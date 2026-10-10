<template>
  <section
    class="sound-lab"
    v-show="controlsVisible"
    :data-audio-state="audioState"
    :data-active-voices="voiceCount"
    :data-example="examplePlaying ? 'playing' : 'idle'"
    :data-example-timers="exampleTimers.size"
    :data-sound="engine ? appliedSoundName : null"
    :data-quality="engine?.quality || (lowCpu ? 'safe' : 'standard')"
    :data-tab-lease="tabLeaseState"
    :data-reveal-stage="revealMode ? revealStage : null"
    :data-volume="volume"
    :data-keyboard="keyboardOn ? 'on' : 'off'"
    :data-audio-capability="capabilities.audio ? 'available' : 'unavailable'"
    :data-midi-capability="capabilities.midi ? 'available' : 'unavailable'"
    :data-plant-state="plantSignalState"
  >
    <template v-if="controlsVisible">
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
        <GardenVisual ref="garden" :stage="visualStage" />
        <div class="sound-lab__reveal-copy">
          <small v-if="recognizedInput && revealStage !== 'intro'" class="sound-lab__recognized" :title="recognizedInput">Device connected</small>
          <h2 id="device-reveal-title" aria-live="polite">{{ revealHeading }}</h2>
          <p>{{ revealCopy.instruction }}</p>
          <details v-if="revealStage === 'intro'" class="play-help"><summary>Connection steps</summary><ol><li>Push both contact cables onto the device’s CONTACT PINS.</li><li>Clip them to two separate points on the same plant.</li><li>Connect USB with a data cable, then press Start listening.</li></ol><a href="/midi-access.html" target="_blank" rel="noopener">Browser permission help</a></details>

          <CompatibilityNotice v-if="midiAdvisory" :issue="midiAdvisory" advisory />
          <div v-if="revealIssue" class="sound-lab__connect-notice" role="status" aria-live="polite">
            <strong>{{ revealIssue.title }}</strong>
            <span>{{ revealIssue.body }}</span>
            <a v-if="revealIssue.title === 'Allow access to Biotron'" href="/midi-access.html" target="_blank" rel="noopener">How to allow MIDI access</a>
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
              v-if="engine || midi || starting || releaseBlocked"
              type="button"
              class="btn btn-outline-dark"
              @click="stop"
              :disabled="starting && !midiOpening && !audioStarting"
            >{{ releaseBlocked ? 'Retry release' : starting ? 'Cancel connection' : 'Stop & release' }}</button>
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
            <DiagnosticCopy class="sound-lab__diagnostic" :packet="playDiagnosticPacket" />
            <div v-if="firstSoundOutcome" class="sound-lab__task-feedback"><h3>Can you hear the notes?</h3><div class="sound-lab__reveal-actions"><a :href="firstSoundFeedbackUrl('helped')" @click="recordFirstSound('heard')" class="btn btn-outline-dark" target="_blank" rel="noopener">Yes — WhatsApp</a><a :href="firstSoundFeedbackUrl('not_yet')" @click="recordFirstSound('not_heard')" class="btn btn-outline-dark" target="_blank" rel="noopener">Not yet — WhatsApp</a></div><small>Opens a draft with the version and stop point. Send it to share.</small></div>
          </details>
        </div>
      </section>
      <small class="garden-credit">Visual adapted from <a href="https://dasprinzip.com/tinker/day41/" target="_blank" rel="noopener">Garden Anomaly · Frank Reitberger</a>. Volume adapted from <a href="https://reactbits.dev/micro/wake-slider" target="_blank" rel="noopener">React Bits · David Haz</a>.</small>

      <details v-if="revealProfile.id === 'biotron'" class="sound-palette" :open="$route.query.sound === '1'" @toggle="paletteVisited ||= $event.target.open">
        <summary><span>Sound</span><small>{{ selectedSound.name }}</small></summary>
        <AudioCompare v-if="paletteVisited" />
      </details>
      <label v-if="revealProfile.id === 'biotron'" class="sound-lab__quality">
        <input type="checkbox" aria-label="Limit to 4 notes at once" aria-describedby="sound-quality-help" :checked="lowCpu" @change="changeQuality" :disabled="starting || releaseBlocked"> Limit to 4 notes at once
        <small id="sound-quality-help">Use if sound breaks up: less work for your device, no simulated room reflections. Switching stops sound.</small>
      </label>
      <section v-if="revealProfile.id !== 'biotron' && revealStage === 'revealed'" class="sound-lab__after-reveal" :aria-label="`Continue with ${revealProfile.productName}`">
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
            :class="{'sound-lab__variant--active': !audition && index === currentVariant}"
            :aria-pressed="!audition && index === currentVariant"
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
    </header>

    <CompatibilityNotice v-if="midiAdvisory" :issue="midiAdvisory" advisory />

    <section class="sound-lab__controls" aria-label="Sound controls">
      <button v-if="!capabilities.midi" type="button" class="btn btn-dark" @click="toggleExample" :disabled="releaseBlocked || !capabilities.audio">{{ examplePlaying || audioStarting ? 'Stop example' : 'Listen to example' }}</button>
      <button type="button" class="btn btn-dark sound-lab__start" @click="start" :disabled="starting || releaseBlocked || !capabilities.audio">Start sound</button>
      <button type="button" class="btn btn-outline-dark" @click="stop" :disabled="(starting && !midiOpening && !audioStarting) || (!engine && !midi)">Stop &amp; release</button>
      <button type="button" class="btn btn-outline-danger" @click="panic" :disabled="!engine">Stop notes</button>
      <label class="sound-lab__quality">
        <input
          type="checkbox"
          :checked="lowCpu" @change="changeQuality"
          :disabled="starting || releaseBlocked"
          aria-label="Limit to 4 notes at once" aria-describedby="sound-quality-help"
        >
        Limit to 4 notes at once
      </label>
      <small id="sound-quality-help">Use if sound breaks up: less work for your device, no simulated room reflections. Switching stops sound.</small>
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
    <KeyboardControls />
    </template>
  </section>
