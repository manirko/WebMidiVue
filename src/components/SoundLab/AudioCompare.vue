<template>
  <section class="audio-compare" :class="{'audio-compare--embedded': embedded}" :data-variant="variant.id">
    <DeviceTaskNav v-if="!embedded" device-name="Biotron" active-task="settings" play-route="/biotron/play" settings-route="/biotron" />
    <h1 v-if="!embedded">Compare sounds</h1>
    <p>Choose a sound to use it immediately. It stays selected while you adjust settings and when you reopen this browser.</p>
    <div class="compare-groups" role="group" aria-label="Sound experiment group">
      <button v-for="group in banks" :key="group.id" type="button" class="btn btn-outline-primary" :class="{active: bankId === group.id}" :aria-pressed="bankId === group.id" @click="changeBank(group.id)">{{ group.label }}</button>
    </div>
    <label for="compare-variant">Option</label>
    <select id="compare-variant" class="form-select" :value="variantId" @change="choose(bankId, $event.target.value)">
      <option v-for="(option, index) in bank.variants" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.label }}</option>
    </select>
    <p class="compare-description">{{ variant.description }}</p>
    <template v-if="player">
      <div class="compare-actions">
        <button type="button" class="btn btn-primary" @click="play"
          :disabled="player.releaseBlocked || (!player.engine && !player.canStartReveal)">{{ player.midi?.input ? 'Stop & release Biotron' : player.starting && !player.examplePlaying ? 'Cancel connection' : 'Play with Biotron' }}</button>
        <button type="button" class="btn btn-outline-secondary" @click="listen" :disabled="player.releaseBlocked">{{ player.examplePlaying || player.audioStarting ? 'Stop example' : 'Listen to example' }}</button>
        <button v-if="player.releaseBlocked" type="button" class="btn btn-outline-danger" @click="player.stop()">Retry release</button>
        <button v-if="player.engine && ['suspended', 'interrupted'].includes(player.audioState) && !player.releaseBlocked" type="button" class="btn btn-outline-secondary" @click="player.resumeSound()">Resume sound</button>
      </div>
      <p v-if="bankId === 'calibration'">This changes the calibration cue only. Plant notes keep their ordinary sound. Stop and start Biotron to recalibrate.</p>
      <p v-else-if="bankId === 'high-notes'">Changes begin above C5. Middle notes stay the same; the three-register option also changes bass notes.</p>
      <label class="compare-volume" for="compare-volume"><span>Volume</span><input id="compare-volume" type="range" min="0" max="100" step="1" :value="player.volume" @input="player.updateVolume"><output>{{ player.volume }}%</output></label>
      <label class="compare-quality"><input type="checkbox" v-model="player.lowCpu" :disabled="Boolean(player.engine)"> Low CPU</label>
      <p role="status" aria-live="polite">{{ storageMessage || player.status }}</p>
    </template>
    <router-link v-if="!embedded" to="/biotron?experiments=1">Back to settings</router-link>
  </section>
</template>
<script>
import DeviceTaskNav from '@/components/DeviceTaskNav.vue'
import {AUDITION_BANKS, resolveAudition} from '@/audio/auditionBanks.mjs'
import {getSoundController, soundSessionState, selectSoundExperiment, restoreSoundExperiment} from '@/audio/sessionState.mjs'
export default {
  name: 'AudioCompare', components: {DeviceTaskNav},
  props: {embedded: {type: Boolean, default: false}},
  data() { return {banks: AUDITION_BANKS, storageMessage: ''} },
  computed: {
    player() { return getSoundController() },
    bankId() { return soundSessionState.audition?.bankId || 'timbres' },
    variantId() { return soundSessionState.audition?.variant.id || 'tone-reference' },
    bank() { return this.banks.find(bank => bank.id === this.bankId) },
    variant() { return this.bank.variants.find(variant => variant.id === this.variantId) || this.bank.variants[0] }
  },
  mounted() { restoreSoundExperiment(resolveAudition) },
  methods: {
    changeBank(id) { this.choose(id, this.banks.find(bank => bank.id === id).variants[0].id) },
    choose(bankId, variantId) {
      const selection = resolveAudition(bankId, variantId)
      if (!selection) return
      this.storageMessage = selectSoundExperiment(selection) ? '' : 'Selected for this session. This browser could not save the sound for next time.'
    },
    async play() {
      if (this.player.midi?.input || (this.player.starting && !this.player.examplePlaying)) await this.player.stop()
      else { this.choose(this.bankId, this.variantId); await this.player.startReveal() }
    },
    async listen() {
      if (!this.player.examplePlaying && !this.player.audioStarting) this.choose(this.bankId, this.variantId)
      await this.player.toggleExample()
    }
  }
}
</script>
<style scoped>
.audio-compare { max-width:760px; margin:auto; padding:16px; }
.audio-compare--embedded { padding:0; }
.compare-groups,.compare-actions { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
.audio-compare button,.audio-compare select { min-height:44px; }
.audio-compare label { display:block; margin-top:12px; }
.compare-volume { display:grid!important; grid-template-columns:auto minmax(0,1fr) 3.25rem; align-items:center; gap:12px; }
#compare-volume { width:100%; min-height:44px; cursor:pointer; }
.compare-description { margin:8px 0; }
</style>
