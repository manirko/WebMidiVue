// Ported from Biotron d35e937: 47-byte persisted-settings protocol.
export const SETTINGS_QUERY_ID = 123
export const SETTINGS_PROTOCOL_VERSION = 1
export const SETTINGS_SCHEMA_VERSION = 1
export const SETTINGS_SOURCE_PERSISTED = 1
export const SETTINGS_VECTOR_LENGTH = 27
export const CALMER_PLAY_SETTINGS = [
  ["randomness", 0],
  ["performance", 1],
  ["same_note_plant", 2]
]
const FIELD_NAMES = [
  'lightBpm', 'noteOffPercent', 'noteDistance', 'firstValue', 'smoothness',
  'scale', 'minPlantVelocity', 'maxPlantVelocity', 'minLightVelocity',
  'maxLightVelocity', 'randomness', 'same_note_plant', 'same_note_light',
  'range_light_note', 'light_pitch_mode', 'plant_no_velocity',
  'light_no_velocity', 'randomPlantVelocity', 'randomLightVelocity',
  'performance', 'middle_plant_note', 'plant_midi_channel',
  'light_midi_channel', 'swing_first_note_percent', 'button_mode_state'
]
const u7 = value => Math.max(0, Math.min(127, Math.round(Number(value) || 0)))
export function buildSettingsQuery(requestId, source = SETTINGS_SOURCE_PERSISTED) {
  return [0xf0, 0x14, 0x0d, SETTINGS_QUERY_ID, u7(source), u7(requestId), 0xf7]
}
function decodeU35(bytes) {
  return bytes.reduce((value, byte, index) => value + (byte * (2 ** (7 * index))), 0)
}
export function parseSettingsResponse(input, expectedRequestId) {
  const data = Array.from(input || [])
  if (data.length !== 47 || data[0] !== 0xf0 || data[1] !== 0x14 ||
      data[2] !== 0x0d || data[3] !== SETTINGS_QUERY_ID || data[46] !== 0xf7) return null
  if (data.slice(1, -1).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0x7f)) return null
  if (data[4] !== SETTINGS_PROTOCOL_VERSION || data[5] !== SETTINGS_SCHEMA_VERSION ||
      data[6] !== SETTINGS_SOURCE_PERSISTED || data[7] !== u7(expectedRequestId)) return null
  const flags = data[8]
  if (flags & ~3) return null
  return {
    valid: Boolean(flags & 1),
    dirty: Boolean(flags & 2),
    dirtyGeneration: decodeU35(data.slice(9, 14)),
    persistedGeneration: decodeU35(data.slice(14, 19)),
    values: data.slice(19, 46)
  }
}
export function settingsVectorFromCommands(commands) {
  const bpm = Math.max(0, Math.min(16383, Math.round(Number(commands.plantBpm.value) || 0)))
  const values = [bpm & 0x7f, (bpm >> 7) & 0x7f]
  for (const name of FIELD_NAMES) values.push(u7(commands[name].value))
  return values
}
export function applySettingsVector(commands, values) {
  if (!Array.isArray(values) || values.length !== SETTINGS_VECTOR_LENGTH) {
    throw new Error('Unsupported Biotron settings response.')
  }
  commands.plantBpm.set_value(values[0] | (values[1] << 7))
  FIELD_NAMES.forEach((name, index) => commands[name].set_value(values[index + 2]))
}
export function settingsVectorsEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === SETTINGS_VECTOR_LENGTH && right.length === SETTINGS_VECTOR_LENGTH &&
    left.every((value, index) => value === right[index])
}
export function savedSettingsMessage(lastChangedSetting) {
  if (lastChangedSetting === "noteOffPercent") {
    return "Saved on Biotron. Note Hold changes note length, not the LEDs."
  }
  if (lastChangedSetting === "reduceExtraNotes") {
    return "Calmer play is saved."
  }
  return "Saved on Biotron."
}
