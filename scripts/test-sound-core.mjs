import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_VOLUME,
  KEYBOARD_CODE_TO_NOTE,
  makeNoteKey,
  midiPitchBendRatio,
  normalizeVolume,
  noteForKeyboardCode,
  parseMidiMessage,
  VoiceLedger
} from '../src/audio/core.mjs'
import {ElementarySynthEngine} from '../src/audio/elementary/engine.mjs'
import {SOUNDS, TIMBRES, toSound} from '../src/audio/elementary/timbres.mjs'
import {describeMidiAccessError, MidiInputSession} from '../src/audio/midi.mjs'
import {ExclusiveTabLease} from '../src/audio/tabLease.mjs'
import {
  getRevealProfile,
  REVEAL_PROFILES,
  selectRevealInput,
  validateRevealProfile
} from '../src/audio/revealProfiles.mjs'
import {detectSoundCapabilities, soundCapabilityMessage} from '../src/audio/capabilities.mjs'
import {BIOTRON_CALIBRATION, biotronVoiceLevel, BiotronCalibrationTracker,
  parseBiotronCalibrationState} from '../src/audio/biotronCalibration.mjs'
import {
  buildCompatibilityIssue,
  buildMidiAdvisory,
  detectPlatformCapabilities
} from '../src/compatibility.mjs'

test('physical keyboard mapping is independent from typed character', () => {
  assert.equal(noteForKeyboardCode('KeyA'), 60)
  assert.equal(noteForKeyboardCode('KeyK'), 72)
  assert.equal(noteForKeyboardCode('KeyФ'), null)
  assert.equal(Object.keys(KEYBOARD_CODE_TO_NOTE).length, 13)
  assert.notEqual(makeNoteKey('keyboard', 0, 60), makeNoteKey('midi', 0, 60))
})

test('sound volume is bounded', () => {
  assert.equal(DEFAULT_VOLUME, 70)
  assert.equal(normalizeVolume(null), DEFAULT_VOLUME)
  assert.equal(normalizeVolume('37'), 37)
  assert.equal(normalizeVolume(-1), 0)
  assert.equal(normalizeVolume(140), 140)
  assert.equal(normalizeVolume(200), 150)
})

test('MIDI note-on, velocity-zero note-off and panic are accepted', () => {
  assert.deepEqual(parseMidiMessage([0x91, 60, 100]), {type: 'note-on', channel: 1, note: 60, velocity: 100})
  assert.deepEqual(parseMidiMessage([0x91, 60, 0]), {type: 'note-off', channel: 1, note: 60})
  assert.deepEqual(parseMidiMessage([0xb0, 123, 0]), {type: 'panic', channel: 0})
  assert.deepEqual(parseMidiMessage([0xb1, 90, 72]), {type: 'controller', channel: 1, controller: 90, value: 72})
  assert.deepEqual(parseMidiMessage([0xe1, 0, 64]), {type: 'pitch-bend', channel: 1, value: 8192})
  assert.deepEqual(parseMidiMessage([0xe2, 127, 127]), {type: 'pitch-bend', channel: 2, value: 16383})
  assert.deepEqual(parseMidiMessage([0xf0, 0x0b, 125, 0, 1, 0xf7]),
    {type: 'system-exclusive', data: [0xf0, 0x0b, 125, 0, 1, 0xf7]})
})

