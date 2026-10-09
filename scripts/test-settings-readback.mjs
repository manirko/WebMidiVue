import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
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
