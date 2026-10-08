import {SOUNDS, toSound} from './elementary/timbres.mjs'

const sound = (index, name, cv = {}, fx = {}) => toSound({...SOUNDS[index], name,
  cv: {...SOUNDS[index].cv, ...cv}, fx: {...SOUNDS[index].fx, ...fx}})
const entry = (id, label, description, preset, extra = {}) => Object.freeze({id, label, description, preset, ...extra})
const round = sound(0, 'Round reference')
const soft = sound(0, 'Soft round', {cutoff: 450, cutq: 0.7, shape: 0.1})
const glass = sound(1, 'Clear glass', {shape: 0.05, cutq: 0.7, vibdep: 0})
const dry = sound(0, 'Dry short', {release: 1, vibdep: 0}, {delayWet: 0, reverbWet: 0})
const timbres = [
  entry('tone-reference', 'Round — reference', 'The current rounded sound.', round),
  entry('tone-soft', 'Soft round', 'Darker and gentler.', soft),
  entry('tone-glass', 'Clear glass', 'Pure, bright and focused.', glass),
  entry('tone-hollow', 'Warm hollow', 'A soft hollow edge.', sound(0, 'Warm hollow', {shape: 0.85, cutoff: 700, cutq: 0.7})),
  entry('tone-reed', 'Dense reed', 'A fuller, grainier voice.', sound(2, 'Dense reed', {shape: 0.65, cutoff: 1000, cutq: 0.7})),
  entry('tone-bass', 'Deep bass', 'A darker voice one octave down.', sound(3, 'Deep bass')),
  entry('tone-pluck', 'String pluck', 'A clear, textured pluck.', sound(4, 'String pluck')),
  entry('tone-string', 'Soft string', 'A softer, rounder pluck.', sound(5, 'Soft string')),
  entry('tone-air', 'Air', 'Breathy and light.', sound(6, 'Air')),
  entry('tone-dry', 'Dry short', 'Shorter notes with little room.', dry)
]
const cue = (id, label, description, preset, level) => entry(id, label, description, preset, {level})
const calibration = [
  cue('cue-reference', 'Previous quiet cue — reference', 'The previous quiet calibration sound.', round, 0.025),
  cue('cue-current', 'Current clearer cue', 'The louder level in this candidate.', round, 0.14),
  cue('cue-gentle', 'Gentler level', 'Less prominent than the current cue.', round, 0.08),
  cue('cue-present', 'More present', 'A stronger cue against background sound.', round, 0.22),
  cue('cue-soft', 'Soft rounded cue', 'A darker cue at the current level.', soft, 0.14),
  cue('cue-glass', 'Clear glass cue', 'A pure, brighter cue.', glass, 0.14),
  cue('cue-pluck', 'Plucked cue', 'A textured pluck.', sound(4, 'Plucked cue'), 0.14),
  cue('cue-warm', 'Warm low cue', 'A lower, warmer signal.', sound(3, 'Warm low cue'), 0.14),
  cue('cue-air', 'Airy cue', 'A soft breath-like signal.', sound(6, 'Airy cue'), 0.2),
  cue('cue-dry', 'Dry cue', 'A shorter signal without echoes.', dry, 0.14)
]
const upper = (id, label, description, treatment) => entry(id, label, description,
  toSound({...round, name: label, registers: {upper: {startNote: 72, endNote: 84, ...treatment}}}))
const highNotes = [
  entry('high-reference', 'Current upper notes — reference', 'The current sound without upper-note treatment.', round),
  upper('high-soft', 'Gentler highs', 'Gradually quieter above C5.', {gain: 0.75}),
  upper('high-quiet', 'Quieter highs', 'A stronger gradual reduction.', {gain: 0.5}),
  upper('high-filter', 'Soft upper filter', 'A softer edge in the upper range.', {cutoff: 3000, resonance: 0.7}),
  upper('high-dark', 'Darker upper filter', 'A warmer, more restrained upper range.', {cutoff: 1600, resonance: 0.7}),
  upper('high-resonance', 'Less upper resonance', 'Less emphasis around the filter peak.', {voice: sound(0, 'Less resonance', {cutq: 0.5})}),
  upper('high-clear', 'Pure upper voice', 'Gradually changes to a clean glass-like voice.', {voice: glass}),
  upper('high-pluck', 'Plucked upper voice', 'Gradually changes to a textured pluck.', {voice: sound(4, 'Upper pluck', {cutq: 0.7})}),
  upper('high-balanced', 'Soft and darker highs', 'A gentle level reduction and softer edge.', {gain: 0.75, cutoff: 2200, resonance: 0.7}),
  entry('high-three', 'Three-register blend', 'Deep bass, rounded middle and clean upper voice.', toSound({...round, name: 'Three-register blend', registers: {
    lower: {startNote: 48, endNote: 60, voice: sound(3, 'Lower voice')},
    upper: {startNote: 72, endNote: 84, voice: glass}
  }}))
]
const pan = (name, cv = {}, fx = {}) => toSound({name, timbre: 'pan',
  cv: {attack: .004, decay: 2.1, release: 1.7, octave: 0, gain: .9, octaveLevel: .46, fifthLevel: .32, detune: .7, strike: .08, ...cv},
  fx: {cutoff: 6500, resonance: .7, delayTime: .22, delayFeedback: .1, delayWet: 0, reverbWet: .12, ...fx}})
