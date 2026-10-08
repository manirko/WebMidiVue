import test from 'node:test'
import assert from 'node:assert/strict'
import {setImmediate} from 'node:timers/promises'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {ElementarySynthEngine} from '../src/audio/elementary/engine.mjs'
import {KEYBOARD_CODE_TO_NOTE} from '../src/audio/core.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return {promise, resolve, reject}
}

function engineWithSetters(setters = {}) {
  const engine = new ElementarySynthEngine({
    currentTime: 0, state: 'running', addEventListener() {}
  })
  const resolved = () => Promise.resolve()
  engine.ready = true
  engine.freqSetters = Array(8).fill(setters.freq || resolved)
  engine.velSetters = Array(8).fill(setters.vel || resolved)
  engine.gateSetters = Array(8).fill(setters.gate || resolved)
  return engine
}

for (const count of [1000, 10000]) {
  test(`${count} note pairs retain no settled ref updates`, async () => {
    const engine = engineWithSetters()
    for (let index = 0; index < count; index++) {
      engine.noteOn('plant', 0, 60)
      engine.noteOff('plant', 0, 60)
    }
    await setImmediate()
    assert.equal(engine.activeVoiceCount, 0)
    assert.equal(engine._pending.size ?? engine._pending.length, 0)
  })
}

test('whenIdle includes ref updates added while it waits', async () => {
  const first = deferred()
  const second = deferred()
  const engine = engineWithSetters({
    freq: () => first.promise,
    gate: ({value}) => value === 0 ? second.promise : Promise.resolve()
  })
  engine.noteOn('plant', 0, 60)
  let finished = false
  const waiting = engine.whenIdle().then(() => { finished = true })
  engine.noteOff('plant', 0, 60)
  first.resolve()
  await setImmediate()
  assert.equal(finished, false, 'barrier finished before the later gate update')
  second.resolve()
  await waiting
  assert.equal(engine._pending.size ?? engine._pending.length, 0)
})

test('rejected setter is observed, reported once, and permits a later barrier', async () => {
  const failure = new Error('worklet refused update')
  const engine = engineWithSetters({freq: () => Promise.reject(failure)})
  engine.noteOn('plant', 0, 60)
  await setImmediate()
  await assert.rejects(engine.whenIdle(), error => error === failure)
  assert.equal(engine._pending.size ?? engine._pending.length, 0)
  engine.freqSetters.fill(() => Promise.resolve())
  engine.noteOn('plant', 0, 61)
  await engine.whenIdle()
  assert.equal(engine._pending.size ?? engine._pending.length, 0)
})

test('concurrent idle barriers both receive the same setter failure', async () => {
  const gate = deferred()
  const failure = new Error('worklet refused update')
  const engine = engineWithSetters({freq: () => gate.promise})
  engine.noteOn('plant', 0, 60)
  const first = engine.whenIdle()
  const second = engine.whenIdle()
  gate.reject(failure)
  const results = await Promise.allSettled([first, second])
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected'])
  assert(results.every(result => result.reason === failure))
  await engine.whenIdle()
})

function startupContext(close = async () => {}) {
  const context = {
    state: 'running', currentTime: 0, destination: {}, gainCount: 0,
    addEventListener() {}, removeEventListener() {},
    createGain() {
      this.gainCount++
      return {connect() {}, disconnect() {}}
    },
    async close() { await close(); this.state = 'closed' }
  }
  return context
}

test('late renderer initialize after Stop cannot create an audio graph', async () => {
  const gate = deferred()
  const context = startupContext()
  let disconnected = 0
  const node = {connect() {}, disconnect() { disconnected++ }}
  const engine = new ElementarySynthEngine(context, {ownsContext: true})
  engine.core = {initialize: () => gate.promise}
  const starting = engine.ensureReady()
  const cancelled = assert.rejects(starting, {name: 'AbortError'})
  await engine.stop()
  gate.resolve(node)
  await cancelled
  assert.equal(context.gainCount, 0)
  assert.equal(disconnected, 1)
  assert.equal(engine.ready, false)
  assert.equal(context.state, 'closed')
})

