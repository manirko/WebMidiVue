import assert from 'node:assert/strict'
import {analyze,wav,SCORE,creatorFixtureMetrics,creatorFixtureHasBoth} from './analyze.mjs'
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
assert.deepEqual(analyze([good],rate).captureProblems,[])
assert.deepEqual(analyze([good],rate,{dropped:1}).captureProblems,['DROPPED_BLOCKS'])
assert.deepEqual(analyze([good],rate,{clocksValid:false}).captureProblems,['INVALID_CLOCKS'])
assert.deepEqual(analyze([good.slice(0,rate*2)],rate).captureProblems,['INCOMPLETE_PCM'])
const view=new DataView(wav([good,good],rate));assert.equal(view.getUint16(20,true),3);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(40,true),n*8);assert.equal(view.getFloat32(44+rate*8,true),good[rate])
console.log('PASS: signal, silence, lost Note Off before panic, stuck tail, clipping, non-finite, dropped blocks, timing, truncation and float WAV')
const fixtureTone=frequency=>Float32Array.from({length:rate},(_,i)=>.04*Math.sin(2*Math.PI*frequency*i/rate))
const fixtureMusic=fixtureTone(440*2**((60-69)/12)),fixtureMic=fixtureTone(310)
const fixtureBaseline={synth:creatorFixtureMetrics(fixtureMusic,rate),micOnly:creatorFixtureMetrics(fixtureMic,rate)}
assert(creatorFixtureHasBoth(creatorFixtureMetrics(fixtureMusic.map((x,i)=>x+fixtureMic[i]),rate),fixtureBaseline))
for(const samples of [fixtureMusic,fixtureMic,fixtureMic.map(x=>2*x),new Float32Array(rate)])assert(!creatorFixtureHasBoth(creatorFixtureMetrics(samples,rate),fixtureBaseline))
const fixtureSequential=new Float32Array(rate*2);fixtureSequential.set(fixtureMusic);fixtureSequential.set(fixtureMic,rate)
assert(!creatorFixtureHasBoth(creatorFixtureMetrics(fixtureSequential,rate),fixtureBaseline), 'Both sources must occur in the same window')
assert.throws(()=>creatorFixtureMetrics(Float32Array.of(NaN),rate),/Non-finite/)
console.log('PASS: controlled music/mic mixture; music-only, mic-only, doubled mic-only, silence and non-overlapping sources rejected')

// Reuse the existing capture UI and production engine. This flag replaces the
// manual three-button check; it does not introduce another audio renderer.
if (process.argv.includes('--browser') || process.argv.includes('--creator-recording')) await testRealtimeCapture()
if (process.argv.includes('--creator-prototype')) await testCreatorPrototype()

