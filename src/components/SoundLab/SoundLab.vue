<template>
  <section
    class="sound-lab"
    :data-audio-state="audioState"
    :data-active-voices="voiceCount"
    :data-quality="lowCpu ? 'safe' : 'standard'"
    :data-tab-lease="tabLeaseState"
    :data-reveal-stage="revealMode ? revealStage : null"
    :data-volume="volume"
    :data-audio-capability="capabilities.audio ? 'available' : 'unavailable'"
    :data-midi-capability="capabilities.midi ? 'available' : 'unavailable'"
  >
    <template v-if="revealMode">
      <DeviceTaskNav
        :device-name="revealProfile.productName"
        active-task="play"
        :play-route="`/${revealProfile.id}/play`"
        :settings-route="revealProfile.settingsRoute"
      />
      <header class="sound-lab__intro sound-lab__intro--reveal">
        <small>{{ revealProfile.eyebrow }}</small>
        <h1>{{ revealProfile.title }}</h1>
        <p>{{ revealProfile.promise }}</p>
      </header>

      <section class="sound-lab__reveal" aria-labelledby="device-reveal-title">
        <GardenVisual ref="garden" :stage="revealStage" />
        <div class="sound-lab__reveal-copy">
          <small v-if="recognizedInput && revealStage !== 'intro'" class="sound-lab__recognized" :title="recognizedInput">Device connected</small>
          <h2 id="device-reveal-title">{{ revealStage === 'revealed' ? (midiActive ? 'Notes arriving' : 'Ready for the next note') : revealCopy.heading }}</h2>
          <p>{{ revealCopy.instruction }}</p>
          <details v-if="revealStage === 'intro'" class="play-help"><summary>Connection steps</summary><ol><li>Push both contact cables onto the device’s CONTACT PINS.</li><li>Clip them to two separate points on the same plant.</li><li>Connect USB with a data cable, then press Start listening.</li></ol></details>

          <div v-if="revealIssue" class="sound-lab__connect-notice" role="status" aria-live="polite">
            <strong>{{ revealIssue.title }}</strong>
            <span>{{ revealIssue.body }}</span>
          </div>

          <div class="sound-lab__reveal-actions">
            <button
              v-if="revealStage === 'intro' || (engine && ['suspended', 'interrupted'].includes(audioState) && !releaseBlocked)"
              type="button"
              class="btn btn-dark"
              @click="revealStage === 'intro' ? startReveal() : resumeSound()"
              :disabled="starting || releaseBlocked || !canStartReveal"
            >{{ revealStage === 'intro' ? revealProfile.startLabel : 'Resume sound' }}</button>
            <button v-if="permissionPending" type="button" class="btn btn-outline-secondary" @click="cancelMidiPermission()">Cancel MIDI request</button>
            <button
              v-if="engine || midi"
              type="button"
              class="btn btn-outline-dark"
              @click="stop"
              :disabled="starting && !midiOpening && !audioStarting"
            >Stop &amp; release</button>
            <button
              v-if="engine && revealStage !== 'intro'"
              type="button"
              class="btn btn-outline-danger"
              @click="stop"
            >Stop listening</button>
          </div>
          <label class="sound-lab__volume" for="biotron-play-volume">
            <span>Volume</span>
            <WakeVolume id="biotron-play-volume" :value="volume" @input="updateVolume" />
            <output for="biotron-play-volume">{{ volume }}%</output>
          </label>
          <span class="sound-lab__status sound-lab__status--reveal" role="status" aria-live="polite">{{ status }}</span>
          <details class="play-help" v-if="engine || revealIssue">
            <summary>No sound? · Help</summary>
            <p>Incoming notes move the visual. To hear them, the browser audio must also be running.</p>
            <ol><li>Check Volume here and on your computer or phone.</li><li>Check which speakers or headphones your device is using.</li><li v-if="audioState !== 'running'">Press Resume sound if available, or stop and start listening again.</li><li v-else>If notes are arriving but you hear nothing, try a different sound below.</li></ol>
            <p class="play-audio-state">Browser audio: {{ audioState === 'running' ? 'running' : audioState }}. Only you can confirm that sound is audible.</p>
            <div class="sound-lab__diagnostic"><button type="button" class="btn btn-outline-secondary btn-sm" @click="copyPlayDiagnostics">Copy diagnostics</button><small>{{ diagnosticMessage || 'Copies audio, MIDI and version details for support.' }}</small></div>
            <div v-if="firstSoundOutcome" class="sound-lab__task-feedback"><h3>Can you hear the notes?</h3><div class="sound-lab__reveal-actions"><a :href="firstSoundFeedbackUrl('helped')" @click="recordFirstSound('heard')" class="btn btn-outline-dark" target="_blank" rel="noopener">Yes — WhatsApp</a><a :href="firstSoundFeedbackUrl('not_yet')" @click="recordFirstSound('not_heard')" class="btn btn-outline-dark" target="_blank" rel="noopener">Not yet — WhatsApp</a></div><small>Opens a draft with the version and stop point. Send it to share.</small></div>
          </details>
        </div>
      </section>
      <small class="garden-credit">Visual adapted from <a href="https://dasprinzip.com/tinker/day41/" target="_blank" rel="noopener">Garden Anomaly · Frank Reitberger</a>. Volume adapted from <a href="https://reactbits.dev/micro/wake-slider" target="_blank" rel="noopener">React Bits · David Haz</a>.</small>

      <section v-if="revealStage === 'revealed'" class="sound-lab__after-reveal" :aria-label="`Continue with ${revealProfile.productName}`">
        <button type="button" class="btn btn-primary" @click="revealExpanded = !revealExpanded">
          {{ revealExpanded ? 'Hide sounds' : 'Choose a sound' }}
        </button>
        <router-link class="btn btn-outline-primary" :to="revealProfile.settingsRoute">Settings</router-link>
        <div v-if="revealExpanded" class="sound-lab__reveal-variants" aria-label="Sound choices">
          <button
            v-for="(preset, index) in variants"
            :key="preset.name"
            type="button"
            class="sound-lab__variant"
            :class="{'sound-lab__variant--active': index === currentVariant}"
            :aria-pressed="index === currentVariant"
            :aria-label="preset.name"
            @click="chooseVariant(index)"
          ><span>{{ preset.name }}</span></button>
        </div>
      </section>


    </template>

    <template v-else>
    <header class="sound-lab__intro">
      <small>Beta sound lab</small>
      <h1>Play your device</h1>
      <p>Choose a sound, then play from a Playtronica device or your computer keyboard.</p>
    </header>

    <CompatibilityNotice v-if="midiAdvisory" :issue="midiAdvisory" advisory />

    <section class="sound-lab__controls" aria-label="Sound controls">
      <button type="button" class="btn btn-dark" @click="start" :disabled="starting || releaseBlocked || !capabilities.audio">Start sound</button>
      <button type="button" class="btn btn-outline-dark" @click="stop" :disabled="(starting && !midiOpening && !audioStarting) || (!engine && !midi)">Stop &amp; release</button>
      <button type="button" class="btn btn-outline-danger" @click="panic" :disabled="!engine">Stop notes</button>
      <label class="sound-lab__quality">
        <input
          type="checkbox"
          v-model="lowCpu"
          :disabled="Boolean(engine) || releaseBlocked"
          aria-label="Low CPU — use if sound crackles"
        >
        Low CPU
      </label>
      <label class="sound-lab__volume" for="sound-lab-volume">
        <span>Volume</span>
        <input
          id="sound-lab-volume"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="volume"
          @input="updateVolume"
        >
        <output for="sound-lab-volume">{{ volume }}%</output>
      </label>
      <span class="sound-lab__status" role="status" aria-live="polite">{{ status }}</span>
    </section>

    <section aria-labelledby="sound-character">
      <div class="sound-lab__heading">
        <h2 id="sound-character">Sounds</h2>
        <small>Choose by ear</small>
      </div>
      <div class="sound-lab__variants">
        <button
          v-for="(preset, index) in variants"
          :key="preset.name"
          type="button"
          class="sound-lab__variant"
          :class="{'sound-lab__variant--active': index === currentVariant}"
          :aria-pressed="index === currentVariant"
          :aria-label="preset.name"
          @click="chooseVariant(index)"
        >
          <span>{{ preset.name }}</span>
        </button>
      </div>
    </section>

    <section aria-labelledby="sound-keyboard">
      <div class="sound-lab__heading">
        <h2 id="sound-keyboard">Keyboard</h2>
        <small>A–K physical keys · any language</small>
      </div>
      <div class="sound-lab__keyboard" aria-label="One octave keyboard">
        <button
          v-for="key in keyboard"
          :key="key.code"
          type="button"
          :class="{'sound-lab__black-key': key.black}"
          :aria-label="key.noteName"
          @pointerdown="pressScreenKey($event, key.note)"
          @pointerup="releaseScreenKey(key.note)"
          @pointercancel="releaseScreenKey(key.note)"
          @lostpointercapture="releaseScreenKey(key.note)"
        >{{ key.label }}</button>
      </div>
    </section>

    <section v-if="capabilities.midi" class="sound-lab__midi" aria-labelledby="sound-device">
      <div>
        <h2 id="sound-device">Playtronica device</h2>
        <p>Only the selected MIDI input is opened. Stop &amp; release closes it.</p>
      </div>
      <div class="sound-lab__midi-actions">
        <select v-if="midiInputs.length" v-model="selectedInput" class="form-select" aria-label="MIDI input">
          <option v-for="input in midiInputs" :key="input.id" :value="input.id">
            {{ [input.manufacturer, input.name].filter(Boolean).join(' — ') }}
          </option>
        </select>
        <button type="button" class="btn btn-primary" @click="connectMidi" :disabled="starting || releaseBlocked || !capabilities.audio || !capabilities.midi">
          {{ midiInputs.length ? 'Connect selected' : 'Find MIDI device' }}
        </button>
        <button v-if="permissionPending" type="button" class="btn btn-outline-secondary" @click="cancelMidiPermission()">Cancel MIDI request</button>
      </div>
    </section>
    </template>
  </section>
