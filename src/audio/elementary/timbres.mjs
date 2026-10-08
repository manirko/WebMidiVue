/*
 * Тембры, перенесённые из https://github.com/chromatone/elements
 * (elements/round.js, fat.js, string.js, noise.js).
 * Автор: Денис Старов (Chromatone), MIT License, Copyright (c) 2024 Chromatone.
 * Текст лицензии — рядом: fx/LICENSE-chromatone.txt. Синт сделан автором в
 * поддержку этого проекта; перенесено 04.09.2026.
 *
 * Изменения при переносе, математика в остальном не тронута:
 *  - вход по частоте в герцах (наш движок держит freq-реф), а не по номеру
 *    ноты: у автора midiFrequency() внутри тембра, у нас частота приходит уже
 *    сглаженным рефом из engine.mjs. Вибрато и октава поэтому умножают
 *    частоту (2^(полутона/12)), а не складываются в пространстве нот;
 *  - темп фиксирован (120 BPM => rate 0.125): у автора огибающие
 *    масштабируются темпом секвенсора, у нас темп задаёт растение;
 *  - громкость голоса приведена к нашему VOICE_LEVEL, чтобы восемь голосов
 *    не пробивали потолок мастера.
 */
import {el} from '@elemaudio/core'
import {srvb} from './fx/srvb.mjs'

// Решение Андрея 2026-09-04: кривая 0.78 даёт ~10 дБ между velocity 24 и 100
// (0.70 → 9.0 дБ, 0.78 → 10.0, 0.85 → 10.8) — лёгкое касание растения слышно
// уверенно, динамика не сплющена.
export const VELOCITY_CURVE = 0.78
export const VOICE_LEVEL = 0.5
// Мастер: сухой уровень, потолок линии задержки и фиксированная комната
// ревербератора — баланс, под который выставлены все звуки.
const FILTER_Q = 0.7
const DRY_LEVEL = 0.86
const DELAY_MAX_SECONDS = 0.8
const REVERB_ROOM = Object.freeze({size: 0.35, decay: 0.5, mod: 0.2})

// 15/120 BPM — авторский масштаб огибающих на спокойном темпе.
const RATE = 0.125
const semitones = cents => Math.pow(2, cents / 12)
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback)

const envelopes = (cv, gate) => ({
  amp: el.adsr(num(cv.attack, 1) * RATE, num(cv.decay, 1) * RATE, num(cv.sustain, 0.5),
    num(cv.release, 1) * RATE, gate),
  filter: el.adsr(num(cv.fattack, 1) * RATE, num(cv.fdecay, 1) * RATE, num(cv.fsustain, 0.5),
    num(cv.frelease, 1) * RATE, gate)
})

// Частота голоса с октавой и (для round/fat) вибрато в полутонах.
const tuned = (freq, cv, withVibrato) => {
  const base = el.mul(freq, semitones(12 * num(cv.octave, 0)))
  const depth = num(cv.vibdep, 0)
  if (!withVibrato || depth <= 0) return base
  const lfo = el.mul(depth, el.cycle(num(cv.vibrate, 2) * 2))
  return el.mul(base, el.pow(2, el.div(lfo, 12)))
}

const cutoffNode = (cv, filterEnv) => el.max(20, el.min(20000,
  el.add(num(cv.cutoff, 200), el.mul(num(cv.cutoff, 200) * num(cv.fenv, 0.5), filterEnv))))

// round: cycle + triangle, смешиваются равной мощностью по `shape`.
function round({gate, freq, vel}, cv) {
  const {amp, filter} = envelopes(cv, gate)
  const f = tuned(freq, cv, true)
  const shape = num(cv.shape, 0.2)
  const osc = el.mul(amp, el.add(
    el.mul(Math.cos(shape * Math.PI / 2), el.cycle(f)),
    el.mul(Math.sin(shape * Math.PI / 2), el.triangle(f))
  ))
  return el.tanh(el.mul(num(cv.gain, 0.8), vel, el.lowpass(cutoffNode(cv, filter), num(cv.cutq, 1.1), osc)))
}

// fat: то же, но полосно-ограниченные квадрат и пила — плотнее и ярче.
function fat({gate, freq, vel}, cv) {
  const {amp, filter} = envelopes(cv, gate)
  const f = tuned(freq, cv, true)
  const shape = num(cv.shape, 0.2)
  const osc = el.mul(amp, el.add(
    el.mul(Math.cos(shape * Math.PI / 2), el.blepsquare(f)),
    el.mul(Math.sin(shape * Math.PI / 2), el.blepsaw(f))
  ))
  return el.tanh(el.mul(num(cv.gain, 0.8), vel, el.lowpass(cutoffNode(cv, filter), num(cv.cutq, 1.1), osc)))
}