</template>
<script>
import {markRaw, defineAsyncComponent} from 'vue'
const GardenVisual = defineAsyncComponent(() => import(/* webpackChunkName: "garden-visual" */ './GardenVisual.vue'))
const WakeVolume = defineAsyncComponent(() => import(/* webpackChunkName: "garden-visual" */ './WakeVolume.vue'))
const AudioCompare = defineAsyncComponent(() => import(/* webpackChunkName: "biotron-auditions" */ '@audio-compare'))
import {noteForKeyboardCode, blocksKeyboardNotes} from '@/audio/core.mjs'
import {createRealtimeElementarySynth as createRealtimeSynth, DEFAULT_VOLUME, normalizeVolume} from '@/audio/elementary/engine.mjs'
import {registerSoundController, soundSessionState, unregisterSoundController, updateSoundSession, selectSoundExperiment, restoreSoundExperiment} from '@/audio/sessionState.mjs'
import {resolveAudition} from '@/audio/auditionBanks.mjs'
import {trace, MidiInputSession} from '@/audio/midi.mjs'
import {createSoundSessionEffects} from '@/audio/soundSessionEffects.mjs'
import {createListenerScope} from '@/assets/js/ListenerScope.mjs'
import {MIDI_PROMPT_HINT} from '@/audio/midiAccess.mjs'
import {SOUNDS} from '@/audio/elementary/timbres.mjs'
import {createExclusiveTabLease} from '@/audio/tabLease.mjs'
import {BIOTRON_CALIBRATION, biotronVoiceLevel, BiotronCalibrationTracker, parseBiotronCalibrationState} from '@/audio/biotronCalibration.mjs'
import {getRevealProfile, selectRevealInput} from '@/audio/revealProfiles.mjs'
import {detectSoundCapabilities, soundCapabilityMessage} from '@/audio/capabilities.mjs'
import DeviceTaskNav from '@/components/DeviceTaskNav.vue'
import DiagnosticCopy from '@/components/DiagnosticCopy.vue'
import CompatibilityNotice from '@/components/CompatibilityNotice.vue'
import KeyboardControls from './KeyboardControls.vue'
import {biotronFirstSoundFeedbackUrl, buildMidiAdvisory, detectPlatformCapabilities, recordBiotronEvent} from '@/compatibility.mjs'