</template>

<script>
import {markRaw, defineAsyncComponent} from 'vue'
const GardenVisual = defineAsyncComponent(() => import(/* webpackChunkName: "garden-visual" */ './GardenVisual.vue'))
const WakeVolume = defineAsyncComponent(() => import(/* webpackChunkName: "garden-visual" */ './WakeVolume.vue'))
import {KEYBOARD_CODE_TO_NOTE, noteForKeyboardCode} from '@/audio/core.mjs'
import {createRealtimeElementarySynth as createRealtimeSynth, DEFAULT_VOLUME, normalizeVolume} from '@/audio/elementary/engine.mjs'
import {registerSoundController, soundSessionState, unregisterSoundController, updateSoundSession} from '@/audio/sessionState.mjs'
import {trace, MidiInputSession} from '@/audio/midi.mjs'
import {createSoundSessionEffects} from '@/audio/soundSessionEffects.mjs'
import {MIDI_PROMPT_HINT} from '@/audio/midiAccess.mjs'
import {SOUNDS} from '@/audio/elementary/timbres.mjs'
import {createExclusiveTabLease} from '@/audio/tabLease.mjs'
import {BIOTRON_CALIBRATION, biotronVoiceLevel, BiotronCalibrationTracker, parseBiotronCalibrationState} from '@/audio/biotronCalibration.mjs'
import {getRevealProfile, selectRevealInput} from '@/audio/revealProfiles.mjs'
import {detectSoundCapabilities, soundCapabilityMessage} from '@/audio/capabilities.mjs'
import DeviceTaskNav from '@/components/DeviceTaskNav.vue'
import CompatibilityNotice from '@/components/CompatibilityNotice.vue'
import {biotronFirstSoundFeedbackUrl, buildMidiAdvisory, detectPlatformCapabilities, recordBiotronEvent} from '@/compatibility.mjs'