test('Biotron calibration recognizes the soft cue and legacy 91/92 pattern', () => {
  const tracker = new BiotronCalibrationTracker()
  const note = (value, velocity = 90) => ({type: 'note-on', channel: 1, note: value, velocity})
  assert.equal(tracker.observe(note(64, 24), 0), 'candidate')
  assert.equal(tracker.observe(note(65, 24), 500), 'candidate')
  assert.equal(tracker.observe(note(67, 24), 1000), 'candidate')
  assert.equal(tracker.observe(note(72, 24), 1500), 'calibrating')
  assert.equal(tracker.calibrating, true)
  assert.equal(BIOTRON_CALIBRATION.quietCompletionMs, 1100)
  assert.equal(biotronVoiceLevel(note(64, 24)), 1)  // cue pitch+velocity alone never mutes
  assert.equal(biotronVoiceLevel(note(64, 63)), 1)
  assert.equal(biotronVoiceLevel(note(64, 24), BIOTRON_CALIBRATION, true), 0.025)
  assert.equal(biotronVoiceLevel(note(50, 75)), 1)
  assert.equal(biotronVoiceLevel(note(50, 75), BIOTRON_CALIBRATION, true), 0.025)
  assert.equal(biotronVoiceLevel({type: 'note-on', channel: 2, note: 50, velocity: 75}),
    BIOTRON_CALIBRATION.lightLevel)

  tracker.reset()
  assert.equal(tracker.observe(note(92), 0), 'candidate')
  assert.equal(tracker.observe(note(91), 70), 'candidate')
  assert.equal(tracker.observe(note(92), 140), 'candidate')
  assert.equal(tracker.observe(note(91), 210), 'calibrating')
  assert.equal(tracker.calibrating, true)

  tracker.reset()
  ;[22, 24, 26, 28].forEach((velocity, index) => {
    const expected = index === 3 ? 'calibrating' : 'candidate'
    assert.equal(tracker.observe(note(BIOTRON_CALIBRATION.cue[index], velocity), index * 500), expected)
  })

  assert.deepEqual(parseBiotronCalibrationState(
    parseMidiMessage([0xf0, 0x0b, 125, 0, 1, 0xf7])), {nonce: 0, state: 'waiting'})
  assert.deepEqual(parseBiotronCalibrationState(
    parseMidiMessage([0xf0, 0x0b, 125, 42, 2, 0xf7])), {nonce: 42, state: 'measuring'})
  assert.deepEqual(parseBiotronCalibrationState(
    parseMidiMessage([0xf0, 0x0b, 125, 42, 3, 0xf7])), {nonce: 42, state: 'ready'})
  assert.equal(parseBiotronCalibrationState(
    parseMidiMessage([0xf0, 0x0b, 125, 42, 0, 0xf7])), null)
  assert.equal(parseBiotronCalibrationState(parseMidiMessage([0xf0, 0x0b, 124, 0, 1, 0xf7])), null)

  tracker.reset()
  assert.equal(tracker.observe(note(92), 0), 'candidate')
  assert.equal(tracker.observe(note(91), 400), 'candidate')
  assert.equal(tracker.observe(note(64, 100), 470), 'activity')
  assert.equal(tracker.observe({type: 'controller', channel: 1, controller: 90, value: 64}, 500), 'activity')
  assert.equal(tracker.observe({type: 'note-off', channel: 1, note: 64}, 520), 'ignored')
})

test('MIDI state exposes the parsed event without exposing SysEx access', () => {
  const states = []
  const played = []
  const engine = {
    activeVoiceCount: 1,
    context: {currentTime: 3},
    noteOn(...args) { played.push(args) },
    noteOff() {},
    panic() {}
  }
  const session = new MidiInputSession(engine, state => states.push(state), {voiceLevel: () => 0.4})
  session.input = {id: 'biotron-music'}
  session.onMessage({data: [0x91, 64, 100]})
  assert.deepEqual(played, [['biotron-music', 1, 64, 100, 3, 0.4]])
  assert.deepEqual(states, [{
    type: 'voices',
    count: 1,
    message: {type: 'note-on', channel: 1, note: 64, velocity: 100}
  }])
})

test('MIDI pitch bend is forwarded to the synth on its exact channel', () => {
  const bends = []
  const engine = {
    activeVoiceCount: 0,
    panic() {},
    pitchBend(...args) { bends.push(args) }
  }
  const session = new MidiInputSession(engine)
  session.input = {id: 'biotron-music'}
  session.onMessage({data: [0xe1, 0, 64]})
  session.onMessage({data: [0xe2, 127, 127]})
  assert.deepEqual(bends, [
    ['biotron-music', 1, 8192],
    ['biotron-music', 2, 16383]
  ])
})