async function testCreatorPrototype() {
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os'), crypto = await import('node:crypto')
  const {execFileSync} = await import('node:child_process'), {createRequire} = await import('node:module')
  const require = createRequire(import.meta.url), {launchBrowser, browserCall, createStaticServer} = require('../browser-test-harness.js')
  const root = path.resolve(''), output = fs.mkdtempSync(path.join(process.env.BIOTRON_QA_OUTPUT || os.tmpdir(), 'creator-ui-')), bench = path.join(output, 'bench')
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const report = {status: 'RUNNING', commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), inputs: {}, checks: [], scope: 'Actual production engine and local files; controlled clipboard/share/camera providers, no native devices, editor or creator acceptance'}
  const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2))
  const pass = name => { report.checks.push(name); save() }
  console.log('Creator prototype evidence:', output); save()
  let browser, server, context, page
  const errors = []
  try {
    const build = execFileSync('python3', ['-I', 'scripts/build-browser-qa-harness.py', '--output', bench], {encoding: 'utf8', timeout: 30000})
    const bundle = execFileSync(process.execPath, [path.join(bench, 'build.cjs')], {encoding: 'utf8', timeout: 60000})
    fs.writeFileSync(path.join(output, 'build.log'), build + bundle)
    report.inputs = JSON.parse(fs.readFileSync(path.join(bench, 'source-manifest.json'), 'utf8')).generated_from
    report.testSha256 = hash(fs.readFileSync(new URL(import.meta.url)))
    server = createStaticServer(bench); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    browser = await launchBrowser({ignoreDefaultArgs: ['--mute-audio']}); report.browser = browser.version()
    context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true})
    await context.addInitScript(() => {
      window.__creatorControls = {clipboard: 'success', share: 'cancel', copied: [], shared: [], midi: 0, camera: 0, cameraMode: 'deny', fixtureTracks: [], fixtureContexts: [], fixtureTimers: new Set()}
      Object.defineProperty(navigator, 'requestMIDIAccess', {value: undefined, configurable: true})
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: text => { if (window.__creatorControls.clipboard === 'reject') return Promise.reject(new DOMException('Denied', 'NotAllowedError')); window.__creatorControls.copied.push(text); return Promise.resolve() }}, configurable: true})
      Object.defineProperty(navigator, 'canShare', {value: () => true, configurable: true})
      Object.defineProperty(navigator, 'share', {value: async ({files}) => {
        const controls = window.__creatorControls
        if (controls.share === 'cancel') throw new DOMException('Cancelled', 'AbortError')
        if (controls.share === 'reject') throw new DOMException('Blocked', 'NotAllowedError')
        controls.shared.push(Array.from(new Uint8Array(await files[0].arrayBuffer())))
      }, configurable: true})
      const createCamera = options => {
        const controls = window.__creatorControls, canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320
        const drawing = canvas.getContext('2d'); let frame = 0
        const timer = setInterval(() => { drawing.fillStyle = ++frame % 2 ? '#24553e' : '#edf3eb'; drawing.fillRect(0, 0, 240, 320) }, 40)
        controls.fixtureTimers.add(timer)
        const stream = canvas.captureStream(25)
        let context
        if (options.audio) {
          context = new AudioContext(); controls.fixtureContexts.push(context)
          const oscillator = context.createOscillator(), gain = context.createGain(), sink = context.createMediaStreamDestination()
          oscillator.frequency.value = 310; gain.gain.value = .03; oscillator.connect(gain); gain.connect(sink); oscillator.start(); void context.resume()
          for (const track of sink.stream.getAudioTracks()) stream.addTrack(track)
        }
        for (const track of stream.getTracks()) {
          controls.fixtureTracks.push(track); const stop = track.stop.bind(track)
          track.stop = () => { stop(); clearInterval(timer); controls.fixtureTimers.delete(timer); if (context && context.state !== 'closed') void context.close() }
        }
        return stream
      }
      // Pin the whole controlled provider. WebKit dropped the native wrapper's
      // expando after audio capture; a fixture must never fall through to hardware.
      Object.defineProperty(navigator, 'mediaDevices', {value: {getUserMedia: async options => {
        const controls = window.__creatorControls; controls.camera++
        if (controls.cameraMode === 'pending') return new Promise(resolve => { controls.resolveCamera = () => resolve(createCamera(options)) })
        if (controls.cameraMode === 'success') return createCamera(options)
        throw new DOMException('Denied', 'NotAllowedError')
      }}, configurable: true})
    })
    await context.tracing.start({screenshots: true, snapshots: true})
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)))
    const origin = `http://127.0.0.1:${server.address().port}`, navStarted = Date.now()
    await page.goto(origin + '/creator.html', {waitUntil: 'networkidle'})
    await page.waitForFunction(() => window.__CreatorPrototype)
    report.observedNavigationMs = Date.now() - navStarted
    report.prototypeBundleBytes = fs.statSync(path.join(bench, 'creator.js')).size
    assert(await page.locator('#connect').isDisabled()); assert.match(await page.locator('#connection').innerText(), /MIDI-capable/)
    assert.equal(await page.evaluate(() => __creatorControls.camera), 0); pass('no-device page, truthful MIDI fallback, no permission on load')
    await page.selectOption('#sound', 'tone-glass'); await page.selectOption('#register', '-12')
    await page.locator('#copy').click()
    const copied = await page.evaluate(() => __creatorControls.copied.at(-1))
    await page.evaluate(() => { __creatorControls.clipboard = 'reject' }); await page.locator('#copy').click()
    assert.equal(await page.locator('#link-fallback').inputValue(), copied); assert(await page.locator('#link-fallback').isVisible())
    await page.evaluate(() => { __creatorControls.clipboard = 'success' }); await page.locator('#copy').click(); assert(await page.locator('#link-fallback').isHidden())
    const fresh = await browser.newContext(), reopened = await fresh.newPage()
    await fresh.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', {value: undefined}))
    await reopened.goto(copied, {waitUntil: 'networkidle'}); assert.equal(await reopened.locator('#sound').inputValue(), 'tone-glass'); assert.equal(await reopened.locator('#register').inputValue(), '-12'); await fresh.close()
    pass('actual selected sound/register URL, clipboard reject fallback, fresh-context restoration')
    await page.selectOption('#sound', 'tone-reference'); await page.selectOption('#register', '0')
    await page.locator('#record-audio').click(); await page.locator('#stop').waitFor({state: 'visible'})
    await page.waitForFunction(() => __CreatorPrototype.capture?.kind === 'audio')
    await page.locator('#example').click(); await page.waitForTimeout(5200)
    await page.locator('#stop').click(); await page.waitForFunction(() => __CreatorPrototype.takes.length === 1 && !__CreatorPrototype.capture)
    const file = await browserCall(browser, () => page.evaluate(async () => {
      const take = __CreatorPrototype.takes[0]
      return {bytes: Array.from(new Uint8Array(await take.file.arrayBuffer())), mime: take.file.type, events: take.events}
    }), 'save creator take')
    fs.writeFileSync(path.join(output, 'take.wav'), Buffer.from(file.bytes)); const sha = hash(Buffer.from(file.bytes)); report.take = {...file, bytes: file.bytes.length, sha256: sha}
    save() // Actual bytes survive decoder rejection or timeout.
    Object.assign(file, await browserCall(browser, () => page.evaluate(async inject => {
      if (inject) throw Error('Injected fresh decoder failure after saved bytes')
      const bytes = await __CreatorPrototype.takes[0].file.arrayBuffer(), context = new AudioContext()
      try { const audio = await context.decodeAudioData(bytes); const pcm = audio.getChannelData(0); let peak = 0, sum = 0; for (const value of pcm) { peak = Math.max(peak, Math.abs(value)); sum += value * value }; return {seconds: audio.duration, peak, rms: Math.sqrt(sum / pcm.length)} }
      finally { await context.close() }
    }, process.argv.includes('--creator-prototype-decode-fault')), 'fresh creator decode'))
    Object.assign(report.take, {seconds: file.seconds, peak: file.peak, rms: file.rms}); save()
    assert.equal(file.mime, 'audio/wav'); assert(file.seconds > 5 && file.seconds < 7); assert(file.rms > .001 && file.peak < .999)
    assert.equal(file.events.filter(event => event.type === 'on').length, 8); assert.equal(file.events.filter(event => event.type === 'off').length, 8)
    pass('trusted UI → final-gain WAV → fresh decode; finite audible unclipped PCM and full phrase events')
    const download = page.waitForEvent('download'); await page.locator('#takes .save').first().click(); const downloaded = await download
    await downloaded.saveAs(path.join(output, 'saved-take.wav')); assert.equal(hash(fs.readFileSync(path.join(output, 'saved-take.wav'))), sha)
    await page.locator('#takes button', {hasText: 'Share file'}).first().click(); assert.match(await page.locator('#takes [role="status"]').first().innerText(), /cancelled/)
    await page.evaluate(() => { __creatorControls.share = 'reject' }); await page.locator('#takes button', {hasText: 'Share file'}).first().click(); assert.match(await page.locator('#takes [role="status"]').first().innerText(), /Save/)
    await page.evaluate(() => { __creatorControls.share = 'success' }); await page.locator('#takes button', {hasText: 'Share file'}).first().click()
    await page.waitForFunction(() => window.__creatorControls.shared.length === 1)
    assert.equal(hash(Buffer.from(await page.evaluate(() => __creatorControls.shared[0]))), sha); assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 1)
    pass('exact download/readback, Share cancel/reject/success keep the same file; no receiving-app success claim')
    await page.locator('#record-video').click(); await page.waitForFunction(() => !document.querySelector('#record-audio').disabled)
    assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 1); assert.equal(await page.evaluate(() => Boolean(__CreatorPrototype.capture)), false)
    assert.equal(await page.evaluate(() => __creatorControls.camera), 1); assert.equal(await page.locator('#status').innerText(), 'Denied')
    pass('camera denial retains the completed audio take')
    await page.evaluate(() => { __creatorControls.share = 'cancel'; Object.defineProperty(navigator, 'canShare', {value: () => false, configurable: true}) })
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    assert.equal(await page.locator('#repeat').isDisabled(), false)
    await page.locator('#repeat').click(); await page.waitForTimeout(5600); await page.locator('#stop').click()
    await page.waitForFunction(() => __CreatorPrototype.takes.length === 2)
    assert(await page.locator('#takes article').last().getByRole('button', {name: 'Share file'}).isHidden())
    assert.deepEqual(await page.evaluate(() => __CreatorPrototype.takes[1].events.filter(event => ['on', 'off'].includes(event.type)).map(({at, ...event}) => event)), file.events.filter(event => ['on', 'off'].includes(event.type)).map(({at, ...event}) => event))
    await page.locator('#repeat').click(); await page.waitForTimeout(1000); await page.locator('#example').click()
    pass('another independent take and repeat-performance control')
    await page.locator('#volume').fill('0'); await page.locator('#volume').dispatchEvent('input')
    await page.locator('#record-audio').click(); await page.waitForTimeout(1100); await page.locator('#stop').click()
    await page.waitForFunction(() => __CreatorPrototype.takes.length === 3)
    assert.match(await page.locator('#status').innerText(), /no music/)
    await page.locator('#record-audio').click(); assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 3); assert.match(await page.locator('#status').innerText(), /Three takes/)
    await page.locator('#takes button', {hasText: 'Remove take'}).last().click(); assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 2)
    pass('silence warning, bounded three-take memory, explicit removal; prior bytes retained')
    await page.evaluate(() => { __creatorControls.cameraMode = 'pending' })
    await page.locator('#record-video').click(); await page.waitForFunction(() => Boolean(__creatorControls.resolveCamera))
    await page.locator('#stop').click(); await page.waitForFunction(() => !document.querySelector('#record-audio').disabled)
    assert.match(await page.locator('#status').innerText(), /cancelled/)
    if (await page.evaluate(() => typeof document.createElement('canvas').captureStream === 'function')) {
      await page.evaluate(() => __creatorControls.resolveCamera())
      await page.waitForFunction(() => __creatorControls.fixtureTracks.every(track => track.readyState === 'ended') && __creatorControls.fixtureTimers.size === 0)
      pass('cancel permission while pending, late camera stream released, previous takes kept')
      await page.evaluate(() => { __creatorControls.cameraMode = 'success' })
      await page.locator('#takes button', {hasText: 'Remove take'}).last().click()
      const mp4Expected = await page.evaluate(() => MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2'))
      const videoAudio = {}
      for (const [label, voice, volume] of [['synth', false, '70'], ['mic-only', true, '0'], ['synth-and-mic', true, '70']]) {
        if (label !== 'synth') await page.locator('#takes button', {hasText: 'Remove take'}).last().click()
        await page.locator('#voice').setChecked(voice)
        await page.locator('#volume').fill(volume); await page.locator('#volume').dispatchEvent('input')
        await page.locator('#record-video').click(); await page.waitForFunction(() => __CreatorPrototype.capture?.kind === 'video' && !document.querySelector('#stop').disabled)
        if (volume !== '0') await page.locator('#example').click()
        await page.waitForTimeout(3400); await page.locator('#stop').click(); await page.waitForFunction(() => !__CreatorPrototype.capture)
        const observed = await page.evaluate(async () => {
          const take = __CreatorPrototype.takes.at(-1), bytes = await take.file.arrayBuffer()
          return {bytes: Array.from(new Uint8Array(bytes)), mime: take.file.type, seconds: take.seconds, trackStates: __creatorControls.fixtureTracks.map(track => track.readyState), timers: __creatorControls.fixtureTimers.size}
        })
        const extension = observed.mime.includes('mp4') ? 'mp4' : 'webm', filename = path.join(output, `video-${label}.${extension}`)
        fs.writeFileSync(filename, Buffer.from(observed.bytes))
        assert(observed.bytes.length > 1000); assert(observed.trackStates.every(state => state === 'ended')); assert.equal(observed.timers, 0)
        const probe = JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', filename], {encoding: 'utf8', timeout: 10000}))
        report.videoFormats ||= {}; report.videoFormats[label] = {mime: observed.mime, bytes: observed.bytes.length, sha256: hash(Buffer.from(observed.bytes)), probe}; save()
        assert(probe.streams.some(stream => stream.codec_type === 'video' && stream.width === 240 && stream.height === 320)); assert(probe.streams.some(stream => stream.codec_type === 'audio'))
        if (mp4Expected) {
          assert.equal(probe.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264', 'Use explicit H.264 when the browser can encode it; bare MP4 may select VP9')
          assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac', 'Use explicit AAC when the browser can encode it')
        }
        const pcm = execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', filename, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], {timeout: 10000, maxBuffer: 3000000})
        const samples = Float32Array.from({length: pcm.length / 4}, (_, i) => pcm.readFloatLE(i * 4))
        const metrics = creatorFixtureMetrics(samples, 48000), {rms, peak} = metrics
        assert(rms > .001); assert(peak < .999)
        videoAudio[label] = metrics; report.videoAudio = videoAudio; save()
        if (label === 'synth-and-mic') {
          const baseline = {synth: videoAudio.synth, micOnly: videoAudio['mic-only']}
          const bothPresent = metrics => creatorFixtureHasBoth(metrics, baseline)
          assert(bothPresent(videoAudio[label]), 'Final file must retain music and the known microphone signal together')
          assert(!bothPresent(videoAudio.synth), 'Missing microphone control must be rejected')
          assert(!bothPresent(videoAudio['mic-only']), 'Missing music control must be rejected')
          assert(!bothPresent(creatorFixtureMetrics(samples.map(x => 0), 48000)), 'Silence control must be rejected')
          assert(!bothPresent({...videoAudio['mic-only'], windows: videoAudio['mic-only'].windows.map(({music, mic310}) => ({music: music * 2, mic310: mic310 * 2}))}), 'Louder microphone without music must be rejected')
          assert(!bothPresent({...metrics, windows: [...videoAudio.synth.windows, ...videoAudio['mic-only'].windows]}), 'Non-overlapping sources must be rejected')
          pass('simultaneous music/microphone fixture retained; missing-source, loud-mic-only and silence controls rejected')
        }
        report.checks.push({name: 'native encoded video: ' + label, mime: observed.mime, bytes: observed.bytes.length, sha256: hash(Buffer.from(observed.bytes)), rms, probe})
        await page.locator('#takes video').last().evaluate(video => video.play()); await page.waitForTimeout(350)
        assert(await page.locator('#takes video').last().evaluate(video => video.currentTime > 0 && video.videoWidth === 240)); save()
      }
      pass('camera+synth and optional mic → actual video files → ffmpeg decode + browser playback; no physical camera/mic claim')
      await page.locator('#takes button', {hasText: 'Remove take'}).last().click()
      await page.evaluate(() => {
        window.__oldPlay = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function() { return this.id === 'preview' ? new Promise(() => {}) : window.__oldPlay.call(this) }
      })
      await page.locator('#record-video').click(); await page.waitForFunction(() => __CreatorPrototype.capture?.kind === 'video')
      await page.locator('#stop').click(); await page.waitForFunction(() => !document.querySelector('#record-audio').disabled)
      assert.equal(await page.evaluate(() => Boolean(__CreatorPrototype.capture)), false)
      await page.waitForFunction(() => __creatorControls.fixtureTracks.every(track => track.readyState === 'ended'))
      await page.evaluate(() => { HTMLMediaElement.prototype.play = window.__oldPlay })
      pass('cancel interrupts a pending camera preview and closes video/mic tracks')
      await page.evaluate(() => {
        window.__NativeRecorder = MediaRecorder
        window.MediaRecorder = class extends window.__NativeRecorder { constructor() { throw Error('Injected recorder constructor failure') } }
      })
      await page.locator('#record-video').click(); await page.waitForFunction(() => !document.querySelector('#record-audio').disabled)
      assert.match(await page.locator('#status').innerText(), /constructor failure/)
      await page.waitForFunction(() => __creatorControls.fixtureTracks.every(track => track.readyState === 'ended'))
      await page.evaluate(() => { window.MediaRecorder = window.__NativeRecorder })
      pass('recorder constructor failure closes allocated streams and retains prior files')
    } else {
      report.checks.push({name: 'synthetic canvas camera fixture', status: 'NOT_SUPPORTED', scope: 'No verdict on actual camera support'})
    }
    // Held-key blur must be represented in replay, not just the original audio.
    while (await page.evaluate(() => __CreatorPrototype.takes.length > 1)) await page.locator('#takes button', {hasText: 'Remove take'}).last().click()
    await page.locator('#volume').fill('70'); await page.locator('#volume').dispatchEvent('input')
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    await page.keyboard.down('KeyA'); await page.waitForTimeout(350); await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(350); await page.locator('#stop').click(); await page.waitForFunction(() => __CreatorPrototype.takes.length === 2)
    assert(await page.evaluate(() => __CreatorPrototype.takes.at(-1).events.some(event => event.type === 'panic')))
    await page.locator('#repeat').click(); await page.waitForTimeout(3000); assert.equal(await page.evaluate(() => __CreatorPrototype.engine.activeVoiceCount), 0)
    pass('held-key/blur performance has an explicit stop and replay ends with zero active voices')
    await page.locator('#takes button', {hasText: 'Remove take'}).last().click()
    await page.reload({waitUntil: 'networkidle'})
    // Init scripts deliberately remove native API again. Install the fake provider only on this page.
    await page.evaluate(() => {
      const input = {id: 'fixture-biotron', name: 'Biotron controlled fixture', state: 'connected', async open() { return this }, async close() { __creatorControls.closed = true; return this }}
      const access = {inputs: new Map([[input.id, input]])}; Object.defineProperty(access, 'outputs', {get() { throw Error('MIDI output touched') }})
      __creatorControls.input = input; __creatorControls.access = access
      Object.defineProperty(navigator, 'requestMIDIAccess', {value: async options => { __creatorControls.midi++; if (options.sysex !== false) throw Error('SysEx permission'); return access }, configurable: true})
    })
    await page.locator('#example').click(); await page.locator('#example').click()
    await page.locator('#connect').click(); await page.waitForFunction(() => typeof __creatorControls.input.onmidimessage === 'function')
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    await page.evaluate(() => __creatorControls.input.onmidimessage({data: [0x91, 64, 97]})); await page.waitForTimeout(500)
    await page.evaluate(() => __creatorControls.input.onmidimessage({data: [0x81, 64, 0]})); await page.waitForTimeout(500)
    await page.locator('#stop').click(); await page.waitForFunction(() => __CreatorPrototype.takes.length === 1)
    assert.deepEqual(await page.evaluate(() => __CreatorPrototype.takes[0].events.filter(event => event.type === 'on').map(({note, channel, velocity}) => ({note, channel, velocity}))), [{note: 64, channel: 1, velocity: 97}])
    await page.evaluate(() => { __creatorControls.cameraMode = 'pending' })
    await page.locator('#record-video').click(); await page.waitForFunction(() => typeof __creatorControls.resolveCamera === 'function')
    await page.evaluate(() => { __creatorControls.input.state = 'disconnected'; __creatorControls.access.onstatechange({port: __creatorControls.input}) })
    await page.waitForFunction(() => __creatorControls.closed && !document.querySelector('#record-audio').disabled)
    assert.equal(await page.evaluate(() => __creatorControls.input.onmidimessage), null)
    if (await page.evaluate(() => typeof document.createElement('canvas').captureStream === 'function')) {
      await page.evaluate(() => __creatorControls.resolveCamera()); await page.waitForFunction(() => __creatorControls.fixtureTracks.every(track => track.readyState === 'ended'))
    }
    assert.equal(await page.evaluate(() => __creatorControls.midi), 1)
    pass('controlled Biotron input preserves channel/note/velocity, no outputs/SysEx; busy permission disconnect detaches and releases')
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    await page.evaluate(() => { __CreatorPrototype.capture.tap.port.postMessage = () => {} })
    await page.locator('#stop').click(); await page.waitForFunction(() => !document.querySelector('#record-audio').disabled, null, {timeout: 8000})
    assert.match(await page.locator('#status').innerText(), /finalization timed out/); assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 1)
    pass('missing stop acknowledgement times out visibly and retains the old take')
    for (const action of ['disconnect', 'release']) {
      await page.evaluate(() => { __creatorControls.input.state = 'connected'; __creatorControls.closed = false })
      await page.locator('#connect').click(); await page.waitForFunction(() => typeof __creatorControls.input.onmidimessage === 'function')
      await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
      await page.evaluate(() => { __CreatorPrototype.capture.tap.port.postMessage = () => {} })
      if (action === 'disconnect') await page.evaluate(() => { __creatorControls.input.state = 'disconnected'; __creatorControls.access.onstatechange({port: __creatorControls.input}) })
      else await page.locator('#release').click()
      await page.waitForFunction(() => !document.querySelector('#record-audio').disabled, null, {timeout: 8000})
      assert.match(await page.locator('#status').innerText(), /finalization timed out/)
      assert(await page.evaluate(() => __creatorControls.closed && __creatorControls.input.onmidimessage === null))
      assert.equal(await page.evaluate(() => __CreatorPrototype.takes.length), 1)
    }
    pass('disconnect and explicit release close controlled MIDI inputs even when capture finalization fails; first timeout and prior take survive')
    await page.evaluate(() => { __creatorControls.input.state = 'connected' })
    await page.locator('#connect').click(); await page.waitForFunction(() => typeof __creatorControls.input.onmidimessage === 'function')
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    await page.evaluate(() => { for (let i = 0; i < 2001; i++) __creatorControls.input.onmidimessage({data: [0xe0, i % 128, 64]}) })
    await page.waitForTimeout(300); await page.locator('#stop').click(); await page.waitForFunction(() => __CreatorPrototype.takes.length === 2)
    assert.match(await page.locator('#status').innerText(), /Repeat unavailable/); assert(await page.locator('#repeat').isDisabled())
    assert.equal(await page.evaluate(() => __CreatorPrototype.takes.at(-1).events.length), 2000)
    assert(await page.evaluate(async () => (await __CreatorPrototype.takes.at(-1).file.arrayBuffer()).byteLength > 44))
    await page.locator('#takes button', {hasText: 'Remove take'}).last().click(); await page.locator('#release').click()
    pass('2001 controlled events keep a playable file but disable incomplete performance replay; event memory remains bounded')
    await page.locator('#record-audio').click(); await page.waitForFunction(() => __CreatorPrototype.capture)
    await page.waitForFunction(() => __CreatorPrototype.takes.length === 2 && !__CreatorPrototype.capture, null, {timeout: 35000})
    assert(await page.evaluate(() => __CreatorPrototype.takes.at(-1).seconds >= 30 && __CreatorPrototype.takes.at(-1).seconds < 30.1))
    pass('actual audio-clock 30-second cap finalizes a bounded WAV without operator action')
    const resumeCancel = await page.evaluate(() => { window.__oldResume = __CreatorPrototype.engine.resume; __CreatorPrototype.engine.resume = () => new Promise(() => {}); return true })
    assert(resumeCancel); await page.locator('#record-audio').click(); await page.locator('#stop').click()
    await page.waitForFunction(() => !document.querySelector('#record-audio').disabled); assert.match(await page.locator('#status').innerText(), /cancelled/)
    pass('cancel interrupts a pending resume; owned context closes')
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})))
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})))
    assert(await page.evaluate(async () => { const response = await fetch(__CreatorPrototype.takes[0].url); return response.ok && (await response.arrayBuffer()).byteLength > 44 }))
    pass('controlled BFCache lifecycle keeps completed take URLs readable; native BFCache remains unverified')
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 900})
      for (const item of await page.locator('details').all()) await item.evaluate(element => { element.open = true })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'viewport overflow')
      assert.equal(await page.locator('main').count(), 1)
      await page.screenshot({path: path.join(output, `ui-${width}.png`), timeout: 3000})
    }
    pass('320/390/1440 layout, expanded explanations, native labels and viewport screenshots')
    await browserCall(browser, () => page.evaluate(() => __CreatorPrototype.close()), 'creator close')
    assert.equal(await page.evaluate(() => __CreatorPrototype.engine.context.state), 'closed'); assert.equal(await page.evaluate(() => __CreatorPrototype.engine.core._timer), null)
    assert.deepEqual(errors, []); report.status = 'PASS_SCOPED'; save()
  } catch (error) {
    report.status = 'FAIL'; report.firstFault = {message: String(error), stack: error.stack, errors}; save()
    if (page) await page.screenshot({path: path.join(output, 'first-fault.png'), timeout: 2000}).catch(() => {})
    throw error
  } finally {
    if (context && browser?.isConnected()) await browserCall(browser, () => context.tracing.stop({path: path.join(output, 'trace.zip')}), 'creator trace', 10000).catch(error => { report.traceError = String(error) })
    if (browser) await browser.close()
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    save()
  }
}

