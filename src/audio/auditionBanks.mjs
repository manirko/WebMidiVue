import {SOUNDS, toSound} from './elementary/timbres.mjs'

const sound = (index, name, cv = {}, fx = {}) => toSound({...SOUNDS[index], name,
  cv: {...SOUNDS[index].cv, ...cv}, fx: {...SOUNDS[index].fx, ...fx}})
const entry = (id, label, description, preset, extra = {}) => Object.freeze({id, label, description, preset, ...extra})
const round = sound(0, 'Round reference')
// Sergey 2026-10-12: Soft round, Clear glass, Warm hollow and Dry short sounded like the
// reference, so only clearly different voices stay (2026-10-28).
const timbres = [
  entry('tone-reference', 'Round — reference', 'The current rounded sound.', round),
  entry('tone-reed', 'Dense reed', 'A fuller, grainier voice.', sound(2, 'Dense reed', {shape: 0.65, cutoff: 1000, cutq: 0.7})),
  entry('tone-bass', 'Deep bass', 'A darker voice one octave down.', sound(3, 'Deep bass')),
  entry('tone-pluck', 'String pluck', 'A clear, textured pluck.', sound(4, 'String pluck')),
  entry('tone-string', 'Soft string', 'A softer, rounder pluck.', sound(5, 'Soft string')),
  entry('tone-air', 'Air', 'Breathy and light.', sound(6, 'Air'))
]
const pan = (name, cv = {}, fx = {}) => toSound({name, timbre: 'pan',
  cv: {attack: .004, decay: 2.1, release: 1.7, octave: 0, gain: .9, octaveLevel: .46, fifthLevel: .32, detune: .7, strike: .08, ...cv},
  fx: {cutoff: 6500, resonance: .7, delayTime: .22, delayFeedback: .1, delayWet: 0, reverbWet: .12, ...fx}})
// Sergey 2026-10-12: options 1–5 differed only by background noise; the reference and the
// lower Deep ding are the two that sound different.
const handpan = [
  entry('pan-clear', 'Handpan — reference', 'A rounded steel note with a clear, singing ring.', pan('Handpan'), {role: '01-clear'}),
  entry('pan-bold', 'Deep ding', 'A low, full central note with a slow, warm ring.', pan('Deep ding', {octave: -1, gain: .95, octaveLevel: .24, fifthLevel: .15, decay: 3, release: 2.4, strike: .04}, {cutoff: 4500, reverbWet: .16}), {role: '06-bold'})
]
export const AUDITION_BANKS = Object.freeze([
  Object.freeze({id: 'timbres', label: 'Timbres', variants: Object.freeze(timbres)}),
  Object.freeze({id: 'handpan', label: 'Handpan', variants: Object.freeze(handpan)})
])
// Same inputs for every option in a bank. Preview never sends MIDI.
const phrase = (pitches, duration = .27) => pitches.map((note, index) => ({note, at: 0.15 + index * 0.35, duration, velocity: 98}))
export function auditionEvents(bankId) {
  const notes = bankId === 'handpan' ? phrase([50,57,60,62,65,69,67,62], .027) : phrase([48,60,64,67,72,84,60,48])
  return notes.flatMap(({note, at, duration, velocity}) => [
    {at, type: 'on', note, velocity}, {at: +(at + duration).toFixed(3), type: 'off', note}
  ]).sort((a,b) => a.at - b.at || (a.type === 'off' ? -1 : 1))
}
export const auditionDuration = bankId => Math.max(...auditionEvents(bankId).map(event => event.at)) + (bankId === 'handpan' ? 3 : 2)
export function resolveAudition(bankId, variantId) {
  const variant = AUDITION_BANKS.find(bank => bank.id === bankId)?.variants.find(option => option.id === variantId)
  return variant ? {bankId, variant, events: auditionEvents(bankId), duration: auditionDuration(bankId)} : null
}
