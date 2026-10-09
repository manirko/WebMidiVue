<template>
  <LoaderComponent v-if="this.is_loading && !betaBuild" :key="forceRerender"/>
  <div :class="{'biotron-settings-beta': betaBuild}">
    <DeviceTaskNav
        v-if="betaBuild"
        device-name="Biotron"
        active-task="settings"
        play-route="/biotron/play"
        settings-route="/biotron"
    />
    <header :class="{'settings-hero': betaBuild}">
      <h1 class="text-center">{{ betaBuild ? 'Settings' : 'Biotron settings' }}</h1>
      <p v-if="betaBuild" class="settings-hero__intro">Change settings in this browser. Connect Biotron to change settings on the device.</p>
    </header>
    <div v-if="betaBuild && (soundPlayer?.engine || soundPlayer?.midi || soundPlayer?.starting || soundPlayer?.releaseBlocked)" class="alert py-2" :class="soundPlayer?.releaseBlocked ? 'alert-warning' : 'alert-success'" role="status">
      {{ soundPlayer?.releaseBlocked ? 'Release did not finish. Retry Stop.' : soundPlayer?.starting ? 'Connecting sound…' : soundSession.running ? 'Sound stays on while you adjust settings.' : 'Sound is paused. Use Play to resume or stop here.' }}
      <router-link to="/biotron/play" class="alert-link ms-1">Sound &amp; volume</router-link>
      <button type="button" class="btn btn-outline-dark btn-sm ms-2" @click="soundPlayer.stop()">{{ soundPlayer?.releaseBlocked ? 'Retry release' : soundPlayer?.starting ? 'Cancel connection' : 'Stop & release' }}</button>
    </div>
    <section :class="{'beta-connect-card': betaBuild}" aria-label="Connect Biotron">
    <DeviceSelector
        ref="deviceSelector"
        regex-name="Biotron"
        @device_changed="handleDeviceChanged"
        @calibration_state="handleCalibrationState"
        @firmware_version="handleFirmwareVersion"
        @firmware_timeout="handleFirmwareTimeout"
        text_label="Select device"
        check-versions-flag
        allow-daw-handoff
        :class="betaBuild ? 'beta-command' : 'm-2'"
    />
    <div v-if="betaBuild && device && settingsSnapshotKnown" class="calibration-control mt-3">
        <button
            type="button"
            class="btn btn-outline-primary"
            @click="startCalibration"
            :disabled="!device || calibrationBusy || is_loading || !settingsSnapshotKnown"
        >{{ calibrationBusy ? 'Calibrating…' : 'Calibrate plant again' }}</button>
      <span
          v-if="calibrationMessage"
          class="calibration-control__status"
          :class="{'calibration-control__status--active': calibrationBusy}"
          role="status"
          aria-live="polite"
      >{{ calibrationMessage }}</span>
    </div>
    <div v-if="betaBuild && settingsMessage" class="settings-feedback" :class="{'settings-feedback--error': settingsState === 'error'}" role="status" aria-live="polite">
      <span>{{ settingsMessage }}</span>
      <button v-if="settingsState === 'saved'" type="button" class="btn btn-outline-secondary btn-sm" aria-label="Dismiss saved message" @click="settingsMessage = ''">Dismiss</button>
      <button v-if="device && settingsState === 'error' && !settingsSnapshotKnown && !legacyFirmware" type="button" class="btn btn-outline-primary btn-sm" @click="retrySettingsConnection">Retry settings connection</button>
    </div>
    <details v-if="betaBuild" class="diagnostic-copy mt-3">
      <summary>Connection details &amp; diagnostics</summary>
      <DiagnosticCopy :packet="settingsDiagnosticPacket" label="Copy diagnostics for Andrey" />
    </details>
    <UpdateFirmwareComponent v-if="betaBuild && firmwareTestEnabled" class="w-100 mt-3" text="Update firmware" repo="Playtronica/biotron-firmware" :device="device" :current-version="firmwareVersion" version-aware @check_firmware="checkFirmware"/>
    </section>
    <BootstrapCollapse v-if="betaBuild" name_of_collapse="Experiments" :open_by_default="$route.query.experiments === '1'">
      <template v-slot:objects>
        <GroupOfCommands name-of-group="Calibration cues">
          <template v-slot:objects><AudioCompare calibration-only /></template>
        </GroupOfCommands>
        <GroupOfCommands name-of-group="Calmer plant response">
          <template v-slot:objects>
            <p id="calmer-play-help">Reduce extra notes changes and saves three settings: turns off Input variation, turns on Manual control to prevent idle pitch drift, and sets Note repeat to 2 — skipping notes less than two semitones apart. It keeps your tempo, scale and note velocity. Save your current preset first if you want to return to it.</p>
            <button type="button" class="btn btn-outline-primary" aria-describedby="calmer-play-help"
                    @click="reduceExtraNotes" :disabled="!device || calibrationBusy || is_loading || !settingsSnapshotKnown">Reduce extra notes</button>
            <small v-if="!device" class="d-block mt-1">Connect Biotron to try this experiment.</small>
          </template>
        </GroupOfCommands>
      </template>
    </BootstrapCollapse>
    <template v-if="!betaBuild || settingsReady || (page_is_inited && !device)">
    <p v-if="betaBuild && !device" role="status">Local preset — changes stay in this browser. Connect Biotron, then choose Apply preset to Biotron.</p>
    <section :class="{'beta-preset-card': betaBuild}" :inert="betaBuild && is_loading" aria-label="Preset and saved settings">
    <PatchSelector :patches="this.patches" :key="this.forceRerender + this.patchRerender" :page_id="this.id"  text_label="Preset"/>
    <div :class="betaBuild ? 'preset-actions' : 'row row-cols-1 row-cols-sm-2 row-cols-lg-4 g-2 mb-5'">
      <div :class="{'col': !betaBuild}">
        <button @click="change_data_loader" :disabled="!this.device || this.is_loading || (betaBuild && !settingsReady)" class="btn btn-primary w-100 h-100">
          {{ betaBuild ? (is_loading ? (presetPending ? 'Applying preset…' : 'Checking…') : (presetPending ? 'Apply preset to Biotron' : 'Check saved settings')) : 'Send to device' }}
        </button>
      </div>
      <div :class="{'col': !betaBuild}">
        <button @click="this.createPreset" class="btn btn-outline-secondary w-100 h-100">Save preset</button>
      </div>
      <div v-if="!betaBuild" :class="{'col': !betaBuild}">
        <UpdateFirmwareComponent
            class="w-100 h-100"
            text="Update firmware"
            repo="Playtronica/biotron-firmware"
            :device="this.device"
            :current-version="firmwareVersion"
            :version-aware="betaBuild"
            @check_firmware="checkFirmware"
        />
      </div>
      <div :class="{'col': !betaBuild}">
        <FileDropArea name="Load preset" @get_drop="(e) => loadDataFromPreset(e)"/>
      </div>
    </div>
    </section>
  <div :inert="betaBuild && is_loading">
    <BootstrapCollapse name_of_collapse="Plant sensor" open_by_default>
      <template v-slot:objects>
        <GroupOfCommands>
          <template v-slot:objects>
            <div :class="betaBuild ? 'row beta-command' : 'row m-2'">
              <SwitchComponent
                  id="plantVelDis"
                  command-label="🔇 Mute"
                  description="Turns off notes coming off plant sensor."
                  :command-object="commands_data.plant_no_velocity"
                  @input-changed="this.sys_ex_changed"
              />
            </div>
            <SliderCommand
                command-label="🌱 The beat"
                :key="this.forceRerender"
                :command-object="this.commands_data.plantBpm"
                description="Set tempo of plant notes, plant’s BPM."
                @input-changed="this.sys_ex_changed"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SliderCommand
                command-label="🎵 Note hold"
                :key="this.forceRerender"
                :command-object="this.commands_data.noteOffPercent"
                :table-values="this.fractions_note_off"
                description="How long each note plays: 1 = the full beat, 1/2 = half a beat, and 1/64 = a very short note."
                @input-changed="this.sys_ex_changed"
                table-values-reversed
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SliderCommand
                command-label="🏠︎ Home note"
                :key="this.forceRerender"
                :command-object="this.commands_data.middle_plant_note"
                :table-values="this.root_note_id"
                description="The main note everything starts from and returns to."
                @input-changed="this.sys_ex_changed"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SelectCommand
                command-label="🎼 Scale"
                :key="this.forceRerender"
                :list-of-variants="this.scales"
                :command-object="commands_data.scale"
                @input-changed="this.sys_ex_changed"
                description="A set of notes that shape the melody and feel of the music. Choose a scale to define the sound of your composition."
                class="m-3"
            />
          </template>
        </GroupOfCommands>
      </template>
    </BootstrapCollapse>
  </div>

  <div>
    <BootstrapCollapse name_of_collapse="More fun">
      <template v-slot:objects>
        <GroupOfCommands name-of-group="Plant MIDI channel">
          <template v-slot:objects>
            <SliderCommand
                command-label="🎛️ MIDI channel"
                description="Pick a midi channel that the plant would be on"
                :key="this.forceRerender"
                :command-object="this.commands_data.plant_midi_channel"
                @input-changed="this.sys_ex_changed"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
          </template>
        </GroupOfCommands>

        <GroupOfCommands name-of-group="Buttons mode">
          <template v-slot:objects>
            <SwitchComponent
                command-label="Biotron mute pad"
                description="Enable the upper touch pad on Biotron. Touch it to mute notes; touch it again to resume."
                :command-object="this.commands_data.button_mode_state"
                @input-changed="this.sys_ex_changed"

            />
          </template>
        </GroupOfCommands>

        <GroupOfCommands name-of-group="Rhythm">
          <template v-slot:objects>
            <SliderCommand
                command-label="Swing note"
                description="Changes the timing of alternating beats. At 100%, beats are evenly spaced; lower values make one interval shorter and the next longer. Used with the internal tempo; MIDI Clock sets its own timing."
                :key="this.forceRerender"
                :command-object="this.commands_data.swing_first_note_percent"
                @input-changed="this.sys_ex_changed"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
          </template>
        </GroupOfCommands>

        <GroupOfCommands name-of-group="Note velocity">
          <template v-slot:objects>
            <div :class="betaBuild ? 'row beta-command' : 'row m-2'">
              <div class="col">
                <SwitchComponent
                    command-label="🧍 Humanize"
                    description="Varies note velocity between the minimum and maximum values. The minimum value only has an effect while Humanize is on."
                    :command-object="this.commands_data.randomPlantVelocity"
                    @input-changed="this.sys_ex_changed"

                />
              </div>
            </div>

            <div v-if="!commands_data.plant_no_velocity.value">
              <div v-if="!this.commands_data.randomPlantVelocity.value">
                <SliderCommand :key="this.forceRerender"
                               :command-object="commands_data.maxPlantVelocity"
                               @input-changed="this.sys_ex_changed"
                               command-label="💪 Note velocity"
                               description="Intensity range of of notes (volume, expression)."
                               :class="betaBuild ? 'beta-command' : 'm-2'"
                />
              </div>
              <div v-else>
                <SliderRangeCommand :key="this.forceRerender"
                                    :max-command-object="commands_data.maxPlantVelocity"
                                    :min-command-object="commands_data.minPlantVelocity"
                                    @input-changed="this.sys_ex_changed"
                                    command-label="💪 Note velocity"
                                    description="Intensity range of of notes (volume, expression)"
                                    :class="betaBuild ? 'beta-command' : 'm-2'"
                />
              </div>
            </div>
          </template>
        </GroupOfCommands>
        <GroupOfCommands name-of-group="Plant response">
          <template v-slot:objects>
            <div :class="betaBuild ? 'row beta-command' : 'row m-2'">
              <div class="col">
                <SwitchComponent
                    :key="this.forceRerender"
                    command-label="📡 Input variation"
                    :command-object="commands_data.randomness"
                    @input-changed="this.sys_ex_changed"
                    description="Adds a small random 0–9 offset to each new plant-sensor reading before note calculation. It does not increase the sensor's measured sensitivity or control velocity."
                />
              </div>
              <div class="col">
                <SwitchComponent
                    :key="this.forceRerender"
                    command-label="✋ Manual control"
                    :command-object="commands_data.performance"
                    @input-changed="this.sys_ex_changed"
                    description="Prevents slow automatic pitch drift during inactivity. Notes driven by the sensor still play."
                />
              </div>
            </div>

            <SliderCommand
                :key="this.forceRerender"
                :command-object="commands_data.same_note_plant"
                command-label="🔂 Note repeat"
                @input-changed="this.sys_ex_changed"
                description="Skip a note when its pitch is less than this many semitones from the previous note. 0 allows repeats; 1 skips identical notes; 2 skips identical notes and one-semitone changes. This does not change sensor sensitivity."
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SliderCommand
                command-label="🌞 Wake-up"
                :key="this.forceRerender"
                :command-object="this.commands_data.firstValue"
                @input-changed="this.sys_ex_changed"
                description="A little change that wakes up the first note."
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SliderCommand
                command-label="👣 Step size"
                :key="this.forceRerender"
                :command-object="this.commands_data.noteDistance"
                @input-changed="this.sys_ex_changed"
                description="Shapes how strongly sensor changes move through the note sequence. Start at 50, then compare 25 and 75 over several notes."
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
            <SliderCommand
                command-label="⏳ Delay"
                :key="this.forceRerender"
                :command-object="this.commands_data.smoothness"
                @input-changed="this.sys_ex_changed"
                description="How quickly device reacts to change"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
          </template>
        </GroupOfCommands>
      </template>
    </BootstrapCollapse>
  </div>

  <div>
    <BootstrapCollapse name_of_collapse="Light sensor">
      <template v-slot:objects>
        <GroupOfCommands>
          <template v-slot:objects>
            <div :class="betaBuild ? 'row beta-command' : 'row m-2'">
              <div class="col">
                <SwitchComponent
                    id="lightVelDis"
                    command-label="🔇 Mute"
                    :command-object="commands_data.light_no_velocity"
                    @input-changed="this.sys_ex_changed"
                    description="Turns off notes coming off light sensor"
                />
              </div>
              <div class="col">
                <SwitchComponent
                    id="randomLightVelSwitch"
                    command-label="🧍 Humanize"
                    :command-object="this.commands_data.randomLightVelocity"
                    @input-changed="this.sys_ex_changed"
                    description="Varies light-note velocity between the minimum and maximum values. The minimum value only has an effect while Humanize is on."
                />
              </div>
              <div class="col">
                <SwitchComponent
                    id="light_pitch_mode"
                    command-label="〜 Pitch bend"
                    :command-object="this.commands_data.light_pitch_mode"
                    @input-changed="this.sys_ex_changed"
                    description="Uses the light sensor to bend plant notes instead of playing separate light notes. Light Range is ignored while this is on."
                />
              </div>
            </div>
            <p class="small mx-2" role="status" aria-live="polite">{{ lightSensorStatus }}</p>

            <SliderCommand
                command-label="🎛️ MIDI channel"
                description="Pick a midi channel that the light would be on"
                :key="this.forceRerender"
                :command-object="this.commands_data.light_midi_channel"
                @input-changed="this.sys_ex_changed"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />

            <SliderCommand
                command-label="🌞 Every N plant beats"
                :key="this.forceRerender"
                :command-object="this.commands_data.lightBpm"
                @input-changed="this.sys_ex_changed"
                description="Checks the light sensor every N plant beats. The plant tempo sets this counter even when plant notes are muted or unchanged. Used while Pitch Bend is off."
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />

            <SliderCommand
                :key="this.forceRerender"
                :command-object="commands_data.same_note_light"
                command-label="🔂 Note repeat"
                @input-changed="this.sys_ex_changed"
                description="Change the light to change notes (1 = small moves change notes, 10 = big moves needed). 🎶"
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />

            <div class="row" v-if="!commands_data.light_no_velocity.value">
              <div v-if="!this.commands_data.randomLightVelocity.value">
                <SliderCommand
                    :key="this.forceRerender"
                    :command-object="commands_data.maxLightVelocity"
                    @input-changed="this.sys_ex_changed"
                    :name="commands_data.maxLightVelocity.value"
                    command-label="🔨 Note velocity"
                    description="Intensity range of of notes (volume, expression)"
                    :class="betaBuild ? 'beta-command' : 'm-2'"
                />
              </div>
              <div v-else>
                <SliderRangeCommand
                    :key="this.forceRerender"
                    :max-command-object="commands_data.maxLightVelocity"
                    :min-command-object="commands_data.minLightVelocity"
                    @input-changed="this.sys_ex_changed"
                    command-label="🔨 Note velocity"
                    description="Intensity range of of notes (volume, expression)"
                    :class="betaBuild ? 'beta-command' : 'm-2'"
                />
              </div>
            </div>

            <SliderCommand
                v-if="!this.commands_data.light_pitch_mode.value"
                :key="this.forceRerender"
                :command-object="this.commands_data.range_light_note"
                @input-changed="this.sys_ex_changed"
                command-label="📏 Range"
                description="How wide the light-sensor melody can move around the Home Note. Used only while Pitch Bend is off."
                :class="betaBuild ? 'beta-command' : 'm-2'"
            />
          </template>
        </GroupOfCommands>
      </template>
    </BootstrapCollapse>

  </div></template><p v-else class="alert alert-light mx-2" role="status">{{ device ? (settingsState === 'error' ? settingsMessage : 'Reading your Biotron settings… Controls unlock when it answers.') : 'Connect Biotron to unlock its settings. Nothing changes until you choose a device.' }}</p>
  </div>
