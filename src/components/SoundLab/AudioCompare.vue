<template>
  <section class="audio-compare" :data-audio-state="engine?.state || 'closed'" :data-phase="phase" :data-active-voices="voiceCount" :data-variant="variant.id" :data-timers="timers.size">
    <DeviceTaskNav device-name="Biotron" active-task="settings" play-route="/biotron/play" settings-route="/biotron" />
    <h1>Compare sounds</h1>
    <p>Three experiments, ten options each. Every option in a group plays the same notes at the same volume.</p>
    <p>These are examples for listening. The calibration example uses the device’s cue melody. Play listening stops before comparison.</p>
    <div class="compare-groups" role="group" aria-label="Comparison group">
      <button v-for="group in banks" :key="group.id" type="button" class="btn btn-outline-primary" :aria-pressed="bankId === group.id" @click="changeBank(group.id)">{{ group.label }}</button>
    </div>
    <label for="compare-variant">Option</label>
    <select id="compare-variant" class="form-select" :value="variantId" @change="changeVariant($event.target.value)">
      <option v-for="(option, index) in bank.variants" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.label }}</option>
    </select>
    <p class="compare-description">{{ variant.description }}</p>
    <div class="compare-actions">
      <button type="button" class="btn btn-primary" @click="play" :disabled="starting || releaseBlocked">{{ starting ? 'Starting…' : 'Play example' }}</button>
      <button type="button" class="btn btn-outline-danger" @click="stop()" :disabled="!engine && !starting">Stop example</button>
      <button type="button" class="btn btn-outline-secondary" @click="playReference" :disabled="starting || releaseBlocked">Play reference</button>
    </div>
    <label for="compare-volume">Volume <output>{{ volume }}%</output></label>
    <input id="compare-volume" type="range" min="0" max="100" step="1" :value="volume" @input="setVolume($event.target.value)">
    <label class="compare-quality"><input type="checkbox" v-model="lowCpu" :disabled="Boolean(engine)"> Low CPU</label>
    <p role="status" aria-live="polite">{{ status }}</p>
    <fieldset class="compare-feedback">
      <legend>Your listening choice</legend>
      <button type="button" class="btn btn-outline-primary" @click="prefer">Prefer this option</button>
      <p>{{ feedback[bankId]?.label || 'No preference recorded for this group.' }}</p>
      <label for="compare-comment">What sounds better or worse?</label>
      <textarea id="compare-comment" rows="2" class="form-control" v-model="comment" @change="saveComment"></textarea>
      <button type="button" class="btn btn-outline-secondary mt-2" @click="exportFeedback">Download listening choices</button>
      <small class="d-block">Choices stay in this browser. Playing an example does not record a listening result.</small>
    </fieldset>
    <router-link to="/biotron">Back to settings</router-link>
  </section>
