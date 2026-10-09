<template>
  <section class="audio-compare" :data-variant="variant.id">
    <p>{{ calibrationOnly ? 'Selecting a cue replaces the current experiment; plant notes use the last Classic sound.' : 'Choose a sound, then play it with Biotron or your computer keyboard. Experimental sounds stay selected when you reopen this browser.' }}</p>
    <div class="compare-groups" role="group" aria-label="Sound experiment group">
      <button v-for="group in banks" :key="group.id" type="button" class="btn btn-outline-primary" :class="{active: bankId === group.id}" :aria-pressed="bankId === group.id" @click="changeBank(group.id)">{{ group.label }}</button>
    </div>
    <label :for="calibrationOnly ? 'calibration-variant' : 'compare-variant'">{{ calibrationOnly ? 'Calibration cue' : 'Sound' }}</label>
    <select :id="calibrationOnly ? 'calibration-variant' : 'compare-variant'" class="form-select" :value="variantId" @change="choose(bankId, $event.target.value)">
      <option v-if="calibrationOnly && !variantId" value="" disabled>Choose a cue to try</option>
      <option v-for="(option, index) in bank.variants" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.label }}</option>
    </select>
    <p class="compare-description">{{ variant.description }}</p>
    <template v-if="player">
      <p class="compare-current" aria-live="polite"><template v-if="calibrationOnly && !variantId">No experimental cue selected.</template><template v-else>Selected: {{ variant.label }}</template><span v-if="player.audioState === 'running'"> · Active sound: {{ player.appliedSoundName }}</span></p>
      <div class="compare-actions">
        <button type="button" class="btn btn-outline-secondary" @click="listen" :disabled="player.releaseBlocked || (calibrationOnly && !variantId && !player.examplePlaying && !player.audioStarting)">{{ player.examplePlaying || player.audioStarting ? 'Stop example' : 'Listen to example' }}</button>
      </div>
      <small>Playing an example releases Biotron. Choose Start listening on Play to reconnect.</small>
      <p v-if="bankId === 'calibration'">Stop and start Biotron to recalibrate with this cue.</p>
      <p v-else-if="bankId === 'high-notes'">Changes begin above C5. Middle notes stay the same; the three-register option also changes bass notes.</p>
      <p role="status" aria-live="polite">{{ storageMessage || player.status }}</p>
    </template>
  </section>
</template>
<script>
import {AUDITION_BANKS, resolveAudition} from '@/audio/auditionBanks.mjs'
import {getSoundController, soundSessionState, selectSoundExperiment} from '@/audio/sessionState.mjs'
export default {
  name: 'AudioCompare',
  props: {calibrationOnly: {type: Boolean, default: false}},
  data() { return {storageMessage: ''} },
  computed: {
    player() { return getSoundController() },
    banks() {
      if (this.calibrationOnly) return AUDITION_BANKS.filter(bank => bank.id === 'calibration')
      return [{id: 'classic', label: 'Classic', variants: (this.player?.variants || []).map((preset, index) => ({id: String(index), label: preset.name, description: 'Original browser sound.'}))}, ...AUDITION_BANKS.filter(bank => bank.id !== 'calibration')]
    },
    bankId() { return this.calibrationOnly ? 'calibration' : soundSessionState.audition?.bankId === 'calibration' ? 'classic' : soundSessionState.audition?.bankId || 'classic' },
    variantId() { return soundSessionState.audition?.bankId === this.bankId ? soundSessionState.audition.variant.id : this.calibrationOnly ? '' : String(this.player?.currentVariant || 0) },
    bank() { return this.banks.find(bank => bank.id === this.bankId) },
    variant() { return this.bank.variants.find(variant => variant.id === this.variantId) || {id: '', label: '', description: 'Choose a cue explicitly to try a different calibration sound.'} }
  },
  methods: {
    changeBank(id) { if (id !== this.bankId || (!this.calibrationOnly && soundSessionState.audition?.bankId === 'calibration')) this.choose(id, this.banks.find(bank => bank.id === id).variants[0].id) },
    choose(bankId, variantId) {
      if (bankId === 'classic') { this.player?.chooseVariant(Number(variantId)); this.storageMessage = ''; return }
      const selection = resolveAudition(bankId, variantId)
      if (!selection) return
      this.storageMessage = selectSoundExperiment(selection) ? '' : 'Selected for this session. This browser could not save the sound for next time.'
    },
    async listen() {
      if (this.calibrationOnly && !this.variantId && !this.player.examplePlaying && !this.player.audioStarting) return
      if (!this.player.examplePlaying && !this.player.audioStarting) this.choose(this.bankId, this.variantId)
      await this.player.toggleExample()
    }
  }
}
</script>
<style scoped>
.audio-compare { padding:0; }
.compare-groups,.compare-actions { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
.audio-compare button,.audio-compare select { min-height:44px; }
.audio-compare label { display:block; margin-top:12px; }
.compare-description { margin:8px 0; }
</style>
