// Physical positions keep the instrument playable in every keyboard layout.
export const KEYBOARD_CODE_TO_NOTE = Object.freeze({
  KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65, KeyT: 66,
  KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71, KeyK: 72
})

export const noteForKeyboardCode = code => KEYBOARD_CODE_TO_NOTE[String(code)] ?? null
export function blocksKeyboardNotes(event) {
  const targets = event.composedPath?.() || [event.target]
  return event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
    targets.some(target => target?.isContentEditable || target?.closest?.('input,select,textarea,[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[inert],dialog,[role="dialog"],.modal.show'))
}

export function clamp(value, min, max, fallback = min) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export const normalizeMidiByte = value => Math.round(clamp(value, 0, 127, 0))
export const midiNoteToFrequency = note => 440 * 2 ** ((normalizeMidiByte(note) - 69) / 12)
export const midiPitchBendRatio = (value, rangeSemitones = 2) =>
  2 ** (((Math.round(clamp(value, 0, 16383, 8192)) - 8192) / 8192 * clamp(rangeSemitones, 0, 24, 2)) / 12)
export const makeNoteKey = (sourceId, channel, note) =>
  `${String(sourceId || 'unknown')}:${normalizeMidiByte(channel) & 0x0f}:${normalizeMidiByte(note)}`

export function parseMidiMessage(data) {
  if (!data || data.length < 1) return {type: 'ignored'}
  if (data.length >= 2 && Number(data[0]) === 0xf0 && Number(data[data.length - 1]) === 0xf7) {
    return {type: 'system-exclusive', data: Array.from(data, value => Number(value) & 0xff)}
  }
  const rawStatus = Number(data[0])
  if (!Number.isFinite(rawStatus)) return {type: 'ignored'}
  const status = Math.round(rawStatus) & 0xff
  const kind = status & 0xf0
  const channel = status & 0x0f
  if ((kind === 0x80 || kind === 0x90 || kind === 0xb0 || kind === 0xe0) && data.length < 3) {
    return {type: 'ignored', channel}
  }
  const note = normalizeMidiByte(data[1])
  const value = normalizeMidiByte(data[2])
  if (kind === 0x90 && value > 0) return {type: 'note-on', channel, note, velocity: value}
  if (kind === 0x80 || (kind === 0x90 && value === 0)) return {type: 'note-off', channel, note}
  if (kind === 0xb0 && (note === 120 || note === 123)) return {type: 'panic', channel}
  if (kind === 0xb0) return {type: 'controller', channel, controller: note, value}
  if (kind === 0xe0) return {type: 'pitch-bend', channel, value: note | (value << 7)}
  return {type: 'ignored', channel}
}

export class VoiceLedger {
  constructor(limit = 8) {
    this.limit = Math.round(clamp(limit, 1, 32, 8))
    this.entries = new Map()
    this.nextToken = 1
  }

  get size() { return this.entries.size }

  claim(key, startedAt) {
    const time = clamp(startedAt, 0, Number.MAX_SAFE_INTEGER, 0)
    let victimKey = this.entries.has(key) ? key : null
    if (!victimKey && this.entries.size >= this.limit) {
      const ordered = [...this.entries.entries()].sort((left, right) => {
        const a = left[1]
        const b = right[1]
        if (a.state !== b.state) return a.state === 'releasing' ? -1 : 1
        return (a.releasedAt ?? a.startedAt) - (b.releasedAt ?? b.startedAt) || a.token - b.token
      })
      victimKey = ordered[0]?.[0] ?? null
    }
    if (victimKey) this.entries.delete(victimKey)
    const token = this.nextToken++
    this.entries.set(key, {key, token, state: 'active', startedAt: time, releasedAt: null})
    return {key, token, victimKey}
  }

  markReleased(key, releasedAt) {
    const entry = this.entries.get(key)
    if (!entry) return false
    entry.state = 'releasing'
    entry.releasedAt = clamp(releasedAt, 0, Number.MAX_SAFE_INTEGER, entry.startedAt)
    return true
  }

  clear() { this.entries.clear() }
}

export const DEFAULT_VOLUME = 70
// Громкость интерфейса 0…100; в ослабление её переводит движок.
export function normalizeVolume(input) {
  if (input === null || input === undefined || input === '') return DEFAULT_VOLUME
  return Math.round(clamp(Number(input), 0, 100, DEFAULT_VOLUME))
}