</template>
<script>
import {markRaw} from 'vue'
import DeviceTaskNav from '@/components/DeviceTaskNav.vue'
import {AUDITION_BANKS, auditionEvents, auditionDuration} from '@/audio/auditionBanks.mjs'
import {createRealtimeElementarySynth, normalizeVolume} from '@/audio/elementary/engine.mjs'
import {createExclusiveTabLease} from '@/audio/tabLease.mjs'
import {registerSoundController, unregisterSoundController, updateSoundSession} from '@/audio/sessionState.mjs'
import {createListenerScope} from '@/assets/js/ListenerScope.mjs'
const buildId = process.env.VUE_APP_BUILD_ID || 'local-build'
const feedbackKey = `biotron-audition-feedback-v1-${buildId}`
const bounded = (task, message, signal) => {
  let timer
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 3500); if (signal) { signal.onabort = () => reject(new Error('Example cancelled.')); if (signal.aborted) signal.onabort() } })]).finally(() => { clearTimeout(timer); if (signal) signal.onabort = null })
}
export default {
  name: 'AudioCompare', components: {DeviceTaskNav},
  data() { return {banks: AUDITION_BANKS, bankId: 'timbres', variantId: 'tone-reference', engine: null,
    volume: 70, lowCpu: false, phase: 'idle', voiceCount: 0, starting: false, releaseBlocked: false,
    attempt: 0, startAbort: null, timers: markRaw(new Set()), lease: null, listenerScope: null, feedback: {}, comment: '', status: 'Choose an option and press Play example.'} },
  computed: {
    bank() { return this.banks.find(bank => bank.id === this.bankId) },
    variant() { return this.bank.variants.find(variant => variant.id === this.variantId) || this.bank.variants[0] }
  },
  mounted() {
    registerSoundController(this)
    this.lease = markRaw(createExclusiveTabLease('playtronica-settings-sound-lab'))
    this.listenerScope = markRaw(createListenerScope())
    this.listenerScope.on(document, 'visibilitychange', () => { if (document.hidden) void this.stop() })
    try { const saved = JSON.parse(localStorage.getItem(feedbackKey) || '{}'); this.feedback = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {} } catch { this.feedback = {} }
    this.comment = this.feedback[this.bankId]?.comment || ''
  },
  async beforeRouteLeave(to, from, next) { await this.stop(); next(!this.releaseBlocked) },
  beforeUnmount() { this.listenerScope?.clear(); void this.stop(); unregisterSoundController(this) },
  methods: {
    async changeBank(id) { await this.stop(); this.bankId = id; this.variantId = this.bank.variants[0].id; this.comment = this.feedback[id]?.comment || '' },
    async changeVariant(id) { await this.stop(); this.variantId = id },
    setVolume(value) { this.volume = normalizeVolume(value); this.engine?.setVolume(this.volume) },
    async playReference() { await this.changeVariant(this.bank.variants[0].id); await this.play() },
    schedule(fn, milliseconds) {
      const timer = setTimeout(() => { this.timers.delete(timer); fn() }, milliseconds)
      this.timers.add(timer)
    },
    async play() {
      await this.stop()
      if (this.releaseBlocked) return
      const attempt = ++this.attempt
      this.startAbort = markRaw(new AbortController())
      const signal = this.startAbort.signal
      this.starting = true; this.phase = 'starting'; this.status = 'Starting the example…'
      const option = this.variant, bankId = this.bankId
      try {
        // Create the context within the click; no notes until the lease is held.
        const engine = markRaw(createRealtimeElementarySynth({preset: option.preset, volume: this.volume, quality: this.lowCpu ? 'safe' : 'standard', onStateChange: state => {
          if (this.phase === 'playing' && ['suspended','interrupted','closed'].includes(state)) void this.stop('Audio paused. Press Play example to restart.')
        }}))
        this.engine = engine
        if (!await bounded(this.lease.acquire(), 'Sound ownership did not respond. Retry once.', signal)) throw new Error('Sound is open in another tab. Stop it there, then retry.')
        if (attempt !== this.attempt) return
        await bounded(engine.ensureReady(), 'The sound engine did not start. Retry once.', signal)
        if (attempt !== this.attempt) return
        if (await bounded(engine.resume(), 'Audio resume timed out.', signal) !== 'running') throw new Error('Audio is paused. Press Play again.')
        if (attempt !== this.attempt) return
        this.phase = 'playing'; this.status = `Playing ${option.label}.`
        updateSoundSession({running: true, calibrating: false})
        for (const event of auditionEvents(bankId)) this.schedule(() => {
          if (attempt !== this.attempt) return
          if (event.type === 'on') engine.noteOn('audition', 0, event.note, event.velocity, engine.context.currentTime, option.level ?? 1)
          else engine.noteOff('audition', 0, event.note)
          this.voiceCount = engine.activeVoiceCount
        }, event.at * 1000)
        this.schedule(() => { void this.stop('Example finished. Choose another option to compare.') }, auditionDuration(bankId) * 1000)
      } catch (error) {
        if (attempt === this.attempt) { await this.stop(); this.status = error.message; this.phase = 'error' }
      } finally { if (attempt === this.attempt) this.starting = false }
    },
    async stop(message = 'Example stopped.') {
      this.attempt++; this.startAbort?.abort(); this.startAbort = null
      for (const timer of this.timers) clearTimeout(timer)
      this.timers.clear(); this.voiceCount = 0; this.starting = false
      try {
        if (this.engine) await bounded(this.engine.stop(), 'Audio release failed. Try Stop example again.')
        this.engine = null; this.lease?.release(); this.releaseBlocked = false; this.phase = 'idle'; this.status = message
        updateSoundSession({running: false, calibrating: false})
      } catch (error) { this.releaseBlocked = true; this.phase = 'error'; this.status = error.message }
    },
    saveFeedback() { try { localStorage.setItem(feedbackKey, JSON.stringify(this.feedback)) } catch { this.status = 'Your browser could not save these choices. Download them instead.' } },
    prefer() {
      this.feedback[this.bankId] = {
        variantId: this.variant.id, label: this.variant.label, comment: this.comment,
        commentForVariantId: this.variant.id, enteredAt: new Date().toISOString(),
        settings: {preset: this.variant.preset, level: this.variant.level ?? 1,
          volume: this.volume, quality: this.lowCpu ? 'safe' : 'standard'}
      }
      this.saveFeedback()
    },
    saveComment() {
      // A listener can reject an option without voting for it.
      const choice = this.feedback[this.bankId] || {variantId: null, label: 'No preference recorded.'}
      this.feedback[this.bankId] = {...choice, comment: this.comment,
        commentForVariantId: this.variant.id, commentEnteredAt: new Date().toISOString()}
      this.saveFeedback()
    },
    exportFeedback() {
      const blob = new Blob([JSON.stringify({schema: 'biotron-listening-feedback/v1', buildId, source: 'listener-entered preferences', choices: this.feedback}, null, 2)], {type: 'application/json'})
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = 'biotron-listening-choices.json'; link.click(); URL.revokeObjectURL(url)
    }
  }
}
</script>
<style scoped>
.audio-compare { max-width: 760px; margin: auto; padding: 16px; }
.compare-groups, .compare-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.audio-compare button, .audio-compare select { min-height: 44px; }
.audio-compare label { display: block; margin-top: 12px; }
#compare-volume { width: 100%; min-height: 44px; }
.compare-description { min-height: 48px; margin: 8px 0; }
.compare-feedback { border: 1px solid #ccc; border-radius: 8px; padding: 16px; margin: 24px 0; }
.compare-feedback legend { font-size: 1rem; }
.compare-feedback small { margin-top: 8px; }
</style>
