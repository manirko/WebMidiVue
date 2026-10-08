import assert from 'node:assert/strict'
import {analyze,wav,SCORE} from './analyze.mjs'
const rate=8000,n=rate*SCORE.seconds,good=new Float32Array(n)
for(let i=rate;i<rate*3;i++)good[i]=.1*Math.sin(i*2*Math.PI*440/rate)
assert.equal(analyze([good],rate).result,'PASS')
const silent=new Float32Array(n);assert(analyze([silent],rate).reasons.includes('MISSING_SIGNAL'))
const stuck=good.slice();stuck.fill(.1,rate*5);assert(analyze([stuck],rate).reasons.includes('STUCK_TAIL'))
const unreleased=good.slice();unreleased.fill(.1,rate*3,rate*4)
assert(analyze([unreleased],rate).reasons.includes('UNRELEASED_NOTE'), 'later panic must not hide lost Note Off')
assert(!analyze([unreleased],rate).reasons.includes('STUCK_TAIL'), 'release and panic windows are independent')
const clipped=good.slice();clipped.fill(1,rate,rate+100);assert(analyze([clipped],rate).reasons.includes('CLIPPING'))
const invalid=good.slice();invalid[15]=NaN;assert(analyze([invalid],rate).reasons.includes('NON_FINITE'))
assert.equal(analyze([good],rate,{dropped:1}).result,'INCONCLUSIVE')
assert.equal(analyze([good],rate,{clocksValid:false}).result,'INCONCLUSIVE')
assert.equal(analyze([good.slice(0,rate*2)],rate).result,'INCONCLUSIVE')
const view=new DataView(wav([good,good],rate));assert.equal(view.getUint16(20,true),3);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(40,true),n*8);assert.equal(view.getFloat32(44+rate*8,true),good[rate])
console.log('PASS: signal, silence, lost Note Off before panic, stuck tail, clipping, non-finite, dropped blocks, timing, truncation and float WAV')

// Reuse the existing capture UI and production engine. This flag replaces the
// manual three-button check; it does not introduce another audio renderer.
if (process.argv.includes('--browser')) await testRealtimeCapture()

