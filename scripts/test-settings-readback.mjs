import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {detectedFault} from './qa-contract-controls.mjs'
import {
  CALMER_PLAY_SETTINGS,
  applyCalmerPlay,
  applySettingsVector,
  buildSettingsQuery,
  parseSettingsResponse,
  savedSettingsMessage,
  settingsVectorFromCommands,
  settingsVectorsEqual
} from '../src/biotron/settingsReadback.mjs'

const values = [
  78, 3, 4, 4, 50, 10, 0, 4, 8, 98, 74, 75, 0, 1, 0, 12,
  0, 0, 1, 1, 0, 1, 60, 2, 3, 100, 0
]
// Frame copied from a real device reply, not invented: f0 14 0d 7b 01 01 01 64 ... f7
// (Fibonacci/A08, firmware 1.9.8, biotron_mac_bench.py settings-readback, 2026-09-02).
const response = [
  0xf0, 0x14, 0x0d, 123, 1, 1, 1, 42, 1,
  7, 0, 0, 0, 0, 7, 0, 0, 0, 0,
  ...values, 0xf7
]
assert.equal(response.length, 47)
assert.deepEqual(response.slice(0, 4), [0xf0, 0x14, 0x0d, 123])

assert.deepEqual(buildSettingsQuery(42), [0xf0, 0x14, 0x0d, 123, 1, 42, 0xf7])
const parsed = parseSettingsResponse(response, 42)
assert(parsed?.valid)
assert.equal(parsed.dirty, false)
assert.equal(parsed.dirtyGeneration, 7)
assert.equal(parsed.persistedGeneration, 7)
assert.deepEqual(parsed.values, values)
assert.equal(parseSettingsResponse(response, 41), null)
assert.equal(parseSettingsResponse(response.slice(0, -1), 42), null)
const malformed = [...response]
malformed[20] = 128
assert.equal(parseSettingsResponse(malformed, 42), null)
for (const flags of [4, 5, 7, 8, 127]) {
  const unknownFlags = [...response]
  unknownFlags[8] = flags
  assert.equal(parseSettingsResponse(unknownFlags, 42), null, `unknown settings flags ${flags} must be rejected`)
}

const commands = {}
for (const name of [
  'plantBpm', 'lightBpm', 'noteOffPercent', 'noteDistance', 'firstValue',
  'smoothness', 'scale', 'minPlantVelocity', 'maxPlantVelocity',
  'minLightVelocity', 'maxLightVelocity', 'randomness', 'same_note_plant',
  'same_note_light', 'range_light_note', 'light_pitch_mode',
  'plant_no_velocity', 'light_no_velocity', 'randomPlantVelocity',
  'randomLightVelocity', 'performance', 'middle_plant_note',
  'plant_midi_channel', 'light_midi_channel', 'swing_first_note_percent',
  'button_mode_state'
]) commands[name] = {value: 0, set_value(value) { this.value = value }}

applySettingsVector(commands, values)
assert.equal(commands.plantBpm.value, 462)
assert.equal(commands.plant_midi_channel.value, 2)
assert.equal(commands.light_midi_channel.value, 3)
assert(settingsVectorsEqual(settingsVectorFromCommands(commands), values))

const fullRange = {...commands, maxPlantVelocity: {value: 127}}
assert.equal(settingsVectorFromCommands(fullRange)[9], 127)
assert(!settingsVectorsEqual(values, [...values.slice(0, -1), 1]))

assert.equal(savedSettingsMessage('noteOffPercent'),
  'Saved on Biotron. Note Hold changes note length, not the LEDs.')
assert(savedSettingsMessage('reduceExtraNotes').startsWith('Calmer play is saved.'))
const calmerMessages = []
const calmerDevice = {
  state: 'connected', connection: 'open',
  send(message) { calmerMessages.push(message) }
}
const calmerCommands = Object.fromEntries(CALMER_PLAY_SETTINGS.map(([name]) => [name, {
  value: 127,
  set_value(value) { this.value = value },
  sendToMidi(output) { output.send([this.value]) }
}]))
assert.equal(await applyCalmerPlay(calmerDevice, () => calmerDevice, calmerCommands), true)
assert.deepEqual(CALMER_PLAY_SETTINGS.map(([name]) => calmerCommands[name].value), [0, 1, 2])
assert.deepEqual(calmerMessages, [[0], [1], [2]])

for (const bpm of [0, 127, 128, 16383]) {
  const bpmVector = settingsVectorFromCommands({...commands, plantBpm: {value: bpm}})
  assert.equal(bpmVector[0], bpm & 0x7f, `bpm ${bpm} low byte`)
  assert.equal(bpmVector[1], (bpm >> 7) & 0x7f, `bpm ${bpm} high byte`)
}

const commandSource = readFileSync(new URL('../src/assets/js/SysExCommand.js', import.meta.url), 'utf8')
assert(!commandSource.includes('val % 127'), 'MIDI value 127 must never wrap to zero')
assert(commandSource.includes('Math.min(127'), 'outgoing MIDI data must be clamped to the 7-bit maximum')

console.log('settings readback contract: PASS')

// Every wire position and nonce is exercised independently of the serializer.
for (let index = 0; index < 27; index++) for (const value of [0, 1, 126, 127]) {
  const vector = [...values]; vector[index] = value
  const frame = [...response]; frame.splice(19, 27, ...vector)
  const before = [...frame]
  const answer = parseSettingsResponse(frame, 42)
  assert.deepEqual(answer.values, vector)
  applySettingsVector(commands, answer.values)
  assert.deepEqual(settingsVectorFromCommands(commands), vector)
  assert.deepEqual(frame, before, 'readback parser mutated its input')
}
for (let nonce = 0; nonce < 128; nonce++) {
  const frame = [...response]; frame[7] = nonce
  assert.deepEqual(parseSettingsResponse(frame, nonce).values, values)
  assert.equal(parseSettingsResponse(frame, (nonce + 1) % 128), null)
}
for (let index = 1; index < 46; index++) for (const invalid of [-1, 128, .5, NaN, Infinity]) {
  const frame = [...response]; frame[index] = invalid
  assert.equal(parseSettingsResponse(frame, 42), null, `invalid wire byte ${index}/${invalid}`)
}
console.log('PASS: 108 vector round-trips, 128 nonce pairs, 225 malformed wire bytes; input preservation')

test('fault control detects Saved with a mismatched persisted vector', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  t.diagnostic(JSON.stringify(await detectedFault(new URL('../src/biotron/settingsConnection.mjs', import.meta.url),
    'if (snapshot.dirty || !settingsVectorsEqual(snapshot.values, expected)) {', 'if (false) {',
    async ({createSettingsConnectionMethods: create}) => {
      const methods = create({settingsVectorFromCommands: () => [...values], settingsVectorsEqual, savedSettingsMessage})
      for (const variant of ['same', 'mismatch', 'dirty']) {
        const persisted = [...values]; if (variant === 'mismatch') persisted[26] ^= 1
        const device = {}, page = {device, liveVerifyId: 0, settingsState: 'changed',
          clearLiveVerification() { this.liveVerifyId++ },
          async readPersistedSettingsWithRetry() { return {values: persisted, dirty: variant === 'dirty'} }}
        methods.scheduleLiveVerification.call(page, device); t.mock.timers.tick(1500); await Promise.resolve()
        assert.equal(page.settingsState, variant === 'same' ? 'saved' : 'error', 'Unconfirmed vector reported Saved')
        assert.deepEqual(persisted, variant === 'mismatch' ? [...values.slice(0, -1), values[26] ^ 1] : values)
      }
    }, 'Unconfirmed vector reported Saved')))
})
