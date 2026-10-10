export function detectSoundCapabilities(runtime = globalThis) {
  return Object.freeze({
    audio: typeof (runtime.AudioContext || runtime.webkitAudioContext) === 'function',
    midi: typeof runtime.navigator?.requestMIDIAccess === 'function'
  })
}

export function soundCapabilityMessage(capabilities, {requiresMidi = false} = {}) {
  if (!capabilities.audio) {
    return 'Sound is not available in this browser. Open this page in current Chrome or Edge on a computer.'
  }
  if (!capabilities.midi && requiresMidi) {
    return 'This browser can play examples, but it cannot connect to your device. Use a browser or app with Web MIDI support.'
  }
  if (!capabilities.midi) {
    return 'You can listen to examples here. USB devices need a browser with Web MIDI support.'
  }
  return ''
}
