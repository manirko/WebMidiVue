import {parseMidiMessage} from './core.mjs'
import {requestSharedMidiAccess} from './midiAccess.mjs'
import {parseBiotronSensorState} from './biotronCalibration.mjs'

const cancelledConnection = () => Object.assign(new Error('MIDI connection was cancelled.'), {name: 'AbortError'})

function releaseDeadline(task, milliseconds) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('MIDI release is still pending. Press Stop again after the device responds.')), milliseconds)
  })
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
}

export function describeMidiAccessError(error) {
  if (error?.name === 'NotAllowedError') {
    return 'MIDI permission was not allowed. Allow device access, then try again.'
  }
  if (error?.name === 'SecurityError') {
    return 'MIDI is blocked on this page. Check site permissions and browser policy. The page address must start with https:// or use localhost.'
  }
  return error?.message || 'MIDI could not start. Reconnect the device, then try again.'
}

// Beta-only evidence trail: last 400 MIDI/stage events, copied by a tester with `copy(__biotronTrace)`
// in the console or read by the CDP harness. Bytes and stages only, no names or IDs.
export function trace(kind, data) {
  const log = globalThis.__biotronTrace || (globalThis.__biotronTrace = [])
  if (log.push({t: Math.round(performance.now()), kind, data}) > 400) log.shift()
}

export class MidiInputSession {
  constructor(engine, onState = () => {}, options = {}) {
    this.engine = engine
    this.onState = onState
    this.access = null
    this.input = null
    this.enabled = true
    this.closed = false
    this.sysex = Boolean(options.sysex)
    this.voiceLevel = typeof options.voiceLevel === 'function' ? options.voiceLevel : () => 1
    // Late permission/open completions must never reacquire a released port.
    this.operationId = 0
    this.pendingConnect = null
    this.pendingRelease = null
    this.failedOutputClose = null
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 2000
    this.lastMessageAt = null
    this.signalWatch = null
    this.signalNonce = 0
    this.pendingSignalRead = null
    this.boundMessage = event => this.onMessage(event)
    this.boundState = event => this.onStateChange(event)
  }

  assertActive(operationId) {
    if (this.closed || operationId !== this.operationId) {
      throw cancelledConnection()
    }
  }

  async requestAccess(operationId = this.operationId, signal) {
    this.assertActive(operationId)
    if (!this.access) {
      let access
      try {
        access = await requestSharedMidiAccess({sysex: this.sysex, signal})
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        this.assertActive(operationId)
        throw new Error(describeMidiAccessError(error))
      }
      this.assertActive(operationId)
      this.access = access
      access.addEventListener('statechange', this.boundState)
    }
    return this.listInputs()
  }

  listInputs() {
    return this.access ? [...this.access.inputs.values()]
      .filter(input => input.state !== 'disconnected')
      .map(input => ({
        id: input.id,
        name: input.name || 'MIDI input',
        manufacturer: input.manufacturer || ''
      })) : []
  }

  async connect(inputId) {
    if (this.pendingConnect) throw new Error('MIDI connection is already starting.')
    const operationId = ++this.operationId
    const task = this.connectAt(inputId, operationId)
    this.pendingConnect = task
    try { return await task }
    finally {
      if (this.pendingConnect === task) this.pendingConnect = null
    }
  }

  async connectAt(inputId, operationId) {
    await this.requestAccess(operationId)
    this.assertActive(operationId)
    const input = this.access.inputs.get(inputId)
    if (!input) throw new Error('That MIDI input is no longer available.')
    await this.releaseCurrent()
    this.assertActive(operationId)
    let openError = null
    try { await input.open() } catch (error) { openError = error }
    const cancelled = this.closed || operationId !== this.operationId
    if (openError || cancelled) {
      try { await input.close() }
      catch (cleanupError) {
        this.input = input
        this.onState({type: 'release-error', input: input.name || 'MIDI input', error: cleanupError})
        if (openError) throw new AggregateError([openError, cleanupError], 'MIDI input open and cleanup failed.')
        throw cleanupError
      }
      if (cancelled) throw cancelledConnection()
      throw openError
    }
    input.addEventListener('midimessage', this.boundMessage)
    this.input = input
    this.onState({type: 'connected', input: input.name || 'MIDI input'})
  }

  async sendToPairedOutput(data, isCurrent = () => true) {
    if (!this.access || !this.input) throw new Error('Connect the MIDI input first.')
    const operationId = this.operationId
    const access = this.access
    const input = this.input
    this.assertActive(operationId)
    // Same name and manufacturer as the input; when a platform names every cable alike (Android), pair by index.
    const alike = port => port.state !== 'disconnected' &&
      ['name', 'manufacturer'].every(key => (port[key] || '') === (input[key] || ''))
    const inputs = [...access.inputs.values()].filter(alike)
    const outputs = [...access.outputs.values()].filter(alike)
    const output = inputs.length === outputs.length ? outputs[inputs.indexOf(input)] : null
    if (!output) throw new Error('Biotron control port could not be matched safely.')
    let primaryError = null
    try {
      await output.open()
      this.assertActive(operationId)
      if (!isCurrent()) throw cancelledConnection()
      if (this.access !== access || this.input !== input || output.state === 'disconnected') {
        throw new Error('MIDI connection was cancelled.')
      }
      output.send(data)
      trace('out', [...data])
    } catch (error) {
      primaryError = error
    }
    try {
      await output.close()
    } catch (cleanupError) {
      this.failedOutputClose = output
      this.onState({type: 'release-error', input: output.name || 'MIDI output', error: cleanupError})
      if (primaryError) {
        throw new AggregateError([primaryError, cleanupError], 'MIDI output failed and cleanup failed.')
      }
      throw cleanupError
    }
    if (primaryError) throw primaryError
  }

