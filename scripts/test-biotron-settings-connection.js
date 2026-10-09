const assert = require('assert')
const fs = require('fs')
const vm = require('vm')

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
  BiotronDb: class {},
}
for (const name of [
  'DeviceTaskNav', 'DiagnosticCopy', 'BootstrapCollapse', 'LoaderComponent', 'UpdateFirmwareComponent',
  'DeviceSelector', 'PatchSelector', 'SelectCommand', 'SliderRangeCommand',
  'SliderCommand', 'SwitchComponent', 'GroupOfCommands', 'FileDropArea',
]) context[name] = {}
const connectionSource = fs.readFileSync('src/biotron/settingsConnection.mjs', 'utf8')
  .replace('export function createSettingsConnectionMethods', 'function createSettingsConnectionMethods') +
  '\nmodule.exports = createSettingsConnectionMethods'
const connectionContext = {module: {exports: {}}}
vm.runInNewContext(connectionSource, connectionContext)
context.createSettingsConnectionMethods = connectionContext.module.exports
context.settingsVectorFromCommands = () => []
context.settingsVectorsEqual = () => true
context.savedSettingsMessage = () => 'Saved'
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
  const legacy = page()
  legacy.firmwareVersion = '1.8.2'
  legacy.legacyFirmware = component.computed.legacyFirmware.call(legacy)
  legacy.readPersistedSettingsWithRetry = () => { throw new Error('legacy must not query unsupported readback') }
  await legacy.loadPersistedSettings(legacy.device)
  assert.equal(legacy.settingsState, 'error')
  assert.match(legacy.settingsMessage, /Update firmware/)
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
  console.log('Biotron Settings initial-read, retry and eight stale-gesture/independent-edit cases: PASS')
})().catch(error => { console.error(error); process.exitCode = 1 })
