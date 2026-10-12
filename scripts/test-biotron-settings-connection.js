const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
let presetProvider = () => ({})

const source = fs.readFileSync(process.env.BIOTRON_SETTINGS_CONTROL_FILE || 'src/components/BiotronPage/BiotronPageUpdated.vue', 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const context = {
  module: {exports: {}},
  process: {env: {}},
  defineAsyncComponent: () => ({}),
  applySettingsVector() {},
  soundSessionState: {running: false},
  recordBiotronEvent() {},
  BiotronCommandsData: [],
  BiotronDb: class {constructor() {Object.assign(this, presetProvider())}},
  getSoundController: () => null,
  updateSoundSession() {},
}
for (const name of [
  'DeviceTaskNav', 'DiagnosticCopy', 'BootstrapCollapse', 'LoaderComponent', 'UpdateFirmwareComponent',
  'DeviceSelector', 'PatchSelector', 'SelectCommand', 'SliderRangeCommand',
  'SliderCommand', 'SwitchComponent', 'GroupOfCommands', 'FileDropArea',
]) context[name] = {}
const connectionSource = fs.readFileSync('src/biotron/settingsConnection.mjs', 'utf8')
  .replace('export function createSettingsConnectionMethods', 'function createSettingsConnectionMethods') +
  '\nmodule.exports = createSettingsConnectionMethods'
const connectionContext = {module: {exports: {}}, setTimeout, clearTimeout}
vm.runInNewContext(connectionSource, connectionContext)
context.createSettingsConnectionMethods = connectionContext.module.exports
context.settingsVectorFromCommands = () => []
context.settingsVectorsEqual = () => true
context.savedSettingsMessage = () => 'Saved'
const storageEvents = []
context.document = {dispatchEvent(event) {storageEvents.push(event.detail)}}
context.CustomEvent = class {constructor(type, options) {this.type = type; this.detail = options?.detail}}
const feedback = fs.readFileSync('src/assets/js/PresetsIDB.js', 'utf8').split('export async function withPresetFeedback')[1]
vm.runInNewContext('async function withPresetFeedback' + feedback, context)
vm.runInNewContext(
  script.replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?/g, '')
    .replace('export default', 'module.exports ='),
  context
)
const component = context.module.exports

function page() {
  const device = {id: 'biotron-output'}
  const state = {
    betaBuild: true,
    device,
    settingsState: 'connecting',
    settingsSnapshotKnown: false,
    settingsLoadId: 0,
    liveVerifyId: 0,
    liveVerifyTimer: null,
    calibrationBusy: false,
    settingsMessage: '',
    firmwareVersion: '1.9.8',
    commands_data: {},
    forceRerender: 0,
    $refs: {deviceSelector: {operationId: 0, requestFirmwareVersion() { return true }}},
  }
  for (const [name, method] of Object.entries(component.methods)) state[name] = method.bind(state)
  return state
}

// A select commits its displayed value before notifying the parent. A Vue
// watcher runs later; callers must never receive the previous choice.
const selectScript = fs.readFileSync(process.env.SELECT_COMMAND_CONTROL_FILE || 'src/components/MidiComponents/SelectCommand.vue', 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1]
const selectContext = {module: {exports: {}}, HintComponent: {}, SysExCommand: class {}}
vm.runInNewContext(selectScript.replace(/import.*$/gm, '').replace('export default', 'module.exports ='), selectContext)
const selection = {Value: 0, commandObject: {value: 4, set_value(value) {this.value = value}},
  $emit(name, command) {assert.equal(command.value, this.Value, 'selector emitted the previous scale')}}
for (const value of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  selection.Value = value
  selectContext.module.exports.methods.changed.call(selection)
}

function controlComponent(file) {
  const script = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const scope = {module: {exports: {}}, SysExCommand: class {}, HintComponent: {}, Slider: {}, toRaw: value => value}
  vm.runInNewContext(script.replace(/import.*$/gm, '').replace('export default', 'module.exports ='), scope)
  return scope.module.exports
}
const slider = controlComponent('src/components/MidiComponents/SliderCommand.vue')
const numeric = {rawValue: 50, minValue: 0, maxValue: 100, tableValues: undefined,
  commandObject: {value: 50, set_value(value) {this.value = value}}, sent: [],
  $emit(name, command) {this.sent.push(command.value)}}
