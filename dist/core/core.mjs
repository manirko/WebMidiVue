export function parseMidi(data) {
  if (!data || data.length !== 3 || !Array.from(data).every(Number.isInteger)) return null;
  const [status, a, b] = data;
  if (status < 0x80 || status > 0xef || a < 0 || a > 127 || b < 0 || b > 127) return null;
  const channel = status & 15, type = status & 0xf0;
  if (type === 0x90 || type === 0x80) return {
    type: type === 0x90 && b > 0 ? 'on' : 'off', channel, note: a, velocity: b,
  };
  if (type === 0xb0 && (a === 120 || a === 123)) return {type: 'panic', channel};
  if (type === 0xb0) return {type:'cc',channel,controller:a,value:b};
  return null;
}

export function recovery(s) {
  if (s.paused) return ['Sound is stopped', 'Make a new touch to play again: let go of TouchMe for a moment and touch it again, or play a strip or a key.'];
  if (s.modelMuted) return ['Mouse preview notes are muted', 'Open TouchMe settings and turn off Device Note Mute to hear the preview. CC can still respond.'];
  if (s.volume === 0) return ['The page is muted', 'Raise Volume, then try a new touch.'];
  if (s.audio !== 'running') return ['Enable the sound', 'Press Enable sound, then touch again.'];
  if (s.midi === 'unsupported') return ['Try the screen, or use another browser', 'This browser does not offer device MIDI here. Screen playing still works. Try a desktop browser with Web MIDI for TouchMe.'];
  if (s.midi === 'denied') return ['Allow device access', 'Check this site’s MIDI permission in your browser, then press Allow MIDI access.'];
  if (s.midi === 'error') return ['Try the connection again', 'Reconnect TouchMe and press Allow MIDI access. If it repeats, copy the details below for support.'];
  if (!s.selected) return ['Connect your TouchMe', 'Use a data USB cable and allow browser MIDI access. Choose your input if several devices appear. A light alone does not confirm MIDI data.'];
  if (!s.midiNotes) return ['Try both gold pads', 'Hold one gold pad with each hand, using bare skin. Watch for “Notes received” here.'];
  if (!s.heard) return ['Notes are arriving', 'Check your speaker output and Volume. Play a strip or a key to test this page. Does your TouchMe touch make a sound?'];
  return ['Keep exploring', 'Try a lighter touch, then a fuller touch. With a friend, hold one pad each and touch bare hands.'];
}

// A device with two USB-MIDI cables also shows a second port (Windows MIDIIN2/MIDIOUT2, elsewhere “MIDI 2”/“Port 2”); it is the same device (Sergey 33824).
export const isSecondPort = name => /(?:midi(?:in|out)2|port 2|midi 2)/i.test(name || '');
export function withDeadline(task, ms = 8000) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The browser did not respond in time. Try again.')), ms);
  })]).finally(() => clearTimeout(timer));
}