async function testRealtimeCapture() {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const crypto = await import('node:crypto')
  const {execFileSync} = await import('node:child_process')
  const {createRequire} = await import('node:module')
  const {fileURLToPath} = await import('node:url')
  const require = createRequire(import.meta.url)
  const {launchBrowser, browserCall, createStaticServer} = require('../browser-test-harness.js')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const parent = process.env.BIOTRON_QA_OUTPUT || os.tmpdir()
  const output = fs.mkdtempSync(path.join(parent, 'audio-realtime-'))
  const bench = path.join(output, 'bench')
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const report = {
    status: 'RUNNING', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}),
    platform: process.platform, cases: [], loadOnly: process.argv.includes('--load'), creatorOnly: process.argv.includes('--creator-recording'),
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
    browser = await launchBrowser({ignoreDefaultArgs: ['--mute-audio']})
    report.browser = browser.version()
    context = await browser.newContext()
    await context.tracing.start({screenshots: true, snapshots: true, sources: true})
    await context.addInitScript(() => {
      const intervals = new Set(), blobs = new Set(), frames = new Set(), contexts = [], tracks = []
      window.__captureResources = {intervals, blobs, frames, contexts, tracks, midiRequests: 0, microphoneRequests: 0}
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
        createMediaStreamDestination() { const sink = super.createMediaStreamDestination(); tracks.push(...sink.stream.getTracks()); return sink }
      }
      navigator.requestMIDIAccess = () => { window.__captureResources.midiRequests++; throw Error('Audio bench must not open MIDI') }
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__captureResources.microphoneRequests++; throw Error('Audio bench must not open microphone/camera') }
    })
    page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    for (const mode of report.loadOnly || report.creatorOnly ? [] : ['normal', 'mute', 'stuck']) {
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
    if (report.creatorOnly) {
      const capability = await page.evaluate(() => ({available: typeof MediaRecorder !== 'undefined',
        formats: ['audio/webm;codecs=opus', 'audio/mp4'].filter(mime => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime))}))
      report.recordingCapability = capability; save()
      assert(capability.available && capability.formats.length, 'no supported recording format; route remains unsupported')
      const requested = process.env.BIOTRON_QA_RECORD_MIME
      const formats = requested === undefined ? capability.formats : capability.formats.filter(mime => mime === requested)
      report.requestedRecordingFormat = requested ?? null; save()
      assert(formats.length, 'requested format is not supported; no automatic substitution')
      const unsupported = await page.evaluate(async () => {
        const before = window.__captureResources.contexts.length
        try { await window.__CaptureScore(window.__ElemEngine.ElementarySynthEngine, 'normal', undefined, 'audio/x-unsupported-biotron'); return false }
        catch (error) { return error.message === 'Recording format not supported' && before === window.__captureResources.contexts.length }
      })
      assert(unsupported, 'unsupported format must fail before creating audio resources')
      report.recordingControls = await browserCall(browser, () => page.evaluate(async mime => {
        const Native = window.MediaRecorder, controls = []
        window.MediaRecorder = class extends Native { constructor(...args) { super(...args); throw Error('Injected encoder constructor failure') } }
        try { await window.__CaptureScore(window.__ElemEngine.ElementarySynthEngine, 'normal', undefined, mime); controls.push({name: 'constructor', detected: false}) }
        catch (error) { controls.push({name: 'constructor', detected: error.message === 'Injected encoder constructor failure'}) }
        finally { window.MediaRecorder = Native }
        for (const failCleanup of [false, true]) {
          const controller = new AbortController(); let timer, started = false
          const nativeSink = AudioContext.prototype.createMediaStreamDestination
          if (failCleanup) AudioContext.prototype.createMediaStreamDestination = function () {
            const sink = nativeSink.call(this); sink.disconnect = () => { throw Error('Injected sink cleanup failure') }; return sink
          }
          window.MediaRecorder = class extends Native {
            start(...args) { super.start(...args); started = true; timer = setTimeout(() => controller.abort(), 1200) }
          }
          try { await window.__CaptureScore(window.__ElemEngine.ElementarySynthEngine, 'normal', controller.signal, mime); controls.push({name: 'abort', detected: false}) }
          catch (error) { controls.push({name: failCleanup ? 'first-fault-retained-on-cleanup-failure' : 'abort-after-recorder-start',
            detected: started && error.name === 'AbortError' && (failCleanup ? error.cleanupFailure?.includes('Injected sink cleanup failure') : !error.cleanupFailure)}) }
          finally { clearTimeout(timer); window.MediaRecorder = Native; AudioContext.prototype.createMediaStreamDestination = nativeSink }
        }
        return {controls, intervals: window.__captureResources.intervals.size, blobs: window.__captureResources.blobs.size,
          contextStates: window.__captureResources.contexts.map(c => c.state), trackStates: window.__captureResources.tracks.map(t => t.readyState)}
      }, formats[0]), 'creator fault controls'); save()
      assert(report.recordingControls.controls.every(row => row.detected), 'capture must retain the original constructor/abort failure')
      assert.equal(report.recordingControls.intervals, 0); assert.equal(report.recordingControls.blobs, 0)
      assert(report.recordingControls.contextStates.every(state => state === 'closed'))
      assert(report.recordingControls.trackStates.every(state => state === 'ended'))
      for (const mime of formats) for (const mode of ['normal', 'mute']) {
        const observed = await browserCall(browser, () => page.evaluate(async ({mime, mode}) => {
          const data = await window.__CaptureScore(window.__ElemEngine.ElementarySynthEngine, mode, undefined, mime)
          const base64 = bytes => { const view = new Uint8Array(bytes); let binary = ''; for (let i = 0; i < view.length; i += 8192) binary += String.fromCharCode(...view.subarray(i, i + 8192)); return btoa(binary) }
          const {bytes, ...metadata} = data.recording
          return {report: data.report, metadata, encoded: base64(bytes), referenceWav: base64(data.wav)}
        }, {mime, mode}), 'creator capture')
        const name = `${mime.startsWith('audio/mp4') ? 'mp4' : 'webm'}-${mode}`
        const encoded = Buffer.from(observed.encoded, 'base64'), reference = Buffer.from(observed.referenceWav, 'base64')
        fs.writeFileSync(path.join(output, `${name}.${mime.startsWith('audio/mp4') ? 'm4a' : 'webm'}`), encoded)
        fs.writeFileSync(path.join(output, `${name}-reference.wav`), reference)
        // Decoder failure must not discard the very file being diagnosed.
        const row = {mime, mode, report: observed.report, metadata: observed.metadata, reopenedStatus: 'PENDING',
          encodedSha256: hash(encoded), referenceSha256: hash(reference)}
        report.cases.push(row); save()
        const reopened = await browserCall(browser, () => page.evaluate(async encoded => {
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer
          const base64 = bytes => { const view = new Uint8Array(bytes); let binary = ''; for (let i = 0; i < view.length; i += 8192) binary += String.fromCharCode(...view.subarray(i, i + 8192)); return btoa(binary) }
          const decode = new AudioContext({sampleRate: 48000})
          try {
            const audio = await decode.decodeAudioData(bytes.slice(0))
            let damagedRejected = false
            try { await decode.decodeAudioData(bytes.slice(0, 32)) } catch (_) { damagedRejected = true }
            return {decoded: {sampleRate: audio.sampleRate, duration: audio.duration, channels: Array.from({length: audio.numberOfChannels}, (_, c) => base64(audio.getChannelData(c).buffer))}, damagedRejected}
          } finally { await decode.close() }
        }, observed.encoded), 'creator reopen')
        const channels = reopened.decoded.channels.map(value => { const b = Buffer.from(value, 'base64'); return Float32Array.from({length: b.length / 4}, (_, i) => b.readFloatLE(i * 4)) })
        const checked = analyze(channels, reopened.decoded.sampleRate)
        const resources = await page.evaluate(() => ({intervals: window.__captureResources.intervals.size, blobs: window.__captureResources.blobs.size,
          contextStates: window.__captureResources.contexts.map(c => c.state), trackStates: window.__captureResources.tracks.map(t => t.readyState),
          midiRequests: window.__captureResources.midiRequests, microphoneRequests: window.__captureResources.microphoneRequests}))
        Object.assign(row, {decoded: {...reopened.decoded, channels: channels.length}, reopenedStatus: 'DECODED',
          reopenedAnalysis: checked, damagedRejected: reopened.damagedRejected, resources}); save()
        assert.equal(encoded.length, observed.metadata.size); assert(encoded.length > 32, 'empty recording')
        assert.equal(observed.metadata.finalizedBeforeContextClose, true, 'finalize before closing synth')
        assert.equal(observed.report.result, 'PASS', 'final gain reference capture must pass its fixture')
        assert.equal(checked.result, mode === 'normal' ? 'PASS' : 'FAIL', 'reopened file must detect silent capture')
        if (mode === 'mute') assert(checked.reasons.includes('MISSING_SIGNAL'))
        else assert(Math.abs(checked.metrics[0].signalRms / observed.report.analysis.metrics[0].signalRms - 1) < .25, 'encoded take must retain reference level')
        assert(reopened.damagedRejected, 'truncated file must be rejected')
        assert.equal(resources.intervals, 0); assert.equal(resources.blobs, 0)
        assert(resources.contextStates.every(state => state === 'closed'))
        assert(resources.trackStates.every(state => state === 'ended'))
        assert.equal(resources.midiRequests, 0); assert.equal(resources.microphoneRequests, 0)
        assert.deepEqual(pageErrors, [])
      }
      report.recordingScope = 'Local native-codec feasibility and fresh AudioContext reopen; no editor import, native phone, speaker, camera, Share, running Play recorder or completed video proof'
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
    console.log(report.creatorOnly ? 'PASS: encoded final-gain takes, fresh decode, silent/truncated controls and cleanup' : report.loadOnly ? 'PASS: Garden renderer, audio oracles at 0/4/10ms contention, host frame metrics and cleanup' : 'PASS: actual real-time PCM, silence/stuck-note mutations, downloaded WAV and repeated capture cleanup')
  } catch (error) {
    report.status = 'FAIL'
    report.error = {message: String(error), stack: error.stack, cleanupFailure: error.cleanupFailure ?? null, pageErrors}
    const pending = report.cases.at(-1)
    if (pending?.reopenedStatus === 'PENDING') pending.reopenedStatus = 'FAILED'
    save() // The first failure survives a hanging screenshot or cleanup.
    if (page) await page.screenshot({path: path.join(output, 'first-fault.png'), timeout: 2000}).catch(() => {})
    throw error
  } finally {
    save()
    if (context) await context.tracing.stop({path: path.join(output, 'trace.zip')}).catch(() => {})
    if (browser) await browser.close()
    if (server?.listening) await new Promise(resolve => server.close(resolve))
  }
}