// string: щипок Карплуса-Стронга — шум в полосовом фильтре, закольцованный
// задержкой длиной в период ноты.
function string({gate, freq, vel}, cv) {
  const {amp, filter} = envelopes(cv, gate)
  const f = tuned(freq, cv, false)
  const excitation = el.mul(amp, el.noise(), num(cv.noise, 0.95))
  const body = el.lowpass(cutoffNode(cv, filter), num(cv.cutq, 1.1),
    el.bandpass(f, num(cv.bandq, 1), excitation))
  const delayed = el.delay({size: 44100}, el.div(el.sr(), f), num(cv.feedback, 0.95), body)
  return el.mul(num(cv.gain, 0.8), vel, el.tanh(delayed))
}

// noise: белый/розовый шум в полосе вокруг ноты — дыхание, ветер.
function noise({gate, freq, vel}, cv) {
  const {amp, filter} = envelopes(cv, gate)
  const f = tuned(freq, cv, false)
  const color = num(cv.color, 0)
  const source = el.add(
    el.mul(Math.cos(color * Math.PI / 2), el.noise()),
    el.mul(Math.sin(color * Math.PI / 2), el.pinknoise())
  )
  const band = el.bandpass(f, num(cv.bandq, 5), source)
  const cutoff = el.max(20, el.min(20000, el.add(num(cv.cutoff, 200), el.mul(num(cv.fenv, 0.5) * 20000, filter))))
  return el.tanh(el.mul(num(cv.gain, 0.8), vel, amp, el.lowpass(cutoff, num(cv.cutq, 1.1), band)))
}

// Общая обвязка: наша кривая нажатия и общий уровень голоса — одни и те же
// для любого тембра, иначе замеренная динамика становится «динамикой тембра».
const withHouseLevel = timbre => (ctx, cv) =>
  el.mul(timbre({...ctx, vel: el.pow(ctx.vel, VELOCITY_CURVE)}, cv), VOICE_LEVEL)

export const TIMBRES = Object.freeze({
  round: withHouseLevel(round),
  fat: withHouseLevel(fat),
  string: withHouseLevel(string),
  noise: withHouseLevel(noise)
})

// Готовые звуки Biotron. Тембры — авторские, из chromatone/elements (см.
// timbres.mjs и лицензию рядом с fx/), а не наши собственные кривые: они
// написаны под этот движок и на нём проверены. Здесь только выбор значений
// под наш прибор — растение шлёт очень короткие ноты (~27 мс), поэтому у
// каждого звука быстрая атака; авторские значения по умолчанию рассчитаны на
// клавиатуру и на щипке растения звучали бы вполсилы.
//
// Форма звука: {name, timbre, cv, fx}. `cv` — параметры тембра (их имена
// авторские), `fx` — общая цепь мастера (master() ниже).

const FX_DEFAULT = Object.freeze({
  cutoff: 12000, resonance: 0.7, delayTime: 0.22, delayFeedback: 0.1, delayWet: 0.05, reverbWet: 0.12
})
const fx = extra => Object.freeze({...FX_DEFAULT, ...extra})

// Общие для всех тембров огибающие: атака в 7 мс (0.06 * 0.125 c) успевает
// за нотой растения, отпускание длинное, чтобы отдельная нота не обрывалась.
const ENV = Object.freeze({attack: 0.06, decay: 1, sustain: 0.5, release: 2,
  fattack: 0.1, fdecay: 1.2, fsustain: 0.4, frelease: 2})

export const SOUNDS = Object.freeze([
  {name: 'Round', timbre: 'round',
    cv: {...ENV, gain: 0.8, octave: 0, shape: 0.2, vibdep: 0.1, vibrate: 2, cutoff: 900, cutq: 1.1, fenv: 1.5},
    fx: fx()},
  {name: 'Round Bright', timbre: 'round',
    cv: {...ENV, gain: 0.75, octave: 0, shape: 0.6, vibdep: 0.05, vibrate: 3, cutoff: 2200, cutq: 1.4, fenv: 3},
    fx: fx({reverbWet: 0.1})},
  {name: 'Fat', timbre: 'fat',
    cv: {...ENV, gain: 0.6, octave: 0, shape: 0.3, vibdep: 0.08, vibrate: 2, cutoff: 700, cutq: 1.1, fenv: 2},
    fx: fx({delayWet: 0.08})},
  {name: 'Fat Bass', timbre: 'fat',
    cv: {...ENV, gain: 0.6, octave: -1, shape: 0.35, vibdep: 0.03, vibrate: 2, cutoff: 400, cutq: 2, fenv: 1.2},
    fx: fx({reverbWet: 0.06, delayWet: 0.03})},
  {name: 'String', timbre: 'string',
    cv: {...ENV, gain: 0.8, octave: 0, noise: 0.95, feedback: 0.95, bandq: 1, cutoff: 1500, cutq: 1.1, fenv: 1},
    fx: fx({reverbWet: 0.16})},
  {name: 'Soft String', timbre: 'string',
    cv: {...ENV, gain: 0.8, octave: 0, noise: 0.5, feedback: 0.9, bandq: 3, cutoff: 800, cutq: 1.1, fenv: 0.8},
    fx: fx({reverbWet: 0.22, delayWet: 0.08, delayTime: 0.3})},
  {name: 'Air', timbre: 'noise',
    cv: {...ENV, gain: 0.9, octave: 0, color: 0.6, bandq: 8, cutoff: 400, cutq: 1.1, fenv: 0.6},
    fx: fx({reverbWet: 0.25, delayWet: 0.1})}
].map(Object.freeze))

