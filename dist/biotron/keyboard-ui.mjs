import {KEYBOARD_CODE_TO_NOTE} from './sound/core.mjs';

// Play's input-view KEY_POSITIONS and GROUP_COLORS, for Biotron's existing 13 notes.
const KEY_POSITIONS = [[1,2],[2,1],[3,2],[4,1],[5,2],[7,2],[8,1],[9,2],[10,1],[11,2],[12,1],[13,2],[15,2]];
const GROUP_COLORS = ['#b4543a','#367887','#7661a4','#747333'];

export function mountKeyboard(root, sound, onError) {
  const pointers = new Map(), caps = new Map();
  for (const [index, [code, note]] of Object.entries(KEYBOARD_CODE_TO_NOTE).entries()) {
    const cap = document.createElement('button'); cap.type = 'button'; cap.dataset.key = code;
    cap.style.setProperty('--key-column', KEY_POSITIONS[index][0]);
    cap.style.setProperty('--key-row', KEY_POSITIONS[index][1]);
    cap.style.setProperty('--group-color', GROUP_COLORS[Math.floor(index / 4)]);
    cap.setAttribute('aria-label', 'Play ' + code.slice(3)); cap.setAttribute('aria-pressed', 'false');
    const letter = document.createElement('kbd'); letter.textContent = code.slice(3); cap.append(letter);
    cap.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); cap.focus({preventScroll:true}); cap.setPointerCapture(event.pointerId);
      const id = 'cap:' + event.pointerId; pointers.set(id, note);
      void sound.hold(id, note, () => pointers.has(id)).catch(error => onError(error.message));
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) cap.addEventListener(type, event => {
      const id = 'cap:' + event.pointerId, held = pointers.has(id), sounded = Boolean(sound.held.get(id)?.voice);
      pointers.delete(id); sound.release(id);
      // A quick first tap may finish before audio is ready; still audition that explicit click.
      if (type === 'pointerup' && held && !sounded) void sound.tap(note).catch(error => onError(error.message));
    });
    cap.addEventListener('click', event => {if (event.detail === 0) void sound.tap(note).catch(error => onError(error.message));});
    caps.set(note, cap); root.append(cap);
  }
  return {
    render(notes) {for (const [note, cap] of caps) cap.setAttribute('aria-pressed', String(notes.includes(note)));},
    release() {for (const id of pointers.keys()) sound.release(id); pointers.clear();}
  };
}
