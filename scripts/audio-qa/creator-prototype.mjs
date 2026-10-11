// Reversible creator proof around the production engine; not a second synth.
import {createRealtimeElementarySynth} from '../../src/audio/elementary/engine.mjs'
import {AUDITION_BANKS, auditionEvents} from '../../src/audio/auditionBanks.mjs'
import {parseMidiMessage, noteForKeyboardCode, blocksKeyboardNotes} from '../../src/audio/core.mjs'
import {wav} from './analyze.mjs'

const $ = id => document.getElementById(id)
const sounds = AUDITION_BANKS.filter(bank => ['timbres', 'handpan'].includes(bank.id)).flatMap(bank => bank.variants)
for (const sound of sounds) $('sound').add(new Option(sound.label, sound.id))
const settings = new URLSearchParams(location.hash.slice(1))
if (sounds.some(sound => sound.id === settings.get('sound'))) $('sound').value = settings.get('sound')
if (['-12', '0', '12'].includes(settings.get('register'))) $('register').value = settings.get('register')
if (settings.has('volume') && /^\d{1,3}$/.test(settings.get('volume')) && +settings.get('volume') <= 100) $('volume').value = settings.get('volume')

let engine, busy = false, capture, midi, inputs = [], timers = [], pressed = new Map(), lastPerformance = [], takes = [], takeNumber = 0, workletContext, startAbort, finishRequested = false, disconnectRequested = false
let generation = 0, pageActive = true, runFinished = Promise.resolve(), hiddenCleanup = Promise.resolve(), lostCurrentTake = false
const opening = new Set()
const status = text => { $('status').textContent = text }
const currentSound = () => sounds.find(sound => sound.id === $('sound').value)
const guard = (promise, label, ms = 10000, signal) => new Promise((resolve, reject) => {
  const finish = (error, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value) }
  const abort = () => finish(new DOMException('Start cancelled. Previous takes are kept.', 'AbortError'))
  const timer = setTimeout(() => finish(Error(label + ' timed out')), ms)
  Promise.resolve(promise).then(value => finish(null, value), finish)
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true})
})
function update() {
  for (const id of ['sound', 'register', 'record-audio', 'connect']) $(id).disabled = busy || Boolean(capture)
  $('connect').disabled ||= opening.size > 0
  $('connect').textContent = opening.size ? 'Waiting for previous connection' : 'Connect Biotron'
  $('repeat').disabled = busy || !lastPerformance.length
  $('stop').disabled = !startAbort && (!capture || busy)
  $('stop').textContent = startAbort ? 'Cancel start' : 'Stop recording'
  $('example').disabled = busy
  $('release').hidden = !midi
  $('connect').hidden = Boolean(midi)
  if (!navigator.requestMIDIAccess) { $('connect').disabled = true; $('connection').textContent = 'This browser cannot receive Biotron notes. The example and recording still work. Use a MIDI-capable browser to play the plant.' }
}
async function run(action) {
  if (busy || !pageActive) return
  const started = generation
  let done; runFinished = new Promise(resolve => { done = resolve })
  busy = true; update()
  try { await action() }
  catch (error) { if (started === generation && pageActive) status(error.message || String(error)) }
  finally {
    done()
    if (started !== generation || !pageActive) return
    busy = false; update()
    if (disconnectRequested) { disconnectRequested = false; finishRequested = false; void run(async () => { await finishAndRelease(); status('Biotron disconnected. Completed takes are kept.') }) }
    else if (finishRequested) { finishRequested = false; if (capture) void run(finish) }
  }
}
function requestFinish() { if (busy) finishRequested = true; else void run(finish) }
async function ready(signal) {
  if (!engine || engine.stopped) engine = createRealtimeElementarySynth({preset: currentSound().preset, volume: +$('volume').value})
  const owned = engine
  try { await guard(owned.resume(), 'Sound resume', 10000, signal); await guard(owned.ensureReady(), 'Sound start', 10000, signal) }
  catch (error) { try { await guard(owned.stop(), 'Sound cleanup') } catch (cleanup) { error.cleanupFailure = String(cleanup) }; throw error }
}
function stopNotes() {
  if (engine?.activeVoiceCount) send({type: 'panic'})
  for (const timer of timers) clearTimeout(timer)
  timers = []; pressed.clear(); engine?.panic(); $('example').textContent = 'Play example'
}
function send(event) {
  if (!engine?.ready) return
  const {type, note, velocity, channel = 0, source = 'creator'} = event
  const pitch = note == null ? null : Math.max(0, Math.min(127, note + +$('register').value))
  if (type === 'on') engine.noteOn(source, channel, pitch, velocity)
  else if (type === 'off') engine.noteOff(source, channel, pitch)
  else if (type === 'bend') engine.pitchBend(source, channel, event.value)
  else if (type === 'panic') engine.panic()
  if (capture) {
    if (capture.events.length < 2000) capture.events.push({...event, at: engine.context.currentTime - capture.started})
    else capture.eventsOverflow = true
  }
}
function play(events) {
  stopNotes(); $('example').textContent = 'Stop example'
  for (const event of events) timers.push(setTimeout(() => send(event), event.at * 1000))
  timers.push(setTimeout(stopNotes, Math.max(...events.map(event => event.at)) * 1000 + 2000))
}
$('example').onclick = () => run(async () => {
  if (timers.length) return stopNotes()
  await ready(); play(auditionEvents('timbres'))
})
$('repeat').onclick = () => run(async () => { await ready(); play(lastPerformance) })
$('sound').onchange = () => run(async () => { stopNotes(); if (engine?.ready) await guard(engine.applyPreset(currentSound().preset), 'Sound change'); status('Sound selected. Try the same example.') })
$('register').onchange = stopNotes
$('volume').oninput = () => engine?.setVolume(+$('volume').value)