test('late render after Stop never reports ready and disconnects its partial graph', async () => {
  const gate = deferred()
  const context = startupContext()
  let disconnected = 0
  const node = {connect() {}, disconnect() { disconnected++ }}
  const engine = new ElementarySynthEngine(context, {ownsContext: true})
  engine.core = {initialize: async () => node}
  engine._createRefs = () => {}
  engine._render = () => gate.promise
  const starting = engine.ensureReady()
  const cancelled = assert.rejects(starting, {name: 'AbortError'})
  await setImmediate()
  assert.equal(context.gainCount, 2)
  await engine.stop()
  gate.resolve()
  await cancelled
  assert.equal(disconnected, 1)
  assert.equal(engine.ready, false)
})

test('repeated Stop shares one pending AudioContext close', async () => {
  const gate = deferred()
  let closeCalls = 0
  const context = startupContext(async () => { closeCalls++; await gate.promise })
  const engine = new ElementarySynthEngine(context, {ownsContext: true})
  const first = engine.stop()
  const second = engine.stop()
  await setImmediate()
  assert.equal(closeCalls, 1)
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(context.state, 'closed')
})

test('Stop releases the renderer poller, pending requests and loaded message port', async () => {
  const engine = new ElementarySynthEngine(startupContext())
  let ticks = 0, closes = 0
  const request = deferred()
  const rejected = assert.rejects(request.promise, {name: 'AbortError'})
  engine.core = {_timer: setInterval(() => ticks++, 1), _promiseMap: new Map([[0, request]]),
    _renderer: {}, _worklet: {port: {onmessage() {}, close() { closes++ }}}}
  await engine.stop()
  await rejected
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(ticks, 0)
  assert.equal(closes, 1)
  assert.equal(engine.core._promiseMap.size, 0)
  assert.equal(engine.core._worklet.port.onmessage, null)
})

test('Stop during module loading revokes its Blob, restores addModule and disposes late initialization', async () => {
  const loaded = deferred(), context = startupContext(), revoked = []
  const originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = url => revoked.push(url)
  const addModule = async () => { await loaded.promise }
  context.audioWorklet = {addModule}
  let closes = 0
  const node = {disconnect() {}, port: {onmessage() {}, close() { closes++ }}}
  const engine = new ElementarySynthEngine(context)
  engine.core = {async initialize(ctx) {
    await ctx.audioWorklet.addModule('blob:delayed-module')
    this._renderer = {}; this._worklet = node; this._timer = setInterval(() => {}, 100)
    return node
  }}
  try {
    const starting = assert.rejects(engine.ensureReady(), {name: 'AbortError'})
    assert.equal(context.audioWorklet.addModule, addModule)
    await engine.stop()
    assert(revoked.includes('blob:delayed-module'))
    loaded.resolve(); await starting
    assert.equal(engine.core._timer, null)
    assert.equal(closes, 1)
    assert.equal(context.gainCount, 0)
    assert.equal(engine._moduleUrls.size, 0)
  } finally { URL.revokeObjectURL = originalRevoke }
})

