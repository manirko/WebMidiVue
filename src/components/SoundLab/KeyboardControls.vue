<template>
  <section v-if="player" class="computer-keys" aria-label="Computer keyboard">
    <div class="keys-controls">
      <h2>Keyboard</h2>
      <button type="button" class="btn btn-outline-primary" :aria-pressed="player.keyboardOn" :disabled="(player.starting && !player.keyboardOn) || player.releaseBlocked || !player.capabilities.audio" @click="player.toggleKeyboard()">{{ player.keyboardOn ? 'Stop keyboard' : 'Play with keyboard' }}</button>
      <label>Octave <select class="form-select" v-model.number="player.keyboardOctave" data-keyboard-playable="true" aria-label="Keyboard octave"><option v-for="octave in [2,3,4,5,6,7]" :key="octave" :value="octave">C{{ octave }}–C{{ octave + 1 }}</option></select></label>
    </div>
    <p>White keys A S D F G H J K · black keys W E T Y U. Use these physical QWERTY positions in any layout. While Keyboard is on, note keys also play in Sound and Octave menus; arrow keys change options.</p>
    <small v-if="player.audition?.bankId === 'calibration'">Keyboard previews the cue when Biotron is stopped; with Biotron connected it plays the ordinary plant sound.</small>
  </section>
</template>
<script>
import {getSoundController} from '@/audio/sessionState.mjs'
export default {
  name: 'KeyboardControls',
  computed: { player() { return getSoundController() } }
}
</script>
<style scoped>
.computer-keys { max-width:760px; margin:1rem auto; text-align:left; }
.keys-controls { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; }
.keys-controls h2 { margin:0; font-size:var(--ui-text-section); }
.keys-controls label { display:flex; gap:.5rem; align-items:center; }
.keys-controls select,.keys-controls button { min-height:44px; }
.computer-keys p,.computer-keys small { color:#625e58; font-size:.85rem; }
</style>
