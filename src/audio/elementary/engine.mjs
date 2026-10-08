// The sound engine on Elementary Audio. Owns the WebRenderer and the pool of
// live refs (4 voices in 'safe' quality, 8 in 'standard'); the DSP lives in
// timbres.mjs (voices and master chain), voice stealing delegates to VoiceLedger.
//
// Rendering strategy (revised 2026-09-04 after studying chromatone/elements,
// Denis Starov's production Elementary synth, MIT): the graph is rendered
// ONCE at startup via core.createRef() for every live parameter (gate/freq/
// vel per voice, master volume), each wrapped in el.smooth(...) at creation
// so a parameter without smoothing cannot exist. noteOn/noteOff/setVolume
// never call render() again — they call each ref's setter(), a cheap direct
// message to the worklet. Only applyPreset() re-renders (attack/release are
// baked into the ADSR node's structure, so a preset change needs a real
// rebuild); that render() is immediately followed by re-pushing every ref's
// tracked value through its setter, because re-rendering an already-mounted
// ref resets it to its creation-time value, not whatever a later setter()
// call moved it to (measured 2026-09-04, see _resyncRefs()).
import {el} from '@elemaudio/core'
import {clamp, makeNoteKey, midiNoteToFrequency, midiPitchBendRatio, normalizeMidiByte, normalizeVolume, VoiceLedger} from '../core.mjs'
// Громкость только ослабляет: 0…1 до потолка, как в chromatone/elements. Множитель
// ×5, компенсировавший компрессор прежнего движка, сплющивал аккорд из 16 голосов
// до 3.2 дБ динамики (замер 2026-09-04); без него держится 8.6 дБ.
const attenuation = value => (normalizeVolume(value) / 100) ** 2
import {master, SOUNDS, toSound, voiceBuilder} from './timbres.mjs'

export {DEFAULT_VOLUME, normalizeVolume} from '../core.mjs'

// Denis Starov's chromatone/elements uses el.tau2pole(0.001) for every ref.
const REF_SMOOTH_TAU = 0.001
const cancelledAudioStart = () => Object.assign(new Error('Audio start cancelled.'), {name: 'AbortError'})

// WebRenderer 4.0.3 has no dispose API: its polling timer and module Blob URL
// survive disconnect/AudioContext.close. Keep the version pinned and this
// compatibility code here; the browser regressions measure both resources.
function initializeRenderer(core, context, options, moduleUrls) {
  const worklet = context.audioWorklet, addModule = worklet?.addModule
  if (!addModule) return core.initialize(context, options)
  // initialize calls addModule synchronously before its first await. Intercept
  // only that call on this context, restore immediately, revoke after loading.
  worklet.addModule = async function(url, options) {
    const blob = typeof url === 'string' && url.startsWith('blob:')
    if (blob) moduleUrls.add(url)
    try { return await addModule.call(this, url, options) }
    finally { if (blob) { moduleUrls.delete(url); URL.revokeObjectURL(url) } }
  }
  try { return core.initialize(context, options) }
  finally { worklet.addModule = addModule }
}

function releaseRenderer(core) {
  if (!core) return
  globalThis.clearInterval(core._timer)
  core._timer = null
  for (const pending of core._promiseMap?.values() || []) pending.reject(cancelledAudioStart())
  core._promiseMap?.clear()
  // Keep the load reply available if Stop interrupts initialization; its late
  // completion below performs disposal again, without creating an audio graph.
  if (core._renderer) {
    core._worklet.port.onmessage = null
    core._worklet.port.close()
    core.removeAllListeners?.()
  }
}

// Voice slots on top of the victim rules VoiceLedger already has (releasing
// before active, oldest first, tie by token); only the slot<->key bookkeeping
// Elementary needs is added. Its declarative graph has no "voice ended"
// callback, so a slot is reclaimed only when a NEW note needs it and the
// ledger picks a victim — a fixed-size voice-stealing synth with no
// idle-voice detection.
class VoicePool {
  constructor(size) {
    this.ledger = new VoiceLedger(size)
    this.slotForKey = new Map()
    this.nextFreshSlot = 0
  }