test('Elementary voices follow two-semitone pitch bend on their own source and channel', () => {
  const context = {currentTime: 0, state: 'suspended', addEventListener() {}, removeEventListener() {}}
  const engine = new ElementarySynthEngine(context)
  engine.noteOn('biotron', 1, 69, 100)
  engine.noteOn('biotron', 2, 69, 100)
  engine.pitchBend('biotron', 1, 16383)
  assert(Math.abs(engine.values.freq[0] - 440 * midiPitchBendRatio(16383)) < 1e-9)
  assert.equal(engine.values.freq[1], 440)
  engine.pitchBend('biotron', 1, 8192)
  assert.equal(engine.values.freq[0], 440)
  engine.panic()
  assert.equal(engine.pitchBends.size, 0)
})

test('pitch bend keeps source and channel separate, including notes started after bend', () => {
  const context = {currentTime: 0, state: 'suspended', addEventListener() {}, removeEventListener() {}}
  const engine = new ElementarySynthEngine(context)
  engine.noteOn('music', 1, 69, 100)
  engine.noteOn('music', 2, 69, 100)
  engine.noteOn('other', 1, 69, 100)
  engine.pitchBend('music', 1, 0)
  assert(Math.abs(engine.values.freq[0] - 440 * midiPitchBendRatio(0)) < 1e-9)
  assert.equal(engine.values.freq[1], 440)
  assert.equal(engine.values.freq[2], 440)
  engine.noteOn('music', 1, 71, 100)
  assert(Math.abs(engine.values.freq[3] - 493.8833012561241 * midiPitchBendRatio(0)) < 1e-7)
  engine.panic()
  engine.noteOn('music', 1, 69, 100)
  assert.equal(engine.values.freq[0], 440)
})

test('Biotron recalibration writes only to the exact paired output and releases it', async () => {
  const sent = []
  const output = {
    id: 'out-1', name: 'Biotron Port 1', manufacturer: 'Playtronica', state: 'connected',
    connection: 'closed', async open() { this.connection = 'open' },
    send(data) { sent.push([...data]) }, async close() { this.connection = 'closed' }
  }
  const session = new MidiInputSession({panic() {}}, () => {}, {sysex: true})
  session.input = {id: 'in-1', name: output.name, manufacturer: output.manufacturer}
  session.access = {inputs: new Map([[session.input.id, session.input]]), outputs: new Map([[output.id, output]])}
  await session.sendToPairedOutput([0xf0, 0x14, 0x0d, 125, 7, 0xf7])
  assert.deepEqual(sent, [[0xf0, 0x14, 0x0d, 125, 7, 0xf7]])
  assert.equal(output.connection, 'closed')
})

test('Android names every cable alike: the paired output is the one at the same index', async () => {
  // Chromium media/midi/midi_manager_android.cc builds each PortInfo from the device product name,
  // so one Biotron shows two inputs and two outputs all called 'Biotron' (Sergey, 2026-09-07).
  const port = (id, extra = {}) => ({
    id, name: 'Biotron', manufacturer: 'Playtronica', state: 'connected', sent: [],
    async open() {}, send(data) { this.sent.push([...data]) }, async close() {}, ...extra
  })
  const [in0, in1, out0, out1] = [port('in-0'), port('in-1'), port('out-0'), port('out-1')]
  const session = new MidiInputSession({panic() {}}, () => {}, {sysex: true})
  session.access = {inputs: new Map([[in0.id, in0], [in1.id, in1]]), outputs: new Map([[out0.id, out0], [out1.id, out1]])}
  session.input = in1
  await session.sendToPairedOutput([0xf0, 0xf7])
  assert.deepEqual([out0.sent, out1.sent], [[], [[0xf0, 0xf7]]])
  session.input = in0
  await session.sendToPairedOutput([0xf0, 0xf7])
  assert.deepEqual(out0.sent, [[0xf0, 0xf7]])
  session.access.outputs.delete(out0.id)
  await assert.rejects(() => session.sendToPairedOutput([0xf0, 0xf7]), /could not be matched safely/)
})

