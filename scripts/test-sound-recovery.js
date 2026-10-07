const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const {test} = require('node:test')

// Exercise the actual Vue methods with hardware effects replaced.
const source = fs.readFileSync('src/components/SoundLab/SoundLab.vue', 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/gm, '').replace('export default', 'module.exports =')

const keyboardContext = {module: {exports: {}}}
vm.runInNewContext(fs.readFileSync('src/audio/core.mjs', 'utf8').replace(/^export /gm, '') +
  '\nmodule.exports = {KEYBOARD_CODE_TO_NOTE}', keyboardContext)
const {KEYBOARD_CODE_TO_NOTE} = keyboardContext.module.exports

const effectsSource = fs.readFileSync('src/audio/soundSessionEffects.mjs', 'utf8')
  .replace('export function createSoundSessionEffects', 'function createSoundSessionEffects') +
  '\nmodule.exports = createSoundSessionEffects'

function fixture() {
  const session = {running: true}
  const events = []
  const calls = {resume: 0, connect: 0, calibrate: 0, sysex: 0}
  const context = {
    module: {exports: {}}, document: {hidden: false}, markRaw: value => value, AbortController,
    KEYBOARD_CODE_TO_NOTE,
    window: {setTimeout, clearTimeout, __biotronTrace: []},
    trace: (kind, data) => events.push([kind, data]), recordBiotronEvent() {},
    CompatibilityNotice: {}, DeviceTaskNav: {}, GardenVisual: {}, WakeVolume: {},
    parseBiotronCalibrationState: message => message.calibration || null,
    selectRevealInput: inputs => inputs[0], MIDI_PROMPT_HINT: 'Allow MIDI',
    BIOTRON_CALIBRATION: {quietCompletionMs: 1100}, performance: {now: () => 100},
    updateSoundSession: patch => Object.assign(session, patch),
  }
  const effectsContext = {...context, module: {exports: {}}}
  vm.runInNewContext(effectsSource, effectsContext)
  context.createSoundSessionEffects = effectsContext.module.exports
  vm.runInNewContext(script, context)
  const engine = {context: {state: 'running'}, panic() {},
    async resume() { calls.resume++; this.context.state = 'running'; return 'running' }}
  const midi = {setEnabled(value) { this.enabled = value },
    async connect() { calls.connect++ },
    async sendToPairedOutput() { calls.sysex++ }}
  const target = {engine, midi, audioState: 'running', volume: 65,
    revealMode: true, firstSoundOutcome: 'helped', starting: false, permissionAttemptId: 0,
    releaseBlocked: false, resumeAttemptId: 0, resumeOutcome: 'not_attempted',
    revealStage: 'revealed', revealCalibrationNonce: 7, explicitCalibration: false,
    revealProfile: {calibratingStatus: 'Calibrating', readyStatus: 'Ready'}, calibrationTracker: {reset() { calls.calibrate++ }}}
  for (const [name, method] of Object.entries(context.module.exports.methods)) target[name] = method.bind(target)
  target.resetVoiceUi = () => {}
  target.releaseHeldKeyboard = () => {}
  return {target, context, session, calls, events}
}

test('interruption pauses MIDI and offers the visible Resume sound control', () => {
  const {target, session} = fixture()
  target.engine.context.state = 'interrupted'
  target.handleAudioContextState('interrupted')
  assert.equal(target.audioState, 'interrupted')
  assert.equal(target.midi.enabled, false)
  assert.equal(session.running, false)
  assert.match(target.status, /Resume sound/)
})

test('browser initiated recovery re-enables MIDI without replaying setup', () => {
  const {target, session} = fixture()
  target.handleAudioContextState('interrupted')
  target.handleAudioContextState('running')
  assert.equal(target.audioState, 'running')
  assert.equal(target.midi.enabled, true)
  assert.equal(session.running, true)
})

test('manual Resume restores audio alone, without reconnecting MIDI or recalibrating', async () => {
  const {target, calls, events} = fixture()
  target.engine.context.state = 'suspended'
  target.handleAudioContextState('suspended')
  await target.resumeSound()
  assert.equal(calls.resume, 1)
  assert.equal(calls.connect, 0)
  assert.equal(calls.calibrate, 0)
  assert.equal(calls.sysex, 0)
  assert.equal(target.audioState, 'running')
  assert.equal(target.midi.enabled, true)
  assert.equal(target.resumeOutcome, 'manual_running')
  assert(events.some(([kind, data]) => kind === 'resume' && data === 'manual_running'))
})

test('foreground return resumes suspended and interrupted contexts once', async () => {
  for (const state of ['suspended', 'interrupted']) {
    const {target, calls} = fixture()
    target.engine.context.state = state
    target.handleAudioContextState(state)
    await target.handleVisibility()
    assert.equal(calls.resume, 1, state)
    assert.equal(target.resumeOutcome, 'automatic_running')
  }
})

test('hidden interruptions never start a background retry loop', async () => {
  const {target, context, calls} = fixture()
  context.document.hidden = true
  target.engine.context.state = 'interrupted'
  target.handleAudioContextState('interrupted')
  await target.handleVisibility()
  assert.equal(calls.resume, 0)
  assert.equal(target.audioState, 'interrupted')
})

