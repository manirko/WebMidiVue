const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return {promise, resolve, reject}
}
const bounded = promise => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('UI cancellation hung')), 150))
])
const component = (file, context) => {
  const source = fs.readFileSync(file, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInNewContext(script.replace(/^\s*import .*$/gm, '').replace('export default', 'module.exports ='), context)
  return context.module.exports
}
const bind = (componentOptions, props = {}, withData = true) => {
  const events = []
  const target = {...(withData ? componentOptions.data() : {}), ...props,
    $emit(name, detail) { events.push([name, detail]) }}
  for (const [name, method] of Object.entries(componentOptions.methods)) target[name] = method.bind(target)
  target.events = events
  return target
}

;(async () => {
  const midiAccess = await import('../src/audio/midiAccess.mjs')
  let pending = deferred()
  let browserRequests = 0
  Object.defineProperty(global, 'navigator', {configurable: true, value: {onLine: true, userAgent: 'Chrome', requestMIDIAccess() {
    browserRequests++
    return pending.promise
  }}})

  midiAccess.resetSharedMidiAccessForTests()
  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  await assert.rejects(midiAccess.requestSharedMidiAccess({sysex: true, signal: alreadyCancelled.signal}), {name: 'AbortError'})
  assert.equal(browserRequests, 0, 'An already cancelled attempt opened a browser prompt')
  const firstSignal = new AbortController()
  const first = midiAccess.requestSharedMidiAccess({sysex: true, signal: firstSignal.signal})
  firstSignal.abort()
  await assert.rejects(bounded(first), {name: 'AbortError'})
  const second = midiAccess.requestSharedMidiAccess({sysex: true})
  assert.equal(browserRequests, 1, 'Cancel started a second browser permission prompt')
  const access = {inputs: new Map(), outputs: new Map(), onstatechange: null}
  pending.resolve(access)
  assert.equal(await bounded(second), access)

  midiAccess.resetSharedMidiAccessForTests()
  pending = deferred()
  const selectorContext = {
    module: {exports: {}}, AbortController, navigator: global.navigator,
    requestSharedMidiAccess: midiAccess.requestSharedMidiAccess,
    MIDI_PROMPT_HINT: 'Allow MIDI', soundSessionState: {running: false},
    stopPersistentSound: async () => true, console: {log() {}},
    setTimeout, clearTimeout, buildSettingsQuery: () => [], parseSettingsResponse: () => null
  }
  const selector = component('src/components/MidiComponents/BiotronDeviceSelector.vue', selectorContext)
  const target = bind(selector, {regexName: /Biotron/, checkVersionsFlag: false})
  const opening = target.connectMidi()
  assert.equal(target.connecting, true)
  await target.connectMidi()
  assert.equal(browserRequests, 2, 'Second Settings attempt opened another browser prompt')
  target.cancelConnection()
  assert.equal(target.connecting, false, 'Settings did not leave starting immediately')
  assert.match(target.midiError, /cancelled/i)
  pending.resolve(access)
  await bounded(opening)
  assert.equal(target.selectedDevice, null, 'Late grant connected Settings after Cancel')
  assert.equal(target.events.at(-1)[1], undefined)
  await bounded(target.connectMidi())
  assert.equal(browserRequests, 2, 'Retry repeated the settled browser prompt')
  assert.match(target.midiError, /No matching MIDI device/, 'Device absent was confused with permission denial')

  midiAccess.resetSharedMidiAccessForTests()
  pending = deferred()
  const leaving = bind(selector, {regexName: /Biotron/, checkVersionsFlag: false})
  const routeAttempt = leaving.connectMidi()
  selector.beforeUnmount.call(leaving)
  pending.resolve(access)
  await bounded(routeAttempt)
  assert.equal(leaving.events.length, 0, 'Route change emitted a late device')

  midiAccess.resetSharedMidiAccessForTests()
  pending = deferred()
  const deniedSignal = new AbortController()
  const cancelledDenial = midiAccess.requestSharedMidiAccess({sysex: true, signal: deniedSignal.signal})
  deniedSignal.abort()
  await assert.rejects(bounded(cancelledDenial), {name: 'AbortError'})
  const denial = new Error('blocked')
  denial.name = 'NotAllowedError'
  pending.reject(denial)
  await new Promise(resolve => setImmediate(resolve))
  pending = deferred()
  const deniedRetry = midiAccess.requestSharedMidiAccess({sysex: true})
  assert.equal(browserRequests, 5, 'Denied prompt was not retryable')
  pending.resolve(access)
  await bounded(deniedRetry)

  midiAccess.resetSharedMidiAccessForTests()
  pending = deferred()
  const soundContext = {
    module: {exports: {}}, markRaw: value => value, defineAsyncComponent: () => ({}), AbortController,
    CompatibilityNotice: {}, DeviceTaskNav: {}, DiagnosticCopy: {}, GardenVisual: {}, WakeVolume: {}, MIDI_PROMPT_HINT: 'Allow MIDI',
    selectRevealInput: inputs => inputs[0], window: {setTimeout, clearTimeout},
    document: {}, trace() {}, recordBiotronEvent() {}
  }
  const keyboardContext = {module: {exports: {}}}
  vm.runInNewContext(fs.readFileSync('src/audio/core.mjs', 'utf8').replace(/^export /gm, '') +
    '\nmodule.exports = {KEYBOARD_CODE_TO_NOTE}', keyboardContext)
  soundContext.KEYBOARD_CODE_TO_NOTE = keyboardContext.module.exports.KEYBOARD_CODE_TO_NOTE
  soundContext.updateSoundSession = () => {}
  soundContext.parseBiotronCalibrationState = () => null
  soundContext.BIOTRON_CALIBRATION = {}
  const effectsContext = {module: {exports: {}}}
  vm.runInNewContext(fs.readFileSync('src/audio/soundSessionEffects.mjs', 'utf8')
    .replace('export function createSoundSessionEffects', 'function createSoundSessionEffects') +
    '\nmodule.exports = createSoundSessionEffects', effectsContext)
  soundContext.createSoundSessionEffects = effectsContext.module.exports
  const sound = component('src/components/SoundLab/SoundLab.vue', soundContext)
  let connects = 0
  const play = bind(sound, {
    canStartReveal: true, starting: false, permissionPending: false,
    permissionAbort: null, permissionAttemptId: 0,
    revealProfile: {id: 'test', productName: 'Biotron', settlingStatus: 'Settling'},
    revealStage: 'intro', midiInputs: [], status: '',
    midi: {
      requestAccess: (_, signal) => midiAccess.requestSharedMidiAccess({sysex: true, signal}),
      async connect() { connects++ }
    }
  }, false)
  play.acquireTabLease = async () => true
  play.ensureEngine = async () => {}
  play.resetCalibration = () => {}
  const firstPlay = play.startReveal()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(play.permissionPending, true)
  await play.startReveal()
  assert.equal(browserRequests, 6, 'Second Play attempt opened another browser prompt')
  play.cancelMidiPermission()
  assert.equal(play.starting, false, 'Play did not leave starting immediately')
  assert.match(play.status, /cancelled/i)
  pending.resolve([{id: 'biotron-1', name: 'Biotron'}])
  await bounded(firstPlay)
  assert.equal(connects, 0, 'Late grant connected Play after Cancel')
  assert.equal(play.revealStage, 'intro')
  await bounded(play.startReveal())
  assert.equal(connects, 1, 'Retry did not connect on a new user gesture')
  assert.equal(browserRequests, 6, 'Retry created a parallel permission loop')

  midiAccess.resetSharedMidiAccessForTests()
  pending = deferred()
  const routePlay = bind(sound, {
    canStartReveal: true, starting: false, permissionPending: false,
    permissionAbort: null, permissionAttemptId: 0,
    revealProfile: {id: 'test', productName: 'Biotron', settingsRoute: '/biotron', settlingStatus: 'Settling'},
    revealStage: 'intro', midiInputs: [], status: '',
    midi: {
      requestAccess: (_, signal) => midiAccess.requestSharedMidiAccess({sysex: true, signal}),
      async connect() { connects++ }
    }
  }, false)
  routePlay.acquireTabLease = async () => true
  routePlay.ensureEngine = async () => {}
  routePlay.stop = async () => { routePlay.stopped = true }
  const routePlayAttempt = routePlay.startReveal()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(routePlay.permissionPending, true)
  let navigated = false
  await sound.beforeRouteLeave.call(routePlay, {path: '/other'}, {}, () => { navigated = true })
  assert.equal(navigated, true, 'Play route change waited on the browser permission prompt')
  pending.resolve([{id: 'biotron-2', name: 'Biotron'}])
  await bounded(routePlayAttempt)
  assert.equal(connects, 1, 'Play connected after route change')

  const {MidiInputSession} = await import('../src/audio/midi.mjs')
  const openingPort = deferred()
  const portStarted = deferred()
  let lateCloseCalls = 0
  const input = {
    id: 'slow-biotron', name: 'Biotron', state: 'connected',
    open() { portStarted.resolve(); return openingPort.promise },
    async close() { lateCloseCalls++ },
    addEventListener() {}, removeEventListener() {}
  }
  const engine = {activeVoiceCount: 0, panic() {}, async stop() {}}
  const midi = new MidiInputSession(engine, () => {}, {cleanupTimeoutMs: 25})
  midi.access = {inputs: new Map([[input.id, input]]), removeEventListener() {}}
  soundContext.updateSoundSession = () => {}
  const stoppingPlay = bind(sound, {
    canStartReveal: true, starting: false, midiOpening: false, permissionPending: false,
    permissionAbort: null, permissionAttemptId: 0, releaseBlocked: false,
    revealProfile: {id: 'test', productName: 'Biotron', settlingStatus: 'Settling'},
    revealStage: 'intro', midiInputs: [], status: '', midi, engine, volume: 65,
    tabLease: {release() {}}
  }, false)
  stoppingPlay.acquireTabLease = async () => true
  stoppingPlay.ensureEngine = async () => {}
  stoppingPlay.resetVoiceUi = () => {}
  stoppingPlay.resetCalibration = () => {}
  stoppingPlay.stopAudioClockMonitor = () => {}
  const openingPlay = stoppingPlay.startReveal()
  await portStarted.promise
  assert.equal(stoppingPlay.midiOpening, true, 'Stop is unavailable during MIDI input open')
  await bounded(stoppingPlay.stop())
  assert.equal(stoppingPlay.releaseBlocked, true, 'Stop claimed an unresolved port was released')
  assert.match(stoppingPlay.status, /did not release/i)
  openingPort.resolve()
  await bounded(openingPlay)
  assert.equal(lateCloseCalls, 1)
  assert.match(stoppingPlay.status, /did not release/i, 'Late open overwrote the Stop warning')
  await bounded(stoppingPlay.stop())
  assert.equal(stoppingPlay.releaseBlocked, false)
  assert.equal(stoppingPlay.midi, null)

  const routeOpening = bind(sound, {
    midiOpening: true, starting: true, permissionPending: false,
    permissionAttemptId: 1, revealMode: true,
    revealProfile: {settingsRoute: '/biotron'}, releaseBlocked: false, midi: {}
  }, false)
  let routeStops = 0
  routeOpening.stop = async () => { routeStops++; routeOpening.releaseBlocked = true }
  let routeResult = 'unset'
  await sound.beforeRouteLeave.call(routeOpening, {path: '/biotron'}, {}, result => { routeResult = result })
  assert.equal(routeStops, 1, 'Route change skipped release during pending MIDI open')
  assert.equal(routeResult, false, 'Route change claimed release after an unresolved MIDI open')

  console.log('MIDI permission and Stop cancellation verified: one browser request, late grant, bounded open, retry and route change')
})().catch(error => { console.error(error); process.exitCode = 1 })