window.addEventListener('keydown', event => {
  const note = noteForKeyboardCode(event.code)
  if (busy || !engine?.ready || note == null || blocksKeyboardNotes(event, true)) return
  event.preventDefault()
  pressed.set(event.code, note); send({type: 'on', note, velocity: 98, source: 'keyboard'})
})
window.addEventListener('keyup', event => {
  if (!pressed.has(event.code)) return
  send({type: 'off', note: pressed.get(event.code), source: 'keyboard'}); pressed.delete(event.code)
})
window.addEventListener('blur', stopNotes)

async function releaseMidi() {
  const owned = inputs; inputs = []; let failure
  if (midi) midi.onstatechange = null
  for (const input of owned) {
    input.onmidimessage = null
    try { await guard(input.close(), 'MIDI release') }
    catch (error) { failure ||= error; inputs.push(input) }
  }
  if (!failure) midi = null
  stopNotes(); update()
  if (failure) throw failure
}
async function finishAndRelease() {
  let primary
  try { if (capture) await finish() }
  catch (error) { primary = error; throw error }
  finally { try { await releaseMidi() } catch (error) { if (primary) primary.cleanupFailure = String(error); else throw error } }
}
$('connect').onclick = () => run(async () => {
  const controller = new AbortController(); startAbort = controller; const signal = controller.signal; update()
  status('Connecting Biotron. Cancel start stops this page waiting; the browser may still show its permission prompt.')
  try {
    await ready(signal)
    signal.throwIfAborted()
    const access = await guard(navigator.requestMIDIAccess({sysex: false}), 'MIDI permission', 30000, signal)
    signal.throwIfAborted()
    const available = [...access.inputs.values()].filter(input => /biotron/i.test(input.name || ''))
    if (!available.length) throw Error('Biotron not found. Connect USB, then try again.')
    midi = access; inputs = available
    for (const input of available) {
      const pending = input.open(); opening.add(input)
      // Native open cannot be aborted. Keep reconnect disabled until its late close.
      void Promise.resolve(pending).then(async () => {
        if (!signal.aborted) return
        let closing
        try {
          closing = input.close(); await guard(closing, 'Cancelled MIDI release')
          inputs = inputs.filter(item => item !== input); if (!inputs.length && midi === access) midi = null
        } catch (error) {
          if (!inputs.includes(input)) inputs.push(input)
          midi ||= access; $('connection').textContent = error.message + '. Try Release Biotron.'; update()
        }
        // A guard timeout does not cancel native close; reconnect must still wait.
        if (closing) await Promise.resolve(closing).catch(() => {})
      }, () => {}).finally(() => { opening.delete(input); update() })
      await guard(pending, 'MIDI input', 10000, signal)
      signal.throwIfAborted()
      input.onmidimessage = event => {
        const message = parseMidiMessage(event.data)
        const type = {'note-on': 'on', 'note-off': 'off', 'pitch-bend': 'bend', panic: 'panic'}[message.type]
        if (type) send({...message, type, source: input.id})
      }
    }
    access.onstatechange = event => {
      if (!inputs.includes(event.port) || event.port.state !== 'disconnected') return
      for (const input of inputs) input.onmidimessage = null
      startAbort?.abort(); stopNotes(); disconnectRequested = true
      if (!busy) void run(async () => {})
    }
    $('connection').textContent = 'Biotron connected. No device settings are changed.'
  } catch (error) { controller.abort(); try { await releaseMidi() } catch (cleanup) { error.cleanupFailure = String(cleanup) }; throw error }
  finally { startAbort = null }
})
$('release').onclick = () => run(async () => { await finishAndRelease(); $('connection').textContent = 'Biotron released.' })