const handpan = [
  entry('pan-clear', 'Handpan — reference', 'A rounded steel note with a clear, singing ring.', pan('Handpan'), {role: '01-clear'}),
  entry('pan-soft', 'Soft fingers', 'A gentler, darker touch with a warm centre.', pan('Soft fingers', {gain: .75, octaveLevel: .26, fifthLevel: .14, strike: .025}, {cutoff: 4200}), {role: '02-soft'}),
  entry('pan-breath', 'Finger texture', 'A more tactile tap followed by a delicate metal ring.', pan('Finger texture', {strike: .18, octaveLevel: .38, fifthLevel: .24, release: 1.3}, {reverbWet: .08}), {role: '03-breath'}),
  entry('pan-expressive', 'Singing steel', 'A longer ring with gently moving overtones.', pan('Singing steel', {detune: 3, octaveLevel: .6, fifthLevel: .44, decay: 2.8, release: 2.3}), {role: '04-expressive'}),
  entry('pan-space', 'Small room', 'A clear handpan ring with a little space around it.', pan('Small room', {release: 1.5}, {reverbWet: .25, delayWet: .08, delayTime: .17}), {role: '05-space'}),
  entry('pan-bold', 'Deep ding', 'A low, full central note with a slow, warm ring.', pan('Deep ding', {octave: -1, gain: .95, octaveLevel: .24, fifthLevel: .15, decay: 3, release: 2.4, strike: .04}, {cutoff: 4500, reverbWet: .16}), {role: '06-bold'})
]
export const AUDITION_BANKS = Object.freeze([
  Object.freeze({id: 'timbres', label: 'Timbres', variants: Object.freeze(timbres)}),
  Object.freeze({id: 'calibration', label: 'Calibration sounds', variants: Object.freeze(calibration)}),
  Object.freeze({id: 'high-notes', label: 'High-note treatments', variants: Object.freeze(highNotes)}),
  Object.freeze({id: 'handpan', label: 'Handpan', variants: Object.freeze(handpan)})
])
// Same inputs for every option in a bank. Firmware1.10.10 src/global.c uses
// 100ms ticks, eight cue notes and velocity24. Preview never sends MIDI.
const phrase = (pitches, duration = .27) => pitches.map((note, index) => ({note, at: 0.15 + index * 0.35, duration, velocity: 98}))
const cueEvents = [[3,64,3],[8,65,3],[13,67,4],[18,72,4],[24,71,3],[29,67,3],[34,62,4],[40,60,9]]
export function auditionEvents(bankId) {
  const notes = bankId === 'calibration'
    ? cueEvents.map(([tick, note, duration]) => ({note, at: tick / 10, duration: duration / 10, velocity: 24}))
    : bankId === 'handpan' ? phrase([50,57,60,62,65,69,67,62], .027)
    : phrase(bankId === 'high-notes' ? [48,60,71,72,78,84,90,96] : [48,60,64,67,72,84,60,48])
  return notes.flatMap(({note, at, duration, velocity}) => [
    {at, type: 'on', note, velocity}, {at: +(at + duration).toFixed(3), type: 'off', note}
  ]).sort((a,b) => a.at - b.at || (a.type === 'off' ? -1 : 1))
}
export const auditionDuration = bankId => Math.max(...auditionEvents(bankId).map(event => event.at)) + (bankId === 'handpan' ? 3 : 2)
export function resolveAudition(bankId, variantId) {
  const variant = AUDITION_BANKS.find(bank => bank.id === bankId)?.variants.find(option => option.id === variantId)
  return variant ? {bankId, variant, events: auditionEvents(bankId), duration: auditionDuration(bankId)} : null
}