  get activeVoiceCount() {
    let count = 0
    for (const entry of this.ledger.entries.values()) if (entry.state === 'active') count += 1
    return count
  }

  // claim(key, startedAt) -> slot; `key` comes from makeNoteKey().
  claim(key, startedAt) {
    const claim = this.ledger.claim(key, startedAt)
    let slot
    if (claim.victimKey != null) {
      slot = this.slotForKey.get(claim.victimKey)
      this.slotForKey.delete(claim.victimKey)
    } else {
      slot = this.nextFreshSlot
      this.nextFreshSlot += 1
    }
    this.slotForKey.set(key, slot)
    return slot
  }

  release(key, releasedAt) { return this.ledger.markReleased(key, releasedAt) }
  slotFor(key) { return this.slotForKey.get(key) }

  clear() {
    this.ledger.clear()
    this.slotForKey.clear()
    this.nextFreshSlot = 0
  }
}

export class ElementarySynthEngine {
  constructor(context, options = {}) {
    if (!context) throw new TypeError('AudioContext is required')
    this.context = context
    this.ownsContext = Boolean(options.ownsContext)
    this.quality = options.quality === 'safe' ? 'safe' : 'standard'
    // "Low CPU" = fewer concurrent voices (safe=4, standard=8). The cap shrinks
    // the ref pool itself: Elementary renders every created ref on every block
    // whether its gate is open or not — an unused ref is not free.
    this.poolSize = this.quality === 'safe' ? 4 : 8
    this.pool = new VoicePool(this.poolSize)
    // Звук = тембр + его настройки + мастер-цепь (timbres.mjs).
    this.sound = toSound(options.preset || SOUNDS[0])
    this.volume = normalizeVolume(options.volume)
    this.core = null
    this.ready = false
    this.stopped = false
    this._closeTask = null
    this._moduleUrls = new Set()
    // Сообщать о состоянии контекста обязан движок: интерфейс слушает только его.
    // Без этого страница не узнаёт, что звук пошёл, и остаётся в 'closed'.
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {}
    this.boundStateChange = () => this.onStateChange(this.context.state)
    this.context.addEventListener?.('statechange', this.boundStateChange)
    this._pending = new Set()
    this._pendingFailure = null
    this._idleWaiters = 0
    this.pitchBends = new Map(); this.voicePitch = new Array(this.poolSize).fill(null)
    // Current live value of every ref. Elementary refs are write-only from
    // here (no getter), so this is what applyPreset()'s resync replays.
    this.values = {
      gate: new Array(this.poolSize).fill(0),
      freq: new Array(this.poolSize).fill(440),
      vel: new Array(this.poolSize).fill(0),
      volume: attenuation(this.volume)
    }
  }