// Optional register treatments use frequency-dependent blends; the default
// voice path is unchanged. No pitch remapping or note-triggered graph rebuild.
function registerTreatment(input) {
  if (!input || !Number.isFinite(input.startNote) || !Number.isFinite(input.endNote) ||
      input.startNote < 0 || input.endNote > 127 || input.endNote <= input.startNote) throw new TypeError('Invalid register transition')
  for (const [key, low, high] of [['gain',0,1], ['cutoff',80,12000], ['resonance',0.3,2]]) {
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < low || input[key] > high)) throw new TypeError(`Invalid register ${key}`)
  }
  if (input.voice?.registers) throw new TypeError('Nested register voices are not supported')
  return Object.freeze({...input, voice: input.voice ? toSound(input.voice) : null})
}
export function toSound(input) {
  if (!input || !TIMBRES[input.timbre]) throw new TypeError(`Unknown timbre: ${input?.timbre}`)
  const output = {name: String(input.name || 'Sound').slice(0, 32), timbre: input.timbre,
    cv: {...input.cv}, fx: {...FX_DEFAULT, ...input.fx}}
  if (input.registers) output.registers = Object.freeze(Object.fromEntries(
    Object.entries(input.registers).map(([key, value]) => {
      if (!['upper','lower'].includes(key)) throw new TypeError('Unknown register')
      return [key, registerTreatment(value)]
    })))
  return Object.freeze(output)
}
const noteHz = note => 440 * 2 ** ((note - 69) / 12)
function blendRegister(base, ctx, treatment, lower) {
  let mix = el.min(1, el.max(0, el.div(el.sub(ctx.freq, noteHz(treatment.startNote)),
    noteHz(treatment.endNote) - noteHz(treatment.startNote))))
  if (lower) mix = el.sub(1, mix)
  let treated = treatment.voice ? TIMBRES[treatment.voice.timbre](ctx, treatment.voice.cv) : base
  if (treatment.cutoff) treated = el.lowpass(treatment.cutoff, treatment.resonance || 0.7, treated)
  treated = el.mul(treatment.gain ?? 1, treated)
  return el.add(el.mul(el.sub(1, mix), base), el.mul(mix, treated))
}
export function voiceBuilder(sound) {
  return ctx => {
    let voice = TIMBRES[sound.timbre](ctx, sound.cv)
    if (sound.registers?.lower) voice = blendRegister(voice, ctx, sound.registers.lower, true)
    if (sound.registers?.upper) voice = blendRegister(voice, ctx, sound.registers.upper, false)
    return voice
  }
}

// master(sum, {volume, fx, sampleRate, quality}) — общая цепь, через которую
// проходит сумма голосов (и зонд, подмешанный до вызова): фильтр звука, его
// задержка и ревербератор от отфильтрованного сигнала, затем мягкий потолок
// tanh. Без компрессора и подъёма громкости: спайк
// (scripts/spike-elementary-gates.js) показал, что именно компрессор сплющивал
// динамику и добавлял искажения. gate/freq/vel/volume приходят уже сглаженными
// рефами (engine.mjs) — сглаживание живёт в создании ссылки, не в чтении.
// `quality: 'safe'` (Low CPU) пропускает ревербератор.
export function master(sum, {volume = 1, fx = {}, sampleRate = 44100, quality = 'standard'} = {}) {
  const filtered = el.lowpass(num(fx.cutoff, 12000), num(fx.resonance, FILTER_Q), sum)
  let out = el.mul(DRY_LEVEL, filtered)

  const delayWet = num(fx.delayWet, 0)
  if (delayWet > 0) {
    const samples = Math.max(1, Math.round(num(fx.delayTime, 0.2) * sampleRate))
    const echo = el.delay(
      {size: Math.ceil(DELAY_MAX_SECONDS * sampleRate)},
      el.const({key: 'master:delay:time', value: samples}),
      num(fx.delayFeedback, 0),
      filtered
    )
    out = el.add(out, el.mul(delayWet, echo))
  }

  const reverbWet = num(fx.reverbWet, 0)
  if (quality === 'standard' && reverbWet > 0) {
    const [left, right] = srvb(
      {key: 'master:srvb', sampleRate, size: REVERB_ROOM.size, decay: REVERB_ROOM.decay, mod: REVERB_ROOM.mod, mix: 1},
      filtered, filtered
    )
    out = el.add(out, el.mul(reverbWet * 0.5, el.add(left, right)))
  }

  return el.tanh(el.mul(out, volume))
}