const noteNames = ['C', 'C sharp', 'D', 'D sharp', 'E', 'F', 'F sharp',
  'G', 'G sharp', 'A', 'A sharp', 'B', 'C high']
const keyboard = Object.entries(KEYBOARD_CODE_TO_NOTE).map(([code, note]) => ({
  code, note, label: code.slice(3), noteName: noteNames[note - 60],
  black: noteNames[note - 60].includes('sharp')
}))

const VOLUME_STORAGE_KEY = 'playtronica-sound-volume-v1'
function loadVolume() {
  try { return normalizeVolume(window.localStorage?.getItem(VOLUME_STORAGE_KEY)) }
  catch (error) { void error; return DEFAULT_VOLUME }
}
function saveVolume(volume) {
  try { window.localStorage?.setItem(VOLUME_STORAGE_KEY, String(volume)) }
  catch (error) { void error }
}
function audioWithin(task, milliseconds, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), milliseconds)
  })
  return Promise.race([task, timeout]).finally(() => window.clearTimeout(timer))
}
const resumeAudioWithin = engine => audioWithin(engine.resume(), 3500, 'Audio resume timed out.')
export default {
  name: 'SoundLab',
  components: {CompatibilityNotice, DeviceTaskNav, GardenVisual, WakeVolume},
  props: {
    mode: {type: String, default: 'lab'},
    profileId: {type: String, default: ''}
  },
  computed: {
    revealMode() { return this.mode === 'reveal' },
    revealProfile() { return getRevealProfile(this.profileId) },
    revealCopy() {
      const stage = ['intro', 'settling', 'calibrating', 'ready'].includes(this.revealStage)
        ? this.revealStage : 'revealed'
      return {heading: this.revealProfile[`${stage}Heading`],
        instruction: this.revealProfile[stage === 'revealed' ? 'explanation' : `${stage}Instruction`]}
    },
    canStartReveal() { return this.capabilities.audio && this.capabilities.midi },
    midiAdvisory() { return this.revealMode ? null : buildMidiAdvisory(this.platformCapabilities) }
  },
  data() {
    const capabilities = detectSoundCapabilities()
    return {
      engine: null,
      midi: null,
      variants: SOUNDS,
      currentVariant: 0,
      volume: loadVolume(),
      keyboard,
      heldCodes: markRaw(new Set()),
      midiInputs: [],
      selectedInput: '',
      capabilities: markRaw(capabilities),
      platformCapabilities: markRaw(detectPlatformCapabilities()),
      status: this.mode === 'reveal'
        ? soundCapabilityMessage(capabilities, {requiresMidi: true}) || 'Ready when you are'
        : capabilities.audio ? 'Press Start sound' : soundCapabilityMessage(capabilities),
      audioState: 'closed',
      resumeOutcome: 'not_attempted',
      resumeAttemptId: 0,
      diagnosticMessage: '',
      voiceCount: 0,
      lowCpu: this.mode === 'reveal',
      starting: false,
      audioStarting: false,
      midiOpening: false,
      permissionPending: false,
      permissionAbort: null,
      permissionAttemptId: 0,
      releaseBlocked: false,
      calibrationTracker: markRaw(new BiotronCalibrationTracker()),
      revealCalibrationNonce: 0,
      explicitCalibration: false,
      voiceFrame: null,
      pendingVoiceCount: 0,
      keyDownHandler: null,
      keyUpHandler: null,
      blurHandler: null,
      visibilityHandler: null,
      tabLease: null,
      tabLeaseState: 'free',
      revealStage: 'intro',
      revealExpanded: false,
      recognizedInput: '',
      revealIssue: null,
      midiActive: false,
      midiIdleTimer: null,
      firstSoundOutcome: ''
    }
  },
  mounted() {
    registerSoundController(this)
    this.tabLease = markRaw(createExclusiveTabLease('playtronica-settings-sound-lab'))
    this.keyDownHandler = event => this.handleKeyDown(event)
    this.keyUpHandler = event => this.handleKeyUp(event)
    this.blurHandler = () => this.releaseHeldKeyboard()
    this.visibilityHandler = () => this.handleVisibility()
    window.addEventListener('keydown', this.keyDownHandler)
    window.addEventListener('keyup', this.keyUpHandler)
    window.addEventListener('blur', this.blurHandler)
    document.addEventListener('visibilitychange', this.visibilityHandler)
  },
  beforeUnmount() {
    window.clearTimeout(this.midiIdleTimer)
    this.cancelMidiPermission({silent: true})
    this.resumeAttemptId++
    unregisterSoundController(this)
    updateSoundSession({running: false, volume: this.volume})
    window.removeEventListener('keydown', this.keyDownHandler)
    window.removeEventListener('keyup', this.keyUpHandler)
    window.removeEventListener('blur', this.blurHandler)
    document.removeEventListener('visibilitychange', this.visibilityHandler)
    this.clearCalibrationTimers()
    this.resetVoiceUi()
    const midi = this.midi
    const engine = this.engine
    const tabLease = this.tabLease
    Promise.resolve().then(async () => {
      try { await midi?.close() } catch (error) { void error }
      try { await engine?.stop() } catch (error) { void error }
      tabLease?.release()
    })
  },
  async beforeRouteLeave(to, from, next) {
    void from
    const wasStarting = this.audioStarting || this.midiOpening
    this.cancelMidiPermission({silent: true})
    if (this.revealMode && to.path === this.revealProfile.settingsRoute && !wasStarting) {
      this.releaseHeldKeyboard()
      next()
      return
    }
    if (!this.engine && !this.midi) {
      next()
      return
    }
    await this.stop()
    if (this.releaseBlocked) next(false)
    else next()
  },
  watch: {revealStage(stage) { trace('stage', stage); if (this.revealMode) recordBiotronEvent('play.stage_changed', {stage}) }},
  methods: {
    ...createSoundSessionEffects({resumeAudioWithin, trace, updateSoundSession,
      parseBiotronCalibrationState, BIOTRON_CALIBRATION}),
    async requestMidiPermission() {
      const controller = markRaw(new AbortController())
      this.permissionAbort = controller
      this.permissionPending = true
      try { return await this.midi.requestAccess(undefined, controller.signal) }
      finally {
        if (this.permissionAbort === controller) {
          this.permissionAbort = null
          this.permissionPending = false
        }
      }
    },
    cancelMidiPermission({silent = false} = {}) {
      if (!this.permissionPending && !this.starting) return
      this.permissionAttemptId++
      this.permissionAbort?.abort()
      this.permissionAbort = null
      this.permissionPending = false
      this.starting = false
      if (!silent) this.status = 'MIDI request cancelled. The browser prompt may remain open; press Start again after answering it.'
    },
    async acquireTabLease() {
      if (await this.tabLease.acquire()) {
        this.tabLeaseState = this.tabLease.protected ? 'held' : 'unprotected'
        return true
      }
      this.tabLeaseState = 'blocked'
      this.status = 'Sound is already open in another Settings window.'
      return false
    },
    async ensureEngine() {
      if (!this.engine || this.engine.state === 'closed') {
        this.engine = markRaw(createRealtimeSynth({
          preset: this.variants[this.currentVariant],
          quality: this.lowCpu ? 'safe' : 'standard',
          volume: this.volume,
          onStateChange: state => this.handleAudioContextState(state)
        }))
        const biotron = this.revealMode && this.revealProfile.id === 'biotron'
        this.midi = markRaw(new MidiInputSession(this.engine, event => this.handleMidiState(event), {
          sysex: biotron, voiceLevel: biotron ? message => biotronVoiceLevel(message,
            BIOTRON_CALIBRATION, soundSessionState.calibrating) : undefined
        }))
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch (error) { void error }
      }
      const engine = this.engine
      const wasReady = engine.ready
      let slowTimer = null
      this.audioStarting = true
      try {
        await audioWithin(engine.ensureReady(stage => {
          if (this.engine !== engine || engine.stopped) return
          if (stage === 'loading') {
            this.status = 'Loading the sound engine…'
            slowTimer = window.setTimeout(() => { if (this.engine === engine && !engine.stopped) this.status = 'Still loading the sound engine — slow connection, it is cached after the first time.' }, 1200)
          }
          if (stage === 'starting') this.status = 'Starting sound…'
        }), 12000, 'Sound engine loading timed out.')
        if (this.engine !== engine || engine.stopped) return
        if (await resumeAudioWithin(engine) !== 'running') throw new Error('Audio could not start.')
        if (this.engine !== engine || engine.stopped) return
        this.setAudioState('running', 'Sound ready')
        return engine
      } catch (error) {
        if (this.engine === engine && !engine.stopped && !wasReady) {
          this.audioStarting = false
          try { await audioWithin(engine.stop(), 3500, 'Audio release timed out.') }
          catch (cleanupError) {
            this.releaseBlocked = true
            this.audioState = 'error'
            throw cleanupError
          }
          this.engine = null
          this.midi = null
          this.audioState = 'closed'
          this.tabLease?.release()
          this.tabLeaseState = 'free'
        }
        throw error
      } finally {
        window.clearTimeout(slowTimer)
        if (this.engine === engine || !this.engine) this.audioStarting = false
      }
    },
    async start() {
      if (!this.capabilities.audio) {
        this.status = soundCapabilityMessage(this.capabilities)
        return
      }
      if (this.starting) return
      const attemptId = ++this.permissionAttemptId
      this.starting = true
      try {
        if (!await this.acquireTabLease()) return
        if (attemptId !== this.permissionAttemptId) return
        await this.ensureEngine()
        if (attemptId !== this.permissionAttemptId) return
        if (!this.tabLease.protected) this.status = 'Sound ready — keep one Settings window open'
      } catch (error) {
        if (attemptId !== this.permissionAttemptId) return
        this.status = error.message
        try { await audioWithin(this.engine?.stop(), 3500, 'Audio release timed out.') }
        catch (cleanupError) {
          this.releaseBlocked = true
          this.status = cleanupError.message
          return
        }
        this.engine = null
        this.midi = null
        this.audioState = 'closed'
        this.tabLease.release()
        this.tabLeaseState = 'free'
      } finally { if (attemptId === this.permissionAttemptId) this.starting = false }
    },
    async stop() {
      this.cancelMidiPermission({silent: true})
      this.midiOpening = false
      this.audioStarting = false
      this.resumeAttemptId++
      this.starting = true
      let midiFailed = false
      let audioFailed = false
      try { await this.midi?.close() } catch (error) { midiFailed = true }
      try { await audioWithin(this.engine?.stop(), 3500, 'Audio release timed out.') } catch (error) { audioFailed = true }
      if (!midiFailed) this.midi = null
      if (!audioFailed) this.engine = null
      this.audioState = audioFailed ? 'error' : 'closed'
      updateSoundSession({running: audioFailed, volume: this.volume})
      this.resetVoiceUi()
      this.releaseBlocked = midiFailed || audioFailed
      if (midiFailed && audioFailed) this.status = 'Audio and MIDI did not release. Press Stop again.'
      else if (midiFailed) this.status = 'Sound stopped, but MIDI did not release. Press Stop again.'
      else if (audioFailed) this.status = 'MIDI released, but audio did not close. Press Stop again.'
      else {
        this.midiInputs = []
        this.selectedInput = ''
        this.revealStage = 'intro'
        this.revealExpanded = false
        this.recognizedInput = ''
        this.revealIssue = null
        this.resetCalibration()
        this.tabLease.release()
        this.tabLeaseState = 'free'
        this.status = 'Stopped — MIDI released'
      }
      this.starting = false
    },
    resetVoiceUi() {
      this.heldCodes.clear()
      window.cancelAnimationFrame(this.voiceFrame)
      this.voiceFrame = null
      this.pendingVoiceCount = 0
      this.voiceCount = 0
    },
    panic() {
      this.engine?.panic()
      this.resetVoiceUi()
      this.status = 'All notes stopped'
    },
    chooseVariant(index) {
      this.currentVariant = index
      this.engine?.applyPreset(this.variants[index])
      this.status = `${this.variants[index].name} selected`
    },
    updateVolume(event) {
      this.volume = normalizeVolume(event?.target?.value)
      this.engine?.setVolume(this.volume)
      saveVolume(this.volume)
      updateSoundSession({volume: this.volume})
    },
    play(note, source = 'screen') {
      if (this.engine?.state === 'running') {
        this.engine.noteOn(source, 0, note, 104)
        this.$refs?.garden?.note(true, note, 104)
        this.voiceCount = this.engine.activeVoiceCount
      }
    },
    release(note, source = 'screen') {
      this.engine?.noteOff(source, 0, note)
      this.$refs?.garden?.note(false, note)
      this.voiceRefreshTimer = window.setTimeout(() => {
        this.voiceCount = this.engine?.activeVoiceCount || 0
      }, 3100)
    },
    pressScreenKey(event, note) {
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      this.play(note)
    },
    releaseScreenKey(note) { this.release(note) },
    handleKeyDown(event) {
      const target = event.target
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName)) return
      const note = noteForKeyboardCode(event.code)
      if (note === null || event.repeat || this.heldCodes.has(event.code)) return
      event.preventDefault()
      this.heldCodes.add(event.code)
      this.play(note, 'keyboard')
    },
    handleKeyUp(event) {
      const note = noteForKeyboardCode(event.code)
      if (note === null) return
      event.preventDefault()
      this.heldCodes.delete(event.code)
      this.release(note, 'keyboard')
    },
    releaseHeldKeyboard() {
      const codes = [...this.heldCodes]
      this.heldCodes.clear()
      for (const code of codes) {
        const note = noteForKeyboardCode(code)
        if (note !== null) this.release(note, 'keyboard')
      }
    },
    async connectMidi() {
      if (this.starting) return
      if (!this.capabilities.audio || !this.capabilities.midi) {
        this.status = soundCapabilityMessage(this.capabilities, {requiresMidi: true})
        return
      }
      const attemptId = ++this.permissionAttemptId
      this.starting = true
      try {
        if (!await this.acquireTabLease()) return
        if (attemptId !== this.permissionAttemptId) return
        await this.ensureEngine()
        if (attemptId !== this.permissionAttemptId) return
        if (!this.midiInputs.length) {
          const inputs = await this.requestMidiPermission()
          if (attemptId !== this.permissionAttemptId) return
          this.midiInputs = inputs
          this.selectedInput = inputs[0]?.id || ''
          if (!this.selectedInput) throw new Error('No MIDI inputs found.')
        }
        this.midiOpening = true
        await this.midi.connect(this.selectedInput)
      } catch (error) {
        if (attemptId === this.permissionAttemptId && error?.name !== 'AbortError') this.status = error.message
      } finally {
        if (attemptId === this.permissionAttemptId) {
          this.midiOpening = false
          this.starting = false
        }
      }
    },
    async startReveal() {
      if (this.starting) return
      recordBiotronEvent('play.attempted')
      if (!this.canStartReveal) {
        this.status = soundCapabilityMessage(this.capabilities, {requiresMidi: true})
        return
      }
      const attemptId = ++this.permissionAttemptId
      this.starting = true
      this.revealIssue = null
      this.firstSoundOutcome = ''
      this.resumeOutcome = 'not_attempted'
      let failure = ''
      try {
        if (!await this.acquireTabLease()) { Object.assign(this, {revealIssue: {title: 'Sound is open elsewhere', body: 'Close or stop sound in the other Settings window, then try again.'}, firstSoundOutcome: 'not_yet'}); return }
        if (attemptId !== this.permissionAttemptId) return
        await this.ensureEngine()
        if (attemptId !== this.permissionAttemptId) return
        this.status = MIDI_PROMPT_HINT
        const inputs = await this.requestMidiPermission()
        if (attemptId !== this.permissionAttemptId) return
        const input = selectRevealInput(inputs, this.revealProfile)
        this.midiInputs = [input]
        this.selectedInput = input.id
        this.midiOpening = true
        await this.midi.connect(input.id)
        if (attemptId !== this.permissionAttemptId) return
        this.recognizedInput = [input.manufacturer, input.name].filter(Boolean).join(' — ')
        this.resetCalibration()
        this.revealStage = 'settling'
        this.status = this.revealProfile.settlingStatus
        if (this.revealProfile.id === 'biotron') {
          const nonce = this.revealCalibrationNonce = this.revealCalibrationNonce % 127 + 1
          // A missing confirmation is not proof of absent plant signal; legacy cues cannot confirm readiness.
          window.clearTimeout(this.revealWatchdog)
          this.revealWatchdog = window.setTimeout(() => {
            if (this.revealCalibrationNonce === nonce && !this.explicitCalibration && ['settling', 'calibrating'].includes(this.revealStage)) Object.assign(this, {revealStage: 'intro', status: 'The device did not confirm calibration. Check the contacts and firmware version in Settings.',
              revealIssue: {title: 'Calibration not confirmed', body: 'Check both plant contacts. Open Settings to check the firmware, then try again.'}, firstSoundOutcome: 'not_yet'})
          }, 15000)
          await this.midi.sendToPairedOutput([0xf0, 0x14, 0x0d, 125, nonce, 0xf7])
          if (attemptId !== this.permissionAttemptId) return
        }
      } catch (error) {
        if (attemptId !== this.permissionAttemptId || error?.name === 'AbortError') return
        failure = error.message || `${this.revealProfile.productName} could not start.`
        const missingDevice = /was not found|No MIDI inputs found/i.test(failure)
        const denied = /permission was not allowed/i.test(failure)
        recordBiotronEvent('midi.connection_changed', {result: 'failed', error_type: denied ? 'permission_denied' : missingDevice ? 'device_missing' : 'connection_failed'})
        await this.stop()
        if (!this.releaseBlocked) {
          this.status = missingDevice ? 'Device not connected.' : 'Could not start listening.'
          this.revealIssue = missingDevice
            ? {title: 'Connect the device', body: 'Connect the device to this computer with a USB data cable, then press Start listening again.'}
            : {title: denied ? 'Allow access to Biotron' : 'Could not start listening', body: failure}
          this.firstSoundOutcome = 'not_yet'
        }
      } finally {
        if (attemptId === this.permissionAttemptId) {
          this.midiOpening = false
          this.starting = false
        }
      }
    },
    handleMidiState(event) {
      if (this.revealMode && ['connected', 'disconnected', 'release-error'].includes(event.type)) recordBiotronEvent('midi.connection_changed', {midi_state: event.type})
      if (event.type === 'ports') {
        this.midiInputs = event.inputs
        if (!event.inputs.some(input => input.id === this.selectedInput)) {
          this.selectedInput = event.inputs[0]?.id || ''
        }
      }
      else if (event.type === 'connected') {
        this.status = `${event.input} connected`
        if (this.revealMode) this.recognizedInput = event.input
      }
      else if (event.type === 'released') this.status = 'MIDI released'
      else if (event.type === 'disconnected') {
        window.cancelAnimationFrame(this.voiceFrame)
        this.voiceFrame = null
        this.voiceCount = 0
        if (this.revealMode) {
          this.revealStage = 'intro'
          this.recognizedInput = ''
          this.revealIssue = {title: 'Connection lost', body: 'Reconnect its USB data cable, then press Start listening again.'}
          if (this.firstSoundOutcome !== 'helped') this.firstSoundOutcome = 'not_yet'
          this.resetCalibration()
        }
        this.status = 'MIDI disconnected — notes stopped'
      }
      else if (event.type === 'release-error') this.status = 'MIDI release failed — retry Stop'
      else if (event.type === 'voices') {
        if (event.message?.type === 'note-on') {
          this.midiActive = true
          window.clearTimeout(this.midiIdleTimer)
          this.midiIdleTimer = window.setTimeout(() => { this.midiActive = false }, 1800)
          this.$refs?.garden?.note(true, event.message.note, event.message.velocity)
        }
        if (event.message?.type === 'note-off') this.$refs?.garden?.note(false, event.message.note)
        if (event.message?.type === 'panic') {
          window.cancelAnimationFrame(this.voiceFrame); this.voiceFrame = null; this.pendingVoiceCount = this.voiceCount = 0; return
        }
        if (this.revealMode) this.handleRevealMessage(event.message)
        this.pendingVoiceCount = event.count
        if (this.voiceFrame === null) {
          this.voiceFrame = window.requestAnimationFrame(() => {
            this.voiceCount = this.pendingVoiceCount
            this.voiceFrame = null
          })
        }
      }
    },
    clearCalibrationTimers() {
      window.clearTimeout(this.revealWatchdog)
      this.revealWatchdog = null
    },
    resetCalibration() {
      this.clearCalibrationTimers()
      this.calibrationTracker.reset()
      this.explicitCalibration = false
      updateSoundSession({calibrating: false})
    },
    finishCalibration() {
      this.resetCalibration()
      if (this.revealStage !== 'intro') {
        this.revealStage = 'ready'
        this.status = this.revealProfile.readyStatus
      }
    },
    setAudioState(state, status) {
      const running = state === 'running'
      this.midi?.setEnabled(running)
      if (!running) { this.engine?.panic(); this.resetVoiceUi() }
      Object.assign(this, {audioState: state, status})
      trace('audio-state', state)
      if (this.revealMode) recordBiotronEvent('audio.state_changed', {audio_state: state, last_midi_at: this.midi?.lastMessageAt})
      updateSoundSession({running, volume: this.volume})
    },
    handleAudioContextState(state) {
      if (!this.engine) return
      if (state === 'running') {
        if (!this.starting && !this.releaseBlocked && ['suspended', 'interrupted'].includes(this.audioState))
          this.setAudioState('running', 'Sound ready')
        return
      }
      if (state === 'closed') {
        this.setAudioState('closed', 'Audio stopped unexpectedly — press Stop & release')
        this.releaseBlocked = true
        if (this.revealMode && this.firstSoundOutcome !== 'helped') Object.assign(this, {revealIssue: {title: 'Audio stopped unexpectedly', body: 'Press Stop & release, then try Start listening again.'}, firstSoundOutcome: 'not_yet'})
        return
      }
      // Respect an OS interruption; retry on foreground return or a user gesture, never in a hidden loop.
      this.setAudioState(state, `Audio paused — press ${this.revealMode ? 'Resume sound' : 'Start sound'}`)
    },
    async handleVisibility() {
      this.releaseHeldKeyboard()
      if (document.hidden || !this.engine || !['suspended', 'interrupted'].includes(this.engine.context.state)) return
      await this.resumeSound({automatic: true})
    },
    recordFirstSound(result) { recordBiotronEvent('play.outcome_reported', {result}) },
    firstSoundFeedbackUrl(outcome) {
      return biotronFirstSoundFeedbackUrl(outcome, this.revealIssue?.title, process.env.VUE_APP_VERSION_LABEL || 'Local preview')
    }
  }
}
</script>

