<template>
  <section class="audio-compare" :data-variant="variant.id">
    <DeviceTaskNav device-name="Biotron" active-task="settings" play-route="/biotron/play" settings-route="/biotron" />
    <h1>Compare sounds</h1>
    <p>Choose an option and play it with Biotron, or listen to the same example. The first option is the reference.</p>
    <div class="compare-groups" role="group" aria-label="Comparison group">
      <button v-for="group in banks" :key="group.id" type="button" class="btn btn-outline-primary" :aria-pressed="bankId === group.id" @click="changeBank(group.id)">{{ group.label }}</button>
    </div>
    <label for="compare-variant">Option</label>
    <select id="compare-variant" class="form-select" :value="variantId" @change="changeVariant($event.target.value)">
      <option v-for="(option, index) in bank.variants" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.label }}</option>
    </select>
    <p class="compare-description">{{ variant.description }}</p>
    <SoundLab ref="player" mode="compare" profile-id="biotron" :audition="selection" v-slot="{player}">
      <div class="compare-actions">
        <button type="button" class="btn btn-primary"
          @click="player.midi?.input || (player.starting && !player.examplePlaying) ? player.stop() : player.startReveal()"
          :disabled="player.releaseBlocked || (!player.engine && !player.canStartReveal)">{{ player.midi?.input ? 'Stop & release Biotron' : player.starting && !player.examplePlaying ? 'Cancel connection' : 'Play with Biotron' }}</button>
        <button type="button" class="btn btn-outline-secondary" @click="player.toggleExample()" :disabled="player.releaseBlocked">{{ player.examplePlaying || player.audioStarting ? 'Stop example' : 'Listen to example' }}</button>
        <button v-if="player.releaseBlocked" type="button" class="btn btn-outline-danger" @click="player.stop()">Retry release</button>
      </div>
      <p v-if="bankId === 'calibration'">The option changes Biotron’s calibration cue. Plant notes keep the reference sound. Stop and start Biotron to recalibrate.</p>
      <p v-else-if="bankId === 'high-notes'">Changes begin above C5 (MIDI72). Middle notes stay the same; the three-register option also changes bass notes.</p>
      <p v-else>Change options while playing to compare timbres.</p>
      <label class="compare-volume" for="compare-volume"><span>Volume</span><input id="compare-volume" type="range" min="0" max="100" step="1" :value="player.volume" @input="player.updateVolume"><output>{{ player.volume }}%</output></label>
      <label class="compare-quality"><input type="checkbox" v-model="player.lowCpu" :disabled="Boolean(player.engine)"> Low CPU</label>
      <p role="status" aria-live="polite">{{ player.status }}</p>
    </SoundLab>
    <fieldset class="compare-feedback">
      <legend>Your listening choice</legend>
      <button type="button" class="btn btn-outline-primary" @click="prefer">Prefer this option</button>
      <p>{{ feedback[bankId]?.label || 'No preference recorded for this group.' }}</p>
      <label for="compare-comment">What sounds better or worse?</label>
      <textarea id="compare-comment" rows="2" class="form-control" v-model="comment" @change="saveComment"></textarea>
      <button type="button" class="btn btn-outline-secondary mt-2" @click="exportFeedback">Download listening choices</button>
      <small class="d-block">Choices stay in this browser. Playing an example does not record a listening result.</small>
    </fieldset>
    <p role="status" aria-live="polite">{{ status }}</p>
    <router-link to="/biotron">Back to settings</router-link>
  </section>
</template>
<script>
import DeviceTaskNav from '@/components/DeviceTaskNav.vue'
import {defineAsyncComponent} from 'vue'
const SoundLab = defineAsyncComponent(() => import(/* webpackChunkName: "sound-lab" */ './SoundLab.vue'))
import {AUDITION_BANKS, auditionEvents, auditionDuration} from '@/audio/auditionBanks.mjs'
const buildId = process.env.VUE_APP_BUILD_ID || 'local-build'
const feedbackKey = `biotron-audition-feedback-v1-${buildId}`
export default {
  name: 'AudioCompare', components: {DeviceTaskNav, SoundLab},
  data() { return {banks: AUDITION_BANKS, bankId: 'timbres', variantId: 'tone-reference', feedback: {}, comment: '', status: ''} },
  computed: {
    bank() { return this.banks.find(bank => bank.id === this.bankId) },
    variant() { return this.bank.variants.find(variant => variant.id === this.variantId) || this.bank.variants[0] },
    selection() { return {bankId: this.bankId, variant: this.variant, events: auditionEvents(this.bankId), duration: auditionDuration(this.bankId)} }
  },
  mounted() {
    try { const saved = JSON.parse(localStorage.getItem(feedbackKey) || '{}'); this.feedback = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {} } catch { this.feedback = {} }
    this.comment = this.feedback[this.bankId]?.comment || ''
  },
  async beforeRouteLeave(to, from, next) { const player = this.$refs.player; await player?.stop(); next(!player?.releaseBlocked) },
  methods: {
    changeBank(id) { this.bankId = id; this.variantId = this.bank.variants[0].id; this.comment = this.feedback[id]?.comment || '' },
    changeVariant(id) { this.variantId = id },
    saveFeedback() { try { localStorage.setItem(feedbackKey, JSON.stringify(this.feedback)) } catch { this.status = 'Your browser could not save these choices. Download them instead.' } },
    prefer() {
      this.feedback[this.bankId] = {
        variantId: this.variant.id, label: this.variant.label, comment: this.comment,
        commentForVariantId: this.variant.id, enteredAt: new Date().toISOString(),
        settings: {preset: this.variant.preset, level: this.variant.level ?? 1,
          volume: this.$refs.player.volume, quality: this.$refs.player.lowCpu ? 'safe' : 'standard'}
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
