export function mountVolume(input, sound) {
  input.value = sound.volume;
  input.addEventListener('input', () => sound.setVolume(Number(input.value)));
}
