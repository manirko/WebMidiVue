<template>
  <div class="mb-3">
    <div class="form-floating">
      <select id="biotron-device" v-model.number="currentMidiNum" class="form-control" @change="deviceChanged" :disabled="released || connecting">
        <option v-for="(device, key) in devices" :key="device.output.id" :value="key">
          {{ device.output.name }} {{ versions[device.output.id] }}
        </option>
      </select>
      <label for="biotron-device">{{ text_label }}</label>
    </div>
    <small v-if="connecting && !selectedDevice" class="text-muted">{{ promptHint }}</small>
    <button v-if="connecting && !selectedDevice" type="button" class="btn btn-outline-secondary mt-2" @click="cancelConnection">Cancel connection</button>
    <div v-if="allowDawHandoff && (selectedDevice || released)" class="daw-handoff d-flex flex-column flex-sm-row gap-2 align-items-stretch align-items-sm-center mt-2">
      <button v-if="!released" type="button" class="btn btn-outline-primary daw-handoff__button" @click="releaseMidi" :disabled="connecting || !selectedDevice">
        Release device for DAW
      </button>
      <button v-else type="button" class="btn btn-primary daw-handoff__button" @click="connectMidi" :disabled="connecting">
        Reconnect settings
      </button>
      <small class="text-muted">
        {{ released ? "The selected MIDI port is free for Reaper, Ableton, or another app. Sound in this tab stays off until you reconnect." : "Windows may allow only one app to use a MIDI port. Release the selected device before opening your DAW." }}
      </small>
    </div>
    <button
        v-if="!released && !selectedDevice && midiError"
        type="button"
        class="btn btn-primary mt-2"
        @click="connectMidi"
        :disabled="connecting"
    >
      Retry connection
    </button>
    <div v-if="midiError" class="alert alert-warning mt-2 mb-0" role="alert">{{ midiError }} <a href="/midi-access.html" target="_blank" rel="noopener">Browser help</a></div>
  </div>
</template>