function soundStartupFixture(engines) {
  const timers = new Map()
  let nextTimer = 0
  let releases = 0
  const context = {
    module: {exports: {}}, markRaw: value => value, defineAsyncComponent: () => ({}), CompatibilityNotice: {}, DeviceTaskNav: {}, DiagnosticCopy: {}, GardenVisual: {}, WakeVolume: {},
    window: {
      setTimeout(callback, delay) { timers.set(++nextTimer, {callback, delay}); return nextTimer },
      clearTimeout(id) { timers.delete(id) }
    },
    navigator: {}, soundSessionState: {calibrating: false}, BIOTRON_CALIBRATION: {},
    KEYBOARD_CODE_TO_NOTE,
    soundCapabilityMessage: () => '', MIDI_PROMPT_HINT: 'Allow MIDI', selectRevealInput: inputs => inputs[0],
    trace() {}, recordBiotronEvent() {}, parseBiotronCalibrationState() { return null },
    updateSoundSession() {}, registerSoundController() {}, createRealtimeSynth: () => engines.shift(),
    MidiInputSession: class {async close() {}}
  }
  const script = readFileSync('src/components/SoundLab/SoundLab.vue', 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
  const effectsSource = readFileSync('src/audio/soundSessionEffects.mjs', 'utf8')
    .replace(/^import .*$/gm, '').replace('export function createSoundSessionEffects', 'function createSoundSessionEffects') +
    '\nmodule.exports = createSoundSessionEffects'
  const effectsContext = {...context, module: {exports: {}}}
  vm.runInNewContext(effectsSource, effectsContext)
  context.createSoundSessionEffects = effectsContext.module.exports
  vm.runInNewContext(script, context)
  const target = {
    exampleTimers: new Set(), engine: null, midi: null, variants: [{}], currentVariant: 0, lowCpu: true,
    volume: 65, revealMode: true, revealProfile: {id: 'biotron', settingsRoute: '/biotron'},
    audioStarting: false, starting: true, midiOpening: false, permissionPending: false,
    permissionAbort: null, permissionAttemptId: 0, audioState: 'closed', releaseBlocked: false,
    midiInputs: [], selectedInput: '', revealStage: 'intro', revealExpanded: false,
    recognizedInput: '', revealIssue: null, status: '',
    tabLease: {release() { releases++ }}, tabLeaseState: 'held'
  }
  for (const [name, method] of Object.entries(context.module.exports.methods)) target[name] = method.bind(target)
  target.setAudioState = (state, status) => { target.audioState = state; target.status = status }
  target.resetVoiceUi = () => {}
  target.resetCalibration = () => {}
  target.startAudioClockMonitor = () => {}
  target.stopAudioClockMonitor = () => {}
  return {target, timers, releases: () => releases, sound: context.module.exports}
}

function fakeStartupEngine(ensureReady) {
  return {
    state: 'running', ready: false, stopped: false, resumeCalls: 0, stopCalls: 0,
    ensureReady,
    async resume() { this.resumeCalls++; return 'running' },
    async stop() { this.stopCalls++; this.stopped = true }
  }
}

test('hung sound loading times out, releases the first engine, and a user retry starts one new engine', async () => {
  const pending = deferred()
  const first = fakeStartupEngine(progress => { progress('loading'); return pending.promise })
  const second = fakeStartupEngine(async () => { second.ready = true })
  const {target, timers, releases} = soundStartupFixture([first, second])
  const starting = target.ensureEngine()
  await setImmediate()
  assert.equal(target.audioStarting, true)
  const deadline = [...timers.values()].find(timer => timer.delay === 12000)
  assert(deadline, 'initial renderer load has no deadline')
  deadline.callback()
  await assert.rejects(starting, /loading timed out/i)
  assert.equal(first.stopCalls, 1)
  assert.equal(target.engine, null)
  assert.equal(target.audioStarting, false)
  assert.equal(releases(), 1)
  await target.ensureEngine()
  assert.equal(target.engine, second)
  assert.equal(second.resumeCalls, 1)
  assert.equal(target.audioState, 'running')
  pending.resolve()
  await setImmediate()
  assert.equal(first.resumeCalls, 0, 'late initialization revived the abandoned engine')
})

test('renderer init rejection cleans up and leaves a retryable start', async () => {
  const first = fakeStartupEngine(async () => { throw new Error('worklet init failed') })
  const second = fakeStartupEngine(async () => { second.ready = true })
  const {target} = soundStartupFixture([first, second])
  await assert.rejects(target.ensureEngine(), /worklet init failed/)
  assert.equal(first.stopCalls, 1)
  assert.equal(target.engine, null)
  await target.ensureEngine()
  assert.equal(target.engine, second)
})

test('Stop during renderer loading ends UI intent and late completion cannot resume sound', async () => {
  const pending = deferred()
  const first = fakeStartupEngine(() => pending.promise)
  const {target} = soundStartupFixture([first])
  const starting = target.ensureEngine()
  await setImmediate()
  assert.equal(target.audioStarting, true)
  await target.stop()
  assert.equal(target.starting, false)
  assert.equal(target.audioStarting, false)
  assert.equal(target.engine, null)
  pending.resolve()
  await starting
  assert.equal(first.resumeCalls, 0)
  assert.equal(target.audioState, 'closed')
})

test('a failed Resume on an existing ready engine preserves its MIDI session for retry', async () => {
  const engine = fakeStartupEngine(async () => {})
  engine.ready = true
  engine.resume = async () => { throw new Error('resume failed') }
  const {target} = soundStartupFixture([])
  target.engine = engine
  const midi = target.midi = {async close() { throw new Error('must not close MIDI') }}
  await assert.rejects(target.ensureEngine(), /resume failed/)
  assert.equal(target.engine, engine)
  assert.equal(target.midi, midi)
  assert.equal(engine.stopCalls, 0)
})

test('initial suspended or interrupted audio never reports ready and can be retried', async () => {
  for (const state of ['suspended', 'interrupted']) {
    const first = fakeStartupEngine(async () => { first.ready = true })
    first.resume = async () => state
    const second = fakeStartupEngine(async () => { second.ready = true })
    const {target} = soundStartupFixture([first, second])
    await assert.rejects(target.ensureEngine(), /Audio could not start/)
    assert.equal(first.stopCalls, 1, state)
    assert.equal(target.engine, null, state)
    await target.ensureEngine()
    assert.equal(target.engine, second, state)
    assert.equal(target.audioState, 'running', state)
  }
})

test('hung AudioContext close leaves Stop visibly incomplete until a later retry', async () => {
  const gate = deferred()
  const engine = fakeStartupEngine(async () => {})
  engine.stop = () => { engine.stopped = true; return gate.promise }
  const {target, timers} = soundStartupFixture([])
  target.engine = engine
  target.starting = false
  const stopping = target.stop()
  await setImmediate()
  const deadline = [...timers.values()].find(timer => timer.delay === 3500)
  assert(deadline, 'AudioContext close has no deadline')
  deadline.callback()
  await stopping
  assert.equal(target.releaseBlocked, true)
  assert.equal(target.engine, engine, 'unconfirmed close was claimed released')
  assert.match(target.status, /Audio did not close/i)
  const retry = target.stop()
  gate.resolve()
  await retry
  assert.equal(target.releaseBlocked, false)
  assert.equal(target.engine, null)
})

test('Play to Settings waits for bounded Stop during audio startup', async () => {
  const engine = fakeStartupEngine(async () => {})
  const {target, sound} = soundStartupFixture([])
  target.engine = engine
  target.audioStarting = true
  let stops = 0
  target.stop = async () => { stops++; target.releaseBlocked = false }
  let routeResult = 'unset'
  await sound.beforeRouteLeave.call(target, {path: '/biotron'}, {}, result => { routeResult = result })
  assert.equal(stops, 1, 'route change preserved a still-starting audio engine')
  assert.equal(routeResult, undefined)
})

test('audio-only Start cancelled by Stop cannot claim sound ready after late init', async () => {
  const pending = deferred()
  const engine = fakeStartupEngine(() => pending.promise)
  const {target} = soundStartupFixture([engine])
  target.starting = false
  target.capabilities = {audio: true}
  target.tabLease.acquire = async () => true
  target.tabLease.protected = false
  const starting = target.start()
  await setImmediate()
  assert.equal(target.audioStarting, true)
  await target.stop()
  pending.resolve()
  await starting
  assert.equal(target.engine, null)
  assert.equal(target.starting, false)
  assert.match(target.status, /Stopped/i)
})