  // Прогресс наружу: рантайм Elementary — отдельный кусок сборки (~190 КБ gzip,
  // 92% из них — вшитые worklet и wasm). На медленной сети это заметная пауза,
  // и человек должен видеть, что идёт работа, а не гадать.
  async ensureReady(onProgress = () => {}) {
    if (this.stopped) throw cancelledAudioStart()
    if (this.ready) return
    if (!this.core) {
      onProgress('loading')
      const {default: WebRenderer} = await import(
        /* webpackChunkName: "elementary-runtime" */ '@elemaudio/web-renderer')
      if (this.stopped) throw cancelledAudioStart()
      this.core = new WebRenderer()
    }
    onProgress('starting')
    const node = await initializeRenderer(this.core, this.context, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    }, this._moduleUrls).catch(error => { if (this.stopped) releaseRenderer(this.core); throw error })
    if (this.stopped) {
      node?.disconnect?.()
      releaseRenderer(this.core)
      throw cancelledAudioStart()
    }
    this.node = node
    this.input = this.context.createGain()
    this.input.connect(node)
    this.output = this.context.createGain()
    node.connect(this.output)
    this.output.connect(this.context.destination)
    this._createRefs()
    await this._render()
    if (this.stopped) throw cancelledAudioStart()
    this.ready = true
    onProgress('ready')
  }

  _createRefs() {
    const smooth = raw => el.smooth(el.tau2pole(REF_SMOOTH_TAU), raw)
    this.gateRefs = []; this.gateSetters = []
    this.freqRefs = []; this.freqSetters = []
    this.velRefs = []; this.velSetters = []
    for (let slot = 0; slot < this.poolSize; slot += 1) {
      const [gateNode, setGate] = this.core.createRef('const', {value: this.values.gate[slot]}, [])
      const [freqNode, setFreq] = this.core.createRef('const', {value: this.values.freq[slot]}, [])
      const [velNode, setVel] = this.core.createRef('const', {value: this.values.vel[slot]}, [])
      this.gateRefs.push(smooth(gateNode)); this.gateSetters.push(setGate)
      this.freqRefs.push(smooth(freqNode)); this.freqSetters.push(setFreq)
      this.velRefs.push(smooth(velNode)); this.velSetters.push(setVel)
    }
    const [volumeNode, setVolume] = this.core.createRef('const', {value: this.values.volume}, [])
    this.volumeRef = smooth(volumeNode)
    this.volumeSetter = setVolume
  }

  _buildGraph() {
    const buildVoice = voiceBuilder(this.sound)
    let sum = 0
    for (let slot = 0; slot < this.poolSize; slot += 1) {
      sum = el.add(sum, buildVoice({
        gate: this.gateRefs[slot], freq: this.freqRefs[slot], vel: this.velRefs[slot]
      }))
    }
    const probe = el.in({channel: 0})
    return master(el.add(sum, probe), {
      volume: this.volumeRef, fx: this.sound.fx, sampleRate: this.context.sampleRate, quality: this.quality
    })
  }

  async _render() { await this.core.render(this._buildGraph()) }

  // Every setter() call is tracked, not fired-and-ignored: a WebRenderer ref
  // update is a real message round trip to the worklet, and (measured
  // 2026-09-04) several such messages fired synchronously in the same JS
  // turn are not guaranteed to all land before the very next audio block —
  // only the last one queued reliably does. Realtime callers never need to
  // await this; whenIdle() exists so an offline test using
  // context.suspend()/resume() for sample-accurate scheduling can wait for
  // every queued update to actually land before resuming.
  _track(promise) {
    const task = Promise.resolve(promise)
    const tracked = task.then(
      () => { this._pending.delete(tracked) },
      error => {
        this._pending.delete(tracked)
        if (!this._pendingFailure) this._pendingFailure = {error}
      }
    )
    this._pending.add(tracked)
    return task
  }

  async whenIdle() {
    this._idleWaiters += 1
    try {
      while (this._pending.size) await Promise.all(this._pending)
      if (this._pendingFailure) throw this._pendingFailure.error
    } finally {
      this._idleWaiters -= 1
      if (this._idleWaiters === 0) this._pendingFailure = null
    }
  }

  async _resyncRefs() {
    for (let slot = 0; slot < this.poolSize; slot += 1) {
      this._track(this.freqSetters[slot]({value: this.values.freq[slot]}))
      this._track(this.velSetters[slot]({value: this.values.vel[slot]}))
      this._track(this.gateSetters[slot]({value: this.values.gate[slot]}))
    }
    this._track(this.volumeSetter({value: this.values.volume}))
    await this.whenIdle()
  }

  get activeVoiceCount() { return this.pool.activeVoiceCount }
  get state() { return this.context.state }

  async resume() {
    if (this.context.state !== 'running' && typeof this.context.resume === 'function') await this.context.resume()
    return this.context.state
  }

  async applyPreset(input) {
    this.sound = toSound(input)
    if (!this.ready) return
    await this._render()
    await this._resyncRefs()
  }

  setVolume(input) {
    this.volume = normalizeVolume(input)
    this.values.volume = attenuation(this.volume)
    if (this.ready) this._track(this.volumeSetter({value: this.values.volume}))
    return this.volume
  }

  noteOn(sourceId, channel, note, velocity = 100, when = this.context.currentTime, levelScale = 1) {
    const key = makeNoteKey(sourceId, channel, note)
    const time = Number.isFinite(when) ? when : this.context.currentTime
    const slot = this.pool.claim(key, time)
    const normalizedVelocity = clamp(velocity, 1, 127, 100) / 127 * clamp(levelScale, 0, 1, 1)
    const baseFrequency = midiNoteToFrequency(note), bendKey = makeNoteKey(sourceId, channel, 0)
    const freq = baseFrequency * (this.pitchBends.get(bendKey) || 1)
    this.voicePitch[slot] = {sourceId: String(sourceId || 'unknown'),
      channel: normalizeMidiByte(channel) & 0x0f, baseFrequency}
    this.values.freq[slot] = freq
    this.values.vel[slot] = normalizedVelocity
    this.values.gate[slot] = 1
    if (this.ready) {
      this._track(this.freqSetters[slot]({value: freq}))
      this._track(this.velSetters[slot]({value: normalizedVelocity}))
      this._track(this.gateSetters[slot]({value: 1}))
    }
    return key
  }

  pitchBend(sourceId, channel, value) {
    const normalizedSource = String(sourceId || 'unknown'), normalizedChannel = normalizeMidiByte(channel) & 0x0f
    const bendKey = makeNoteKey(normalizedSource, normalizedChannel, 0)
    const ratio = midiPitchBendRatio(value)
    this.pitchBends.set(bendKey, ratio)
    for (let slot = 0; slot < this.poolSize; slot += 1) {
      const voice = this.voicePitch[slot]
      if (!voice || voice.sourceId !== normalizedSource || voice.channel !== normalizedChannel) continue
      const freq = voice.baseFrequency * ratio
      this.values.freq[slot] = freq
      if (this.ready) this._track(this.freqSetters[slot]({value: freq}))
    }
  }

  noteOff(sourceId, channel, note, when = this.context.currentTime) {
    const key = makeNoteKey(sourceId, channel, note)
    const time = Number.isFinite(when) ? when : this.context.currentTime
    const slot = this.pool.slotFor(key)
    if (slot == null) return false
    this.pool.release(key, time)
    this.values.gate[slot] = 0
    if (this.ready) this._track(this.gateSetters[slot]({value: 0}))
    return true
  }

  // CC123. Every voice's gate drops to 0 through the same ADSR release stage
  // a normal note-off uses — click-free by construction.
  panic() {
    for (let slot = 0; slot < this.poolSize; slot += 1) {
      this.values.gate[slot] = 0
      if (this.ready) this._track(this.gateSetters[slot]({value: 0}))
    }
    this.pool.clear()
    this.pitchBends.clear(); this.voicePitch.fill(null)
  }

  async stop() {
    this.stopped = true
    this.context.removeEventListener?.('statechange', this.boundStateChange)
    this.panic()
    this.input?.disconnect?.()
    this.output?.disconnect?.()
    this.node?.disconnect?.()
    for (const url of this._moduleUrls) URL.revokeObjectURL(url)
    this._moduleUrls.clear()
    releaseRenderer(this.core)
    this.ready = false
    if (!this.ownsContext || (!this._closeTask && this.context.state === 'closed')) return
    const task = this._closeTask || Promise.resolve().then(() => this.context.close())
    this._closeTask = task
    try { await task }
    catch (error) {
      if (this._closeTask === task) this._closeTask = null
      throw error
    }
  }
}

export function createRealtimeElementarySynth(options = {}) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.')
  let context
  try { context = new AudioContextClass({latencyHint: 'interactive'}) } catch { context = new AudioContextClass() }
  return new ElementarySynthEngine(context, {...options, ownsContext: true})
}