test('voice ledger never exceeds its cap', () => {
  const ledger = new VoiceLedger(4)
  for (let note = 0; note < 40; note += 1) ledger.claim(String(note), note)
  assert.equal(ledger.size, 4)
})

test('seven sounds, each on a known timbre, in one shape', () => {
  assert.equal(SOUNDS.length, 7)
  assert.equal(new Set(SOUNDS.map(sound => sound.name)).size, 7)
  for (const sound of SOUNDS) {
    assert.ok(TIMBRES[sound.timbre], `${sound.name} uses unknown timbre ${sound.timbre}`)
    const normalized = toSound(sound)
    assert.equal(normalized.name, sound.name)
    assert.deepEqual(normalized.cv, sound.cv)
  }
  assert.throws(() => toSound({name: 'Old preset', waveA: 'sine'}), /Unknown timbre/)
})

test('reveal profiles keep first-use copy plain and product-specific', () => {
  const profile = getRevealProfile('biotron')
  assert.equal(REVEAL_PROFILES.biotron, profile)
  assert.equal(validateRevealProfile(profile), profile)
  const beforeReveal = [
    profile.promise, profile.introHeading, profile.introInstruction,
    profile.startLabel, profile.settlingHeading, profile.settlingInstruction,
    profile.calibratingHeading, profile.calibratingInstruction,
    profile.readyHeading, profile.readyInstruction
  ].join(' ')
  assert.doesNotMatch(beforeReveal, /\b(?:MIDI|SysEx|firmware|channel)\b/i)
  assert.match(beforeReveal, /plant/i)
  assert.match(beforeReveal, /music/i)
  assert.match(profile.introInstruction, /both contacts/i)
  assert.match(profile.introInstruction, /contacts.*separate points.*same plant/i)
  assert.doesNotMatch(beforeReveal, /leaf[- _]?pads?/i)
  assert.match(beforeReveal, /Step away.*Keep them still/i)
  assert.match(beforeReveal, /device to confirm it is ready/i)
  assert.match(profile.explanation, /colours follow the pitch/i)
  assert.doesNotMatch(profile.revealedHeading, /you can hear|plant signal/i)
  assert.throws(() => getRevealProfile('unknown'), /Unknown reveal profile/)
})

test('reveal input selection is stable for two cables and blocks two devices', () => {
  const profile = getRevealProfile('biotron')
  const port1 = {id: 'a-1', manufacturer: 'Playtronica', name: 'Biotron Port 1'}
  const port2 = {id: 'a-2', manufacturer: 'Playtronica', name: 'Biotron Port 2'}
  const unrelated = {id: 'keys', manufacturer: 'Other', name: 'Keyboard'}
  assert.equal(selectRevealInput([unrelated, port2, port1], profile), port1)
  assert.equal(selectRevealInput([{...port1, name: 'Biotron'}], profile).name, 'Biotron')
  assert.throws(
    () => selectRevealInput([port1, {...port1, id: 'b-1'}], profile),
    /More than one Biotron music input/
  )
  assert.throws(() => selectRevealInput([unrelated], profile), /Biotron was not found/)
  // Windows (Sergey, 2026-09-03): Chrome names the two cables of one unit
  // 'Biotron' and 'MIDIIN2 (Biotron)'. That is one device, not two.
  const winMusic = {id: 'w-1', manufacturer: 'Playtronica', name: 'Biotron'}
  const winService = {id: 'w-2', manufacturer: 'Playtronica', name: 'MIDIIN2 (Biotron)'}
  assert.equal(selectRevealInput([winService, winMusic], profile), winMusic)
  assert.equal(selectRevealInput([unrelated, winService, winMusic], profile), winMusic)
  // Two real units on Windows still block: two bare 'Biotron' inputs.
  assert.throws(
    () => selectRevealInput([winMusic, {...winMusic, id: 'w-3'}, winService], profile),
    /More than one Biotron music input/
  )
  // Android (Sergey, 2026-09-07): Chromium names both cables of one unit 'Biotron' — no 'Port 1',
  // no 'MIDIIN2'. Cable 0 (first port) is the plant music; two units (four alike) still block.
  const droid0 = {id: 'd-0', manufacturer: 'Playtronica', name: 'Biotron'}
  const droid1 = {id: 'd-1', manufacturer: 'Playtronica', name: 'Biotron'}
  assert.equal(selectRevealInput([droid0, droid1], profile), droid0)
  assert.equal(selectRevealInput([unrelated, droid0, droid1], profile), droid0)
  assert.throws(
    () => selectRevealInput([droid0, droid1, {...droid0, id: 'e-0'}, {...droid1, id: 'e-1'}], profile),
    /More than one Biotron music input/
  )
})