<style scoped>
.play-help{margin:.8rem 0;color:#625e58;font-size:.9rem;text-align:left}.play-help summary{cursor:pointer;min-height:44px;display:list-item;align-content:center;color:#4f456c}.play-help p{font-size:.9rem;margin:.6rem 0}.play-help ol{padding-left:1.3rem;line-height:1.6}.play-help h3{font-size:1rem;margin-top:1rem}.play-audio-state{font-size:.8rem!important}

.garden-credit{display:block;max-width:760px;margin:12px auto 0;color:#6b6761;font-size:11px;text-align:center}.garden-credit a{color:inherit}
.sound-lab { width: min(900px, 100%); margin: 0 auto; padding: 1.5rem 0 4rem; text-align: left; color: #17171a; }
.sound-lab__intro { max-width: 650px; margin-bottom: 2rem; }
.sound-lab__intro--reveal { margin: 2.25rem auto 1.5rem; text-align: center; }
.sound-lab__intro small { color: #6b6761; font-size: var(--ui-text-small); }
.sound-lab__intro h1 { margin: .35rem 0; font-size: var(--ui-text-hero); line-height: 1.1; letter-spacing: -.035em; }
.sound-lab__intro p, .sound-lab__midi p { color: #625e58; line-height: 1.5; }
.sound-lab section { margin-top: 2rem; }
.sound-lab__controls, .sound-lab__variants, .sound-lab__midi-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.sound-lab__status { min-height: 1.5rem; padding-left: .5rem; color: #625e58; }
.sound-lab__diagnostic { display: flex; flex-direction: column; align-items: flex-start; gap: .3rem; margin-top: .5rem; }
.sound-lab__diagnostic small { color: #625e58; }
.sound-lab__quality { display: inline-flex; min-height: 44px; align-items: center; gap: .4rem; margin: 0; padding: 0 .35rem; white-space: nowrap; }
.sound-lab__quality input { width: 1.1rem; height: 1.1rem; }

.sound-lab__volume { display: inline-grid; grid-template-columns: auto minmax(130px, 220px) 3.25rem; gap: .65rem; align-items: center; min-height: 44px; margin: 0; color: #353239; font-weight: 600; }
.sound-lab__volume input { width: 100%; min-height: 32px; accent-color: var(--ui-accent); cursor: pointer; }
.sound-lab__volume output { color: #625e58; font-variant-numeric: tabular-nums; text-align: right; }
.sound-lab__heading { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .75rem; }
.sound-lab__heading h2, .sound-lab__midi h2 { margin: 0; font-size: var(--ui-text-section); font-weight: 700; }
.sound-lab__heading small { color: #6b6761; }
.sound-lab__variant { min-height: 44px; border: 1px solid var(--ui-control-border); border-radius: var(--ui-radius); background: #fff; padding: 0 1rem; font: inherit; font-weight: 600; }
.sound-lab__variant span { display: inline-block; padding: 0 .1rem; white-space: nowrap; font-weight: 500; }
.sound-lab__variant--active { border-color: var(--ui-accent); background: #e8edff; color: #2446bd; }
.sound-lab__reveal { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); gap: clamp(1.5rem, 5vw, 4rem); align-items: start; max-width: 760px; margin: 0 auto; padding: var(--beta-card-inset,24px); border: 1px solid #ded9d1; border-radius: 1.5rem; background: #fbfaf7; }
.sound-lab__reveal-copy h2 { margin: .25rem 0 .5rem; font-size: var(--ui-text-section); }
.sound-lab__reveal-copy p { max-width: 34rem; color: #625e58; line-height: 1.5; }
.sound-lab__connect-notice { display:grid; gap:.2rem; margin:1rem 0; padding:.85rem 1rem; border:1px solid rgba(106,90,205,.28); border-radius:.9rem; color:#302763; background:#f0edff; }
.sound-lab__connect-notice span { color:#514b63; line-height:1.45; }
.sound-lab__recognized { color: #4d427e; font-weight: 700; }
.sound-lab__reveal-actions, .sound-lab__after-reveal { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
.sound-lab__status--reveal { display: block; margin-top: .75rem; padding-left: 0; }
.sound-lab__after-reveal { max-width: 760px; margin: 1rem auto 0; }
.sound-lab__reveal-variants { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: .5rem; padding-top: .5rem; }
.sound-lab__task-feedback { max-width:760px; margin:1rem auto 0!important; padding:var(--beta-card-inset,24px); }
.sound-lab__after-reveal { padding-inline:var(--beta-card-inset,24px); }
.sound-lab__task-feedback small { color:#625e58; }
.sound-lab__keyboard { display: grid; grid-template-columns: repeat(13, minmax(44px, 1fr)); gap: 4px; overflow-x: auto; padding-bottom: .5rem; }
.sound-lab__keyboard button { min-width: 44px; height: 120px; border: 1px solid #cbc6be; border-radius: .6rem; background: #fff; align-content: end; padding-bottom: .7rem; }
.sound-lab__keyboard .sound-lab__black-key { height: 82px; background: #2b2b30; color: #fff; }
.sound-lab__midi { display: flex; justify-content: space-between; gap: 1.5rem; align-items: center; border-top: 1px solid #d6d1c8; padding-top: 1.5rem; }
.sound-lab__midi p { margin: .3rem 0 0; }
.sound-lab__midi-actions { min-width:0; max-width:100%; }
.sound-lab__midi-actions .form-select { min-width:0; width:100%; }
@media (max-width: 640px) { .sound-lab__midi { align-items: flex-start; flex-direction: column; } .sound-lab__keyboard { grid-template-columns: repeat(13, 48px); } .sound-lab__reveal { grid-template-columns: 1fr; text-align: center; } .sound-lab__reveal-actions, .sound-lab__after-reveal { justify-content: center; } .sound-lab__volume { width: 100%; grid-template-columns: auto minmax(0, 1fr) 3.25rem; text-align: left; } }
@media (prefers-reduced-motion: reduce) { .sound-lab button { transition: none; } }
</style>