test('a rejected Resume stays paused and retryable', async () => {
  const {target, session, calls} = fixture()
  target.engine.context.state = 'interrupted'
  target.handleAudioContextState('interrupted')
  target.engine.resume = async () => { calls.resume++; throw new Error('OS still owns audio') }
  await target.resumeSound()
  assert.equal(calls.resume, 1)
  assert.equal(target.audioState, 'interrupted')
  assert.equal(target.resumeOutcome, 'failed')
  assert.equal(target.starting, false)
  assert.equal(session.running, false)
  assert.match(target.status, /Resume sound/)
})

test('a hung Resume times out with a finite, retryable result', async () => {
  const {target, context} = fixture()
  target.engine.context.state = 'suspended'
  target.handleAudioContextState('suspended')
  target.engine.resume = () => new Promise(() => {})
  context.window.setTimeout = (callback, delay) => {
    assert.equal(delay, 3500)
    queueMicrotask(callback)
    return 1
  }
  await target.resumeSound()
  assert.equal(target.audioState, 'suspended')
  assert.equal(target.resumeOutcome, 'timed_out')
  assert.equal(target.starting, false)
})

test('stale completion after Stop cannot claim that audio recovered', async () => {
  const {target} = fixture()
  target.engine.context.state = 'suspended'
  target.handleAudioContextState('suspended')
  let finish
  target.engine.resume = () => new Promise(resolve => { finish = resolve })
  const pending = target.resumeSound()
  target.resumeAttemptId++
  target.engine = null
  finish('running')
  await pending
  assert.equal(target.audioState, 'suspended')
})

test('closed or releasing audio is never silently re-enabled', async () => {
  const {target, session} = fixture()
  target.handleAudioContextState('closed')
  target.handleAudioContextState('running')
  assert.equal(target.audioState, 'closed')
  assert.equal(target.releaseBlocked, true)
  assert.equal(session.running, false)
  target.engine = null
  await target.handleVisibility()
})

test('explicit calibration ends visibly and ignores a late reply after timeout', () => {
  const {target, context} = fixture()
  let deadline
  context.window.setTimeout = (callback, delay) => { assert.equal(delay, 25000); deadline = callback; return 1 }
  target.revealStage = 'settling'
  target.handleRevealMessage({calibration: {nonce: 7, state: 'waiting'}})
  assert.equal(target.revealStage, 'settling')
  assert.equal(target.explicitCalibration, true)
  deadline()
  assert.equal(target.revealStage, 'intro')
  assert.equal(target.firstSoundOutcome, 'not_yet')
  assert.match(target.status, /Calibration did not finish/)
  target.handleRevealMessage({calibration: {nonce: 7, state: 'ready'}})
  assert.equal(target.revealStage, 'intro')
  target.revealStage = 'settling'
  target.revealCalibrationNonce = 8
  target.handleRevealMessage({calibration: {nonce: 7, state: 'ready'}})
  assert.equal(target.revealStage, 'settling')
  target.handleRevealMessage({calibration: {nonce: 8, state: 'ready'}})
  assert.equal(target.revealStage, 'ready')
})

test('a note at zero volume asks for the human result instead of claiming audible plant sound', () => {
  const {target} = fixture()
  target.revealStage = 'ready'
  target.volume = 0
  target.handleRevealMessage({type: 'note-on', channel: 2, note: 60, velocity: 100})
  assert.equal(target.revealStage, 'revealed')
  assert.equal(target.firstSoundOutcome, 'awaiting_answer')
  assert.match(target.status, /check your volume and audio output/)
  assert.doesNotMatch(target.status, /making sound|plant signal/)
})

function timers(context) {
  const pending = new Map()
  let next = 0
  context.window.setTimeout = (callback, delay) => { pending.set(++next, {callback, delay}); return next }
  context.window.clearTimeout = id => pending.delete(id)
  return pending
}

test('a calibration ACK before send resolves keeps the completion deadline', async () => {
  const {target, context} = fixture()
  const pending = timers(context)
  target.canStartReveal = true
  target.revealProfile.id = 'biotron'
  target.acquireTabLease = async () => true
  target.ensureEngine = async () => target.engine
  target.midi.requestAccess = async () => [{id: 'music', name: 'Biotron'}]
  target.midi.sendToPairedOutput = async data => {
    target.handleRevealMessage({calibration: {nonce: data[4], state: 'waiting'}})
    await Promise.resolve()
  }
  await target.startReveal()
  assert.equal(target.revealStage, 'settling')
  assert.deepEqual([...pending.values()].map(timer => timer.delay), [25000])
  pending.values().next().value.callback()
  assert.equal(target.revealStage, 'intro')
  assert.equal(target.revealIssue.title, 'Calibration did not finish')
})

test('legacy notes cannot finish calibration; readiness requires the matching device reply', () => {
  const {target, context} = fixture()
  const pending = timers(context)
  target.revealStage = 'settling'
  for (const hint of ['candidate', 'calibrating', 'activity']) {
    target.calibrationTracker.observe = () => hint
    target.handleRevealMessage({type: 'note-on', note: 64, velocity: 24})
    assert.notEqual(target.revealStage, 'ready')
    assert.equal(pending.size, 0)
  }
  target.handleRevealMessage({calibration: {nonce: 8, state: 'ready'}})
  assert.notEqual(target.revealStage, 'ready')
  target.handleRevealMessage({calibration: {nonce: 7, state: 'waiting'}})
  assert.equal(target.revealStage, 'settling')
  assert.deepEqual([...pending.values()].map(timer => timer.delay), [25000])
  target.handleRevealMessage({calibration: {nonce: 7, state: 'ready'}})
  assert.equal(target.revealStage, 'ready')
  assert.equal(pending.size, 0)
})