test('sound capabilities fail closed without hiding the audio-only fallback', () => {
  const AudioContext = class {}
  const full = detectSoundCapabilities({
    AudioContext,
    navigator: {requestMIDIAccess() {}, locks: {request() {}}}
  })
  assert.deepEqual(full, {audio: true, midi: true})
  assert.equal(soundCapabilityMessage(full), '')

  const audioOnly = detectSoundCapabilities({AudioContext, navigator: {}})
  assert.deepEqual(audioOnly, {audio: true, midi: false})
  assert.match(soundCapabilityMessage(audioOnly), /Keyboard and screen sound work/i)
  assert.match(soundCapabilityMessage(audioOnly, {requiresMidi: true}), /cannot hear your device/i)

  const unsupported = detectSoundCapabilities({navigator: {requestMIDIAccess() {}}})
  assert.deepEqual(unsupported, {audio: false, midi: true})
  assert.match(soundCapabilityMessage(unsupported), /Sound is not available/i)
})

test('platform compatibility separates unsupported runtime from denied permission', () => {
  const AudioContext = class {}
  const desktop = detectPlatformCapabilities({
    AudioContext,
    isSecureContext: true,
    navigator: {userAgent: 'Mozilla/5.0 Chrome/140.0', requestMIDIAccess() {}}
  })
  assert.deepEqual(desktop, {audio: true, midi: true, secureContext: true})
  assert.equal(buildCompatibilityIssue(desktop, {requiresMidi: true}), null)

  const noMidi = detectPlatformCapabilities({
    AudioContext,
    isSecureContext: true,
    navigator: {userAgent: 'Firefox desktop'}
  })
  const midiIssue = buildCompatibilityIssue(noMidi, {requiresMidi: true, productName: 'Biotron'})
  assert.equal(midiIssue.kind, 'midi')
  assert.equal(midiIssue.title, 'No MIDI in this browser')
  assert.match(midiIssue.summary, /Biotron connects over Web MIDI/)
  assert.match(midiIssue.steps.join(' '), /Chrome or Edge/i)
  assert.match(buildMidiAdvisory(noMidi).summary, /keyboard or screen/i)

  const deniedButSupported = {...desktop}
  assert.equal(buildCompatibilityIssue(deniedButSupported, {requiresMidi: true}), null)
})

