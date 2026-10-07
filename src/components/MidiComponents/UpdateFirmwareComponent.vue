<script>
import {recordFirmwarePhase} from '@/biotron/telemetry.mjs'
import {setFirmwareUpdateBusy} from '@/appUpdateSafety.mjs'
import {bootDevice} from '@/assets/js/SysExCommand'
import {compareFirmwareVersions, DESKTOP_ONLY, GetLatestFirmware, LoadFirmware, prepareFirmware, writeFirmware} from '@/assets/js/LoadFirmware'
const target = process.env.VUE_APP_BIOTRON_FIRMWARE_TARGET
const internalFirmware = target ? {version: target, internal: true,
  name: process.env.VUE_APP_BIOTRON_FIRMWARE_NAME, url: process.env.VUE_APP_BIOTRON_FIRMWARE_URL,
  sha256: process.env.VUE_APP_BIOTRON_FIRMWARE_SHA256, size: Number(process.env.VUE_APP_BIOTRON_FIRMWARE_SIZE)} : null
const PICK = '💾 Choose drive RPI-RP2 → Select. 🍎 Mac: left sidebar · 🪟 Windows: This PC.'
export default {
  emits: ['check_firmware'],
  props: {repo: String, device: Object, currentVersion: {type: String, default: ''},
    versionAware: {type: Boolean, default: false}, text: {type: String, default: 'Update firmware'}},
  data: () => ({online: navigator.onLine, latest: internalFirmware, phase: 'idle', message: '', error: '', pick: PICK, desktopOnly: DESKTOP_ONLY,
    prepared: null, checking: false, reconnectTimer: null, updaterUnmounted: false, runStepPending: false}),
  computed: {
    available() { return Boolean(this.currentVersion && this.latest?.version && compareFirmwareVersions(this.latest.version, this.currentVersion) > 0) },
    current() { return Boolean(this.currentVersion && this.latest?.version && !this.available) },
    internal() { return Boolean(this.latest?.internal) },
    manualBoot() { return Boolean(this.currentVersion && compareFirmwareVersions(this.currentVersion, '1.7.4') < 0) },
    canInstall() { return Boolean(window.showDirectoryPicker) },
    // No MIDI answer: Biotron may already sit in update mode as the RPI-RP2 drive (page reloaded or USB replugged mid-update).
    recovery() { return this.internal && this.versionAware && !this.currentVersion },
    ready() { return this.available || this.recovery },
    busy() { return ['preparing', 'booting', 'writing', 'reconnecting'].includes(this.phase) },
    buttonText() {
      if (this.checking) return 'Checking firmware…'
      if (this.versionAware && !this.currentVersion) return this.device ? 'Check firmware' : 'Already see RPI-RP2? Recover firmware'
      if (this.current) return compareFirmwareVersions(this.currentVersion, this.latest.version) > 0 ? `Firmware ${this.currentVersion} · newer than this beta` : `Firmware ${this.currentVersion} ✓`
      if (this.available) return `Update to ${this.latest.version}`
      return this.text
    },
    actionText() {
      if (!this.internal) return 'Update'
      return {idle: '⬇️ Download & check', 'preflight-error': '🔁 Try again', prepared: this.manualBoot ? 'Continue with manual BOOT' : '🔄 Restart Biotron',
        'select-drive': '💾 Choose RPI-RP2 → install'}[this.phase] || ''
    },
    actionDisabled() { return this.busy || !this.online || (this.internal ? this.phase === 'prepared' && !this.device : !this.device) }
  },
  mounted() {
    window.addEventListener('online', this.syncOnline)
    window.addEventListener('offline', this.syncOnline)
    if (this.versionAware && this.currentVersion && !this.latest) this.refresh()
  },
  beforeUnmount() {
    this.updaterUnmounted = true
    // An in-flight write/BOOT/download keeps its guard until runStep settles.
    setFirmwareUpdateBusy(this, this.runStepPending)
    window.removeEventListener('online', this.syncOnline); window.removeEventListener('offline', this.syncOnline)
    clearTimeout(this.reconnectTimer)
  },
  watch: {phase: {immediate: true, flush: 'sync', handler(value) {
    recordFirmwarePhase(value, this.currentVersion, this.latest?.version)
    setFirmwareUpdateBusy(this, ['preparing', 'booting', 'select-drive', 'writing', 'reconnecting'].includes(value))
  }}, currentVersion(value) {
    if (this.versionAware && value && !this.latest) this.refresh()
    if (this.phase === 'reconnecting' && value === this.latest?.version) {
      clearTimeout(this.reconnectTimer); this.prepared = null; this.phase = 'complete'
      this.message = `🎉 Firmware ${value} installed and verified.`
    }
  }},
  methods: {
    syncOnline() { this.online = navigator.onLine; if (this.online) this.error = '' },
    async refresh() {
      if (!this.online || this.checking) return
      this.checking = true
      try { this.latest = await GetLatestFirmware(this.repo); this.error = '' }
      catch (error) { this.error = error.message }
      finally { this.checking = false }
    },
    async runStep() {
      this.error = ''
      this.runStepPending = true
      if (!this.internal) {
        setFirmwareUpdateBusy(this, true)
        try { await LoadFirmware(this.repo, this.device) } catch (error) { this.error = error.message }
        finally { this.runStepPending = false; setFirmwareUpdateBusy(this, false) }
        return
      }
      try {
        if (['idle', 'preflight-error'].includes(this.phase)) {
          if (!this.canInstall) throw new Error(DESKTOP_ONLY)
          this.phase = 'preparing'; this.message = '⬇️ Downloading and checking firmware…'
          this.prepared = await prepareFirmware(this.latest); this.phase = this.device ? 'prepared' : 'select-drive'
          this.message = `✅ Firmware ${this.latest.version} is checked and held in this page — nothing was saved to your computer. ${this.device ? 'Biotron not restarted yet.' : PICK}`
        } else if (this.phase === 'prepared') {
          if (this.manualBoot) {
            this.phase = 'select-drive'
            this.message = `Use your model’s hardware BOOT instructions to enter update mode. Settings may be reset by older firmware. Once RPI-RP2 appears, ${PICK}`
            return
          }
          this.phase = 'booting'; this.message = '🔄 Restarting Biotron…'; await bootDevice(this.device)
          this.phase = 'select-drive'; this.message = `🔄 Biotron is now drive RPI-RP2. ${PICK}`
        } else if (this.phase === 'select-drive') {
          this.phase = 'writing'; await writeFirmware(this.prepared, this.latest); this.phase = 'reconnecting'
          if (this.updaterUnmounted) return
          this.message = `📤 Copied. ⏳ Waiting for Biotron ${this.latest.version}…`
          this.reconnectTimer = setTimeout(() => {
            if (this.phase !== 'reconnecting') return
            this.phase = 'verification-error'; this.error = 'Expected firmware did not reconnect. Reconnect USB and check its version before retrying.'
          }, 30000)
        }
      } catch (error) {
        if (error?.name === 'AbortError') { this.phase = 'select-drive'; this.message = `❌ No drive chosen. ${PICK}`; return }
        if (this.phase === 'writing') { this.phase = 'select-drive'; this.error = error.message; return }
        this.error = error.message; this.phase = ['idle', 'preparing', 'preflight-error'].includes(this.phase) ? 'preflight-error' : `${this.phase}-error`
      } finally {
        this.runStepPending = false
        if (this.updaterUnmounted) setFirmwareUpdateBusy(this, false)
      }
    }
  }
}
</script>
<template>
  <button v-if="versionAware && !currentVersion && device" type="button" class="btn btn-primary" :class="$attrs.class"
          @click="$emit('check_firmware')">{{ buttonText }}</button>
  <button v-else data-bs-toggle="modal" data-bs-target="#UpdateConf" class="btn" :class="[recovery ? 'btn-outline-secondary' : 'btn-primary', $attrs.class]"
          :disabled="checking || current">{{ buttonText }}</button>
  <div class="modal fade" id="UpdateConf" tabindex="-1" aria-labelledby="firmware-title" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title" id="firmware-title">💾 Update firmware</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body">
        <p v-if="available" class="firmware-version">Installed <strong>{{ currentVersion }}</strong> <span aria-hidden="true">→</span> Beta update <strong>{{ latest.version }}</strong></p>
        <ol v-if="internal && ready" class="firmware-steps"><li>Download and verify the file.</li><li>Restart into update mode.</li><li>Choose RPI-RP2 and wait for the version check.</li></ol>
        <p v-if="manualBoot" class="alert alert-warning">This older firmware needs the hardware BOOT procedure for your model. Export your preset first; saved settings may be reset. No software BOOT command will be sent.</p>
        <p v-if="recovery">🔌 No Biotron over MIDI. 💾 Drive <strong>RPI-RP2</strong> on your computer? → Install {{ latest.version }} now.</p>
        <p v-if="internal && ready && !canInstall">{{ desktopOnly }}</p>
        <p v-if="internal && ready && canInstall">✅ File is checked first. 💾 Then you choose drive RPI-RP2.</p>
        <p v-if="internal && ready && canInstall" class="small text-muted">{{ pick }} 🍎 Tip: ⌘⇧G → /Volumes/RPI-RP2</p>
        <p v-if="internal && ready" class="small text-muted">
          Or do it by hand: <a :href="latest.url" :download="latest.name">save {{ latest.name }}</a>, then copy the saved file onto the disk named RPI-RP2.
        </p>
        <p v-if="current" class="alert alert-success mb-0">Firmware {{ currentVersion }} is already installed. This beta offers {{ latest.version }}; no downgrade is offered.</p>
        <p v-if="!online" class="alert alert-warning mb-0">Connect to the internet for firmware updates. Settings remain available offline.</p>
        <p v-if="error" class="alert alert-danger mb-0" role="alert">{{ error }}</p>
        <p v-if="message" class="alert alert-info mb-0" role="status" aria-live="polite">{{ message }}</p>
      </div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button v-if="ready && actionText && (!internal || canInstall)" type="button" class="btn btn-primary" :disabled="actionDisabled" @click="runStep">{{ actionText }}</button>
        <button v-if="busy" type="button" class="btn btn-primary" disabled>⏳ Working…</button></div>
    </div></div>
  </div>
</template>

<style scoped>
.modal-body { padding:1.5rem; line-height:1.6; }
.modal-header,.modal-footer { padding:1.25rem 1.5rem; gap:.75rem; }
.firmware-version { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }
.firmware-steps { padding-left:1.25rem; margin:1.5rem 0; }
.firmware-steps li { margin:.5rem 0; padding-left:.25rem; }
.modal-body .alert { margin-top:1rem; }
@media(max-width:575.98px) { .modal-body,.modal-header,.modal-footer { padding:1rem; } .modal-footer .btn { flex:1; min-height:44px; } }
</style>
