const assert = require('assert')
const fs = require('fs')
const vm = require('vm')

const source = fs.readFileSync('src/components/BiotronPage/BiotronPageUpdated.vue', 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const context = {
  module: {exports: {}},
  process: {env: {}},
  applySettingsVector() {},
  soundSessionState: {running: false},
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
    settingsMessage: '',
    firmwareVersion: '1.9.8',
    commands_data: {},
    forceRerender: 0,
    $refs: {deviceSelector: {requestFirmwareVersion() { return true }}},
  }
  for (const [name, method] of Object.entries(component.methods)) state[name] = method.bind(state)
  return state
}

;(async () => {
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
  console.log('Biotron Settings initial-read gate and retry: PASS')
})().catch(error => { console.error(error); process.exitCode = 1 })
