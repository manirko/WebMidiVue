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

let engine, busy = false, capture, midi, inputs = [], timers = [], pressed = new Map(), lastPerformance = [], takes = [], takeNumber = 0, workletContext, startAbort, finishRequested = false
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
  for (const id of ['sound', 'register', 'voice', 'record-audio', 'record-video', 'connect']) $(id).disabled = busy || Boolean(capture)
  $('repeat').disabled = busy || !lastPerformance.length
  $('stop').disabled = !startAbort && (!capture || busy)
  $('stop').textContent = startAbort ? 'Cancel start' : 'Stop recording'
  $('example').disabled = busy
  $('release').hidden = !midi
  $('connect').hidden = Boolean(midi)
  if (!navigator.requestMIDIAccess) { $('connect').disabled = true; $('connection').textContent = 'This browser cannot receive Biotron notes. The example and recording still work. Use a MIDI-capable browser to play the plant.' }
}
async function run(action) {
  if (busy) return
  busy = true; update()
  try { await action() }
  catch (error) { status(error.message || String(error)) }
  finally { busy = false; update(); if (finishRequested) { finishRequested = false; if (capture) void run(finish) } }
}
function requestFinish() { if (busy) finishRequested = true; else void run(finish) }
async function ready(signal) {
  if (!engine || engine.stopped) engine = createRealtimeElementarySynth({preset: currentSound().preset, volume: +$('volume').value})
  try { await guard(engine.resume(), 'Sound resume', 10000, signal); await guard(engine.ensureReady(), 'Sound start', 10000, signal) }
  catch (error) { try { await guard(engine.stop(), 'Sound cleanup') } catch (cleanup) { error.cleanupFailure = String(cleanup) }; throw error }
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
  if (capture && capture.events.length < 2000) capture.events.push({...event, at: engine.context.currentTime - capture.started})
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
$('connect').onclick = () => run(async () => {
  await ready()
  const access = await guard(navigator.requestMIDIAccess({sysex: false}), 'MIDI permission', 30000)
  const available = [...access.inputs.values()].filter(input => /biotron/i.test(input.name || ''))
  if (!available.length) throw Error('Biotron not found. Connect USB, then try again.')
  midi = access; inputs = available
  try {
    for (const input of inputs) {
      await guard(input.open(), 'MIDI input')
      input.onmidimessage = event => {
        const message = parseMidiMessage(event.data)
        const type = {'note-on': 'on', 'note-off': 'off', 'pitch-bend': 'bend', panic: 'panic'}[message.type]
        if (type) send({...message, type, source: input.id})
      }
    }
    access.onstatechange = event => { if (inputs.includes(event.port) && event.port.state === 'disconnected') void run(async () => { if (capture) await finish(); await releaseMidi(); status('Biotron disconnected. Your completed take is kept.') }) }
    $('connection').textContent = 'Biotron connected. No device settings are changed.'
  } catch (error) { try { await releaseMidi() } catch (cleanup) { error.cleanupFailure = String(cleanup) }; throw error }
})
$('release').onclick = () => run(async () => { if (capture) await finish(); await releaseMidi(); $('connection').textContent = 'Biotron released.' })

$('copy').onclick = async () => {
  const link = new URL(location.href); link.hash = new URLSearchParams({sound: $('sound').value, register: $('register').value, volume: $('volume').value})
  $('link-fallback').value = link.href
  try { await navigator.clipboard.writeText(link.href); $('link-fallback').hidden = true; $('link-status').textContent = 'Sound link copied. It restores sound and register, not plant notes.' }
  catch { $('link-fallback').hidden = false; $('link-status').textContent = 'Copy this sound link manually.' }
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
  if (workletContext !== engine.context) {
    const url = URL.createObjectURL(new Blob([worklet], {type: 'text/javascript'}))
    try { await guard(engine.context.audioWorklet.addModule(url), 'Recorder start', 10000, signal); workletContext = engine.context }
    finally { URL.revokeObjectURL(url) }
  }
  const tap = new AudioWorkletNode(engine.context, 'creator-take'), drain = engine.context.createGain()
  drain.gain.value = 0; tap.connect(drain); drain.connect(engine.context.destination)
  const session = {kind: 'audio', tap, drain, blocks: [], events: [], started: engine.context.currentTime, sound: currentSound().id, sampleRate: engine.context.sampleRate}
  capture = session
  tap.port.onmessage = event => {
    if (event.data.done) { session.done = true; session.resolve?.(); requestFinish() }
    else session.blocks.push(event.data)
  }
  engine.output.connect(tap)
  status('Recording sound. Play the example, keyboard or connected Biotron. Maximum 30 seconds.')
}
async function cameraStream(signal) {
  let expired = false
  const pending = navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment', width: {ideal: 720}, height: {ideal: 1280}}, audio: $('voice').checked})
  pending.then(stream => { if (expired || signal?.aborted) stream.getTracks().forEach(track => track.stop()) }, () => {})
  try { return await guard(pending, 'Camera permission', 30000, signal) }
  catch (error) { expired = true; throw error }
}
async function startVideo(signal) {
  if (takes.length >= 3) throw Error('Three takes kept. Save and remove a take before recording another.')
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Error('Video recording unavailable. Record sound and use your camera app.')
  const mime = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
  if (!mime) throw Error('No supported video format. Record sound and use your camera app.')
  await ready(signal)
  const camera = await cameraStream(signal)
  let sink, mic
  try {
    sink = engine.context.createMediaStreamDestination(); engine.output.connect(sink)
    if (camera.getAudioTracks().length) { mic = engine.context.createMediaStreamSource(camera); mic.connect(sink) }
    const stream = new MediaStream([...camera.getVideoTracks(), ...sink.stream.getAudioTracks()])
    const recorder = new MediaRecorder(stream, {mimeType: mime}), chunks = []
    const session = {kind: 'video', camera, sink, mic, recorder, chunks, events: [], started: engine.context.currentTime, sound: currentSound().id}
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = event => { session.error = event.error || Error('Video recording failed'); requestFinish() }
    capture = session; recorder.start()
    session.limit = setTimeout(requestFinish, 30000)
    $('preview').srcObject = camera; $('preview').hidden = false; await guard($('preview').play(), 'Camera preview', 10000, signal)
    status($('voice').checked ? 'Recording video, synth and microphone. Maximum 30 seconds.' : 'Recording video and synth. Microphone off. Maximum 30 seconds.')
  } catch (error) {
    try {
      if (capture?.kind === 'video') await cleanCapture(capture)
      else { mic?.disconnect(); if (sink) { engine.output.disconnect(sink); sink.stream.getTracks().forEach(track => track.stop()) }; camera.getTracks().forEach(track => track.stop()) }
    } catch (cleanup) { error.cleanupFailure = String(cleanup) }
    capture = null; throw error
  }
}
async function cleanCapture(session) {
  clearTimeout(session.limit)
  if (session.kind === 'audio') { engine.output.disconnect(session.tap); session.tap.disconnect(); session.drain.disconnect(); session.tap.port.onmessage = null; session.tap.port.close() }
  else {
    session.recorder.ondataavailable = null; session.recorder.onerror = null; session.recorder.onstop = null
    if (session.recorder.state !== 'inactive') session.recorder.stop()
    session.mic?.disconnect(); engine.output.disconnect(session.sink); session.sink.disconnect()
    session.camera.getTracks().forEach(track => track.stop()); session.sink.stream.getTracks().forEach(track => track.stop())
    $('preview').pause(); $('preview').srcObject = null; $('preview').hidden = true
  }
}
async function finish() {
  const session = capture
  if (!session) return
  let file, seconds, primary
  try {
    // A recorded performance needs a final stop even if a key/contact remains held.
    if (engine.activeVoiceCount) send({type: 'panic'})
    if (session.kind === 'audio') {
      // Auto-limit may already have acknowledged completion.
      await guard(new Promise(resolve => { session.resolve = resolve; if (session.done) resolve(); else session.tap.port.postMessage('stop') }), 'Sound finalization', 5000)
      let expected = session.blocks[0]?.frame, samples = 0
      for (const block of session.blocks) { if (block.frame !== expected) throw Error('Sound capture has a gap. Existing takes are kept.'); expected += block.pcm.length; samples += block.pcm.length }
      if (!samples) throw Error('No audio blocks received. Try again; existing takes are kept.')
      const pcm = new Float32Array(samples); let at = 0
      for (const block of session.blocks) { pcm.set(block.pcm, at); at += block.pcm.length }
      if (pcm.some(value => !Number.isFinite(value))) throw Error('Invalid audio samples. Existing takes are kept.')
      session.silent = pcm.every(value => Math.abs(value) < .0005)
      file = new File([wav([pcm], session.sampleRate)], 'biotron-take-' + (takeNumber + 1) + '.wav', {type: 'audio/wav'})
      seconds = samples / session.sampleRate
    } else {
      await guard(new Promise(resolve => { session.recorder.onstop = resolve; if (session.recorder.state === 'inactive') resolve(); else session.recorder.stop() }), 'Video finalization', 5000)
      if (session.error) throw session.error
      const mime = session.recorder.mimeType
      file = new File(session.chunks, 'biotron-take-' + (takeNumber + 1) + (mime.includes('mp4') ? '.mp4' : '.webm'), {type: mime})
      if (!file.size) throw Error('Video file is empty. Existing takes are kept.')
      seconds = engine.context.currentTime - session.started
    }
    addTake(file, session, seconds)
    lastPerformance = session.events
    status(session.silent ? 'Take kept, but no music was detected. Check volume and input before another take.' : 'Take kept. Listen or watch before saving. Nothing has been uploaded.')
  } catch (error) { primary = error; throw error }
  finally { capture = null; try { await cleanCapture(session) } catch (error) { if (primary) primary.cleanupFailure = String(error); else throw error } }
}
function addTake(file, session, seconds) {
  const url = URL.createObjectURL(file), take = {file, url, events: session.events, kind: session.kind, seconds}
  takes.push(take); takeNumber++
  const section = document.createElement('article'); section.className = 'take'
  const title = document.createElement('h3'); title.textContent = 'Take ' + takeNumber + ' · ' + seconds.toFixed(1) + ' seconds'
  const media = document.createElement(session.kind === 'audio' ? 'audio' : 'video'); media.controls = true; media.src = url; media.playsInline = true
  media.onplay = stopNotes
  const row = document.createElement('div'); row.className = 'row'
  const save = document.createElement('a'); save.className = 'save'; save.href = url; save.download = file.name; save.textContent = 'Save ' + (session.kind === 'audio' ? 'sound' : 'video')
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
function start(action) { return run(async () => { startAbort = new AbortController(); update(); try { await action(startAbort.signal) } finally { startAbort = null } }) }
$('record-audio').onclick = () => start(startAudio)
$('record-video').onclick = () => start(startVideo)
$('stop').onclick = () => startAbort ? startAbort.abort() : run(finish)
document.addEventListener('visibilitychange', () => { if (document.hidden) { startAbort?.abort(); stopNotes(); if (capture) requestFinish() } })
window.addEventListener('pagehide', () => { startAbort?.abort(); stopNotes(); const session = capture; capture = null; if (session) void cleanCapture(session); void releaseMidi(); void engine?.stop() })
window.addEventListener('pageshow', event => { if (event.persisted) { busy = false; capture = null; update(); status('Returned. Kept takes remain available; restart sound when ready.') } })
update()

// Existing autonomous tester reads actual bytes and sends UI actions. This
// surface never substitutes fake audio or auto-requests a user's devices.
window.__CreatorPrototype = {get takes() { return takes }, get engine() { return engine }, get capture() { return capture }, async close() { if (capture) await finish(); stopNotes(); await releaseMidi(); await engine?.stop(); for (const take of takes) URL.revokeObjectURL(take.url) }}
