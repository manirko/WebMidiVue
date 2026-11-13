// Exact command IDs and wire ranges from BiotronIDB.js at d35e937.
export const COMMANDS = Object.freeze(Object.fromEntries(Object.entries({
  plantBpm: [0, 1000, 1], lightBpm: [9, 30], noteOffPercent: [12, 100],
  noteDistance: [1, 100], firstValue: [2, 100], smoothness: [3, 99], scale: [4],
  minPlantVelocity: [15], maxPlantVelocity: [5], minLightVelocity: [17], maxLightVelocity: [6],
  randomness: [10], same_note_plant: [11, 10], same_note_light: [24, 10], range_light_note: [13, 36],
  light_pitch_mode: [19], plant_no_velocity: [22], light_no_velocity: [23],
  randomPlantVelocity: [16], randomLightVelocity: [18], performance: [21],
  middle_plant_note: [25, 72, 60], plant_midi_channel: [[127, 0], 16, 1],
  light_midi_channel: [[127, 1], 16, 1], swing_first_note_percent: [26, 100, 1], button_mode_state: [27]
}).map(([name, [command, max = 127, min = 0]]) => [name, Object.freeze({command, min, max})])));
export function settingValue(name, input) {
  const spec = COMMANDS[name];
  if (!spec || input === '' || input === null || input === undefined ||
      !['number','string','boolean'].includes(typeof input) || !Number.isFinite(Number(input))) throw Error('Invalid Biotron setting.');
  const value = Number(input);
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) throw Error(`${name}: enter ${spec.min}…${spec.max}.`);
  return value;
}
export function commandFrame(name, input) {
  const value = settingValue(name, input), command = COMMANDS[name].command;
  const bytes = name === 'plantBpm' ? [...Array(Math.floor(value / 127)).fill(127), value % 127]
    : Array.isArray(command) ? [value - 1] : [value];
  return [0xf0, 0x14, 0x0d, ...[command].flat(), ...bytes, 0xf7];
}
export function createCommands(values) {
  return Object.fromEntries(Object.keys(COMMANDS).map(name => [name, {
    value: values?.[name] ?? COMMANDS[name].min,
    set_value(value) { this.value = value; },
    sendToMidi(output) { output.send(commandFrame(name, this.value)); }
  }]));
}
export function validatePreset(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) throw Error('Invalid Biotron preset.');
  return Object.fromEntries(Object.entries(data).map(([name, value]) => [name, settingValue(name, value)]));
}
export function parsePreset(text) {
  const input = JSON.parse(text);
  if (!input || !Array.isArray(input.commands) || !input.commands.length) throw Error('Invalid Biotron preset.');
  const data = {};
  for (const entry of input.commands) {
    if (!entry || Object.hasOwn(data, entry.name)) throw Error('Invalid Biotron preset.');
    data[entry.name] = settingValue(entry.name, entry.value);
  }
  return validatePreset(data);
}