test('phones gate on Web MIDI capability, not on device name', () => {
  const AudioContext = class {}
  // Android Chrome (Web MIDI since 43): passes every device route, no advisory on Sound.
  const android = detectPlatformCapabilities({
    AudioContext,
    isSecureContext: true,
    navigator: {userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/151.0 Mobile', userAgentData: {mobile: true}, requestMIDIAccess() {}}
  })
  assert.equal(buildCompatibilityIssue(android, {requiresMidi: true, requiresAudio: true, productName: 'Biotron'}), null)
  assert.equal(buildMidiAdvisory(android), null)
  // iPhone Safari (Apple ships no Web MIDI): one honest gate without promising an unverified workaround.
  const iphone = detectPlatformCapabilities({
    AudioContext,
    isSecureContext: true,
    navigator: {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari'}
  })
  const iphoneIssue = buildCompatibilityIssue(iphone, {requiresMidi: true, productName: 'Scales'})
  assert.equal(iphoneIssue.kind, 'midi')
  assert.equal(iphone.appleMobile, true)
  assert.match(iphoneIssue.steps.join(' '), /MIDIWeb Browser/)
  assert.equal(iphoneIssue.action.label, 'Get MIDIWeb Browser')
  assert.equal(iphoneIssue.action.href, 'https://apps.apple.com/us/app/midiweb-browser/id6757226617')
  const iphoneAdvisory = buildMidiAdvisory(iphone)
  assert.match(iphoneAdvisory.title, /USB device connection/i)
  assert.equal(iphoneAdvisory.action.href, iphoneIssue.action.href)

  const insecure = detectPlatformCapabilities({
    AudioContext,
    isSecureContext: false,
    navigator: {userAgent: 'Desktop'}
  })
  assert.equal(buildCompatibilityIssue(insecure, {requiresMidi: true}).kind, 'security')

  const noAudio = detectPlatformCapabilities({
    isSecureContext: true,
    navigator: {userAgent: 'Mozilla/5.0 Chrome/140.0', requestMIDIAccess() {}}
  })
  assert.equal(buildCompatibilityIssue(noAudio, {requiresAudio: true}).kind, 'audio')
})

test('MIDI permission and security failures use actionable language', () => {
  assert.match(describeMidiAccessError({name: 'NotAllowedError'}), /Allow device access, then try again/i)
  assert.match(describeMidiAccessError({name: 'SecurityError'}), /secure Playtronica Settings address/i)
  assert.equal(describeMidiAccessError(new Error('driver unavailable')), 'driver unavailable')
})

test('failed MIDI close stays retryable and never reports released', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let closeAttempts = 0
  const states = []
  const engine = {activeVoiceCount: 0, panic() {}}
  const input = new EventTarget()
  Object.assign(input, {
    id: 'input-1', name: 'Biotron test input', manufacturer: 'Playtronica',
    async open() {},
    async close() {
      closeAttempts += 1
      if (closeAttempts === 1) throw new Error('driver refused close')
    }
  })
  const access = new EventTarget()
  access.inputs = new Map([[input.id, input]])
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {requestMIDIAccess: async () => access}
  })
  try {
    const session = new MidiInputSession(engine, state => states.push(state.type))
    await session.connect(input.id)
    await assert.rejects(session.release(), /driver refused close/)
    assert.equal(session.input, input)
    assert.deepEqual(states, ['connected', 'release-error'])
    await session.release()
    assert.equal(session.input, null)
    assert.equal(session.closed, false)
    assert.deepEqual(states, ['connected', 'release-error', 'released'])
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
})

test('closing during a pending MIDI open cancels and closes the late port', async () => {
  let finishOpen
  let markOpenStarted
  let messageListeners = 0
  let closeCalls = 0
  let stateListeners = 1
  const openStarted = new Promise(resolve => { markOpenStarted = resolve })
  const openGate = new Promise(resolve => { finishOpen = resolve })
  const input = {
    id: 'late-input', name: 'Late input', state: 'connected',
    async open() { markOpenStarted(); await openGate },
    async close() { closeCalls += 1 },
    addEventListener(type) { if (type === 'midimessage') messageListeners += 1 },
    removeEventListener(type) { if (type === 'midimessage') messageListeners -= 1 }
  }
  const access = {
    inputs: new Map([[input.id, input]]),
    addEventListener(type) { if (type === 'statechange') stateListeners += 1 },
    removeEventListener(type) { if (type === 'statechange') stateListeners -= 1 }
  }
  const session = new MidiInputSession({activeVoiceCount: 0, panic() {}})
  session.access = access
  const connecting = session.connect(input.id)
  await openStarted
  const closing = session.close()
  finishOpen()
  await assert.rejects(connecting, /cancelled/i)
  await closing
  assert.equal(closeCalls, 1)
  assert.equal(messageListeners, 0)
  assert.equal(stateListeners, 0)
  assert.equal(session.input, null)
  assert.equal(session.access, null)
})