for (const [name, method] of Object.entries(slider.methods)) numeric[name] = method.bind(numeric)
for (const [entered, expected] of [['101', 100], ['-1', 0], ['42.6', 43], ['0', 0]]) {
  numeric.rawValue = entered
  numeric.changed({target: {value: entered}})
  assert.equal(numeric.commandObject.value, expected, 'numeric input displayed one value and sent another')
  assert.equal(numeric.rawValue, expected)
}
const numericWrites = numeric.sent.length
numeric.changed({target: {value: ''}})
assert.equal(numeric.sent.length, numericWrites, 'blank input must not replace a device setting')
const range = controlComponent('src/components/MidiComponents/SliderRangeCommand.vue')
const pair = {values: [-1, 128], sent: [],
  minCommandObject: {value: 8, min_value: 0, max_value: 127, set_value(value) {this.value = value}},
  maxCommandObject: {value: 98, min_value: 0, max_value: 127, set_value(value) {this.value = value}},
  $emit(name, command) {this.sent.push(command.value)}}
for (const [name, method] of Object.entries(range.methods)) pair[name] = method.bind(pair)
pair.changeEndpoint(0, pair.minCommandObject); pair.changeEndpoint(1, pair.maxCommandObject)
assert.equal(pair.minCommandObject.value, 0, 'explicit velocity zero must remain valid')
assert.equal(pair.maxCommandObject.value, 127)
assert.deepEqual(pair.values, [0, 127])
const typedEndpoint = {target: {value: '-1'}}
pair.values[0] = 8
pair.changeEndpoint(0, pair.minCommandObject, typedEndpoint)
assert.equal(typedEndpoint.target.value, 0)
const blankEndpoint = {target: {value: ''}}
pair.changeEndpoint(0, pair.minCommandObject, blankEndpoint)
assert.equal(blankEndpoint.target.value, 0, 'blank numeric DOM must restore even when reactive state is already zero')
const rangeWrites = pair.sent.length
pair.values[0] = ''; pair.changeEndpoint(0, pair.minCommandObject)
assert.equal(pair.sent.length, rangeWrites, 'blank range endpoint must not write zero')