async function testRealtimeCapture() {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const crypto = await import('node:crypto')
  const {execFileSync} = await import('node:child_process')
  const {createRequire} = await import('node:module')
  const {fileURLToPath} = await import('node:url')
  const require = createRequire(import.meta.url)
  const {chromium} = require('playwright-core')
  const {chromePath, createStaticServer} = require('../browser-test-harness.js')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const parent = process.env.BIOTRON_QA_OUTPUT || os.tmpdir()
  const output = fs.mkdtempSync(path.join(parent, 'audio-realtime-'))
  const bench = path.join(output, 'bench')
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const report = {
    status: 'RUNNING', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}),
    platform: process.platform, cases: [], loadOnly: process.argv.includes('--load'),
    scope: 'Isolated production-engine PCM after final gain; no system/speaker, running Play UI, MIDI or human acceptance',
    testSourceSha256: hash(fs.readFileSync(new URL(import.meta.url)))
  }
  const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2))
  console.log('Real-time evidence:', output)
  save()
  let browser, server, context, page
  const pageErrors = []
  try {
    const build = execFileSync(process.env.PYTHON || 'python3', [
      'scripts/build-browser-qa-harness.py', '--output', bench
    ], {cwd: root, encoding: 'utf8', timeout: 30000})
    const bundle = execFileSync(process.execPath, [path.join(bench, 'build.cjs')], {
      cwd: root, encoding: 'utf8', timeout: 60000
    })
    fs.writeFileSync(path.join(output, 'build.log'), build + bundle)
    report.sourceManifest = JSON.parse(fs.readFileSync(path.join(bench, 'source-manifest.json'), 'utf8'))
    report.bundleSha256 = hash(fs.readFileSync(path.join(bench, 'bundle.js')))
    server = createStaticServer(bench)
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    browser = await chromium.launch({executablePath: chromePath(), headless: true, ignoreDefaultArgs: ['--mute-audio']})
    report.browser = browser.version()
    context = await browser.newContext()
    await context.tracing.start({screenshots: true, snapshots: true, sources: true})
    await context.addInitScript(() => {
      const intervals = new Set(), blobs = new Set(), frames = new Set(), contexts = []
      window.__captureResources = {intervals, blobs, frames, contexts}
      const set = window.setInterval, clear = window.clearInterval
      window.setInterval = (...args) => { const id = set(...args); intervals.add(id); return id }
      window.clearInterval = id => { intervals.delete(id); clear(id) }
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      window.requestAnimationFrame = callback => { const id = request(time => { frames.delete(id); callback(time) }); frames.add(id); return id }
      window.cancelAnimationFrame = id => { frames.delete(id); cancel(id) }
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL
      URL.createObjectURL = blob => { const url = create(blob); blobs.add(url); return url }
      URL.revokeObjectURL = url => { blobs.delete(url); revoke(url) }
      const Native = window.AudioContext
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); contexts.push(this) }
      }
      navigator.requestMIDIAccess = () => { throw Error('Audio bench must not open MIDI') }
    })
    page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    for (const mode of report.loadOnly ? [] : ['normal', 'mute', 'stuck']) {
      await page.locator(`#audio-${mode}`).click()
      await page.waitForFunction(mode => {
        const stage = document.getElementById('stage').textContent
        return stage.startsWith(`audio-realtime-${mode} `) && !stage.endsWith('RUNNING')
      }, mode)
      const observed = await page.evaluate(() => ({
        ui: JSON.parse(document.getElementById('result').textContent),
        artifacts: [...document.querySelectorAll('#artifacts a')].map(a => ({name: a.download, href: a.href})),
        resources: {intervals: window.__captureResources.intervals.size, blobs: window.__captureResources.blobs.size,
          contextStates: window.__captureResources.contexts.map(c => c.state)}
      }))
      fs.writeFileSync(path.join(output, `${mode}-ui.json`), JSON.stringify({ui: observed.ui, resources: observed.resources}, null, 2))
      const hashes = {}
      for (const artifact of observed.artifacts) {
        assert([`${mode}-capture.wav`, `${mode}-report.json`].includes(artifact.name), 'unexpected download name')
        assert(artifact.href.startsWith('data:') && artifact.href.includes(';base64,'), 'expected local capture data')
        const bytes = Buffer.from(artifact.href.split(',')[1], 'base64')
        fs.writeFileSync(path.join(output, artifact.name), bytes)
        hashes[artifact.name] = hash(bytes)
      }
      const captured = JSON.parse(fs.readFileSync(path.join(output, `${mode}-report.json`), 'utf8'))
      const bytes = fs.readFileSync(path.join(output, `${mode}-capture.wav`))
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
      assert.equal(bytes.readUInt16LE(20), 3, 'float PCM format')
      assert.equal(bytes.readUInt16LE(22), 1, 'one final-gain channel')
      assert.equal(bytes.readUInt32LE(40), bytes.length - 44, 'complete WAV payload')
      const pcm = Float32Array.from({length: (bytes.length - 44) / 4}, (_, i) => bytes.readFloatLE(44 + i * 4))
      const checked = analyze([pcm], bytes.readUInt32LE(24), {
        dropped: captured.analysis.dropped,
        clocksValid: captured.contextState === 'running' && captured.events.every(e => Math.abs(e.actual - e.expected) < .25)
      })
      const row = {mode, report: captured, wavAnalysis: checked, hashes, resources: observed.resources}
      report.cases.push(row)
      save()
      assert.equal(captured.result, 'PASS', `${mode}: capture or expected mutation failed`)
      assert.equal(observed.ui.result, 'PASS', `${mode}: capture UI failed`)
      assert.equal(checked.result, captured.analysis.result, 'downloaded WAV matches browser analysis')
      assert.deepEqual(checked.reasons, captured.analysis.reasons)
      assert.equal(checked.result, mode === 'normal' ? 'PASS' : 'FAIL')
      if (mode !== 'normal') assert(checked.reasons.includes(mode === 'mute' ? 'MISSING_SIGNAL' : 'STUCK_TAIL'))
      if (mode === 'stuck') assert(checked.reasons.includes('UNRELEASED_NOTE'), 'lost Note Off is detected before panic')
      assert.equal(observed.resources.intervals, 0, 'capture retained a renderer interval')
      assert.equal(observed.resources.blobs, 0, 'capture retained a worklet Blob URL')
      assert(observed.resources.contextStates.every(state => state === 'closed'), 'capture left an AudioContext open')
      assert.deepEqual(pageErrors, [], 'uncaught browser error')
    }
    if (report.loadOnly) {
      await page.locator('#load').click()
      await page.waitForFunction(() => {
        const stage = document.getElementById('stage').textContent
        return stage.startsWith('animation-audio-load ') && !stage.endsWith('RUNNING')
      }, null, {timeout: 60000})
      const observed = await page.evaluate(() => ({
        ui: JSON.parse(document.getElementById('result').textContent),
        resources: {intervals: window.__captureResources.intervals.size, frames: window.__captureResources.frames.size,
          blobs: window.__captureResources.blobs.size, contextStates: window.__captureResources.contexts.map(c => c.state)}
      }))
      report.load = observed
      save()
      assert.equal(observed.ui.result, 'PASS', 'Garden/audio load failed; missing renderer is not PASS')
      assert.deepEqual(observed.ui.value.rows.map(row => row.syntheticMainThreadBusyMsPer16ms), [0, 4, 10])
      for (const row of observed.ui.value.rows) {
        assert.equal(row.audio.result, 'PASS', 'audio oracle failed under contention')
        assert.equal(row.animationRendered, true)
        assert(row.uiFrameSamples > 0 && Number.isFinite(row.uiFrameP95Ms))
      }
      assert.equal(observed.resources.intervals, 0, 'load retained a timer')
      assert.equal(observed.resources.frames, 0, 'load retained a host animation frame')
      assert.equal(observed.resources.blobs, 0, 'load retained a Blob URL')
      assert.equal(observed.resources.contextStates.length, 3, 'one capture per requested load level')
      assert(observed.resources.contextStates.every(state => state === 'closed'))
      assert.deepEqual(pageErrors, [], 'uncaught browser error')
    }
    report.status = 'PASS'
    console.log(report.loadOnly ? 'PASS: Garden renderer, audio oracles at 0/4/10ms contention, host frame metrics and cleanup' : 'PASS: actual real-time PCM, silence/stuck-note mutations, downloaded WAV and repeated capture cleanup')
  } catch (error) {
    report.status = 'FAIL'
    report.error = {message: String(error), stack: error.stack, pageErrors}
    if (page) await page.screenshot({path: path.join(output, 'first-fault.png')}).catch(() => {})
    throw error
  } finally {
    save()
    if (context) await context.tracing.stop({path: path.join(output, 'trace.zip')}).catch(() => {})
    if (browser) await browser.close()
    if (server?.listening) await new Promise(resolve => server.close(resolve))
  }
}
