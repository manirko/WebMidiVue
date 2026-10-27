<template>
  <section class="audio-compare" :data-variant="variant.id">
    <p>Choose a sound. Play it with Biotron or listen to an example.</p>
      <div class="compare-groups" role="group" aria-label="Quick sounds"><button v-for="sound in palette" :key="sound.id" type="button" class="btn btn-outline-primary" :aria-pressed="variantId === sound.id && bankId === sound.bankId" @click="choose(sound.bankId, sound.id)">{{ sound.label }}</button>
      </div><details class="sound-orbit">
        <summary>Sound sphere · Experiment</summary>
        <p>Drag left/right to choose a sound; up/down for brighter/darker. Effects last for this session.</p>
        <div class="orbit" aria-hidden="true" @pointerdown="$event.currentTarget.setPointerCapture($event.pointerId); orbit($event)" @pointermove="$event.buttons === 1 && orbit($event)"><span :style="{width:'64px',height:'64px',border:'2px solid white',borderRadius:'50%',transform: `rotateX(${character * 60}deg) rotateY(${palette.findIndex(sound => sound.bankId === bankId && sound.id === variantId) * 60}deg)`}"></span></div>
        <label>Character: {{ character === 0 ? 'original' : character > 0 ? 'brighter' : 'darker' }}<input type="range" min="-1" max="1" step="0.1" :value="character" @input="adjust($event.target.value, space)"></label>
        <label>Space: {{ Math.round(space * 100) }}%<input type="range" min="0" max="1" step="0.1" :value="space" @input="adjust(character, $event.target.value)"></label>
        <button type="button" class="btn btn-outline-secondary" @click="adjust(0, 0)">Reset effects</button>
      </details>
    <details class="sound-experiments"><summary>All sounds</summary>
      <div class="compare-groups" role="group" aria-label="Sound experiment group"><button v-for="group in banks" :key="group.id" type="button" class="btn btn-outline-primary" :class="{active: bankId === group.id}" :aria-pressed="bankId === group.id" @click="changeBank(group.id)">{{ group.label }}</button>
      </div><label for="compare-variant">Sound</label>
      <select id="compare-variant" data-keyboard-playable="true" class="form-select" :value="variantId" @change="choose(bankId, $event.target.value)">
        <option v-for="(option, index) in bank.variants" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.label }}</option>
      </select>
    </details><p class="compare-description">{{ variant.description }}</p>
    <template v-if="player"><p class="compare-current" aria-live="polite">Selected: {{ variant.label }}<span v-if="player.audioState === 'running'"> · Active sound: {{ player.appliedSoundName }}</span></p>
      <div class="compare-actions"><button type="button" class="btn btn-outline-secondary" @click="listen" :disabled="player.releaseBlocked">{{ player.examplePlaying || player.audioStarting ? 'Stop example' : 'Listen to example' }}</button></div>
      <small>Playing an example releases Biotron. Choose Start listening on Play to reconnect.</small>
      <p role="status" aria-live="polite">{{ storageMessage || player.status }}</p></template></section></template>
<script>
import {AUDITION_BANKS, resolveAudition} from '@/audio/auditionBanks.mjs'
import {getSoundController, soundSessionState, selectSoundExperiment} from '@/audio/sessionState.mjs'
export default {
  name: 'AudioCompare',
  data() { return {storageMessage: ''} }, computed: {
    player() { return getSoundController() },
    palette() { return [['classic', '0', 'Round'], ['timbres', 'tone-reed', 'Reed'], ['timbres', 'tone-bass', 'Bass'], ['timbres', 'tone-pluck', 'Pluck'], ['timbres', 'tone-air', 'Air'], ['handpan', 'pan-clear', 'Handpan']].map(([bankId, id, label]) => ({bankId, id, label})) },
    character() { return soundSessionState.audition?.character || 0 },
    space() { return soundSessionState.audition?.space || 0 },
    banks() {
      return [{id: 'classic', label: 'Classic', variants: (this.player?.variants || []).map((preset, index) => ({id: String(index), label: preset.name, description: 'Original browser sound.'}))}, ...AUDITION_BANKS]
    },
    bankId() { return soundSessionState.audition?.bankId || 'classic' },
    variantId() { return soundSessionState.audition?.bankId === this.bankId ? soundSessionState.audition.variant.id : String(this.player?.currentVariant || 0) },
    bank() { return this.banks.find(bank => bank.id === this.bankId) },
    variant() { return this.bank.variants.find(variant => variant.id === this.variantId) || this.bank.variants[0] }
  },
  methods: {
    changeBank(id) { if (id !== this.bankId) this.choose(id, this.banks.find(bank => bank.id === id).variants[0].id) },
    choose(bankId, variantId) { if (bankId === 'classic') { this.player?.chooseVariant(Number(variantId)); this.storageMessage = ''; return }
      const selection = resolveAudition(bankId, variantId)
      if (selection) this.storageMessage = selectSoundExperiment(selection) ? '' : 'Selected for this session. This browser could not save the sound for next time.'
    },
    orbit(event) { const box = event.currentTarget.getBoundingClientRect(), x = Math.max(0, Math.min(0.999, (event.clientX - box.left) / box.width))
      const sound = this.palette[Math.floor(x * 6)]
      if (sound.id !== this.variantId || sound.bankId !== this.bankId) this.choose(sound.bankId, sound.id)
      this.adjust(Math.max(-1, Math.min(1, 1 - 2 * (event.clientY - box.top) / box.height)), this.space)
    },
    adjust(character, space) { character = Math.max(-1, Math.min(1, Number(character))); space = Math.max(0, Math.min(1, Number(space)))
      if (!Number.isFinite(character) || !Number.isFinite(space)) return
      const base = this.bankId === 'classic' ? {...resolveAudition('timbres', 'tone-reference'), bankId: 'classic', variant: {...this.variant, preset: this.player.variants[Number(this.variantId)]}} : resolveAudition(this.bankId, this.variantId)
      const {preset} = base.variant, {fx} = preset
      selectSoundExperiment({...base, character, space, variant: {...base.variant, preset: {...preset, fx: {...fx, cutoff: Math.max(20, Math.min(20000, fx.cutoff * 2 ** (character < 0 ? character * 4 : character))), reverbWet: Math.min(.3, fx.reverbWet + space * .15), delayWet: Math.min(.35, fx.delayWet + space * .08)}}}}, false)
    },
    async listen() {
      if (!this.player.examplePlaying && !this.player.audioStarting && !soundSessionState.audition?.character && !soundSessionState.audition?.space) this.choose(this.bankId, this.variantId)
      await this.player.toggleExample()
    }
  }}
</script><style scoped>
.compare-groups,.compare-actions { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
.audio-compare button,.audio-compare select,.audio-compare summary,.audio-compare input { min-height:44px; }
.audio-compare summary { cursor:pointer; padding:10px 0; }
.audio-compare label { display:block; margin-top:12px; }
.audio-compare input { display:block; width:100%; }
.compare-description { margin:8px 0; } .orbit { width:144px; height:144px; border-radius:50%; margin:16px auto; background:radial-gradient(circle at 30% 25%, #d6e7ff, #3467a3 70%, #152f50); color:white; display:grid; place-items:center; font-size:64px; perspective:280px; touch-action:none; cursor:grab; }
</style>