<script>
  import {buildSettingsQuery, parseSettingsResponse} from "@/biotron/settingsReadback.mjs";
  import {MIDI_PROMPT_HINT, requestSharedMidiAccess} from "@/audio/midiAccess.mjs";
  import {soundSessionState, stopPersistentSound} from "@/audio/sessionState.mjs";
  const portIdentity = (port) => [port.manufacturer || "", port.name || ""].join("\u0000");
  const androidCablePair = (devices) => /android/i.test(navigator.userAgent || "") && devices.length === 2 && devices.every((device) => device.input && portIdentity(device.output) === portIdentity(devices[0].output) && portIdentity(device.input) === portIdentity(devices[0].input));
  // 123 is reserved for persisted-settings readback in firmware protocol v1.
  const RECALIBRATE_COMMAND = 125;
  const RECALIBRATE_WAITING = 1;
  const RECALIBRATE_MEASURING = 2;
  const RECALIBRATE_READY = 3;
  const requestMidiAccess = (signal) => {
    return requestSharedMidiAccess({sysex: true, signal});
  };
  export default {
    props: {
      regexName: {
        default: ".*",
        type: String
      },
      checkVersionsFlag: {
        default: false,
        type: Boolean
      },
      allowDawHandoff: {
        default: false,
        type: Boolean
      },
      text_label: {
        default: "Select device",
        type: String,
      },
    },
    emits: ["device_changed", "calibration_state", "firmware_version", "firmware_timeout"],
    name: "DeviceSelector",
    data() {
      return {
        devices: [],
        versions: {},
        currentMidiNum: 0,
        updateTimeout: null,
        versionRequest: null,
        midiAccess: null,
        selectedDevice: null,
        released: false,
        connecting: false,
        permissionAbort: null,
        midiError: "",
        promptHint: MIDI_PROMPT_HINT,
        operationId: 0,
        unmounted: false,
        recalibrationNonce: 0,
        recalibrationRequest: null,
        settingsReadbackNonce: 0,
        settingsReadbackRequest: null
      }
    },
    methods: {
      matchingPorts(ports) {
        return [...ports.values()].filter((port) => port.name && port.name.match(this.regexName) && !/(?:midi(?:in|out)2|port 2|midi 2)/i.test(port.name));
      },
      pairDevices(midi) {
        const inputsByIdentity = new Map();
        for (const input of this.matchingPorts(midi.inputs)) {
          const identity = portIdentity(input);
          if (!inputsByIdentity.has(identity)) inputsByIdentity.set(identity, []);
          inputsByIdentity.get(identity).push(input);
        }

        const devices = this.matchingPorts(midi.outputs).map((output) => {
          const matchingInputs = inputsByIdentity.get(portIdentity(output)) || [];
          return {output, input: matchingInputs.shift()};
        });
        // Android names one device's two USB MIDI cables alike; cable 0 is music/settings.
        return androidCablePair(devices) ? [devices[0]] : devices;
      },
      hasAmbiguousIdentity(devices) {
        const counts = new Map();
        for (const device of devices) {
          const identity = portIdentity(device.output);
          counts.set(identity, (counts.get(identity) || 0) + 1);
        }
        return [...counts.values()].some((count) => count > 1);
      },
      midiReady(midi) {
        this.midiAccess = midi;
        midi.onstatechange = () => {
          if (!this.released && !this.connecting) this.refreshDevices();
        };
        return this.refreshDevices();
      },
      async connectMidi() {
        if (this.connecting) return;
        const operationId = ++this.operationId;
        const permissionAbort = new AbortController();
        this.permissionAbort = permissionAbort;
        this.clearVersionRequest();
        this.connecting = true;
        this.midiError = "";
        try {
          const midi = this.midiAccess || await requestMidiAccess(permissionAbort.signal);
          if (operationId !== this.operationId || this.unmounted) return;
          this.released = false;
          await this.midiReady(midi);
        } catch (err) {
          if (operationId === this.operationId && !this.unmounted) {
            if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
              this.midiError = "MIDI access was blocked. Allow MIDI and SysEx for this site, then retry.";
            } else if (!navigator.requestMIDIAccess) {
              this.midiError = "Device connection isn’t available in this browser. Open browser help for connection steps.";
            } else {
              this.midiError = "Could not open the MIDI port. Close your DAW or other MIDI apps, then retry.";
            }
          }
          if (err?.name !== 'AbortError') console.log('Something went wrong', err);
        } finally {
          if (this.permissionAbort === permissionAbort) this.permissionAbort = null;
          if (operationId === this.operationId && !this.unmounted) this.connecting = false;
        }
      },
      cancelConnection() {
        if (!this.connecting) return;
        ++this.operationId;
        this.permissionAbort?.abort();
        this.permissionAbort = null;
        if (this.midiAccess) this.midiAccess.onstatechange = null;
        this.selectedDevice = null;
        this.$emit('device_changed', undefined);
        this.connecting = false;
        this.midiError = 'MIDI connection cancelled. The browser permission prompt may remain open; press Retry after answering it.';
      },
      clearUpdateTimeout() {
        if (this.updateTimeout !== null) clearTimeout(this.updateTimeout);
        this.updateTimeout = null;
      },
      clearVersionRequest() {
        if (this.versionRequest) clearTimeout(this.versionRequest.timeout);
        this.versionRequest = null;
      },
      clearRecalibrationRequest() {
        const request = this.recalibrationRequest;
        if (!request) return;
        clearTimeout(request.ackTimeout);
        clearTimeout(request.completionTimeout);
        this.recalibrationRequest = null;
      },
      clearSettingsReadbackRequest(error = null) {
        const request = this.settingsReadbackRequest;
        if (!request) return;
        clearTimeout(request.timeout);
        this.settingsReadbackRequest = null;
        if (error) request.reject(error);
      },
      requestPersistedSettings() {
        const device = this.selectedDevice;
        if (!device || this.released) {
          return Promise.reject(new Error("Biotron is not connected."));
        }
        this.clearSettingsReadbackRequest(new Error("Settings read was replaced by a newer request."));
        this.settingsReadbackNonce = (this.settingsReadbackNonce % 127) + 1;
        const nonce = this.settingsReadbackNonce;
        return new Promise((resolve, reject) => {
          const request = {
            nonce,
            resolve,
            reject,
            timeout: setTimeout(() => {
              if (this.settingsReadbackRequest !== request) return;
              this.settingsReadbackRequest = null;
              reject(new Error("Biotron did not return saved settings."));
            }, 2500)
          };
          this.settingsReadbackRequest = request;
          try {
            device.output.send(buildSettingsQuery(nonce));
          } catch (error) {
            this.clearSettingsReadbackRequest(error);
          }
        });
      },
      requestRecalibration() {
        const device = this.selectedDevice;
        if (!device || this.released || this.connecting) {
          this.$emit("calibration_state", {state: "error"});
          return;
        }
        this.clearRecalibrationRequest();
        const cancellation = new Error("Settings read was cancelled by calibration.");
        cancellation.name = "AbortError";
        this.clearSettingsReadbackRequest(cancellation);
        this.recalibrationNonce = (this.recalibrationNonce + 1) & 0x7f;
        const nonce = this.recalibrationNonce;
        const request = {
          nonce,
          ackTimeout: null,
          completionTimeout: null
        };
        this.recalibrationRequest = request;
        this.$emit("calibration_state", {state: "starting"});
        request.ackTimeout = setTimeout(() => {
          if (this.recalibrationRequest !== request) return;
          this.clearRecalibrationRequest();
          this.$emit("calibration_state", {state: "unsupported"});
        }, 1800);
        try {
          device.output.send([0xf0, 0x14, 0x0d, RECALIBRATE_COMMAND, nonce, 0xf7]);
        } catch (error) {
          this.clearRecalibrationRequest();
          this.$emit("calibration_state", {state: "error"});
          console.log("Could not request Biotron calibration", error);
        }
      },
      async closeDevice(device) {
        if (!device) return [];
        const failures = [];
        if (device.input) device.input.onmidimessage = null;
        for (const port of [device.input, device.output].filter(Boolean)) {
          try {
            await port.close();
          } catch (err) {
            failures.push(port.name);
            console.log('Could not close MIDI port', err);
          }
        }
        return failures;
      },
      async releaseMidi() {
        const operationId = ++this.operationId;
        this.connecting = true;
        this.clearUpdateTimeout();
        this.clearVersionRequest();
        this.clearRecalibrationRequest();
        this.clearSettingsReadbackRequest(new Error("MIDI device changed."));
        this.midiError = "";
        if (soundSessionState.running && !await stopPersistentSound()) {
          this.connecting = false;
          this.midiError = "Sound could not release the MIDI port. Return to Play and press Stop & release, then retry.";
          return;
        }
        if (this.midiAccess) this.midiAccess.onstatechange = null;

        const device = this.selectedDevice;
        const failures = await this.closeDevice(device);
        if (operationId !== this.operationId) return;
        this.connecting = false;

        if (failures.length) {
          this.midiError = `Could not release: ${[...new Set(failures)].join(", ")}. Retry, or close this tab before opening your DAW.`;
          this.released = false;
          this.$emit("device_changed", undefined);
          return;
        }

        this.selectedDevice = null;
        this.released = true;
        this.$emit("device_changed", undefined);
      },
      async refreshDevices() {
        if (!this.midiAccess || this.released) return;
        this.clearVersionRequest();
        const previousOutputId = this.selectedDevice && this.selectedDevice.output.id;
        this.devices = this.pairDevices(this.midiAccess);
        if (this.hasAmbiguousIdentity(this.devices)) {
          this.clearUpdateTimeout();
          const failures = await this.closeDevice(this.selectedDevice);
          if (failures.length) {
            this.$emit("device_changed", undefined);
            this.midiError = `More than one identical device is connected, and ${[...new Set(failures)].join(", ")} did not close. Disconnect the extra device, then retry Release.`;
            this.connecting = false;
            return;
          }
          this.selectedDevice = null;
          this.$emit("device_changed", undefined);
          this.midiError = "More than one identical device is connected. Disconnect the others so Settings can match the correct MIDI input and output.";
          this.connecting = false;
          return;
        }
        if (!this.devices.length) {
          this.selectedDevice = null;
          this.$emit("device_changed", undefined);
          this.midiError = "No matching MIDI device found. Connect it with a USB data cable, then retry.";
          this.connecting = false;
          return;
        }
        const previousIndex = this.devices.findIndex((device) => device.output.id === previousOutputId);
        if (previousIndex >= 0) this.currentMidiNum = previousIndex;
        else if (!this.devices[this.currentMidiNum]) this.currentMidiNum = 0;
        await this.deviceChanged();
      },
      async deviceChanged() {
        if (this.released) return;
        const operationId = ++this.operationId;
        this.connecting = true;
        this.clearUpdateTimeout();
        this.clearVersionRequest();
        this.clearRecalibrationRequest();
        this.midiError = "";

        const previousDevice = this.selectedDevice;
        const nextDevice = this.devices[this.currentMidiNum];
        if (previousDevice && (!nextDevice || previousDevice.output.id !== nextDevice.output.id)) {
          const failures = await this.closeDevice(previousDevice);
          if (operationId !== this.operationId || this.unmounted) return;
          if (failures.length) {
            const previousIndex = this.devices.findIndex((device) => device.output.id === previousDevice.output.id);
            if (previousIndex >= 0) this.currentMidiNum = previousIndex;
            this.connecting = false;
            this.$emit("device_changed", undefined);
            this.midiError = `Could not switch devices: ${[...new Set(failures)].join(", ")} did not close. Retry, or close this tab.`;
            return;
          }
        }
        if (operationId !== this.operationId || this.unmounted) return;

        this.selectedDevice = nextDevice || null;
        if (!nextDevice) {
          this.connecting = false;
          this.$emit("device_changed", undefined);
          return;
        }

        try {
          await nextDevice.output.open();
          if (nextDevice.input) {
            await nextDevice.input.open();
            if (operationId !== this.operationId || this.unmounted) {
              await this.closeDevice(nextDevice);
              return;
            }
            nextDevice.input.onmidimessage = (event) => this.handleMidiMessage(event, operationId);
          }
          if (operationId !== this.operationId || this.unmounted) {
            await this.closeDevice(nextDevice);
            return;
          }
          this.$emit("device_changed", nextDevice.output);
          this.scheduleVersionQuery(nextDevice, operationId);
        } catch (err) {
          await this.closeDevice(nextDevice);
          if (operationId === this.operationId && !this.unmounted) {
            this.selectedDevice = null;
            this.$emit("device_changed", undefined);
            this.midiError = "Could not open the selected device. Another MIDI app may be using it.";
          }
          console.log('Could not open MIDI port', err);
        } finally {
          if (operationId === this.operationId && !this.unmounted) this.connecting = false;
        }
      },
      scheduleVersionQuery(device, operationId) {
        if (!this.checkVersionsFlag) return;
        this.updateTimeout = setTimeout(() => {
          this.updateTimeout = null;
          if (operationId !== this.operationId || this.released || this.selectedDevice !== device) return;
          this.requestFirmwareVersion();
        }, 120);
      },
      requestFirmwareVersion() {
        if (!this.checkVersionsFlag || !this.selectedDevice || this.released || this.unmounted) return false;
        this.clearVersionRequest();
        const device = this.selectedDevice;
        const request = {device, operationId: this.operationId, outputIndex: this.currentMidiNum, timeout: null};
        this.versionRequest = request;
        request.timeout = setTimeout(() => {
          if (this.versionRequest !== request || this.selectedDevice !== device ||
              this.operationId !== request.operationId || this.released || this.unmounted) return;
          this.clearVersionRequest();
          this.$emit("firmware_timeout", {outputId: device.output.id});
        }, 2500);
        try {
          device.output.send([240, 20, 13, 126, request.outputIndex, 247]);
          return true;
        } catch (err) {
          this.clearVersionRequest();
          this.midiError = "Could not query the selected device.";
          this.$emit("firmware_timeout", {outputId: device.output.id});
          return false;
        }
      },
      handleMidiMessage(event, operationId) {
        if (operationId !== this.operationId || this.released) return;
        const data = [...event.data];
        const settingsRequest = this.settingsReadbackRequest;
        if (settingsRequest) {
          const snapshot = parseSettingsResponse(data, settingsRequest.nonce);
          if (snapshot) {
            clearTimeout(settingsRequest.timeout);
            this.settingsReadbackRequest = null;
            if (snapshot.valid) settingsRequest.resolve(snapshot);
            else settingsRequest.reject(new Error("Biotron has no valid saved settings."));
            return;
          }
        }
        const request = this.recalibrationRequest;
        if (request && data.length === 6 && data[0] === 0xf0 && data[1] === 0x0b &&
            data[2] === RECALIBRATE_COMMAND && data[3] === request.nonce && data[5] === 0xf7) {
          const state = data[4];
          if (![RECALIBRATE_WAITING, RECALIBRATE_MEASURING, RECALIBRATE_READY].includes(state)) return;
          clearTimeout(request.ackTimeout);
          request.ackTimeout = null;
          if (request.completionTimeout === null) {
            request.completionTimeout = setTimeout(() => {
              if (this.recalibrationRequest !== request) return;
              this.clearRecalibrationRequest();
              this.$emit("calibration_state", {state: "timeout"});
            }, 25000);
          }
          const stateName = state === RECALIBRATE_WAITING ? "waiting" :
              state === RECALIBRATE_MEASURING ? "measuring" : "ready";
          if (state === RECALIBRATE_READY) this.clearRecalibrationRequest();
          this.$emit("calibration_state", {state: stateName});
          return;
        }
        const [start_sys_ex, flag_byte, num_com, id_of_output, x, y, z, end_sys_ex] = event.data;
        if (start_sys_ex === 0xF0 && end_sys_ex === 0xF7 && flag_byte === 0x0B &&
            num_com === 126 && event.data.length === 8 && id_of_output === this.currentMidiNum) {
          const pending = this.versionRequest;
          if (!pending || pending.device !== this.selectedDevice ||
              pending.operationId !== operationId || pending.outputIndex !== id_of_output) return;
          this.clearVersionRequest();
          const version = `${x}.${y}.${z}`;
          const outputId = this.selectedDevice.output.id;
          this.versions[outputId] = `v${version}`;
          this.$emit("firmware_version", {version, outputId});
        }
      }
    },
    mounted() {
      this.connectMidi();
    },
    beforeUnmount() {
      this.unmounted = true;
      ++this.operationId;
      this.permissionAbort?.abort();
      this.permissionAbort = null;
      this.clearUpdateTimeout();
      this.clearVersionRequest();
      this.clearRecalibrationRequest();
      this.clearSettingsReadbackRequest(new Error("Settings page closed."));
      if (this.midiAccess) this.midiAccess.onstatechange = null;
      // An in-flight lifecycle operation observes operationId and closes its
      // device. Avoid racing it with a second close from the unmount hook.
      if (!this.connecting) {
        const device = this.selectedDevice;
        if (device?.input) device.input.onmidimessage = null;
        // Play and Settings share the same SysEx-enabled MIDI access. Keep the
        // input open only while the persistent sound session owns it.
        if (soundSessionState.running && device) this.closeDevice({output: device.output});
        else this.closeDevice(device);
      }
    }
  }
</script>

<style scoped>

.daw-handoff__button {
  flex: 0 0 auto;
  white-space: nowrap;
}

.daw-handoff small {
  line-height: 1.4;
  text-align: left;
}

@media (max-width: 575.98px) {
  .daw-handoff__button {
    width: 100%;
    white-space: normal;
  }
}

</style>