  startPlantSignalWatch() {
    if (this.signalWatch || this.pendingSignalRead || this.pendingRelease || this.closed || !this.enabled || !this.sysex || !this.input) return
    const watch = this.signalWatch = {timer: null, nonce: null}
    const input = this.input
    const isCurrent = () => this.signalWatch === watch && this.input === input && this.enabled && !this.closed
    const poll = async () => {
      if (!isCurrent()) return
      if (watch.nonce !== null || this.pendingSignalRead) {
        this.stopPlantSignalWatch(); return
      }
      watch.nonce = this.signalNonce = this.signalNonce % 127 + 1
      watch.timer = setTimeout(poll, 2000)
      // One read at a time. A late open after Stop may only close, never send.
      const task = this.pendingSignalRead = this.sendToPairedOutput([0xf0, 0x14, 0x0d, 125, watch.nonce, 5, 0xf7], isCurrent)
      try { await task }
      catch { if (isCurrent()) this.stopPlantSignalWatch() }
      finally { if (this.pendingSignalRead === task) this.pendingSignalRead = null }
    }
    void poll()
  }

  stopPlantSignalWatch() {
    if (!this.signalWatch) return
    clearTimeout(this.signalWatch?.timer)
    this.signalWatch = null
    this.onState({type: 'plant-signal', state: null})
  }

  release() {
    const pending = this.invalidatePendingConnect()
    return this.finishRelease(pending)
  }

  invalidatePendingConnect() {
    this.operationId += 1
    return this.pendingConnect
  }

  async finishRelease(pending) {
    const connection = pending?.catch(error => {
      if (error?.name !== 'AbortError') throw error
    })
    await releaseDeadline(Promise.all([this.releaseCurrent(), connection]), this.cleanupTimeoutMs)
  }

  async releaseCurrent() {
    this.stopPlantSignalWatch()
    if (this.pendingRelease) return this.pendingRelease
    if (!this.input && !this.failedOutputClose) return
    const input = this.input
    const task = (async () => {
      input?.removeEventListener('midimessage', this.boundMessage)
      this.engine.panic()
      try {
        await input?.close()
        await this.pendingSignalRead?.catch(error => { if (error?.name !== 'AbortError') throw error })
        if (this.failedOutputClose) { await this.failedOutputClose.close(); this.failedOutputClose = null }
      }
      catch (error) {
        this.onState({type: 'release-error', input: input?.name || 'MIDI port', error})
        throw error
      }
      if (this.input === input) this.input = null
      this.onState({type: 'released', input: input?.name || 'MIDI port'})
    })()
    this.pendingRelease = task
    try { await task }
    finally { if (this.pendingRelease === task) this.pendingRelease = null }
  }

  close() {
    this.closed = true
    this.setEnabled(false)
    const pending = this.invalidatePendingConnect()
    this.access?.removeEventListener('statechange', this.boundState)
    this.access = null
    return this.finishRelease(pending)
  }

  setEnabled(enabled) {
    const next = Boolean(enabled)
    if (this.enabled === next) return
    this.enabled = next
    if (!next) { this.stopPlantSignalWatch(); this.engine.panic() }
  }

  onMessage(event) {
    this.lastMessageAt = performance.now()
    if (this.closed || !this.enabled) return
    const message = parseMidiMessage(event.data)
    const sensor = this.signalWatch?.nonce == null ? null : parseBiotronSensorState(message, this.signalWatch.nonce)
    if (sensor !== null) {
      this.signalWatch.nonce = null
      this.onState({type: 'plant-signal', state: sensor})
    }
    const level = message.type === 'note-on' ? this.voiceLevel(message) : undefined
    trace('in', level === undefined ? [...event.data].slice(0, 12) : {bytes: [...event.data], level})
    const source = this.input?.id || 'midi'
    if (message.type === 'note-on') this.engine.noteOn(source, message.channel, message.note, message.velocity,
      this.engine.context?.currentTime, level)
    else if (message.type === 'note-off') this.engine.noteOff(source, message.channel, message.note)
    else if (message.type === 'pitch-bend') this.engine.pitchBend(source, message.channel, message.value)
    else if (message.type === 'panic') this.engine.panic()
    this.onState({type: 'voices', count: this.engine.activeVoiceCount, message})
  }

  onStateChange(event) {
    if (this.closed) return
    if (this.input && event.port?.id === this.input.id && event.port.state === 'disconnected') {
      this.stopPlantSignalWatch()
      this.input.removeEventListener('midimessage', this.boundMessage)
      this.engine.panic()
      this.input = null
      this.onState({type: 'disconnected', input: event.port.name || 'MIDI input'})
    }
    this.onState({type: 'ports', inputs: this.listInputs()})
  }
}