const VOLUME_STORAGE_KEY = 'playtronica-sound-volume-v1'
function loadVolume() {
  try { return normalizeVolume(window.localStorage?.getItem(VOLUME_STORAGE_KEY)) }
  catch (error) { void error; return DEFAULT_VOLUME }
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
  components: {CompatibilityNotice, DeviceTaskNav, DiagnosticCopy, GardenVisual, WakeVolume, KeyboardControls, AudioCompare},
  props: {
    mode: {type: String, default: 'lab'},
    profileId: {type: String, default: ''},
    controlsVisible: {type: Boolean, default: true}
  },
  computed: {
    revealMode() { return this.mode === 'reveal' },
    plantSignalStage() {
      const live = this.revealMode && this.revealProfile.id === 'biotron' && this.controlsVisible && !this.revealIssue && !this.releaseBlocked &&
        !this.keyboardOn && !this.examplePlaying && this.audioState === 'running' && ['ready', 'revealed'].includes(this.revealStage)
      return live ? {0: 'attention', 1: 'calibrating'}[this.plantSignalState] || null : null
    },
    revealHeading() {
      if (this.starting && this.visualStage === 'connecting') return 'Starting…'
      if (this.plantSignalStage || this.revealStage !== 'revealed') return this.revealCopy.heading
      return this.midiActive ? 'Notes arriving' : 'Ready for the next note'
    },
    visualStage() {
      if (this.releaseBlocked || (this.revealIssue && !this.keyboardOn && !this.examplePlaying) || this.audioState === 'error') return 'attention'
      if (this.plantSignalStage) return this.plantSignalStage
      if (this.starting) return this.revealStage === 'intro' || this.audioStarting || this.midiOpening || this.permissionPending ? 'connecting' : 'paused'
      if (this.engine && this.audioState !== 'running') return 'paused'
      if (this.revealStage === 'settling') return 'connecting'
      return this.keyboardOn || this.examplePlaying || this.revealStage === 'revealed' ? 'ready'
        : this.revealStage === 'intro' ? 'waiting' : this.revealStage
    },
    audition() { return this.profileId === 'biotron' ? soundSessionState.audition : null },
    selectedSound() {
      const cue = this.examplePlaying || soundSessionState.calibrating || (this.keyboardOn && !this.recognizedInput)
      return this.audition && (this.audition.bankId !== 'calibration' || cue)
        ? this.audition.variant.preset : this.variants[this.currentVariant]
    },
    exampleSelection() { return this.audition || {...resolveAudition('timbres', 'tone-reference'), variant: {label: this.selectedSound.name, level: 1}} },
    revealProfile() { return getRevealProfile(this.profileId) },
    revealCopy() {
      if (this.plantSignalStage === 'attention') return {heading: 'Waiting for plant signal', instruction: 'Check both contacts on the plant and both contact cables on Biotron.'}
      const stage = this.plantSignalStage === 'calibrating' ? 'calibrating' : ['intro', 'settling', 'calibrating', 'ready'].includes(this.revealStage)
        ? this.revealStage : 'revealed'
      return {heading: this.revealProfile[`${stage}Heading`],
        instruction: this.revealProfile[stage === 'revealed' ? 'explanation' : `${stage}Instruction`]}
    },
    canStartReveal() { return this.capabilities.audio && this.capabilities.midi },
    midiAdvisory() { return buildMidiAdvisory(this.platformCapabilities) }
  },
  data() {
    const capabilities = detectSoundCapabilities()
    return {
      engine: null,
      midi: null,
      variants: SOUNDS,
      currentVariant: 0,
      appliedSoundName: '',
      examplePlaying: false,
      exampleTimers: markRaw(new Set()),
      presetTask: markRaw(Promise.resolve()),
      volume: loadVolume(),
      keyboardOn: false,
      keyboardOctave: 4,
      heldCodes: markRaw(new Map()),
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
      listenerScope: null,
      tabLease: null,
      tabLeaseState: 'free',
      revealStage: 'intro',
      revealExpanded: false,
      paletteVisited: this.$route.query.sound === '1',
      recognizedInput: '',
      revealIssue: null,
      midiActive: false,
      midiIdleTimer: null,
      plantSignalState: null,
      firstSoundOutcome: ''
    }
  },
  mounted() {
    if (this.profileId === 'biotron') restoreSoundExperiment(resolveAudition)
    registerSoundController(this)
    this.tabLease = markRaw(createExclusiveTabLease('playtronica-settings-sound-lab'))
    this.listenerScope = markRaw(createListenerScope())
    this.listenerScope.on(window, 'keydown', event => this.handleKeyDown(event))
    this.listenerScope.on(window, 'keyup', event => this.handleKeyUp(event))
    this.listenerScope.on(window, 'blur', () => this.releaseHeldKeyboard())
    this.listenerScope.on(window, 'pagehide', () => this.releaseHeldKeyboard())
    this.listenerScope.on(document, 'compositionstart', () => this.releaseHeldKeyboard())
    this.listenerScope.on(document, 'focusin', event => { if (blocksKeyboardNotes(event)) this.releaseHeldKeyboard() })
    this.listenerScope.on(document, 'visibilitychange', () => this.handleVisibility())
  },
  beforeUnmount() {
    this.clearExample()
    window.clearTimeout(this.midiIdleTimer)
    this.cancelMidiPermission({silent: true})
    this.resumeAttemptId++
    unregisterSoundController(this)
    updateSoundSession({running: false, volume: this.volume})
    this.listenerScope?.clear()
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
  watch: {
    keyboardOctave() { this.releaseHeldKeyboard() },
    selectedSound() { void this.applySelectedSound() },
    audition(next, previous) { if (this.examplePlaying && next?.bankId !== previous?.bankId) void this.stop() },
    revealStage(stage) { trace('stage', stage); if (this.revealMode) recordBiotronEvent('play.stage_changed', {stage}) },
    controlsVisible(visible) { if (visible) this.watchPlantSignal(); else this.midi?.stopPlantSignalWatch() }
  },
  methods: {
    ...createSoundSessionEffects({resumeAudioWithin, trace, updateSoundSession, parseBiotronCalibrationState,
      MIDI_PROMPT_HINT, selectRevealInput, recordBiotronEvent, soundCapabilityMessage}),
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
      registerSoundController(this)
      if (!this.engine || this.engine.state === 'closed') {
        this.engine = markRaw(createRealtimeSynth({
          preset: this.selectedSound,
          quality: this.lowCpu ? 'safe' : 'standard',
          volume: this.volume,
          onStateChange: state => this.handleAudioContextState(state)
        }))
        const biotron = this.revealMode && this.revealProfile.id === 'biotron'
        this.midi = markRaw(new MidiInputSession(this.engine, event => this.handleMidiState(event), {
          sysex: biotron, voiceLevel: biotron ? message => soundSessionState.calibrating && this.audition?.bankId === 'calibration'
            ? this.audition.variant.level : biotronVoiceLevel(message, BIOTRON_CALIBRATION, soundSessionState.calibrating) : undefined
        }))
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch (error) { void error }
      }
      const engine = this.engine
      const wasReady = engine.ready
      let slowTimer = null
      this.audioStarting = true
      try {
        // Firefox needs a running context to acknowledge worklet initialization.
        if (!wasReady && engine.state !== 'running' && await resumeAudioWithin(engine) !== 'running') throw new Error('Audio could not start.')
        await audioWithin(engine.ensureReady(stage => {
          if (this.engine !== engine || engine.stopped) return
          if (stage === 'loading') {
            this.status = 'Loading the sound engine…'
            slowTimer = window.setTimeout(() => { if (this.engine === engine && !engine.stopped) this.status = 'Still loading the sound engine — slow connection, it is cached after the first time.' }, 1200)
          }
          if (stage === 'starting') this.status = 'Starting sound…'
        }), 12000, 'Sound engine loading timed out.')
        if (this.engine !== engine || engine.stopped) return
        if (this.audition) await this.applySelectedSound()
        this.appliedSoundName = engine.sound?.name || ''
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
      if (!this.revealMode) this.keyboardOn = true
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
      this.keyboardOn = false
      this.clearExample()
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
    chooseVariant(index) {
      if (this.profileId === 'biotron') selectSoundExperiment(null)
      this.currentVariant = index
      this.status = `${this.variants[index].name} selected`
    },
    updateVolume(event) {
      this.volume = normalizeVolume(event?.target?.value)
      this.engine?.setVolume(this.volume)
      try { window.localStorage?.setItem(VOLUME_STORAGE_KEY, String(this.volume)) } catch (error) { void error }
      updateSoundSession({volume: this.volume})
    },
    play(note, source = 'screen') {
      if (this.engine?.state === 'running') {
        const cue = this.audition?.bankId === 'calibration' && this.keyboardOn && !this.recognizedInput
        this.engine.noteOn(source, 0, note, cue ? 24 : 104, this.engine.context.currentTime, cue ? this.audition.variant.level : 1)
        this.$refs?.garden?.note(true, note, 104)
        this.voiceCount = this.engine.activeVoiceCount
      }
    },
    release(note, source = 'screen') {
      this.engine?.noteOff(source, 0, note)
      this.$refs?.garden?.note(false, note)
      this.voiceCount = this.engine?.activeVoiceCount || 0
    },
    async toggleKeyboard() {
      if (this.keyboardOn) {
        this.keyboardOn = false
        this.releaseHeldKeyboard()
        if (!this.midi?.input) await this.stop()
        return
      }
      if (this.examplePlaying) await this.stop()
      if (this.releaseBlocked || this.starting) return
      this.keyboardOn = true
      await this.start()
      if (this.audioState !== 'running') this.keyboardOn = false
    },
    holdKey(id, note) {
      if (!this.keyboardOn || this.audioState !== 'running' || this.heldCodes.has(id)) return
      this.heldCodes.set(id, note)
      this.play(note, `keys:${id}`)
    },
    releaseKey(id) {
      if (!this.heldCodes.has(id)) return
      this.release(this.heldCodes.get(id), `keys:${id}`)
      this.heldCodes.delete(id)
    },
    handleKeyDown(event) {
      if (!this.keyboardOn || this.audioState !== 'running' || blocksKeyboardNotes(event, true)) return
      const note = noteForKeyboardCode(event.code)
      if (note === null) return
      event.preventDefault()
      this.holdKey(event.code, note + 12 * (this.keyboardOctave - 4))
    },
    handleKeyUp(event) {
      if (!this.heldCodes.has(event.code)) return
      event.preventDefault()
      this.releaseKey(event.code)
    },
    releaseHeldKeyboard() {
      for (const id of this.heldCodes.keys()) this.releaseKey(id)
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
      else if (event.type === 'plant-signal') this.plantSignalState = event.state
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
          window.cancelAnimationFrame(this.voiceFrame); this.voiceFrame = null; this.voiceCount = 0; return
        }
        if (this.revealMode) this.handleRevealMessage(event.message)
        if (this.voiceFrame === null) {
          this.voiceFrame = window.requestAnimationFrame(() => {
            this.voiceCount = this.engine?.activeVoiceCount || 0
            this.voiceFrame = null
          })
        }
      }
    },
    clearCalibrationTimers() {
      window.clearTimeout(this.revealWatchdog)
      this.revealWatchdog = null
    },
    setAudioState(state, status) {
      const running = state === 'running'
      this.midi?.setEnabled(running)
      if (!running) { this.engine?.panic(); this.resetVoiceUi() }
      Object.assign(this, {audioState: state, status})
      trace('audio-state', state)
      if (this.revealMode) recordBiotronEvent('audio.state_changed', {audio_state: state, last_midi_at: this.midi?.lastMessageAt})
      updateSoundSession({running, volume: this.volume})
      if (running) this.watchPlantSignal()
    },
    handleAudioContextState(state) {
      if (!this.engine) return
      if (this.examplePlaying && state !== 'running') { void this.stop(); return }
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
      if (document.hidden) this.midi?.stopPlantSignalWatch()
      else this.watchPlantSignal()
      if (document.hidden && this.examplePlaying) { await this.stop(); return }
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
.sound-lab__controls button { min-height:44px; }
@media (any-hover: none) and (any-pointer: coarse) { .sound-lab[data-midi-capability="unavailable"] .sound-lab__start { display:none; } }
.sound-lab__status { min-height: 1.5rem; padding-left: .5rem; color: #625e58; }
.sound-lab__diagnostic { margin-top: .5rem; }
.sound-lab__quality { display: inline-flex; flex-wrap:wrap; min-height: 44px; align-items: center; gap: .4rem; margin: 0; padding: 0 .35rem; white-space: normal; }
.sound-lab__quality input { width: 1.1rem; height: 1.1rem; }
.sound-palette { max-width:760px; margin:1.5rem auto .5rem; padding:1rem 1.25rem; border:1px solid var(--ui-control-border); border-radius:var(--ui-radius); background:#fff; }
.sound-palette summary { min-height:44px; cursor:pointer; align-content:center; font-weight:600; }
.sound-palette summary small { float:right; max-width:70%; color:#625e58; font-weight:400; }

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
.sound-lab__midi { display: flex; justify-content: space-between; gap: 1.5rem; align-items: center; border-top: 1px solid #d6d1c8; padding-top: 1.5rem; }
.sound-lab__midi p { margin: .3rem 0 0; }
.sound-lab__midi-actions { min-width:0; max-width:100%; }
.sound-lab__midi-actions .form-select { min-width:0; width:100%; }
@media (max-width: 640px) { .sound-lab__midi { align-items: flex-start; flex-direction: column; } .sound-lab__reveal { grid-template-columns: 1fr; text-align: center; } .sound-lab__reveal-actions, .sound-lab__after-reveal { justify-content: center; } .sound-lab__volume { width: 100%; grid-template-columns: auto minmax(0, 1fr) 3.25rem; text-align: left; } }
@media (prefers-reduced-motion: reduce) { .sound-lab button { transition: none; } }
</style>