$('copy').onclick = async () => {
  const link = new URL(location.href); link.hash = new URLSearchParams({sound: $('sound').value, register: $('register').value, volume: $('volume').value})
  $('link-fallback').value = link.href
  $('link-fallback').hidden = false; $('link-status').textContent = 'Copying. You can also copy this link manually.'; $('copy').disabled = true
  try { await navigator.clipboard.writeText(link.href); $('link-fallback').hidden = true; $('link-status').textContent = 'Sound link copied. It restores sound and register, not plant notes.' }
  catch { $('link-fallback').hidden = false; $('link-status').textContent = 'Copy this sound link manually.' }
  finally { $('copy').disabled = false }
}

// Stop is acknowledged by the worklet after its last PCM message. No wall-clock
// guess about queued audio blocks; the old take stays available on failure.
const worklet = `class Take extends AudioWorkletProcessor {
 constructor(){super();this.active=true;this.n=0;this.port.onmessage=e=>{if(e.data==='stop')this.end()}}
 end(){if(!this.active)return;this.active=false;this.port.postMessage({done:true})}
 process(inputs){const a=inputs[0]?.[0];if(this.active&&a){this.port.postMessage({frame:currentFrame,pcm:a.slice()});this.n+=a.length;if(this.n>=sampleRate*30)this.end()}return true}
}registerProcessor('creator-take',Take)`
async function startAudio(signal) {
  if (takes.length >= 3) throw Error('Three takes kept. Save and remove a take before recording another.')
  await ready(signal)
  signal.throwIfAborted()
  if (workletContext !== engine.context) {
    const url = URL.createObjectURL(new Blob([worklet], {type: 'text/javascript'}))
    try { await guard(engine.context.audioWorklet.addModule(url), 'Recorder start', 10000, signal); signal.throwIfAborted(); workletContext = engine.context }
    finally { URL.revokeObjectURL(url) }
  }
  const tap = new AudioWorkletNode(engine.context, 'creator-take'), drain = engine.context.createGain()
  drain.gain.value = 0; tap.connect(drain); drain.connect(engine.context.destination)
  const session = {kind: 'audio', engine, tap, drain, blocks: [], events: [], started: engine.context.currentTime, sound: currentSound().id, sampleRate: engine.context.sampleRate}
  capture = session
  tap.port.onmessage = event => {
    if (capture !== session) return
    if (event.data.done) { session.done = true; session.resolve?.(); requestFinish() }
    else session.blocks.push(event.data)
  }
  engine.output.connect(tap)
  status('Recording sound. Play the example, keyboard or connected Biotron. Maximum 30 seconds.')
}
async function cleanCapture(session) {
  // Detach before engine.stop disconnects output; still close the port on error.
  session.cleaning ||= (async () => {
    let failure
    for (const release of [() => session.engine.output.disconnect(session.tap), () => session.tap.disconnect(), () => session.drain.disconnect(), () => { session.tap.port.onmessage = null; session.tap.port.close() }]) {
      try { release() } catch (error) { failure ||= error }
    }
    if (failure) throw failure
  })()
  await session.cleaning
}
async function finish() {
  const session = capture, started = generation
  if (!session) return
  let file, seconds, primary
  try {
    // A recorded performance needs a final stop even if a key/contact remains held.
    if (engine.activeVoiceCount) send({type: 'panic'})
    // Auto-limit may already have acknowledged completion.
    await guard(new Promise(resolve => { session.resolve = resolve; if (session.done) resolve(); else session.tap.port.postMessage('stop') }), 'Sound finalization', 5000)
    if (started !== generation || !pageActive || capture !== session) return
    let expected = session.blocks[0]?.frame, samples = 0
    for (const block of session.blocks) { if (block.frame !== expected) throw Error('Sound capture has a gap. Existing takes are kept.'); expected += block.pcm.length; samples += block.pcm.length }
    if (!samples) throw Error('No audio blocks received. Try again; existing takes are kept.')
    const pcm = new Float32Array(samples); let at = 0
    for (const block of session.blocks) { pcm.set(block.pcm, at); at += block.pcm.length }
    if (pcm.some(value => !Number.isFinite(value))) throw Error('Invalid audio samples. Existing takes are kept.')
    session.silent = pcm.every(value => Math.abs(value) < .0005)
    file = new File([wav([pcm], session.sampleRate)], 'biotron-take-' + (takeNumber + 1) + '.wav', {type: 'audio/wav'})
    seconds = samples / session.sampleRate
    addTake(file, session, seconds)
    lastPerformance = session.eventsOverflow ? [] : session.events
    const message = session.silent ? 'Take kept, but no music was detected. Check volume and input before another take.' : 'Take kept. Listen before saving. Nothing has been uploaded.'
    status(message + (session.eventsOverflow ? ' Repeat unavailable: too many note changes. The recorded file is kept.' : ''))
  } catch (error) { primary = error; throw error }
  finally { if (capture === session) capture = null; try { await cleanCapture(session) } catch (error) { if (primary) primary.cleanupFailure = String(error); else throw error } }
}
function addTake(file, session, seconds) {
  const url = URL.createObjectURL(file), take = {file, url, events: session.events, kind: session.kind, seconds}
  takes.push(take); takeNumber++
  const section = document.createElement('article'); section.className = 'take'
  const title = document.createElement('h3'); title.textContent = 'Take ' + takeNumber + ' · ' + seconds.toFixed(1) + ' seconds'
  const media = document.createElement('audio'); media.controls = true; media.src = url
  media.onplay = stopNotes
  const row = document.createElement('div'); row.className = 'row'
  const save = document.createElement('a'); save.className = 'save'; save.href = url; save.download = file.name; save.textContent = 'Save sound'
  const share = document.createElement('button'); share.textContent = 'Share file'
  let shareable = false
  try { shareable = Boolean(navigator.share && navigator.canShare?.({files: [file]})) } catch { /* Save remains available. */ }
  share.hidden = !shareable
  const message = document.createElement('p'); message.setAttribute('role', 'status')
  share.onclick = async () => {
    share.disabled = true
    try { await navigator.share({files: [file]}); message.textContent = 'Share sheet closed. Check the file in the receiving app.' }
    catch (error) { message.textContent = error.name === 'AbortError' ? 'Sharing cancelled. Your take is still here.' : 'Sharing failed. Save the file instead.' }
    finally { share.disabled = false }
  }
  const remove = document.createElement('button'); remove.textContent = 'Remove take'
  remove.onclick = () => { media.pause(); media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); takes = takes.filter(item => item !== take); section.remove() }
  row.append(save, share, remove); section.append(title, media, row, message); $('takes').append(section)
}
function start() { return run(async () => { startAbort = new AbortController(); update(); try { await startAudio(startAbort.signal) } finally { startAbort = null } }) }
$('record-audio').onclick = start
$('stop').onclick = () => startAbort ? startAbort.abort() : run(finish)
document.addEventListener('visibilitychange', () => { if (document.hidden) { startAbort?.abort(); stopNotes(); if (capture) requestFinish() } })
window.addEventListener('pagehide', () => {
  pageActive = false; generation++; busy = true; startAbort?.abort(); stopNotes()
  const session = capture, owned = engine; lostCurrentTake ||= Boolean(session)
  capture = null; engine = null; workletContext = null; finishRequested = false; disconnectRequested = false
  hiddenCleanup = Promise.allSettled([hiddenCleanup, runFinished, session && cleanCapture(session), releaseMidi(), owned?.stop()])
})
window.addEventListener('pageshow', event => {
  if (!event.persisted) return
  pageActive = true; const returned = generation; update()
  void hiddenCleanup.then(results => {
    if (!pageActive || returned !== generation) return
    busy = false; update()
    const failure = results.find(result => result.status === 'rejected')
    status((lostCurrentTake ? 'Returned. The current recording was not kept. Previous takes remain available.' : 'Returned. Kept takes remain available.') + (failure ? ' Cleanup failed: ' + failure.reason : ' Restart sound when ready.'))
    lostCurrentTake = false
  })
})
update()

// Existing autonomous tester reads actual bytes and sends UI actions. This
// surface never substitutes fake audio or auto-requests a user's devices.
window.__CreatorPrototype = {get takes() { return takes }, get engine() { return engine }, get capture() { return capture }, async close() { if (capture) await finish(); stopNotes(); await releaseMidi(); await engine?.stop(); for (const take of takes) URL.revokeObjectURL(take.url) }}