;(async () => {
  const importing = page()
  importing.settingsSnapshotKnown = true
  importing.commands_data = Object.fromEntries(['noteDistance', 'minPlantVelocity'].map(name => [name,
    {value: 8, min_value: 0, max_value: name === 'noteDistance' ? 100 : 127, set_value(value) { this.value = value }}]))
  let presetChanges = 0
  importing.patchChanged = importing.saveData = async () => { presetChanges++ }
  importing.markPresetPending = () => {}
  for (const invalid of ['{', '{}', '{"commands":[]}', '{"commands":[{"name":"unknown","value":1}]}',
    '{"commands":[{"name":"noteDistance","value":101}]}', '{"commands":[{"name":"noteDistance","value":3},{"name":"noteDistance","value":4}]}',
    '{"commands":[{"name":"noteDistance","value":null}]}', '{"commands":[{"name":"noteDistance","value":""}]}']) {
    await assert.doesNotReject(() => importing.loadDataFromPreset(invalid), 'invalid preset must show an error without throwing')
    assert.match(importing.settingsMessage, /valid Biotron preset file/)
    assert.equal(presetChanges, 0, 'invalid preset changed browser storage before validation')
    assert.equal(importing.commands_data.noteDistance.value, 8, 'invalid preset partly changed the form')
  }
  await importing.loadDataFromPreset('{"commands":[{"name":"minPlantVelocity","value":0},{"name":"noteDistance","value":"42"}]}')
  assert.equal(importing.commands_data.minPlantVelocity.value, 0)
  assert.equal(Number(importing.commands_data.noteDistance.value), 42, 'legacy numeric strings must remain readable')
  assert.equal(presetChanges, 2)
  const storedData = new Map()
  context.localStorage = {getItem: key => storedData.get(key), setItem: (key, value) => storedData.set(key, value)}
  connectionContext.localStorage = context.localStorage
  importing.id = 'stored-preset-fixture'
  importing.patch_id = 9
  storedData.set(importing.id, '9')
  let storedPreset
  importing.db = {getPatch: async () => storedPreset}
  for (const data of [{noteDistance: 21, unknown: 1}, null, [], {}, {noteDistance: 101}, {noteDistance: ''}]) {
    storedPreset = {id: 9, editable: true, saved: true, data}
    await assert.doesNotReject(() => importing.loadData(), 'damaged stored preset must show an error without interrupting Settings')
    assert.match(importing.settingsMessage, /Choose another preset/)
    assert.equal(importing.commands_data.noteDistance.value, 42, 'damaged stored preset partly changed the form')
    assert.equal(presetChanges, 2, 'reading a damaged preset wrote browser storage')
    assert.equal(storedData.get(importing.id), '9', 'damaged preset was silently replaced')
  }
  storedPreset = {id: 9, editable: true, data: {noteDistance: '7', minPlantVelocity: 0}}
  assert.equal(await importing.loadData(), true)
  assert.equal(importing.commands_data.noteDistance.value, 7)
  assert.equal(importing.commands_data.minPlantVelocity.value, 0)
  const uncommon = {commandObject: {value: 7}, tableValues: {1:'1',2:'1/2',4:'1/4',8:'1/8'}, tableValuesReversed: true, rawValue: -1}
  slider.created.call(uncommon)
  assert.equal(uncommon.tableTranslate[uncommon.rawValue], '7', 'stored table value was displayed as another setting')
  assert.equal(uncommon.maxValue, uncommon.tableTranslate.length - 1)
  assert.equal(uncommon.tableTranslate.join(','), '8,7,4,2,1', 'custom value must retain the slider order')
  const legacy = page()
  legacy.firmwareVersion = '1.8.2'
  legacy.legacyFirmware = component.computed.legacyFirmware.call(legacy)
  legacy.readPersistedSettingsWithRetry = () => { throw new Error('legacy must not query unsupported readback') }
  await legacy.loadPersistedSettings(legacy.device)
  assert.equal(legacy.settingsState, 'error')
  assert.match(legacy.settingsMessage, /Check the firmware offer/)
  assert.equal(component.computed.legacyFirmware.call({firmwareVersion:'1.9.8'}), false)
  const loading = page()
  let finishRead
  let calibrationStarts = 0
  loading.calibrationBusy = false
  loading.$refs.deviceSelector.requestRecalibration = () => { calibrationStarts++ }
  loading.readPersistedSettingsWithRetry = () => new Promise(resolve => { finishRead = resolve })
  const firstRead = loading.loadPersistedSettings(loading.device)
  const loadId = loading.settingsLoadId
  loading.startCalibration()
  assert.equal(calibrationStarts, 0, 'calibration interrupted an unconfirmed first read')
  assert.equal(loading.settingsLoadId, loadId)
  assert.equal(loading.settingsState, 'loading')
  finishRead({values: []})
  await firstRead
  assert.equal(loading.settingsSnapshotKnown, true)

  const target = page()
  target.readPersistedSettingsWithRetry = async () => { throw new Error('no first read') }
  await target.loadPersistedSettings(target.device)
  assert.equal(target.settingsState, 'error')
  assert.equal(component.computed.settingsReady.call(target), false,
    'initial read failure exposed unverified settings controls')
  assert.match(target.settingsMessage, /retry/i)
  assert.doesNotMatch(target.settingsMessage, /Live changes still work/i)

  let writes = 0
  target.patchChanged = async () => { writes++ }
  await target.sys_ex_changed({name: 'lightBpm', sendToMidi: async () => { writes++ }})
  assert.equal(writes, 0, 'unknown settings were written after a failed first read')

  target.readPersistedSettingsWithRetry = async () => ({values: []})
  await target.retrySettingsConnection()
  assert.equal(target.settingsState, 'loaded')
  assert.equal(component.computed.settingsReady.call(target), true,
    'retry did not unlock a confirmed snapshot')

  target.readPersistedSettingsWithRetry = async () => { throw new Error('verification failed') }
  await target.loadPersistedSettings(target.device)
  assert.equal(component.computed.settingsReady.call(target), true,
    'a later verification failure hid previously confirmed settings')
  const status = () => component.computed.lightSensorStatus.call({
    ...target, settingsReady: component.computed.settingsReady.call(target),
  })
  target.commands_data.light_pitch_mode = {value: 0}
  target.commands_data.light_no_velocity = {value: 0}
  target.settingsState = 'loaded'
  assert.match(status(), /Light notes are enabled/)
  target.commands_data.light_no_velocity.value = 1
  assert.match(status(), /Light notes are muted/)
  target.commands_data.light_pitch_mode.value = 1
  assert.match(status(), /Pitch Bend mode/)
  assert.doesNotMatch(status(), /Light notes are enabled/)
  target.settingsState = 'changed'
  assert.match(status(), /Saving and checking/)
  target.settingsSnapshotKnown = false
  assert.match(status(), /unknown until Biotron settings are read/)
  target.settingsSnapshotKnown = true
  target.settingsState = 'error'
  assert.match(status(), /not confirmed/)
  const local = page()
  local.device = null
  let localSaves = 0, midiWrites = 0, loadedDeviceVector = 0
  local.patchChanged = async () => { localSaves++ }
  local.clearLiveVerification = () => {}
  await local.sys_ex_changed({name: 'scale', sendToMidi: async () => { midiWrites++ }})
  assert.equal(localSaves, 1, 'disconnected edit must save the local preset')
  assert.equal(midiWrites, 0, 'disconnected edit must not send MIDI')
  assert.equal(local.presetPending, true)
  context.applySettingsVector = () => { loadedDeviceVector++ }
  local.device = {id: 'reconnected'}
  local.readPersistedSettingsWithRetry = async () => ({values: []})
  await local.loadPersistedSettings(local.device)
  assert.equal(local.settingsSnapshotKnown, true)
  assert.equal(local.presetPending, true, 'reconnect must preserve unapplied local edits')
  assert.equal(loadedDeviceVector, 0, 'device readback overwrote the local preset')
  assert.match(local.settingsMessage, /local preset is unchanged/)

  const deferred = () => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return {promise, resolve}
  }
  const editable = () => {
    const state = page()
    state.settingsSnapshotKnown = true
    state.settingsState = 'loaded'
    state.page_is_inited = true
    return state
  }
  const reconnect = async (state, device) => {
    state.$refs.deviceSelector.operationId++
    await state.handleDeviceChanged(device)
  }
  const changedDuringSave = async (name, change) => {
    const state = editable(), initial = state.device, replacement = {id: 'replacement'}
    const save = deferred(), writes = [], verified = []
    state.patchChanged = () => save.promise
    state.scheduleLiveVerification = device => verified.push(device.id)
    const gesture = state.sys_ex_changed({name: 'firstValue', sendToMidi: device => writes.push(device.id)})
    await change(state, initial, replacement)
    save.resolve()
    await gesture
    assert.deepEqual(writes, [], `${name}: old gesture reached a stale or replacement connection`)
    assert.deepEqual(verified, [], `${name}: old gesture verified a stale or replacement connection`)
    assert.notEqual(state.settingsState, 'changed', `${name}: old gesture claimed a live change`)
  }
  await changedDuringSave('A to B', (state, initial, replacement) => reconnect(state, replacement))
  await changedDuringSave('disconnect', state => reconnect(state, null))
  await changedDuringSave('A to B to A', async (state, initial, replacement) => {
    await reconnect(state, replacement)
    await reconnect(state, initial)
    state.settingsSnapshotKnown = true
  })
  await changedDuringSave('same-object reconnect', async (state, initial) => {
    await reconnect(state, initial)
    state.settingsSnapshotKnown = true
  })
  await changedDuringSave('readback became unknown', state => { state.settingsSnapshotKnown = false })

  const sending = editable(), sendDevice = sending.device, sendEntered = deferred(), sendFinished = deferred()
  const sent = [], verifiedAfterSend = []
  sending.patchChanged = async () => {}
  sending.scheduleLiveVerification = device => verifiedAfterSend.push(device.id)
  const sendGesture = sending.sys_ex_changed({name: 'scale', sendToMidi: async device => {
    sent.push(device.id)
    sendEntered.resolve()
    await sendFinished.promise
  }})
  await sendEntered.promise
  await reconnect(sending, {id: 'replacement-during-send'})
  sending.settingsSnapshotKnown = true
  sendFinished.resolve()
  await sendGesture
  assert.deepEqual(sent, [sendDevice.id], 'send used the replacement instead of its captured target')
  assert.deepEqual(verifiedAfterSend, [], 'completion of an old send verified the replacement')
  assert.equal(sending.settingsState, 'connecting', 'completion of an old send changed replacement status')

  const independent = editable(), firstSave = deferred(), secondSave = deferred(), independentWrites = [], independentVerifications = []
  let saveIndex = 0
  independent.patchChanged = () => [firstSave.promise, secondSave.promise][saveIndex++]
  independent.scheduleLiveVerification = device => independentVerifications.push(device.id)
  const firstGesture = independent.sys_ex_changed({name: 'scale', sendToMidi: device => independentWrites.push(['scale', device.id])})
  const secondGesture = independent.sys_ex_changed({name: 'lightBpm', sendToMidi: device => independentWrites.push(['lightBpm', device.id])})
  secondSave.resolve()
  await secondGesture
  firstSave.resolve()
  await firstGesture
  assert.equal(independent.settingsLoadId, 2)
  assert.deepEqual(independentWrites, [['lightBpm', independent.device.id], ['scale', independent.device.id]],
    'independent gestures on one connection cancelled each other')
  assert.deepEqual(independentVerifications, [independent.device.id, independent.device.id])

  const rejected = editable(), rejectedWrites = []
  rejected.patchChanged = async () => { throw new Error('local preset save failed') }
  rejected.scheduleLiveVerification = () => { throw new Error('failed local save must not verify') }
  await assert.rejects(rejected.sys_ex_changed({name: 'scale', sendToMidi: device => rejectedWrites.push(device.id)}), /local preset save failed/)
  assert.deepEqual(rejectedWrites, [], 'failed local persistence still wrote MIDI')

  // Exercise the real feedback wrapper: it returns null on an aborted save.
  // A throwing patchChanged stub alone cannot detect the production failure.
  const storedEdit = () => {
    const state = editable()
    state.id = 'settings-storage-fixture'
    state.patch_id = 7
    state.patches = [{id: 7, saved: false}]
    state.commands_data = {scale: {name: 'scale', value: 8}}
    storedData.set(state.id, '7')
    return state
  }
  const failure = storedEdit(), failureWrites = [], failureVerifications = []
  failure.db = {async updatePatch() {throw new Error('Injected quota failure')}}
  failure.scheduleLiveVerification = () => failureVerifications.push('verify')
  storageEvents.length = 0
  await failure.sys_ex_changed({name: 'scale', sendToMidi: () => failureWrites.push('send')})
  assert.equal(storageEvents.at(-1).ok, false)
  assert.deepEqual(failureWrites, [], 'real autosave rejection still sent MIDI')
  assert.deepEqual(failureVerifications, [], 'real autosave rejection started verification')
  assert.equal(failure.settingsState, 'error')
  assert.match(failure.settingsMessage, /not saved/i)
  assert.equal(failure.commands_data.scale.value, 8, 'storage failure discarded the edit')
  failure.db.updatePatch = async (id, data) => ({id, data})
  await failure.sys_ex_changed({name: 'scale', sendToMidi: () => failureWrites.push('send')})
  assert.equal(storageEvents.at(-1).ok, true)
  assert.deepEqual(failureWrites, ['send'], 'retry did not restore the live path')
  assert.deepEqual(failureVerifications, ['verify'])

  const importFailure = storedEdit()
  importFailure.commands_data.scale = {name:'scale', value:8, min_value:0, max_value:12,
    set_value(value) {this.value = value}}
  let importSave = 0
  importFailure.db = {async updatePatch(id, data) {
    if (++importSave === 2) throw new Error('Injected import save failure')
    return {id, data}
  }}
  await importFailure.loadDataFromPreset('{"commands":[{"name":"scale","value":6}]}')
  assert.equal(importFailure.commands_data.scale.value, 6)
  assert.equal(importFailure.presetPending, true, 'an unsaved imported form was exposed as the live device state')
  assert.equal(importFailure.settingsState, 'error', 'import pending status hid the storage error')

  const a = storedEdit(), records = new Map([[7, {scale: 2}], [9, {scale: 3}]])
  const addresses = []
  a.patches = [{id: 7, saved: false}, {id: 9, saved: false}]
  a.db = {async updatePatch(id, data) {addresses.push(Number(id)); records.set(Number(id), data); return {id, data}}}
  storedData.set(a.id, '9') // another tab changes the shared startup preference
  await a.patchChanged()
  assert.equal(records.get(9).scale, 3, 'tab B redirected tab A into its preset')
  assert.equal(records.get(7).scale, 8)
  assert.deepEqual(addresses, [7])
  a.patches[0].saved = true
  a.patches[0].data = {scale: 2}
  a.db.createPatch = async data => {records.set(10, data); return 10}
  a.db.getPatch = async () => [...a.patches, {id: 10, saved: false}]
  a.commands_data.scale.value = 11
  await a.patchChanged()
  assert.equal(a.patch_id, 10, 'editing a saved preset did not select its own draft')
  assert.equal(records.get(9).scale, 3, 'saved-preset fork overwrote another tab draft')
  assert.equal(records.get(10).scale, 11)
  assert.equal(records.get(7).scale, 8, 'saved source was overwritten')
  const legacyOrder = page(), legacyCalls = []
  legacyOrder.commands_data = Object.fromEntries(['scale', 'plantBpm', 'lightBpm'].map(name => [name,
    {sendToMidi(output, bytes) {legacyCalls.push([name, ...bytes])}}]))
  await legacyOrder.sendDataDeprecated(null)
  assert.deepEqual(legacyCalls, [])
  await legacyOrder.sendDataDeprecated({send(bytes) {legacyCalls.push(Array.from(bytes))},
    async wait(ms) {legacyCalls.push(['wait', ms])}})
  assert.deepEqual(legacyCalls, [[240,11,16,127,247], ['scale',11], ['wait',100],
    ['lightBpm',11], ['wait',100], [240,11,126,247], ['wait',100], ['plantBpm',11]],
    'simplification changed the legacy firmware command order')
  { // Cold storage has independent pending and unmount boundaries.
  const stored = {id:9, name:'My preset', editable:true, saved:true, data:{scale:5}}
  const initialPage = (device = null) => {
    const state = Object.assign(page(), component.data())
    state.betaBuild = true; state.id = 'preset-startup-fixture'; state.device = device
    state.commands_data = {scale:{name:'scale', value:1, min_value:0, max_value:12, set_value(value) {this.value = value}}}
    state.readbacks = 0
    state.loadPersistedSettings = async output => {assert.equal(output, state.device); state.readbacks++; state.settingsSnapshotKnown = true}
    storedData.set(state.id, '9')
    return state
  }
  let constructions = 0, startupFailure = 'ready'
  presetProvider = () => {
    constructions++
    return {ready: startupFailure === 'ready' ? Promise.reject(Error('Injected storage open failure')) : Promise.resolve(),
      async getPatch(id) {if ((startupFailure === 'list' && id === undefined) || (startupFailure === 'selected' && id === 9)) throw Error('Injected preset list failure'); return id === undefined ? [stored] : stored}}
  }
  for (const kind of ['ready', 'list', 'selected']) {
    startupFailure = kind
    const state = initialPage({id:'cold-device'})
    await assert.doesNotReject(() => component.created.call(state), 'initial preset storage failure escaped instead of offering recovery')
    assert.equal(state.page_is_inited, false); assert.equal(state.readbacks, 0)
    assert.match(state.presetStorageError, /saved presets/i)
    assert.equal(state.presetStoragePending, false)
    assert.equal(state.commands_data.scale.value, 1)
    startupFailure = ''
    await state.initPresetStorage()
    assert.equal(state.page_is_inited, true); assert.equal(state.patch_id, 9)
    assert.equal(state.commands_data.scale.value, 5); assert.equal(state.readbacks, 1)
    assert.equal(state.presetStorageError, '')
  }
  const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
  const malformed = initialPage()
  presetProvider = () => ({ready:Promise.resolve(), async getPatch(id) {return id === undefined ? [stored] : {...stored, data:{unknown:1}}}})
  await component.created.call(malformed)
  assert.equal(malformed.page_is_inited, true, 'invalid selected preset hid the usable preset list')
  assert.match(malformed.settingsMessage, /Choose another preset/)
  assert.equal(malformed.commands_data.scale.value, 1)
  presetProvider = () => ({ready:Promise.resolve(), async getPatch(id) {return id === undefined ? [stored] : stored}})
  malformed.db = new context.BiotronDb()
  assert.equal(await malformed.loadData(), true)
  assert.equal(malformed.commands_data.scale.value, 5)
  for (const phase of ['ready', 'list', 'selected', 'fallback', 'rejected']) {
    const pending = deferred(), reached = deferred()
    presetProvider = () => {
      constructions++
      if (phase === 'ready') reached.resolve()
      return {ready: phase === 'ready' ? pending.promise : Promise.resolve(), async getPatch(id) {
        if (phase === 'fallback' && id === 9) return null
        if ((phase === 'list' && id === undefined) || (['selected', 'rejected'].includes(phase) && id === 9) || (phase === 'fallback' && id === 1)) {reached.resolve(); return pending.promise}
        return id === undefined ? [stored] : stored
      }}
    }
    const state = initialPage(), opening = component.created.call(state)
    await reached.promise
    const calls = constructions
    await state.initPresetStorage()
    assert.equal(constructions, calls, 'Retry overlapped a pending initial load')
    component.beforeUnmount.call(state)
    const afterUnmount = {value:state.commands_data.scale.value, patch:state.patch_id, error:state.presetStorageError}
    if (phase === 'rejected') pending.reject(Error('Late storage rejection'))
    else pending.resolve(phase === 'list' ? [stored] : stored)
    await opening
    assert.equal(state.page_is_inited, false, 'late initial load exposed unmounted controls')
    assert.deepEqual({value:state.commands_data.scale.value, patch:state.patch_id, error:state.presetStorageError}, afterUnmount)
    assert.equal(state.readbacks, 0)
  }
  const pending = deferred()
  presetProvider = () => ({ready:pending.promise, async getPatch(id) {return id === undefined ? [stored] : stored}})
  const timed = initialPage()
  let deadline
  connectionContext.setTimeout = (callback, ms) => {assert.equal(ms, 5000); deadline = callback; return 1}
  connectionContext.clearTimeout = () => {}
  const opening = component.created.call(timed)
  deadline(); await opening
  assert.match(timed.presetStorageError, /saved presets/i); assert.equal(timed.presetStoragePending, false)
  connectionContext.setTimeout = setTimeout; connectionContext.clearTimeout = clearTimeout
  presetProvider = () => ({ready:Promise.resolve(), async getPatch(id) {return id === undefined ? [stored] : stored}})
  await timed.initPresetStorage()
  pending.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(timed.page_is_inited, true); assert.equal(timed.commands_data.scale.value, 5)
  assert.equal(timed.presetStorageError, '', 'old timed-out completion replaced the successful Retry')
  }
  console.log('Biotron Settings initial-read, retry, stale gestures, real autosave failure/retry, preset addressing/fork, legacy order and startup storage recovery: PASS')
})().catch(error => { console.error(error); process.exitCode = 1 })
