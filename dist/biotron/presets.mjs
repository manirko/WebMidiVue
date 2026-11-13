import {validatePreset} from './protocol.mjs';
import {builtinPresets, audibleHumanize} from './factory-presets.mjs';
const KEY = 'biotron-web-presets-v1';
export class Presets {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  list() {
    const saved = JSON.parse(this.storage.getItem(KEY) || '[]');
    if (!Array.isArray(saved)) throw Error('Saved presets could not be opened. Existing presets are kept.');
    // Validate before returning anything; damaged storage is never rewritten.
    const user = saved.map(p => {
      if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw Error('Invalid saved preset.');
      return {name: p.name, data: validatePreset(p.data)};
    });
    return [...builtinPresets.map(p => ({...p, data: audibleHumanize(p.data), factory: true})), ...user];
  }
  save(name, values) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw Error('Preset name is required (up to 80 characters).');
    const data = validatePreset(values), previous = this.list().filter(p => !p.factory);
    const saved = {name: name.trim(), data};
    this.storage.setItem(KEY, JSON.stringify([...previous, saved]));
    return saved;
  }
}
