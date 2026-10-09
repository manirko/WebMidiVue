'use strict'

// Existing UI and engine only. Synthetic CPU budgets and browser timing are
// observations, not hardware latency, speaker output or perceptual acceptance.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const {execFileSync} = require('node:child_process')
const {createRequire} = require('node:module')
const {pathToFileURL} = require('node:url')

const repo = path.resolve(process.argv[2] || path.join(__dirname, '..'))
const localRequire = createRequire(path.join(repo, 'package.json'))
const {launchBrowser, qaOrigin, verifyOnlineIdentity, createStaticServer} = localRequire(path.join(repo, 'scripts/browser-test-harness.js'))
const outputParent = process.env.BIOTRON_QA_OUTPUT || process.argv[3] || os.tmpdir()
const fault = process.env.UI_PERF_FAULT || 'none'
const output = fs.mkdtempSync(path.join(outputParent, 'ui-performance-'))
const dist = path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(repo, 'dist'))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const files = directory => fs.readdirSync(directory, {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
const snapshot = () => Object.fromEntries(files(dist).sort()
  .map(file => [path.relative(dist, file), hash(fs.readFileSync(file))]))
const distribution = values => {
  const sorted = values.slice().sort((left, right) => left - right)
  const quantile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null
  return {n: sorted.length, min: sorted[0] ?? null, p50: quantile(.5), p95: quantile(.95), max: sorted.at(-1) ?? null}
}
const report = {
  status: 'RUNNING', capturedAt: new Date().toISOString(), routes: [], audio: [], errors: [], requestFailures: [],
  scope: 'Exact built UI, actual Garden and existing production-engine final-gain PCM; keyboard input and synthetic CPU contention, no physical MIDI/speaker, perceptual or release acceptance',
  limits: {routeResponseMs: 5000, firstKeyboardStartMs: 5000, gardenHandshakeMs: 20000},
  performanceDistributions: 'Observations only; no calibrated p50/p95 or hardware-latency acceptance',
  traceScope: 'Protocol events only; continuous screenshots/DOM snapshots delay trusted keys and invalidate audio timing. First-fault screenshot remains separate.',
  fault,
  faultScope: fault === 'mute' ? 'Test-only capture worklet substitutes zero PCM; production output is unchanged' :
    fault === 'drop' ? 'Test-only capture omits the second observed block; production output is unchanged' :
    fault === 'late-release' ? 'Test-only keyboard Note Off is delayed by 500ms; timing must remain INCONCLUSIVE' : 'No injected capture fault',
  physicalMidi: 'NOT RUN: the synthetic provider never delegates to native MIDI',
}
const save = () => {
  const target = path.join(output, 'report.json')
  fs.writeFileSync(target + '.tmp', JSON.stringify(report, null, 2) + '\n')
  fs.renameSync(target + '.tmp', target)
}
let browser, server, context, page, initialDist
save()
console.log('UI performance evidence:', output)

async function cleanup() {
  if (!page || page.isClosed()) return
  await page.evaluate(() => {
    const q = window.__uiPerf
    if (!q) return
    q.measurementPhase = 'cleanup'
    clearInterval(q.phase?.load)
    q.phase = null
    cancelAnimationFrame(q.raf)
    q.observer?.disconnect()
    if (q.tap) {
      q.tap.port.postMessage({type: 'stop'})
      try { q.output?.disconnect(q.tap) } catch { /* already released */ }
      q.tap.disconnect()
      q.drain?.disconnect()
      q.tap.port.onmessage = null
      q.tap.port.close()
      q.tap = null
    }
  })
  const stop = page.getByRole('button', {name: 'Stop & release', exact: true})
  if (await stop.count()) {
    await stop.click()
    await page.locator('.sound-lab[data-active-voices="0"][data-audio-state="closed"]').waitFor()
  }
  report.cleanup = await page.evaluate(() => {
    const q = window.__uiPerf
    return q ? {contexts: q.contexts.map(audio => audio.state), midiRequests: q.midiCalls.length, midiCalls: q.midiCalls,
      retainedIntervals: q.intervals.size, retainedBlobs: q.blobs.size} : null
  })
}

(async () => {
  const {SCORE, analyze, wav} = await import(pathToFileURL(path.join(repo, 'scripts/audio-qa/analyze.mjs')).href)
  assert(['none', 'mute', 'drop', 'late-release'].includes(fault), 'UI_PERF_FAULT must be none, mute, drop or late-release')
  assert(fs.existsSync(path.join(dist, 'service-worker.js')), 'Existing beta dist required; this lane never builds')
  initialDist = snapshot()
  report.distHashes = initialDist
  report.artifactRoot = dist
  const releaseFile = path.join(dist, 'release-evidence.json')
  report.builtReleaseEvidence = fs.existsSync(releaseFile) ? JSON.parse(fs.readFileSync(releaseFile, 'utf8')) : null
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim()
  report.workingTree = execFileSync('git', ['status', '--porcelain'], {cwd: repo, encoding: 'utf8'})
  report.sourceHashes = Object.fromEntries([
    'src/components/SoundLab/SoundLab.vue', 'src/components/SoundLab/GardenVisual.vue',
    'src/components/BiotronPage/BiotronPageUpdated.vue', 'src/audio/elementary/engine.mjs',
    'src/audio/elementary/timbres.mjs', 'public/garden/scene.html', 'scripts/browser-test-harness.js',
    'scripts/audio-qa/analyze.mjs', 'package-lock.json',
  ].map(file => [file, hash(fs.readFileSync(path.join(repo, file)))]))
  report.testSourceSha256 = hash(fs.readFileSync(__filename))
  report.score = SCORE
  report.input = {preset: 'Round', volume: 70, note: 69, keyboardCode: 'KeyH', velocity: 104,
    panic: 'Not injected into the UI; real Note Off is checked before the score panic time and tail afterwards'}
  save()
  server = createStaticServer(dist)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  browser = await launchBrowser({headless: process.env.UI_PERF_HEADED !== '1'})
  report.browser = browser.version()
  report.browserSelector = process.env.BIOTRON_QA_BROWSER || 'chrome'
  report.engine = browser.browserType().name()
  report.headless = process.env.UI_PERF_HEADED !== '1'
  const origin = qaOrigin(server)
  report.origin = origin
  // PWA update has its own lane. A fresh, SW-free profile isolates UI/engine timing.
  context = await browser.newContext({viewport: {width: 1366, height: 900}, serviceWorkers: 'block'})
  context.setDefaultTimeout(5000)
  if (process.env.BIOTRON_QA_ORIGIN !== undefined) report.onlineIdentityBefore = await verifyOnlineIdentity(context, origin, dist)
  await context.tracing.start({screenshots: false, snapshots: false, sources: false})
  await context.addInitScript(injectedFault => {
    const q = window.__uiPerf = {contexts: [], output: null, gesture: null, gardenAt: null,
      phase: null, phaseId: 0, fault: injectedFault, midiCalls: [], measurementPhase: 'cold-play',
      intervals: new Set(), blobs: new Set(), longtasksSupported: false}
    localStorage.setItem('playtronica-sound-volume-v1', '70')
    localStorage.removeItem('biotron-sound-experiment-v1')
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination === this.context.destination && (!q.output || q.output.context !== this.context)) q.output = this
      return connect.call(this, destination, ...args)
    }
    const Native = window.AudioContext
    window.AudioContext = class extends Native { constructor(...args) { super(...args); q.contexts.push(this) } }
    const set = window.setInterval, clear = window.clearInterval, create = URL.createObjectURL, revoke = URL.revokeObjectURL
    window.setInterval = (...args) => { const id = set(...args); q.intervals.add(id); return id }
    window.clearInterval = id => { q.intervals.delete(id); clear(id) }
    URL.createObjectURL = blob => { const url = create(blob); q.blobs.add(url); return url }
    URL.revokeObjectURL = url => { q.blobs.delete(url); revoke(url) }
    Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => {
      q.midiCalls.push({at: performance.now(), route: location.hash.split('?')[0], hash: location.hash, phase: q.measurementPhase})
      throw Error('Synthetic Settings provider does not delegate to physical MIDI')
    }})
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a.device-task-nav__link')
      if (link) {
        q.gesture = {at: performance.now(), href: link.href}
        q.measurementPhase = link.href.endsWith('/biotron/play') ? 'return-play' : 'settings-route'
        if (q.measurementPhase === 'return-play') q.gardenAt = null
      }
    }, true)
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.source === document.querySelector('.garden-visual iframe')?.contentWindow && event.data?.type === 'garden-rendered') q.gardenAt = performance.now()
    })
    const key = (event, type) => {
      if (q.phase && event.code === 'KeyH' && q.phase.firstFrame !== null)
        q.phase.events.push({type, actual: q.output.context.currentTime - q.phase.firstFrame / q.output.context.sampleRate, trusted: event.isTrusted})
    }
    window.addEventListener('keydown', event => key(event, 'on'), true)
    window.addEventListener('keyup', event => key(event, 'off'), true)
    const frame = now => {
      if (q.phase) { if (q.phase.lastRaf) q.phase.frames.push(now - q.phase.lastRaf); q.phase.lastRaf = now }
      q.raf = requestAnimationFrame(frame)
    }
    q.raf = requestAnimationFrame(frame)
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      q.longtasksSupported = true
      q.observer = new PerformanceObserver(list => {
        if (q.phase) for (const entry of list.getEntries()) q.phase.longtasks.push({start: entry.startTime, duration: entry.duration})
      })
      q.observer.observe({type: 'longtask', buffered: false})
    }
  }, fault)
  page = await context.newPage()
  page.on('pageerror', error => report.errors.push(String(error)))
  page.on('requestfailed', request => report.requestFailures.push({url: request.url(), failure: request.failure()}))
  const coldStarted = Date.now()
  await page.goto(`${origin}/#/biotron/play`)
  await page.locator('.sound-lab:visible').waitFor()
  report.coldNavigationWallMs = Date.now() - coldStarted
  for (let index = 0; index < 20; index++) {
    const destination = index % 2 === 0 ? 'Settings' : 'Play'
    await page.locator('.device-task-nav:visible').getByRole('link', {name: destination, exact: true}).click()
    if (destination === 'Settings') await page.getByRole('heading', {name: 'Settings', exact: true}).waitFor()
    else await page.locator('.sound-lab:visible').waitFor()
    const observed = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const q = window.__uiPerf
      return {latencyMs: performance.now() - q.gesture.at, href: q.gesture.href, domNodes: document.querySelectorAll('*').length}
    })
    report.routes.push({sequence: index + 1, destination, phase: index < 2 ? 'first-pass' : 'warm', ...observed})
    save()
    assert(observed.latencyMs < report.limits.routeResponseMs, `${destination} response exceeded 5-second existing UI budget`)
  }
  report.routeDistributions = Object.fromEntries(['Settings', 'Play'].flatMap(destination => ['first-pass', 'warm'].map(phase => [
    destination + '/' + phase, distribution(report.routes.filter(row => row.destination === destination && row.phase === phase).map(row => row.latencyMs)),
  ])))
  await page.waitForFunction(() => window.__uiPerf.gardenAt !== null, {}, {timeout: report.limits.gardenHandshakeMs})
  report.midiCallsBeforeAudio = await page.evaluate(() => window.__uiPerf.midiCalls)
  report.midiBaseline = report.midiCallsBeforeAudio.length
  assert(report.midiCallsBeforeAudio.every(call => call.route === '#/biotron' && call.phase === 'settings-route'),
    'A synthetic MIDI access call occurred on cold or returning Play')
  await page.evaluate(() => { window.__uiPerf.measurementPhase = 'keyboard-start' })
  const start = Date.now()
  await page.getByRole('button', {name: 'Play with keyboard', exact: true}).click()
  await page.locator('.sound-lab[data-keyboard="on"][data-audio-state="running"][data-sound="Round"][data-volume="70"]').waitFor()
  report.firstKeyboardStartWallMs = Date.now() - start
  assert(report.firstKeyboardStartWallMs < report.limits.firstKeyboardStartMs, 'Keyboard start exceeded existing 5-second audio start budget')
  const worklet = `class Capture extends AudioWorkletProcessor {
    constructor(){super();this.capture=false;this.port.onmessage=event=>{this.capture=event.data.type==='start';if(this.capture){this.id=event.data.id;this.fault=event.data.fault;this.samples=0}}}
    process(inputs){const pcm=inputs[0]?.[0];if(this.capture&&pcm&&this.samples<sampleRate*8){this.port.postMessage({id:this.id,frame:currentFrame,pcm:this.fault==='mute'?new Float32Array(pcm.length):pcm.slice()});this.samples+=pcm.length}return true}
  } registerProcessor('ui-perf-capture',Capture)`
  await page.evaluate(async code => {
    const q = window.__uiPerf, audio = q.output.context
    const url = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}))
    try { await audio.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    q.tap = new AudioWorkletNode(audio, 'ui-perf-capture')
    q.drain = audio.createGain(); q.drain.gain.value = 0
    q.tap.connect(q.drain); q.drain.connect(audio.destination); q.output.connect(q.tap)
    q.tap.port.onmessage = event => {
      const phase = q.phase
      if (!phase || event.data.id !== phase.id) return
      phase.receivedBlocks++
      if (phase.firstFrame === null) { phase.firstFrame = event.data.frame; phase.firstResolve?.() }
      if (q.fault === 'drop' && phase.receivedBlocks === 2) { phase.omittedBlocks++; return }
      phase.blocks.push(event.data)
    }
  }, worklet)
  const waitUntilScore = seconds => page.waitForFunction(seconds => {
    const q = window.__uiPerf
    return q.output.context.currentTime - q.phase.firstFrame / q.output.context.sampleRate >= seconds
  }, seconds, {timeout: 10000})
  for (const budget of [0, 4, 10]) {
    await page.evaluate(async milliseconds => {
      const q = window.__uiPerf
      q.measurementPhase = 'audio-load'
      const phase = q.phase = {id: ++q.phaseId, budget: milliseconds, firstFrame: null, blocks: [], receivedBlocks: 0, omittedBlocks: 0,
        events: [], frames: [], longtasks: [], lastRaf: 0}
      if (milliseconds) phase.load = setInterval(() => { const end = performance.now() + milliseconds; while (performance.now() < end) Math.sqrt(Math.random()) }, 16)
      q.tap.port.postMessage({type: 'start', id: phase.id, fault: q.fault})
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(Error('No actual production PCM block within 10 seconds'), {code: 'PCM_INCONCLUSIVE'})), 10000)
        phase.firstResolve = () => { clearTimeout(timer); resolve() }
      })
    }, budget)
    await waitUntilScore(SCORE.noteOn)
    const downStarted = Date.now()
    await page.keyboard.down('h')
    const keyDownWallMs = Date.now() - downStarted
    await waitUntilScore(SCORE.noteOff)
    if (fault === 'late-release') await page.waitForTimeout(500)
    const upStarted = Date.now()
    await page.keyboard.up('h')
    const keyUpWallMs = Date.now() - upStarted
    await waitUntilScore(SCORE.seconds)
    const captured = await page.evaluate(score => {
      const q = window.__uiPerf, phase = q.phase, sampleRate = q.output.context.sampleRate
      q.tap.port.postMessage({type: 'stop'}); clearInterval(phase.load); q.phase = null
      const length = Math.round(score.seconds * sampleRate), pcm = new Float32Array(length)
      let expected = phase.firstFrame, dropped = 0
      for (const block of phase.blocks) {
        if (block.frame !== expected) dropped++
        const offset = block.frame - phase.firstFrame
        if (offset >= 0 && offset < length) pcm.set(block.pcm.subarray(0, Math.min(block.pcm.length, length - offset)), offset)
        expected = block.frame + block.pcm.length
      }
      if (expected - phase.firstFrame < length - sampleRate * .1) dropped++
      const bytes = new Uint8Array(pcm.buffer), chunks = []
      for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)))
      return {pcmBase64: btoa(chunks.join('')), sampleRate, dropped, deliberatelyOmittedBlocks: phase.omittedBlocks,
        coveredAudioSeconds: (expected - phase.firstFrame) / sampleRate,
        syntheticMainThreadBusyMsPer16ms: phase.budget, events: phase.events, frames: phase.frames, longtasks: phase.longtasks,
        longtasksSupported: q.longtasksSupported, contextState: q.output.context.state,
        baseLatency: q.output.context.baseLatency, outputLatency: q.output.context.outputLatency}
    }, SCORE)
    const bytes = Buffer.from(captured.pcmBase64, 'base64')
    const pcm = Float32Array.from({length: bytes.length / 4}, (_, index) => bytes.readFloatLE(index * 4))
    delete captured.pcmBase64
    const drift = captured.events.map(event => 1000 * (event.actual - (event.type === 'on' ? SCORE.noteOn : SCORE.noteOff)))
    const clocksValid = captured.contextState === 'running' && captured.events.length === 2 &&
      captured.events[0].type === 'on' && captured.events[1].type === 'off' &&
      captured.events.every(event => event.trusted) && drift.every(value => Math.abs(value) < 250)
    const analysis = analyze([pcm], captured.sampleRate, {dropped: captured.dropped, clocksValid})
    const wavBytes = Buffer.from(wav([pcm], captured.sampleRate))
    const filename = `load-${budget}ms.wav`
    fs.writeFileSync(path.join(output, filename), wavBytes)
    const frameDistribution = distribution(captured.frames)
    delete captured.frames
    report.audio.push({...captured, analysis, timingDriftMs: drift, inputTransportWallMs: {down: keyDownWallMs, up: keyUpWallMs}, uiFrameDistributionMs: frameDistribution,
      wav: filename, wavSha256: hash(wavBytes), performanceAcceptance: 'Frame/long-task distributions are observations; audio fault oracle is gated'})
    save()
    if (analysis.result !== 'PASS') {
      report.status = analysis.result
      throw Error(`Production UI load ${budget}ms: ${analysis.result}/${analysis.reasons.join(',')}`)
    }
  }
  await cleanup()
  assert.equal(report.cleanup.contexts.length, 1, 'Lane created more than one production AudioContext')
  assert(report.cleanup.contexts.every(state => state === 'closed'), 'Stop retained an open production context')
  assert.equal(report.cleanup.midiRequests - report.midiBaseline, 0, 'Keyboard/audio/cleanup phase requested MIDI')
  assert(report.cleanup.midiCalls.every(call => call.route === '#/biotron' && call.phase === 'settings-route'),
    'Synthetic MIDI access occurred outside Settings')
  assert.equal(report.cleanup.retainedIntervals, 0, 'Lane or renderer retained an interval')
  assert.equal(report.cleanup.retainedBlobs, 0, 'Lane or renderer retained a Blob URL')
  assert.deepEqual(report.errors, [], 'Uncaught browser error')
  assert.deepEqual(snapshot(), initialDist, 'dist changed during this lane; evidence is not bound to one artifact')
  if (process.env.BIOTRON_QA_ORIGIN !== undefined) report.onlineIdentityAfter = await verifyOnlineIdentity(context, origin, dist)
  report.status = 'PASS'
  console.log('PASS: 20 UI route clicks, actual Garden, existing engine PCM under three synthetic loads, trusted keyboard Note Off and complete release')
})().catch(async error => {
  if (error.code === 'PCM_INCONCLUSIVE') report.status = 'INCONCLUSIVE'
  else if (report.status !== 'INCONCLUSIVE') report.status = 'FAIL'
  report.error = String(error.stack || error)
  save()
  if (page && !page.isClosed()) await page.screenshot({path: path.join(output, 'first-fault.png')}).catch(() => {})
  process.exitCode = report.status === 'INCONCLUSIVE' ? 2 : 1
}).finally(async () => {
  try { await cleanup() } catch (error) { report.cleanupError = String(error); report.status = 'FAIL'; process.exitCode = 1 }
  if (report.cleanup && report.midiBaseline !== undefined && report.cleanup.midiRequests !== report.midiBaseline) {
    report.midiCleanupError = 'Cleanup or audio introduced an additional synthetic MIDI access call'
    report.status = 'FAIL'; process.exitCode = 1
  }
  if (context) await context.tracing.stop({path: path.join(output, 'trace.zip')}).catch(error => { report.traceError = String(error); report.status = 'FAIL'; process.exitCode = 1 })
  if (browser) await browser.close().catch(error => { report.browserCloseError = String(error); report.status = 'FAIL'; process.exitCode = 1 })
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  save()
})
