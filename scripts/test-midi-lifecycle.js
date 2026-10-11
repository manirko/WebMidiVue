const assert = require('assert')
const fs = require('fs')
const vm = require('vm')

const source = fs.readFileSync('src/components/MidiComponents/BiotronDeviceSelector.vue', 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const scheduled = new Map()
const settingsOwners = new Set()
let timerId = 0
const context = {
  AbortController,
  module: { exports: {} },
  exports: {},
  navigator: {
    userAgent: 'Mozilla/5.0 (Macintosh) Chrome/151.0',
    requestMIDIAccess: async () => ({inputs: new Map(), outputs: new Map()})
  },
  requestSharedMidiAccess(options) { return context.navigator.requestMIDIAccess(options) },
  MIDI_PROMPT_HINT: 'permission hint (text lives in src/audio/midiAccess.mjs)',
  soundSessionState: {running: false},
  async stopPersistentSound() { return true },
  registerSettingsOwner(release) { settingsOwners.add(release) },
  unregisterSettingsOwner(release) { settingsOwners.delete(release) },
  console: { log() {} },
  setTimeout(callback) { scheduled.set(++timerId, callback); return timerId },
  clearTimeout(id) { scheduled.delete(id) },
  buildSettingsQuery(requestId) { return [0xf0, 0x14, 0x0d, 123, 1, requestId, 0xf7] },
  parseSettingsResponse(data, expectedRequestId) {
    if (data.length !== 46 || data[2] !== 123 || data[6] !== expectedRequestId) return null
    return {valid: Boolean(data[7] & 1), dirty: Boolean(data[7] & 2), values: data.slice(18, 45)}
  }
}
vm.runInNewContext(
  script.replace(/^\s*import .*$/gm, '').replace('export default', 'module.exports ='),
  context
)
const component = context.module.exports

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function port(id, name = 'Biotron', overrides = {}) {
  return {
    id, name, manufacturer: 'Playtronica', state: 'connected', connection: 'closed',
    sent: [], closeCalls: 0, openCalls: 0,
    async open() { this.openCalls++; this.connection = 'open' },
    async close() { this.closeCalls++; this.connection = 'closed' },
    send(message) { this.sent.push(message) },
    ...overrides
  }
}

function instance(props = {}) {
  const state = component.data()
  const events = []
  const target = {
    ...state,
    regexName: /Biotron/,
    checkVersionsFlag: true,
    ...props,
    $emit(name, value) { events.push([name, value]) }
  }
  for (const [name, method] of Object.entries(component.methods)) target[name] = method.bind(target)
  target.events = events
  return target
}

async function releaseFailureStaysVisible() {
  const output = port('out-1', 'Biotron', { async close() { this.closeCalls++; throw new Error('busy') } })
  const input = port('in-1')
  const target = instance({ selectedDevice: { input, output } })
  await target.releaseMidi()
  assert.strictEqual(target.released, false)
  assert.strictEqual(target.selectedDevice.output, output)
  assert.match(target.midiError, /Could not release: Biotron/)
  assert.strictEqual(target.events.at(-1)[0], 'device_changed')
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function delayedQueryIsCancelled() {
  scheduled.clear()
  const first = { input: port('in-1'), output: port('out-1') }
  const second = { input: port('in-2'), output: port('out-2') }
  const target = instance({ devices: [first, second] })
  await target.deviceChanged()
  assert.strictEqual(scheduled.size, 1)
  target.currentMidiNum = 1
  await target.deviceChanged()
  assert.strictEqual(scheduled.size, 1, 'stale version query was not cancelled')
  for (const callback of scheduled.values()) callback()
  assert.strictEqual(first.output.sent.length, 0)
  assert.strictEqual(JSON.stringify(second.output.sent), JSON.stringify([[240, 20, 13, 126, 1, 247]]))
}

async function firmwareQueryCanBeRetriedImmediately() {
  const selected = {input: port('in-1'), output: port('out-1')}
  const target = instance({selectedDevice: selected, currentMidiNum: 0})
  assert.strictEqual(target.requestFirmwareVersion(), true)
  assert.strictEqual(JSON.stringify(selected.output.sent), JSON.stringify([[240, 20, 13, 126, 0, 247]]))
  target.released = true
  assert.strictEqual(target.requestFirmwareVersion(), false)
}

async function reconnectOpenFailure() {
  const output = port('out-1', 'Biotron', { async open() { this.openCalls++; throw new Error('owned by DAW') } })
  const midi = { inputs: new Map(), outputs: new Map([['out-1', output]]), onstatechange: null }
  const target = instance({ midiAccess: midi, released: true })
  await target.connectMidi()
  assert.strictEqual(target.released, false)
  assert.strictEqual(target.selectedDevice, null)
  assert.match(target.midiError, /Could not open the selected device/)
  assert.strictEqual(target.events.at(-1)[0], 'device_changed')
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function permissionDenialIsActionableAndRetryable() {
  context.navigator.requestMIDIAccess = async () => {
    const error = new Error('blocked')
    error.name = 'NotAllowedError'
    throw error
  }
  const target = instance()
  await target.connectMidi()
  assert.strictEqual(target.selectedDevice, null)
  assert.match(target.midiError, /MIDI access was blocked/)
}

async function missingDeviceIsActionable() {
  const midi = {inputs: new Map(), outputs: new Map(), onstatechange: null}
  const target = instance({midiAccess: midi})
  await target.refreshDevices()
  assert.strictEqual(target.selectedDevice, null)
  assert.match(target.midiError, /No matching MIDI device found/)
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function switchCloseFailureDoesNotClaimSuccess() {
  const first = {
    input: port('in-1'),
    output: port('out-1', 'Biotron', { async close() { this.closeCalls++; throw new Error('still owned') } })
  }
  const second = { input: port('in-2'), output: port('out-2') }
  const target = instance({ devices: [first, second], selectedDevice: first, currentMidiNum: 1 })
  await target.deviceChanged()
  assert.strictEqual(target.selectedDevice, first, 'selection moved despite previous output close failure')
  assert.strictEqual(target.currentMidiNum, 0, 'selector displays the unopened next device')
  assert.strictEqual(second.output.openCalls, 0, 'next output opened despite previous output close failure')
  assert.strictEqual(second.input.openCalls, 0, 'next input opened despite previous output close failure')
  assert.match(target.midiError, /Could not switch/)
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function unmountCancelsPendingOpen() {
  scheduled.clear()
  const opening = deferred()
  const output = port('out-1', 'Biotron', { open() { this.openCalls++; return opening.promise } })
  const input = port('in-1')
  const target = instance({ devices: [{ input, output }] })
  const selecting = target.deviceChanged()
  component.beforeUnmount.call(target)
  opening.resolve()
  await selecting
  await Promise.resolve()
  assert.strictEqual(target.unmounted, true)
  assert.strictEqual(scheduled.size, 0)
  assert.strictEqual(output.closeCalls, 1)
  assert.strictEqual(input.closeCalls, 1)
  assert.strictEqual(input.openCalls, 0, 'unmounted Settings opened a second port after output settled')
  assert.strictEqual(target.events.length, 0, 'unmounted component emitted a device')
}

async function navigationWaitsForUnmountedOwnerAndAllowsRetry() {
  settingsOwners.clear()
  const closing = deferred()
  let fail = true
  const output = port('retained-output', 'Biotron', {close() { this.closeCalls++; return fail ? closing.promise : Promise.resolve() }})
  const target = instance({selectedDevice: {output}, released: false})
  target.connectMidi = () => {}
  component.mounted.call(target)
  assert.strictEqual(settingsOwners.size, 1, 'Settings owner was not registered')
  const release = [...settingsOwners][0]
  component.beforeUnmount.call(target)
  let settled = false
  const navigation = release().then(value => { settled = true; return value })
  await Promise.resolve(); await Promise.resolve()
  assert.strictEqual(settled, false, 'navigation ignored pending unmounted cleanup')
  closing.reject(new Error('port busy'))
  assert.strictEqual(await navigation, false, 'failed close claimed free ownership')
  assert.strictEqual(settingsOwners.size, 1, 'failed owner was forgotten')
  assert.strictEqual(target.selectedDevice.output, output)
  fail = false
  assert.strictEqual(await release(), true, 'retained owner could not be retried')
  assert.strictEqual(settingsOwners.size, 0)
}

async function duplicateDevicesStayDistinct() {
  const input1 = port('in-1')
  const input2 = port('in-2')
  const output1 = port('out-1')
  const output2 = port('out-2')
  const midi = {
    inputs: new Map([[input1.id, input1], [input2.id, input2]]),
    outputs: new Map([[output1.id, output1], [output2.id, output2]])
  }
  const target = instance()
  const pairs = target.pairDevices(midi)
  assert.strictEqual(pairs.length, 2)
  assert.strictEqual(pairs[0].output, output1)
  assert.strictEqual(pairs[0].input, input1)
  assert.strictEqual(pairs[1].output, output2)
  assert.strictEqual(pairs[1].input, input2)
  assert.notStrictEqual(pairs[0].input, pairs[1].input, 'duplicate outputs collapsed onto one input')

  target.midiAccess = midi
  await target.refreshDevices()
  assert.strictEqual(output1.openCalls, 0)
  assert.strictEqual(output2.openCalls, 0)
  assert.strictEqual(target.selectedDevice, null)
  assert.match(target.midiError, /More than one identical device/)
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function secondaryServicePortIsNotOffered() {
  const primaryInput = port('in-1', 'Biotron')
  const primaryOutput = port('out-1', 'Biotron')
  const serviceInput = port('in-2', 'MIDIIN2 (Biotron)')
  const serviceOutput = port('out-2', 'MIDIOUT2 (Biotron)')
  const midi = {
    inputs: new Map([[primaryInput.id, primaryInput], [serviceInput.id, serviceInput]]),
    outputs: new Map([[primaryOutput.id, primaryOutput], [serviceOutput.id, serviceOutput]])
  }
  const target = instance()
  const pairs = target.pairDevices(midi)
  assert.strictEqual(pairs.length, 1)
  assert.strictEqual(pairs[0].input, primaryInput)
  assert.strictEqual(pairs[0].output, primaryOutput)

  const macServiceInput = port('mac-in-2', 'Biotron Port 2')
  const macServiceOutput = port('mac-out-2', 'Biotron Port 2')
  const macPairs = target.pairDevices({
    inputs: new Map([
      [primaryInput.id, primaryInput],
      [macServiceInput.id, macServiceInput]
    ]),
    outputs: new Map([
      [primaryOutput.id, primaryOutput],
      [macServiceOutput.id, macServiceOutput]
    ])
  })
  assert.strictEqual(macPairs.length, 1)
  assert.strictEqual(macPairs[0].output, primaryOutput)
}

async function androidIdenticalCablesChooseCableZeroButTwoUnitsStayAmbiguous() {
  const originalUserAgent = context.navigator.userAgent
  context.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/151.0 Mobile'
  try {
    const ports = prefix => [port(`${prefix}-0`, 'Biotron'), port(`${prefix}-1`, 'Biotron')]
    const [input0, input1] = ports('in')
    const [output0, output1] = ports('out')
    const target = instance()
    const oneDevice = target.pairDevices({
      inputs: new Map([[input0.id, input0], [input1.id, input1]]),
      outputs: new Map([[output0.id, output0], [output1.id, output1]])
    })
    assert.strictEqual(oneDevice.length, 1)
    assert.strictEqual(oneDevice[0].input, input0)
    assert.strictEqual(oneDevice[0].output, output0)

    const input2 = port('in-2', 'Biotron')
    const input3 = port('in-3', 'Biotron')
    const output2 = port('out-2', 'Biotron')
    const output3 = port('out-3', 'Biotron')
    const twoDevices = target.pairDevices({
      inputs: new Map([
        [input0.id, input0], [input1.id, input1], [input2.id, input2], [input3.id, input3]
      ]),
      outputs: new Map([
        [output0.id, output0], [output1.id, output1], [output2.id, output2], [output3.id, output3]
      ])
    })
    assert.strictEqual(twoDevices.length, 4)
    assert.strictEqual(target.hasAmbiguousIdentity(twoDevices), true)
  } finally {
    context.navigator.userAgent = originalUserAgent
  }
}

async function duplicateDetectionDoesNotHideCloseFailure() {
  const input1 = port('in-1')
  const input2 = port('in-2')
  const output1 = port('out-1', 'Biotron', {
    async close() { this.closeCalls++; throw new Error('still open') }
  })
  const output2 = port('out-2')
  const selected = {input: input1, output: output1}
  const midi = {
    inputs: new Map([[input1.id, input1], [input2.id, input2]]),
    outputs: new Map([[output1.id, output1], [output2.id, output2]])
  }
  const target = instance({midiAccess: midi, selectedDevice: selected})
  await target.refreshDevices()
  assert.strictEqual(target.selectedDevice, selected, 'failed close was reported as a released selection')
  assert.strictEqual(output2.openCalls, 0)
  assert.match(target.midiError, /did not close/)
  assert.strictEqual(target.events.at(-1)[1], undefined)
}

async function recalibrationRequiresExactNonceAndReportsProgress() {
  scheduled.clear()
  const selected = {input: port('in-1'), output: port('out-1')}
  const target = instance({selectedDevice: selected})
  let settingsCancellation = null
  target.settingsReadbackRequest = {
    timeout: null,
    reject(error) { settingsCancellation = error }
  }
  target.requestRecalibration()
  assert.strictEqual(settingsCancellation?.name, 'AbortError')
  assert.strictEqual(selected.output.sent.length, 1)
  const request = selected.output.sent[0]
  assert.strictEqual(JSON.stringify(request.slice(0, 4)), JSON.stringify([0xf0, 0x14, 0x0d, 125]))
  assert.strictEqual(request.at(-1), 0xf7)
  const nonce = request[4]
  assert.strictEqual(target.events.at(-1)[1].state, 'starting')

  target.handleMidiMessage({data: [0xf0, 0x0b, 125, (nonce + 1) & 0x7f, 1, 0xf7]}, target.operationId)
  assert.strictEqual(target.events.at(-1)[1].state, 'starting', 'wrong nonce was accepted')
  target.handleMidiMessage({data: [0xf0, 0x0b, 125, nonce, 1, 0xf7]}, target.operationId)
  assert.strictEqual(target.events.at(-1)[1].state, 'waiting')
  target.handleMidiMessage({data: [0xf0, 0x0b, 125, nonce, 2, 0xf7]}, target.operationId)
  assert.strictEqual(target.events.at(-1)[1].state, 'measuring')
  target.handleMidiMessage({data: [0xf0, 0x0b, 125, nonce, 3, 0xf7]}, target.operationId)
  assert.strictEqual(target.events.at(-1)[1].state, 'ready')
  assert.strictEqual(target.recalibrationRequest, null)
  assert.strictEqual(scheduled.size, 0)
}

async function oldFirmwareTimesOutWithoutClaimingCalibration() {
  scheduled.clear()
  const selected = {input: port('in-1'), output: port('out-1')}
  const target = instance({selectedDevice: selected})
  target.requestRecalibration()
  assert.strictEqual(scheduled.size, 1)
  const callback = [...scheduled.values()][0]
  callback()
  assert.strictEqual(target.events.at(-1)[1].state, 'unsupported')
  assert.strictEqual(target.recalibrationRequest, null)
  assert.strictEqual(scheduled.size, 0)
}

async function versionReplyUpdatesStatusAndParentContract() {
  scheduled.clear()
  const selected = {input: port('in-1'), output: port('out-1')}
  const target = instance({selectedDevice: selected, currentMidiNum: 0})
  assert.strictEqual(target.requestFirmwareVersion(), true)
  target.handleMidiMessage({data: [0xf0, 0x0b, 126, 0, 1, 9, 3, 0xf7]}, target.operationId)
  assert.strictEqual(target.versions[selected.output.id], 'v1.9.3')
  assert.strictEqual(scheduled.size, 0, 'version response left a timeout armed')
  assert.strictEqual(JSON.stringify(target.events.at(-1)), JSON.stringify([
    'firmware_version',
    {version: '1.9.3', outputId: selected.output.id}
  ]))
}

async function versionTimeoutKeepsLateReplyClosed() {
  scheduled.clear()
  const selected = {input: port('in-1'), output: port('out-1')}
  const target = instance({selectedDevice: selected, currentMidiNum: 0})
  assert.strictEqual(target.requestFirmwareVersion(), true)
  assert.strictEqual(scheduled.size, 1, 'version query had no finite timeout')
  const timeout = [...scheduled.values()][0]
  timeout()
  assert.strictEqual(target.versionRequest, null)
  assert.strictEqual(target.events.at(-1)[0], 'firmware_timeout')
  target.handleMidiMessage({data: [0xf0, 0x0b, 126, 0, 1, 9, 3, 0xf7]}, target.operationId)
  assert.strictEqual(target.versions[selected.output.id], undefined,
    'late answer after timeout unlocked Settings')
  assert.strictEqual(target.requestFirmwareVersion(), true)
  target.handleMidiMessage({data: [0xf0, 0x0b, 126, 0, 1, 9, 3, 0xf7]}, target.operationId)
  assert.strictEqual(target.versions[selected.output.id], 'v1.9.3')
  assert.strictEqual(scheduled.size, 0)
}

;(async () => {
  await releaseFailureStaysVisible()
  await delayedQueryIsCancelled()
  await firmwareQueryCanBeRetriedImmediately()
  await reconnectOpenFailure()
  await permissionDenialIsActionableAndRetryable()
  await missingDeviceIsActionable()
  await switchCloseFailureDoesNotClaimSuccess()
  await unmountCancelsPendingOpen()
  await navigationWaitsForUnmountedOwnerAndAllowsRetry()
  await duplicateDevicesStayDistinct()
  await secondaryServicePortIsNotOffered()
  await androidIdenticalCablesChooseCableZeroButTwoUnitsStayAmbiguous()
  await duplicateDetectionDoesNotHideCloseFailure()
  await recalibrationRequiresExactNonceAndReportsProgress()
  await oldFirmwareTimesOutWithoutClaimingCalibration()
  await versionReplyUpdatesStatusAndParentContract()
  await versionTimeoutKeepsLateReplyClosed()
  console.log('MIDI lifecycle verified: permission/no-device recovery, release failure, delayed cancellation, reconnect failure, switch close failure, unmount, secondary-port filtering, Android cable-zero selection, duplicate-device handling, version propagation, and nonce-bound recalibration progress.')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