test('closing during MIDI permission discards late access without listeners', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let finishAccess
  let stateListeners = 0
  const accessGate = new Promise(resolve => { finishAccess = resolve })
  const access = {
    inputs: new Map(),
    addEventListener(type) { if (type === 'statechange') stateListeners += 1 },
    removeEventListener(type) { if (type === 'statechange') stateListeners -= 1 }
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {requestMIDIAccess: async () => accessGate}
  })
  try {
    const session = new MidiInputSession({activeVoiceCount: 0, panic() {}})
    const requesting = session.requestAccess()
    await session.close()
    finishAccess(access)
    await assert.rejects(requesting, /cancelled/i)
    assert.equal(stateListeners, 0)
    assert.equal(session.access, null)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
})

test('background-disabled MIDI is silent until explicitly enabled', () => {
  let noteOns = 0
  let panics = 0
  const engine = {
    activeVoiceCount: 0,
    noteOn() { noteOns += 1 },
    noteOff() {},
    panic() { panics += 1 }
  }
  const session = new MidiInputSession(engine)
  session.input = {id: 'input-1'}

  session.onMessage({data: [0x90, 60, 100]})
  session.setEnabled(false)
  session.onMessage({data: [0x90, 61, 100]})
  assert.equal(noteOns, 1)
  assert.equal(panics, 1)

  session.setEnabled(true)
  session.onMessage({data: [0x90, 62, 100]})
  assert.equal(noteOns, 2)
})

test('MIDI port state changes refresh only connected inputs', () => {
  const states = []
  let panics = 0
  let removedMessages = 0
  const engine = {activeVoiceCount: 0, panic() { panics += 1 }}
  const session = new MidiInputSession(engine, state => states.push(state))
  const first = {
    id: 'one', name: 'First', state: 'connected',
    removeEventListener(type, listener) {
      assert.equal(type, 'midimessage')
      assert.equal(listener, session.boundMessage)
      removedMessages += 1
    }
  }
  const second = {id: 'two', name: 'Second', state: 'disconnected'}
  session.access = {inputs: new Map([[first.id, first], [second.id, second]])}

  session.onStateChange({port: second})
  assert.deepEqual(states.at(-1), {
    type: 'ports',
    inputs: [{id: 'one', name: 'First', manufacturer: ''}]
  })

  first.state = 'disconnected'
  second.state = 'connected'
  session.input = first
  session.onStateChange({port: first})
  assert.equal(session.input, null)
  assert.equal(removedMessages, 1)
  assert.equal(panics, 1)
  assert.deepEqual(states.at(-1), {
    type: 'ports',
    inputs: [{id: 'two', name: 'Second', manufacturer: ''}]
  })
})

test('only one tab lease can be held and release enables handoff', async () => {
  const locks = {
    held: false,
    async request(name, options, callback) {
      assert.equal(name, 'sound-test')
      assert.equal(options.ifAvailable, true)
      if (this.held) return callback(null)
      this.held = true
      try { return await callback({name}) }
      finally { this.held = false }
    }
  }
  const first = new ExclusiveTabLease(locks, 'sound-test')
  const second = new ExclusiveTabLease(locks, 'sound-test')

  assert.equal(await first.acquire(), true)
  assert.equal(await second.acquire(), false)
  first.release()
  await first.task
  assert.equal(await second.acquire(), true)
  second.release()
  await second.task
})

test('audio-only fallback stays usable without Web Locks', async () => {
  const lease = new ExclusiveTabLease(null)
  assert.equal(lease.protected, false)
  assert.equal(await lease.acquire(), true)
  assert.equal(lease.held, true)
  lease.release()
  assert.equal(lease.held, false)
})