</template>

<script>
import {createSettingsConnectionMethods} from '@/biotron/settingsConnection.mjs'
import {recordBiotronEvent, recordSettingsState} from '@/biotron/telemetry.mjs'
import {withMidiWriteSession} from "@/assets/js/timing.mjs"
import { saveAs } from '@progress/kendo-file-saver';
import {defineAsyncComponent} from 'vue';
const AudioCompare = defineAsyncComponent(() => import(/* webpackChunkName: "biotron-auditions" */ '@audio-compare'));
import {BiotronCommandsData, BiotronDb} from "@/components/BiotronPage/BiotronIDB"
import FileDropArea from "@/components/MidiComponents/FileDropArea.vue";
import GroupOfCommands from "@/components/MidiComponents/GroupOfCommands.vue";
import SwitchComponent from "@/components/MidiComponents/Switch.vue";
import SliderCommand from "@/components/MidiComponents/SliderCommand.vue";
import SliderRangeCommand from "@/components/MidiComponents/SliderRangeCommand.vue";
import SelectCommand from "@/components/MidiComponents/SelectCommand.vue";
import PatchSelector from "@/components/MidiComponents/PatchSelector.vue";
import DeviceSelector from "@biotron-device-selector";
import UpdateFirmwareComponent from "@/components/MidiComponents/UpdateFirmwareComponent.vue";
import LoaderComponent from "@/components/MidiComponents/LoaderComponent.vue";
import BootstrapCollapse from "@/components/BootstrapCollapse.vue";
import DeviceTaskNav from "@/components/DeviceTaskNav.vue";
import DiagnosticCopy from "@/components/DiagnosticCopy.vue";
import {createListenerScope} from "@/assets/js/ListenerScope.mjs";
import {withPresetFeedback} from "@/assets/js/PresetsIDB.js";
import {getSoundController, soundSessionState, updateSoundSession} from "@/audio/sessionState.mjs";
import {
  applySettingsVector,
  applyCalmerPlay,
  buildSettingsDiagnostic,
  savedSettingsMessage,
  sendBiotronSettings,
  settingsVectorFromCommands,
  settingsVectorsEqual
} from "@/biotron/settingsReadback.mjs";
export default  {
  components: {
    AudioCompare,
    DiagnosticCopy,
    DeviceTaskNav,
    BootstrapCollapse,
    LoaderComponent,
    UpdateFirmwareComponent,
    DeviceSelector,
    PatchSelector,
    SelectCommand,
    SliderRangeCommand,
    SliderCommand,
    SwitchComponent,
    GroupOfCommands,
    FileDropArea},
  props: {
    id: {
      type: String,
      required: true,
    },
  },
  computed: {
    soundPlayer() { return getSoundController() },
    legacyFirmware() { return /^1\.[0-8]\.\d+$/.test(this.firmwareVersion || "") },
    soundSession() { return soundSessionState },
    calibrationBusy() {
      return ["starting", "waiting", "measuring"].includes(this.calibrationState)
    },
    settingsReady() { return Boolean(this.device && this.settingsSnapshotKnown) },
    lightSensorStatus() {
      if (!this.settingsReady) return "Light Sensor state unknown until Biotron settings are read."
      const mode = this.commands_data.light_pitch_mode.value
        ? "Pitch Bend mode: light changes plant-note pitch instead of making separate light notes."
        : this.commands_data.light_no_velocity.value
            ? "Light notes are muted; plant notes can still play."
            : "Light notes are enabled."
      if (["changed", "checking"].includes(this.settingsState)) return `${mode} Saving and checking this change…`
      if (this.settingsState === "error") return `${mode} The latest device check failed; this state is not confirmed.`
      return mode
    }
  },
  watch: {settingsState(state, previous) { if (this.betaBuild) recordSettingsState(state, previous, this.firmwareVersion) }},
  methods: {
    ...createSettingsConnectionMethods({settingsVectorFromCommands, settingsVectorsEqual, savedSettingsMessage}),
    settingsDiagnosticPacket() {
      return buildSettingsDiagnostic(this, process.env.VUE_APP_BUILD_ID || "local-build")
    },
    async handleDeviceChanged(device) {
      this.clearLiveVerification()
      this.settingsLoadId++
      this.device = device
      if (this.betaBuild) recordBiotronEvent('midi.connection_changed', {result: device ? 'ready' : 'stopped', port_count: this.$refs.deviceSelector?.devices?.length})
      this.settingsSnapshotKnown = false
      this.firmwareVersion = ""
      if (!device && this.calibrationBusy) {
        this.calibrationState = "error"
        this.calibrationMessage = "Biotron disconnected — reconnect it and try again."
        updateSoundSession({calibrating: false})
      }
      if (!this.betaBuild) return
      if (!device) {
        this.settingsState = "idle"
        this.settingsMessage = ""
        return
      }
      if (!this.page_is_inited) return
      this.settingsState = "connecting"
      this.settingsMessage = "Checking Biotron firmware…"
    },
    async handleFirmwareVersion(event) {
      if (!this.device || event?.outputId !== this.device.id) return
      this.firmwareVersion = event.version
      if (this.betaBuild && !this.settingsSnapshotKnown && ["connecting", "error"].includes(this.settingsState)) {
        await this.loadPersistedSettings(this.device)
      }
    },
    handleFirmwareTimeout(event) {
      if (!this.betaBuild || !this.device || event?.outputId !== this.device.id ||
          this.settingsSnapshotKnown || this.settingsState !== "connecting") return
      this.settingsState = "error"
      this.settingsMessage = "Biotron did not answer the firmware check. Retry the connection; settings stay locked until they are read."
    },
    async retrySettingsConnection() {
      if (!this.betaBuild || !this.device || this.settingsSnapshotKnown) return
      if (this.firmwareVersion) {
        await this.loadPersistedSettings(this.device)
        return
      }
      this.settingsState = "connecting"
      this.settingsMessage = "Checking Biotron firmware…"
      this.$refs.deviceSelector?.requestFirmwareVersion()
    },
    checkFirmware() { this.$refs.deviceSelector?.requestFirmwareVersion() },
    async loadPersistedSettings(device) {
      if (this.legacyFirmware) { this.settingsState = "error"; this.settingsMessage = "This firmware cannot report saved settings. Update firmware below to unlock Settings; reconnecting will not add this feature."; return }
      const loadId = ++this.settingsLoadId
      this.settingsState = "loading"
      this.settingsMessage = "Reading saved settings from Biotron…"
      try {
        const snapshot = await this.readPersistedSettingsWithRetry(device)
        if (this.device !== device || loadId !== this.settingsLoadId) return
        if (!this.presetPending) applySettingsVector(this.commands_data, snapshot.values)
        this.settingsSnapshotKnown = true
        this.forceRerender++
        this.settingsState = "loaded"
        this.settingsMessage = this.presetPending ? "Device checked. Your local preset is unchanged; choose Apply preset to Biotron." : "Settings loaded. Individual changes apply live; presets need Apply preset to Biotron."
      } catch (error) {
        if (this.device !== device || loadId !== this.settingsLoadId) return
        this.settingsState = "error"
        this.settingsMessage = this.settingsSnapshotKnown
            ? "Saved settings could not be rechecked. Existing controls remain available; retry the check."
            : "Saved settings could not be read. Retry the connection; nothing can be changed until Biotron answers."
      }
    },
    clearLiveVerification() {
      if (this.liveVerifyTimer !== null) clearTimeout(this.liveVerifyTimer)
      this.liveVerifyTimer = null
      this.liveVerifyId++
    },
    startCalibration() {
      if (!this.device || this.calibrationBusy || (this.betaBuild && !this.settingsSnapshotKnown)) return
      this.settingsLoadId++
      if (this.settingsState === "loading") {
        this.settingsState = "idle"
        this.settingsMessage = ""
      }
      this.$refs.deviceSelector?.requestRecalibration()
    },
    handleCalibrationState(event) {
      const messages = {
        starting: "Starting…",
        waiting: "Step away and keep the plant still.",
        measuring: "Measuring… keep the plant and cables still.",
        ready: "Calibration complete — touch the plant.",
        unsupported: "This firmware cannot start calibration here. Reconnect USB to calibrate.",
        timeout: "No stable signal yet. Check both plant clips and try again.",
        error: "Calibration could not start. Reconnect Biotron and try again."
      }
      this.calibrationState = event?.state || "error"
      if (this.betaBuild) recordBiotronEvent('calibration.state_changed', {stage: this.calibrationState, result: this.calibrationState === 'ready' ? 'ready' : ['error', 'timeout', 'unsupported'].includes(this.calibrationState) ? 'failed' : 'started', error_type: this.calibrationState === 'timeout' ? 'calibration_timeout' : undefined})
      this.calibrationMessage = messages[this.calibrationState] || messages.error
      updateSoundSession({calibrating: this.calibrationBusy})
    },
    async change_data_loader() {
      if (!this.device || this.is_loading || (this.betaBuild && !this.settingsSnapshotKnown)) return
      const device = this.device
      const applyingPreset = this.betaBuild && this.presetPending
      const waitForPendingSave = this.betaBuild && this.settingsState === "changed" && !applyingPreset
      this.is_loading = true;
      this.settingsState = this.betaBuild ? "checking" : "saving"
      this.settingsMessage = this.betaBuild
          ? (applyingPreset ? "Applying preset to Biotron…" : "Checking the saved copy…") : ""
      this.forceRerender++;
      try {
        if (this.betaBuild) {
          this.clearLiveVerification()
          this.settingsLoadId++
          if (applyingPreset) {
            await withMidiWriteSession(device, () => this.device, output => sendBiotronSettings(output, this.commands_data))
            await new Promise(resolve => setTimeout(resolve, 1100))
          }
          if (waitForPendingSave) {
            await new Promise(resolve => setTimeout(resolve, 1100))
          }
          if (this.device !== device) throw new Error("Biotron disconnected during check.")
          const expected = settingsVectorFromCommands(this.commands_data)
          const snapshot = await this.readPersistedSettingsWithRetry(device, 1)
          if (snapshot.dirty || !settingsVectorsEqual(snapshot.values, expected)) {
            throw new Error("Saved settings did not match the form.")
          }
          this.settingsState = "saved"
          this.presetPending = false
          this.settingsMessage = savedSettingsMessage(this.lastChangedSetting)
          return
        }
        await withMidiWriteSession(device, () => this.device, async output => {
          await output.wait(100)
          await sendBiotronSettings(output, this.commands_data)
          if (!this.betaBuild) {
            await output.wait(100)
            await this.sendDataDeprecated(output)
          }
        })
      } catch (error) {
        if (this.betaBuild) {
          this.settingsState = "error"
          this.settingsMessage = applyingPreset
              ? "Preset could not be confirmed on Biotron — try Apply preset to Biotron again."
              : "Live changes still work. The saved copy could not be confirmed — try again."
        }
      } finally {
        this.is_loading = false;
        this.forceRerender++;
      }
    },
    async reduceExtraNotes() {
      if (!this.device || this.is_loading || this.calibrationBusy ||
          (this.betaBuild && !this.settingsSnapshotKnown)) return
      const device = this.device
      this.clearLiveVerification()
      this.settingsLoadId++
      this.lastChangedSetting = "reduceExtraNotes"
      this.settingsState = "changed"
      this.settingsMessage = "Applying a calmer plant response…"
      this.is_loading = true
      try {
        const completed = await applyCalmerPlay(device, () => this.device, this.commands_data)
        await this.patchChanged()
        if (!completed) throw new Error("Biotron disconnected while applying calmer play.")
        this.forceRerender++
        this.patchRerender++
        this.scheduleLiveVerification(device)
      } catch (error) {
        if (this.device !== device) return
        this.settingsState = "error"
        this.settingsMessage = "Biotron did not confirm the calmer setup. Reconnect once; no firmware update is needed."
      } finally {
        this.is_loading = false
      }
    },
    async sendDataDeprecated(output) {
      if (output) {
        output.send([240, 11, 16, 127, 247])
        let extraComp = []

        extraComp.push("plantBpm");
        for (let comm in this.commands_data) {
          if (!extraComp.includes(comm)) {
            this.commands_data[comm].sendToMidi(output, [11])
            await output.wait(100);
          }
        }
        output.send([240, 11, 126, 247]);
        await output.wait(100);
        this.commands_data.plantBpm.sendToMidi(output, [11])
      }
    },

    saveData() {
      let state = {}
      for (let val of Object.values(this.commands_data)) {
        state[val.name] = val.value
      }

      return withPresetFeedback(this.id, "autosave", () =>
        this.db.updatePatch(localStorage.getItem(this.id), state))
    },

    async loadData() {
      let preset = await this.db.getPatch(localStorage.getItem(this.id))
      if (!preset) {
        localStorage.setItem(this.id, 1)
        preset = await this.db.getPatch(localStorage.getItem(this.id))
      }

      for (const [key, value] of Object.entries(preset.data)) {
        this.commands_data[key].set_value(value);
      }

      this.forceRerender++;
    },
    createPreset() {
      let state = []
      for (let item in this.commands_data) {
        state.push(this.commands_data[item].toShortDict())
      }

      let value = {"commands": state}
      let myFile = new File([JSON.stringify(value)], "biotron-preset.txt",
          {type: "text/plain;charset=utf-8"})
      saveAs(myFile, "biotron-preset.txt");
    },
    async loadDataFromPreset(e) {
      if (this.betaBuild && this.device && !this.settingsSnapshotKnown) return
      await this.patchChanged();
      for (let item of JSON.parse(e).commands) {
        this.commands_data[item.name].set_value(item.value);
      }
      await this.saveData();
      this.forceRerender++;
      this.markPresetPending()
    },
    async patchChanged() {
      let patch_id = parseInt(localStorage.getItem(this.id));

      if (this.patches.find(item => item.id === patch_id).saved) {
        patch_id = await this.db.getUnsavedPatch();
        this.patches = await this.db.getPatch();
        localStorage.setItem(this.id, patch_id);
      }
      await this.saveData();
    },
    async sys_ex_changed(object) {
      if (this.betaBuild && this.device && !this.settingsSnapshotKnown) return
      const device = this.device, operationId = this.$refs?.deviceSelector?.operationId
      const connectionCurrent = () => this.device === device && this.$refs?.deviceSelector?.operationId === operationId && (!this.betaBuild || !device || this.settingsSnapshotKnown)
      this.settingsLoadId++
      this.lastChangedSetting = object.name
      await this.patchChanged();
      if (!connectionCurrent()) return
      if (this.betaBuild && !this.device) this.markPresetPending()
      if (this.betaBuild && this.presetPending) {
        this.settingsMessage = "Preset edited in browser. Apply preset to Biotron to hear and save it."
        this.forceRerender++;
        this.patchRerender++;
        return
      }
      if (device) await object.sendToMidi(device)
      if (!connectionCurrent()) return
      if (this.betaBuild) {
        this.settingsState = "changed"
        this.settingsMessage = this.device
            ? "Applied live — saving and checking…"
            : "Connect Biotron to apply this setting."
        if (device) this.scheduleLiveVerification(device)
      }
      this.forceRerender++;
      this.patchRerender++;
    },
  },
  data() {
    return {
      betaBuild: process.env.VUE_APP_BIOTRON_PWA_BETA === 'true',
      firmwareTestEnabled: process.env.VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED === 'true',
      page_is_inited: false,
      scales: ["Major", "Minor", "Chrom", "Dorian", "Mixolydian",
        "Lydian", "Wholetone", "Minblues", "Majblues", "Minpen",
        "Majpen", "Diminished", "Hirajōshi"],
      root_note_id: {
        60: 'C4', 61: 'C#4', 62: 'D4', 63: 'D#4', 64: 'E4', 65: 'F4',
        66: 'F#4', 67: 'G4', 68: 'G#4', 69: 'A4', 70: 'A#4', 71: 'B4', 72: 'C5',
      },
      fractions_note_off: {
        64: "1/64", 48: "1/48", 32: "1/32", 24: "1/24", 16: "1/16", 12: "1/12",
        8: "1/8", 6: "1/6", 4: "1/4", 2: "1/2", 1: "1"
      },
      device: null,
      forceRerender: 0,
      patchRerender: 0,
      db: {
        type: BiotronDb
      },
      patches: [],
      is_loading: false,
      calibrationState: "idle",
      calibrationMessage: "",
      settingsState: "idle",
      settingsMessage: "",
      settingsSnapshotKnown: false,
      presetPending: false,
      settingsLoadId: 0,
      liveVerifyTimer: null,
      liveVerifyId: 0,
      lastChangedSetting: "",
      firmwareVersion: "",
      commands_data: Object.fromEntries(BiotronCommandsData),
    }
  },
  async created() {
    if (!localStorage.getItem(this.id)) {
      localStorage.setItem(this.id, "1")
    }

    this.db = new BiotronDb();
    await this.db.ready;

    this.patches = await this.db.getPatch();

    await this.loadData()
    this.forceRerender++;
    this.page_is_inited = true
    if (this.betaBuild && this.device) await this.loadPersistedSettings(this.device)

  },
  mounted() {
    this.listenerScope = createListenerScope()
    if (!this.betaBuild) this.listenerScope.on(document, 'keyup', event => {
      if (event.code === 'Enter' && !this.is_loading) this.change_data_loader();
    })
    this.listenerScope.on(document, 'PatchChanged', async () => {
      await this.loadData();
      this.forceRerender++;
      this.markPresetPending()
    })
    this.listenerScope.on(document, "PatchSave", async (ev) => {
      await withPresetFeedback(this.id, "save", async () => {
        await this.db.savePatch(localStorage.getItem(this.id), ev.detail)
        this.patches = await this.db.getPatch()
        this.patchRerender++;
      })
    })
    this.listenerScope.on(document, 'PatchDelete', async () => {
      await withPresetFeedback(this.id, "delete", async () => {
        await this.db.deletePatch(parseInt(localStorage.getItem(this.id)))
        localStorage.setItem(this.id, "1")
        this.patches = await this.db.getPatch()
        await this.loadData();
        this.forceRerender++;
        this.markPresetPending()
      })
    })
  },
  beforeUnmount() {
    this.clearLiveVerification()
    if (!['settling', 'calibrating'].includes(getSoundController()?.revealStage)) updateSoundSession({calibrating: false})
    this.settingsLoadId++
    this.device = null
    this.listenerScope?.clear()
  }
}
</script>
<style scoped src="./BiotronPageUpdated.css"></style>
