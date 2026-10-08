const assert = require('assert')
const crypto = require('crypto')
const {execFileSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {chromium, devices} = require('playwright-core')
const {chromePath, createStaticServer} = require('./browser-test-harness')

const root = path.resolve(__dirname, '..', 'dist')

const soakArgument = process.argv.find(argument => argument.startsWith('--soak-seconds='))
const realtimeSoakSeconds = soakArgument ? Number(soakArgument.split('=')[1]) : 0
assert(Number.isInteger(realtimeSoakSeconds) && realtimeSoakSeconds >= 0 && realtimeSoakSeconds <= 28800,
  '--soak-seconds must be a whole number from 0 to 28800')
const soakReportArgument = process.argv.find(argument => argument.startsWith('--soak-report='))
const soakReportPath = soakReportArgument
  ? path.resolve(process.cwd(), soakReportArgument.slice('--soak-report='.length))
  : ''
assert(!soakReportArgument || soakReportPath !== process.cwd(), '--soak-report requires a file path')
assert(!soakReportPath || realtimeSoakSeconds > 0, '--soak-report requires --soak-seconds greater than 0')
assert(!soakReportPath || fs.existsSync(path.dirname(soakReportPath)),
  '--soak-report parent directory must already exist')

function hashDirectory(directory) {
  const hash = crypto.createHash('sha256')
  const visit = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(directory, absolute)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        hash.update(relative)
        hash.update('\0')
        hash.update(fs.readFileSync(absolute))
        hash.update('\0')
      }
    }
  }
  visit(directory)
  return hash.digest('hex')
}

const evidenceContext = soakReportPath ? {
  sourceCommit: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  sourceDirty: Boolean(execFileSync('/usr/bin/git', ['status', '--porcelain'], {encoding: 'utf8'}).trim()),
  distTreeSha256: hashDirectory(root),
  browserExecutable: path.basename(chromePath()),
  platform: process.platform,
  platformRelease: os.release(),
  architecture: process.arch
} : null
let latestRealtimeSoak = null

function writeSoakEvidence(status, phase, report = latestRealtimeSoak, error = null) {
  if (!soakReportPath) return
  const payload = {
    schemaVersion: 1,
    status,
    phase,
    recordedAt: new Date().toISOString(),
    ...evidenceContext,
    report,
    error: error ? {name: error.name || 'Error', message: error.message || String(error)} : null
  }
  const temporary = `${soakReportPath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {mode: 0o600})
    fs.renameSync(temporary, soakReportPath)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

const server = createStaticServer(root)

async function openSoundHelp(page) {
  const summary = page.getByText('No sound? · Help', {exact: true})
  const details = page.locator('details.play-help').filter({has: summary})
  const visual = page.locator('.garden-visual')
  const top = await visual.evaluate(element => element.getBoundingClientRect().top + scrollY)
  if (!(await details.evaluate(element => element.open))) await summary.click()
  assert(Math.abs(await visual.evaluate(element => element.getBoundingClientRect().top + scrollY) - top) <= 1,
    'Opening sound help shifted the visual in the document')
}

async function verifyCapabilityFallbacks(browser, origin) {
  const audioOnlyContext = await browser.newContext()
  audioOnlyContext.setDefaultTimeout(5000)
  await audioOnlyContext.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: undefined})
  })
  const audioOnly = await audioOnlyContext.newPage()
  const audioOnlyErrors = []
  audioOnly.on('pageerror', error => audioOnlyErrors.push(error.message))
  await audioOnly.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
  await audioOnly.locator('.sound-lab[data-audio-capability="available"][data-midi-capability="unavailable"]').waitFor()
  await audioOnly.getByRole('heading', {name: 'USB device connection isn’t available here'}).waitFor()
  await audioOnly.getByText(/still try every sound with your keyboard or screen/i).waitFor()
  assert.strictEqual(await audioOnly.locator('.sound-lab__midi').count(), 0)
  assert.strictEqual(await audioOnly.getByRole('button', {name: 'Find MIDI device'}).count(), 0)
  await audioOnly.getByRole('button', {name: 'Start sound'}).click()
  await audioOnly.locator('.sound-lab[data-audio-state="running"]').waitFor()
  await audioOnly.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'a'})
  await audioOnly.locator('.sound-lab[data-active-voices="1"]').waitFor()
  await audioOnly.dispatchEvent('body', 'keyup', {code: 'KeyA', key: 'a'})
  await audioOnly.getByRole('button', {name: 'Stop & release'}).click()
  await audioOnly.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await audioOnly.getByRole('button', {name: 'Play with keyboard', exact: true}).click()
  await audioOnly.locator('.sound-lab[data-audio-state="running"][data-keyboard="on"]').waitFor()
  assert.strictEqual(await audioOnly.getByRole('button', {name: 'Start listening'}).isDisabled(), true)
  await audioOnly.getByRole('button', {name: 'Stop keyboard', exact: true}).click()
  for (const [route, product] of [
    ['/biotron', 'Biotron'], ['/biotron/update', 'Biotron'],
    ['/touchme', 'TouchMe'], ['/playtron', 'Playtron'],
    ['/scales', 'Scales'], ['/circle', 'Circle'], ['/scala', 'Playtronica device']
  ]) {
    await audioOnly.goto(`${origin}/#${route}`, {waitUntil: 'domcontentloaded'})
    await audioOnly.getByRole('heading', {name: 'No MIDI in this browser'}).waitFor()
    await audioOnly.getByText(`${product} connects over Web MIDI`).waitFor()
    assert.strictEqual(await audioOnly.getByText('Select Device', {exact: true}).count(), 0)
  }
  assert.deepStrictEqual(audioOnlyErrors, [])
  await audioOnlyContext.close()

  // Android Chrome: full device profile (UA, screen, touch) and real Web MIDI with both permissions granted.
  // Reddens if the gate judges by device name again: beta21 showed «Biotron needs a computer» here (05.09.2026).
  const androidContext = await browser.newContext({...devices['Pixel 7'], permissions: ['midi', 'midi-sysex']})
  androidContext.setDefaultTimeout(5000)
  const android = await androidContext.newPage()
  const androidErrors = []
  android.on('pageerror', error => androidErrors.push(error.message))
  await android.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await android.getByRole('heading', {name: 'Settings'}).waitFor()
  assert.strictEqual(await android.locator('.compatibility-notice').count(), 0)
  await android.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await android.getByRole('button', {name: 'Start listening'}).waitFor()
  assert.strictEqual(await android.locator('.compatibility-notice').count(), 0)
  await android.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
  assert.strictEqual(await android.locator('.compatibility-notice').count(), 0)
  assert.strictEqual(await android.locator('.sound-lab__midi').count(), 1)
  await android.getByRole('button', {name: 'Start sound'}).tap()
  await android.locator('.sound-lab[data-audio-state="running"]').waitFor()
  await android.getByRole('button', {name: 'Stop & release'}).tap()
  assert.deepStrictEqual(androidErrors, [])
  await androidContext.close()

  const deniedContext = await browser.newContext()
  deniedContext.setDefaultTimeout(5000)
  await deniedContext.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError') }
    })
  })
  const denied = await deniedContext.newPage()
  const deniedErrors = []
  denied.on('pageerror', error => deniedErrors.push(error.message))
  await denied.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
  await denied.getByRole('button', {name: 'Start sound'}).click()
  await denied.locator('.sound-lab[data-audio-state="running"]').waitFor()
  await denied.getByRole('button', {name: 'Find MIDI device'}).click()
  await denied.getByText(/Allow device access, then try again/i).waitFor()
  await denied.getByRole('button', {name: 'Stop & release'}).click()
  await denied.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await denied.getByRole('button', {name: 'Start listening'}).click()
  await denied.getByText(/Allow device access, then try again/i).waitFor()
  await denied.locator('.sound-lab[data-audio-state="closed"][data-tab-lease="free"]').waitFor()
  assert.deepStrictEqual(deniedErrors, [])
  await deniedContext.close()

  const missingContext = await browser.newContext()
  missingContext.setDefaultTimeout(5000)
  await missingContext.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}})
    })
  })
  const missing = await missingContext.newPage()
  await missing.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await missing.getByRole('button', {name: 'Start listening'}).click()
  await missing.getByText('Connect the device', {exact: true}).waitFor()
  await missing.getByText(/Connect the device to this computer with a USB data cable/i).waitFor()
  assert.strictEqual(await missing.getByRole('button', {name: 'Stop notes'}).count(), 0)
  await missing.locator('.sound-lab[data-reveal-stage="intro"][data-audio-state="closed"][data-tab-lease="free"]').waitFor()
  await missingContext.close()

  const noAudioContext = await browser.newContext()
  noAudioContext.setDefaultTimeout(5000)
  await noAudioContext.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', {configurable: true, value: undefined})
    Object.defineProperty(window, 'webkitAudioContext', {configurable: true, value: undefined})
    Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => ({inputs: new Map()})})
  })
  const noAudio = await noAudioContext.newPage()
  const noAudioErrors = []
  noAudio.on('pageerror', error => noAudioErrors.push(error.message))
  await noAudio.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
  await noAudio.getByRole('heading', {name: 'Sound can’t start in this browser'}).waitFor()
  assert.strictEqual(await noAudio.getByRole('button', {name: 'Start sound'}).count(), 0)
  assert.strictEqual(await noAudio.locator('.sound-lab').count(), 0)
  await noAudio.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await noAudio.getByRole('heading', {name: 'Sound can’t start in this browser'}).waitFor()
  assert.strictEqual(await noAudio.getByRole('button', {name: 'Start listening'}).count(), 0)
  assert((await noAudio.getByRole('link', {name: 'Tell Andrey where it stopped'}).getAttribute('href')).includes('Reached%3A%20Compatibility%3A%20audio'))
  assert.deepStrictEqual(noAudioErrors, [])
  await noAudioContext.close()

  // Safari profile without MIDI: Settings still explains USB recovery; Play offers screen/keyboard audio.
  const iphoneContext = await browser.newContext(devices['iPhone 15'])
  iphoneContext.setDefaultTimeout(5000)
  await iphoneContext.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: undefined})
  })
  const iphone = await iphoneContext.newPage()
  const iphoneErrors = []
  iphone.on('pageerror', error => iphoneErrors.push(error.message))
  await iphone.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await iphone.getByRole('heading', {name: 'No MIDI in this browser'}).waitFor()
  const midiWebLink = iphone.getByRole('link', {name: 'Get MIDIWeb Browser'})
  await midiWebLink.waitFor()
  assert.strictEqual(await midiWebLink.getAttribute('href'), 'https://apps.apple.com/us/app/midiweb-browser/id6757226617')
  assert.strictEqual(await iphone.getByRole('heading', {name: 'Settings'}).count(), 0)
  await iphone.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await iphone.getByRole('button', {name: 'Play with keyboard', exact: true}).waitFor()
  assert(await iphone.getByRole('button', {name: 'Start listening'}).isDisabled())
  await iphone.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
  await iphone.getByRole('heading', {name: 'USB device connection isn’t available here'}).waitFor()
  await iphone.getByRole('link', {name: 'Get MIDIWeb Browser'}).waitFor()
  assert.strictEqual(await iphone.locator('.sound-lab__midi').count(), 0)
  assert.strictEqual(await iphone.getByRole('button', {name: 'Start sound'}).isEnabled(), true)
  assert.deepStrictEqual(iphoneErrors, [])
  await iphoneContext.close()
}

function heapSlopeBytesPerMinute(samples) {
  if (samples.length < 2) return 0
  const meanTime = samples.reduce((sum, sample) => sum + sample.elapsedMilliseconds, 0) / samples.length
  const meanHeap = samples.reduce((sum, sample) => sum + sample.heapBytes, 0) / samples.length
  const numerator = samples.reduce((sum, sample) =>
    sum + (sample.elapsedMilliseconds - meanTime) * (sample.heapBytes - meanHeap), 0)
  const denominator = samples.reduce((sum, sample) =>
    sum + (sample.elapsedMilliseconds - meanTime) ** 2, 0)
  return denominator ? numerator / denominator * 60000 : 0
}

async function runRealtimeSoak(page, devtools, seconds, browserVersion) {
  if (!seconds) return null
  const metric = (list, name) => list.find(item => item.name === name)?.value || 0
  await devtools.send('Performance.enable')
  await devtools.send('HeapProfiler.collectGarbage')
  const startHeap = metric((await devtools.send('Performance.getMetrics')).metrics, 'JSHeapUsedSize')
  const startedAt = Date.now()
  const startAudioTime = await page.evaluate(() => window.__soundContext.currentTime)
  const sampleIntervalMilliseconds = Math.min(30000, Math.max(5000, Math.round(seconds * 1000 / 20)))
  let nextSampleAt = startedAt + sampleIntervalMilliseconds
  const heapSamples = [{elapsedMilliseconds: 0, heapBytes: startHeap}]
  let cycles = 0
  let maxCycleMilliseconds = 0
  latestRealtimeSoak = {browser: browserVersion, requestedSeconds: seconds, elapsedMilliseconds: 0, cycles: 0}
  writeSoakEvidence('RUNNING', 'realtime-soak')
  while (Date.now() - startedAt < seconds * 1000) {
    const cycleStarted = performance.now()
    await page.evaluate(() => {
      for (let note = 48; note < 56; note += 1) window.__emitSoundMidi([0x90, note, 88])
      for (let note = 48; note < 56; note += 1) window.__emitSoundMidi([0x80, note, 0])
      window.__emitSoundMidi([0xb0, 123, 0])
    })
    await page.locator('.sound-lab[data-active-voices="0"][data-audio-state="running"]').waitFor()
    maxCycleMilliseconds = Math.max(maxCycleMilliseconds, performance.now() - cycleStarted)
    cycles += 1
    if (Date.now() >= nextSampleAt) {
      await devtools.send('HeapProfiler.collectGarbage')
      heapSamples.push({
        elapsedMilliseconds: Date.now() - startedAt,
        heapBytes: metric((await devtools.send('Performance.getMetrics')).metrics, 'JSHeapUsedSize')
      })
      latestRealtimeSoak = {
        browser: browserVersion,
        requestedSeconds: seconds,
        elapsedMilliseconds: Date.now() - startedAt,
        cycles,
        heapSampleCount: heapSamples.length
      }
      writeSoakEvidence('RUNNING', 'realtime-soak')
      nextSampleAt += sampleIntervalMilliseconds
    }
    await page.waitForTimeout(200)
  }
  await devtools.send('HeapProfiler.collectGarbage')
  const endHeap = metric((await devtools.send('Performance.getMetrics')).metrics, 'JSHeapUsedSize')
  const elapsedMilliseconds = Date.now() - startedAt
  if (heapSamples.at(-1).elapsedMilliseconds !== elapsedMilliseconds) {
    heapSamples.push({elapsedMilliseconds, heapBytes: endHeap})
  }
  const warmupSamples = heapSamples.slice(heapSamples.length >= 5 ? Math.floor(heapSamples.length * 0.2) : 0)
  const heapSlope = heapSlopeBytesPerMinute(warmupSamples)
  const endAudioTime = await page.evaluate(() => window.__soundContext.currentTime)
  const report = {
    schemaVersion: 1,
    browser: browserVersion,
    requestedSeconds: seconds,
    elapsedMilliseconds,
    cycles,
    maxCycleMilliseconds: Math.round(maxCycleMilliseconds * 10) / 10,
    heapGrowthBytes: endHeap - startHeap,
    heapSlopeBytesPerMinute: Math.round(heapSlope),
    heapSampleCount: heapSamples.length,
    audioTimeAdvancedSeconds: Math.round((endAudioTime - startAudioTime) * 10) / 10,
    finalAudioState: await page.locator('.sound-lab').getAttribute('data-audio-state'),
    finalVoices: Number(await page.locator('.sound-lab').getAttribute('data-active-voices')),
    midiConnection: await page.evaluate(() => window.__soundInput.connection)
  }
  latestRealtimeSoak = report
  assert(report.cycles > 0, 'real-time soak completed no cycles')
  assert(report.maxCycleMilliseconds < 2000, `real-time soak cycle blocked for ${report.maxCycleMilliseconds} ms`)
  assert(report.heapGrowthBytes < 20 * 1024 * 1024, `real-time soak heap grew by ${report.heapGrowthBytes} bytes`)
  assert(report.heapSlopeBytesPerMinute < 1024 * 1024,
    `real-time soak retained-heap slope is ${report.heapSlopeBytesPerMinute} bytes/minute`)
  assert(report.audioTimeAdvancedSeconds >= seconds * 0.8,
    `audio clock advanced only ${report.audioTimeAdvancedSeconds} seconds`)
  assert.strictEqual(report.finalAudioState, 'running')
  assert.strictEqual(report.finalVoices, 0)
  assert.strictEqual(report.midiConnection, 'open')
  console.log(`SOUND_SOAK_REPORT ${JSON.stringify(report)}`)
  return report
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({executablePath: chromePath(), headless: true})
  try {
    const context = await browser.newContext()
    context.setDefaultTimeout(5000)
    const telemetryEvents = []
    await context.route('**/api/telemetry', route => {
      telemetryEvents.push(JSON.parse(route.request().postData()))
      return route.fulfill({status: 202, contentType: 'application/json', body: '{"accepted":true}'})
    })
    await context.addInitScript(() => {
      window.__soundMidiRequests = []
      window.__soundMidiSent = []
      window.__failSoundCloseOnce = false
      window.__failSoundAudioCloseOnce = false
      let deferSoundOpenOnce = false
      let finishDeferredOpen = null
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      const nativeAudioClose = AudioContextClass?.prototype.close
      const nativeConnect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination && this.context === window.__soundContext)
          window.__soundOutputNode = this
        return nativeConnect.call(this, destination, ...args)
      }
      if (nativeAudioClose) {
        AudioContextClass.prototype.close = function(...args) {
          if (window.__failSoundAudioCloseOnce) {
            window.__failSoundAudioCloseOnce = false
            return Promise.reject(new Error('audio driver refused close'))
          }
          return nativeAudioClose.apply(this, args)
        }
      }
      if (AudioContextClass) {
        class TrackedAudioContext extends AudioContextClass {
          constructor(...args) {
            super(...args)
            window.__soundContext = this
          }
        }
        if (window.AudioContext) {
          Object.defineProperty(window, 'AudioContext', {configurable: true, value: TrackedAudioContext})
        } else {
          Object.defineProperty(window, 'webkitAudioContext', {configurable: true, value: TrackedAudioContext})
        }
      }
      let midiListener = null
      let stateListener = null
      const input = {
        id: 'playtronica-in-1', name: 'Biotron Port 1', manufacturer: 'Playtronica',
        state: 'connected', connection: 'closed', onmidimessage: null,
        async open() {
          if (deferSoundOpenOnce) {
            deferSoundOpenOnce = false
            this.connection = 'opening'
            await new Promise(resolve => {
              finishDeferredOpen = () => { this.connection = 'open'; finishDeferredOpen = null; resolve() }
            })
          } else this.connection = 'open'
          return this
        },
        async close() {
          if (window.__failSoundCloseOnce) {
            window.__failSoundCloseOnce = false
            throw new Error('driver refused close')
          }
          this.connection = 'closed'
          return this
        },
        addEventListener(type, listener) { if (type === 'midimessage') midiListener = listener },
        removeEventListener(type, listener) { if (type === 'midimessage' && midiListener === listener) midiListener = null }
      }
      const serviceInput = {
        id: 'playtronica-in-2', name: 'Biotron Port 2', manufacturer: 'Playtronica',
        state: 'connected', connection: 'closed',
        async open() { this.connection = 'open'; return this },
        async close() { this.connection = 'closed'; return this },
        addEventListener() {}, removeEventListener() {}
      }
      const persistedValues = [
        78, 3, 4, 4, 50, 10, 0, 4, 8, 98, 74, 75, 0, 1, 0, 12,
        0, 0, 1, 1, 0, 1, 60, 2, 3, 100, 0
      ]
      const outputFor = (id, name) => ({
        id, name, manufacturer: 'Playtronica', state: 'connected', connection: 'closed',
        async open() { this.connection = 'open'; return this },
        async close() { this.connection = 'closed'; return this },
        send(data) {
          const message = Array.from(data)
          window.__soundMidiSent.push(message)
          if (id !== 'playtronica-out-1') return
          if (message[0] === 0xf0 && message[1] === 20 && message[2] === 13 &&
              message[3] === 0 && message.at(-1) === 0xf7) {
            const bpm = message.slice(4, -1).reduce((sum, byte) => sum + byte, 0)
            persistedValues[0] = bpm & 0x7f
            persistedValues[1] = (bpm >> 7) & 0x7f
          }
          if (message.length === 7 && message[0] === 0xf0 && message[3] === 123) {
            // Envelope copied from a real 1.9.8 device reply (47 bytes, f0 14 0d 7b …),
            // not invented — an invented frame is what hid this bug until 2026-09-02.
            const response = [
              0xf0, 0x14, 0x0d, 123, 1, 1, 1, message[5], 1,
              7, 0, 0, 0, 0, 7, 0, 0, 0, 0, ...persistedValues, 0xf7
            ]
            setTimeout(() => input.onmidimessage?.({data: Uint8Array.from(response)}), 0)
          }
        }
      })
      const output = outputFor('playtronica-out-1', 'Biotron Port 1')
      const serviceOutput = outputFor('playtronica-out-2', 'Biotron Port 2')
      const access = {
        inputs: new Map([[input.id, input]]),
        outputs: new Map([[output.id, output], [serviceOutput.id, serviceOutput]]),
        addEventListener(type, listener) { if (type === 'statechange') stateListener = listener },
        removeEventListener(type, listener) { if (type === 'statechange' && stateListener === listener) stateListener = null }
      }
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async options => { window.__soundMidiRequests.push(options); return access }
      })
      window.__emitSoundMidi = data => midiListener?.({data: Uint8Array.from(data)})
      window.__hasSoundMidiListener = () => Boolean(midiListener)
      window.__deferSoundOpen = () => { deferSoundOpenOnce = true }
      window.__finishSoundOpen = () => finishDeferredOpen?.()
      window.__setSoundInputState = state => {
        input.state = state
        if (state === 'disconnected') input.connection = 'closed'
        stateListener?.({port: input})
      }
      window.__soundInput = input
      window.__soundServiceInput = serviceInput
      window.__soundOutput = output
      window.__addSoundServicePort = () => access.inputs.set(serviceInput.id, serviceInput)
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const devtools = await context.newCDPSession(page)
    await page.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
    assert.strictEqual(await page.getByRole('navigation', {name: 'Choose a device'}).count(), 0)
    assert.strictEqual(await page.getByRole('link', {name: 'TouchMe'}).count(), 0)
    assert.strictEqual(await page.locator('.sound-lab__variant').count(), 7)
    assert.deepStrictEqual(await page.locator('.sound-lab__variant').allTextContents(), ['Round', 'Round Bright', 'Fat', 'Fat Bass', 'String', 'Soft String', 'Air'])
    const volume = page.getByRole('slider', {name: 'Volume'})
    assert.strictEqual(await volume.inputValue(), '70')
    await volume.fill('100')
    assert.strictEqual(await page.locator('.sound-lab').getAttribute('data-volume'), '100')
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('playtronica-sound-volume-v1')), '100')
    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.locator('.sound-lab[data-audio-state="running"]').waitFor()
    await page.locator('.sound-lab[data-tab-lease="held"]').waitFor()

    const secondPage = await context.newPage()
    await secondPage.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
    await secondPage.getByRole('button', {name: 'Start listening'}).click()
    await secondPage.locator('.sound-lab[data-tab-lease="blocked"]').waitFor()
    await secondPage.getByText(/already open in another Settings window/i).waitFor()
    await openSoundHelp(secondPage)
    await secondPage.getByRole('heading', {name: 'Can you hear the notes?'}).waitFor()
    assert((await secondPage.getByRole('link', {name: 'Not yet — WhatsApp'}).getAttribute('href')).includes('Reached%3A%20Sound%20open%20in%20another%20tab'))
    assert.strictEqual(await secondPage.locator('.sound-lab').getAttribute('data-audio-state'), 'closed')

    await page.getByRole('button', {name: 'Stop & release'}).click()
    await page.locator('.sound-lab[data-tab-lease="free"]').waitFor()
    await secondPage.getByRole('button', {name: 'Start listening'}).click()
    await secondPage.locator('.sound-lab[data-audio-state="running"][data-tab-lease="held"]').waitFor()
    await secondPage.getByRole('button', {name: 'Stop & release'}).click()
    await secondPage.locator('.sound-lab[data-tab-lease="free"]').waitFor()
    await secondPage.close()

    await page.getByLabel('Low CPU').check()
    await devtools.send('Emulation.setCPUThrottlingRate', {rate: 6})
    const constrainedStart = Date.now()
    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.locator('.sound-lab[data-audio-state="running"][data-quality="safe"][data-tab-lease="held"]').waitFor()
    const constrainedStartMilliseconds = Date.now() - constrainedStart
    assert(constrainedStartMilliseconds < 5000, `6x-throttled Low CPU start took ${constrainedStartMilliseconds} ms`)
    assert.strictEqual(await page.getByLabel('Low CPU').isDisabled(), true)
    for (const code of ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG']) {
      await page.dispatchEvent('body', 'keydown', {code, key: code})
    }
    await page.locator('.sound-lab[data-active-voices="4"]').waitFor()
    await page.getByRole('button', {name: 'Stop notes'}).click()
    await page.getByRole('button', {name: 'Find MIDI device'}).click()
    await page.getByRole('button', {name: 'Connect selected'}).click()
    const constrainedBurstMilliseconds = await page.evaluate(() => {
      const started = performance.now()
      for (let index = 0; index < 1000; index += 1) {
        window.__emitSoundMidi([0x90, 36 + index % 48, 100])
      }
      return performance.now() - started
    })
    await page.locator('.sound-lab[data-active-voices="4"]').waitFor()
    assert(constrainedBurstMilliseconds < 3000,
      `6x-throttled Low CPU burst blocked the page for ${constrainedBurstMilliseconds} ms`)
    await page.evaluate(() => window.__emitSoundMidi([0xb0, 123, 0]))
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    await page.getByRole('button', {name: 'Stop & release'}).click()
    await devtools.send('Emulation.setCPUThrottlingRate', {rate: 1})
    await page.getByLabel('Low CPU').uncheck()

    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.locator('.sound-lab[data-audio-state="running"][data-quality="standard"][data-tab-lease="held"]').waitFor()

    await page.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'ф'})
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.dispatchEvent('body', 'keyup', {code: 'KeyA', key: 'ф'})
    await page.getByRole('button', {name: 'Stop notes'}).click()
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()

    await page.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'a'})
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor({timeout: 5000})
    await page.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'a'})
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.dispatchEvent('body', 'keyup', {code: 'KeyA', key: 'a'})
    await page.getByRole('button', {name: 'Stop notes'}).click()

    await page.getByRole('button', {name: 'Find MIDI device'}).click()
    await page.getByRole('button', {name: 'Connect selected'}).click()
    assert.deepStrictEqual(await page.evaluate(() => window.__soundMidiRequests), [{sysex: false}])
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    await page.evaluate(() => window.__emitSoundMidi([0x90, 64, 100]))
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.dispatchEvent('body', 'keydown', {code: 'KeyD', key: 'в'})
    await page.locator('.sound-lab[data-active-voices="2"]').waitFor()
    await page.dispatchEvent('body', 'keyup', {code: 'KeyD', key: 'в'})
    await page.evaluate(() => window.__emitSoundMidi([0x90, 64, 0]))
    await page.getByRole('button', {name: 'Stop notes'}).click()

    const names = ['Round', 'Round Bright', 'Fat', 'Fat Bass', 'String', 'Soft String', 'Air']
    for (let index = 0; index < 6; index += 1) {
      const variant = page.getByRole('button', {name: names[index], exact: true})
      await variant.click()
      assert.strictEqual(await variant.getAttribute('aria-pressed'), 'true')
      await page.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'ф'})
      await page.evaluate(note => window.__emitSoundMidi([0x90, note, 96]), 72 + index)
      await page.locator('.sound-lab[data-active-voices="2"]').waitFor()
      await page.dispatchEvent('body', 'keyup', {code: 'KeyA', key: 'ф'})
      await page.evaluate(note => window.__emitSoundMidi([0x80, note, 0]), 72 + index)
      await page.getByRole('button', {name: 'Stop notes'}).click()
      await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    }

    const burstMilliseconds = await page.evaluate(() => {
      const started = performance.now()
      for (let index = 0; index < 1000; index += 1) {
        window.__emitSoundMidi([0x90, 36 + index % 48, 100])
      }
      return performance.now() - started
    })
    await page.locator('.sound-lab[data-active-voices="8"]').waitFor()
    assert(burstMilliseconds < 1500, `1000-message burst blocked the page for ${burstMilliseconds} ms`)
    await page.evaluate(() => window.__emitSoundMidi([0xb0, 123, 0]))
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()

    await devtools.send('Performance.enable')
    await devtools.send('HeapProfiler.collectGarbage')
    const metric = (list, name) => list.find(item => item.name === name)?.value || 0
    const beforeMetrics = (await devtools.send('Performance.getMetrics')).metrics
    const soakMilliseconds = await page.evaluate(() => {
      const started = performance.now()
      for (let cycle = 0; cycle < 20; cycle += 1) {
        for (let index = 0; index < 1000; index += 1) {
          window.__emitSoundMidi([0x90, 36 + index % 48, 72 + index % 48])
        }
        window.__emitSoundMidi([0xb0, 123, 0])
      }
      return performance.now() - started
    })
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    await page.waitForTimeout(750)
    await devtools.send('HeapProfiler.collectGarbage')
    const afterMetrics = (await devtools.send('Performance.getMetrics')).metrics
    const heapGrowth = metric(afterMetrics, 'JSHeapUsedSize') - metric(beforeMetrics, 'JSHeapUsedSize')
    assert(soakMilliseconds < 15000, `20000-message soak blocked the page for ${soakMilliseconds} ms`)
    assert(heapGrowth < 20 * 1024 * 1024, `JS heap grew by ${heapGrowth} bytes`)
    const realtimeSoak = await runRealtimeSoak(page, devtools, realtimeSoakSeconds, await browser.version())

    await page.evaluate(() => window.__setSoundInputState('disconnected'))
    await page.getByText(/MIDI disconnected/i).waitFor()
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), false)
    await page.getByRole('button', {name: 'Find MIDI device'}).waitFor()
    await page.evaluate(() => window.__setSoundInputState('connected'))
    await page.getByRole('button', {name: 'Connect selected'}).waitFor()
    await page.getByRole('button', {name: 'Connect selected'}).click()
    await page.getByText(/Biotron Port 1 connected/i).waitFor()
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), true)

    await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => true})
      await window.__soundContext.suspend()
    })
    await page.locator('.sound-lab[data-audio-state="suspended"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x90, 67, 100]))
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x80, 67, 0]))
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => false})
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.locator('.sound-lab[data-audio-state="running"]').waitFor()
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), true)
    await page.evaluate(() => window.__emitSoundMidi([0x90, 69, 100]))
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x80, 69, 0]))
    // Chromium does not emit WebKit's interrupted state: inject only that boundary,
    // keeping the real audio engine, MIDI session and Vue lifecycle under test.
    await page.evaluate(() => {
      Object.defineProperty(window.__soundContext, 'state', {configurable: true, get: () => 'interrupted'})
      window.__soundContext.dispatchEvent(new Event('statechange'))
    })
    await page.locator('.sound-lab[data-audio-state="interrupted"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x90, 70, 100]))
    await page.locator('.sound-lab[data-active-voices="0"]').waitFor()
    await page.evaluate(() => {
      delete window.__soundContext.state
      window.__soundContext.dispatchEvent(new Event('statechange'))
    })
    await page.locator('.sound-lab[data-audio-state="running"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x90, 67, 100]))
    await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
    await page.getByRole('button', {name: 'Stop notes'}).click()

    await page.evaluate(() => window.__soundContext.close())
    await page.locator('.sound-lab[data-audio-state="closed"][data-tab-lease="held"]').waitFor()
    await page.getByText(/Audio stopped unexpectedly/i).waitFor()
    assert.strictEqual(await page.getByRole('button', {name: 'Start sound'}).isDisabled(), true)
    assert.strictEqual(await page.getByRole('button', {name: 'Stop & release'}).isEnabled(), true)
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    await page.getByRole('button', {name: 'Stop & release'}).click()
    await page.locator('.sound-lab[data-audio-state="closed"][data-tab-lease="free"]').waitFor()
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'closed')

    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.getByRole('button', {name: 'Find MIDI device'}).click()
    await page.getByRole('button', {name: 'Connect selected'}).click()
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')

    await page.evaluate(() => {
      window.__emitSoundMidi([0x90, 76, 100])
      const stopButton = [...document.querySelectorAll('button')]
        .find(button => button.textContent.includes('Stop & release'))
      stopButton?.click()
    })
    await page.locator('.sound-lab[data-audio-state="closed"][data-active-voices="0"][data-tab-lease="free"]').waitFor()
    await page.waitForTimeout(100)
    assert.strictEqual(await page.locator('.sound-lab').getAttribute('data-active-voices'), '0')
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), false)

    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.getByRole('button', {name: 'Find MIDI device'}).click()
    await page.getByRole('button', {name: 'Connect selected'}).click()
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')

    await page.evaluate(() => { window.__failSoundCloseOnce = true })
    await page.evaluate(() => { window.location.hash = '#/biotron' })
    await page.locator('.sound-lab[data-audio-state="closed"]').waitFor()
    await page.getByText(/MIDI did not release/i).waitFor()
    assert.strictEqual(new URL(page.url()).hash, '#/sound')
    assert.strictEqual(await page.getByRole('button', {name: 'Start sound'}).isDisabled(), true)
    assert.strictEqual(await page.getByRole('button', {name: 'Stop & release'}).isEnabled(), true)
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    await page.getByRole('button', {name: 'Stop & release'}).click()
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'closed')

    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.evaluate(() => { window.__failSoundAudioCloseOnce = true })
    await page.getByRole('button', {name: 'Stop & release'}).click()
    await page.locator('.sound-lab[data-audio-state="error"][data-tab-lease="held"]').waitFor()
    await page.getByText(/audio did not close/i).waitFor()
    assert.strictEqual(await page.getByRole('button', {name: 'Start sound'}).isDisabled(), true)
    assert.strictEqual(await page.getByRole('button', {name: 'Stop & release'}).isEnabled(), true)
    await page.getByRole('button', {name: 'Stop & release'}).click()
    await page.locator('.sound-lab[data-audio-state="closed"][data-tab-lease="free"]').waitFor()

    const cycleStarted = Date.now()
    for (let cycle = 0; cycle < 100; cycle += 1) {
      await page.getByRole('button', {name: 'Start sound'}).click()
      await page.locator('.sound-lab[data-audio-state="running"][data-tab-lease="held"]').waitFor()
      await page.getByRole('button', {name: 'Stop & release'}).click()
      await page.locator('.sound-lab[data-audio-state="closed"][data-tab-lease="free"]').waitFor()
    }
    const cycleMilliseconds = Date.now() - cycleStarted
    assert.strictEqual(await page.getByRole('button', {name: 'Start sound'}).isEnabled(), true)

    await page.getByRole('button', {name: 'Start sound'}).click()
    await page.evaluate(() => window.__deferSoundOpen())
    await page.getByRole('button', {name: 'Find MIDI device'}).click()
    await page.waitForFunction(() => window.__soundInput.connection === 'opening')
    await page.evaluate(() => { window.location.hash = '#/biotron/play' })
    await page.waitForTimeout(100)
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'opening')
    await page.evaluate(() => window.__finishSoundOpen())
    await page.getByRole('heading', {name: 'Plant music'}).waitFor()
    assert.strictEqual(await page.getByRole('navigation', {name: 'Biotron tasks'}).getByRole('link', {name: 'Play'}).getAttribute('aria-current'), 'page')
    assert.strictEqual(await page.getByRole('link', {name: 'Settings', exact: true}).getAttribute('href'), '#/biotron')
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'closed')
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), false)
    await page.evaluate(() => window.__addSoundServicePort())
    await page.locator('.sound-lab[data-reveal-stage="intro"][data-quality="safe"]').waitFor()
    assert.strictEqual(await page.getByRole('link', {name: 'TouchMe'}).count(), 0)
    assert.strictEqual(await page.locator('.offline-status').count(), 0)
    assert.strictEqual(await page.locator('.bottom-panel').count(), 0)
    assert.strictEqual(await page.getByRole('heading', {name: 'Sounds'}).count(), 0)
    assert.strictEqual(await page.getByRole('heading', {name: 'Can you hear the notes?'}).count(), 0)
    await page.getByRole('button', {name: 'Start listening'}).click()
    await page.locator('.sound-lab[data-reveal-stage="settling"][data-audio-state="running"]').waitFor()
    const calibrationRequest = (await page.evaluate(() => window.__soundMidiSent))
      .filter(message => message[0] === 0xf0 && message[3] === 125).at(-1)
    assert.deepStrictEqual(calibrationRequest.slice(0, 4), [0xf0, 0x14, 0x0d, 125])
    assert(calibrationRequest[4] >= 1 && calibrationRequest[4] <= 127)
    assert.strictEqual(calibrationRequest[5], 0xf7)
    assert.strictEqual(await page.getByRole('slider', {name: 'Volume'}).inputValue(), '100')
    await page.getByRole('heading', {name: 'Waiting for the device'}).waitFor()
    const recognized = page.getByText('Device connected')
    await recognized.waitFor()
    assert.strictEqual(await recognized.getAttribute('title'), 'Playtronica — Biotron Port 1')
    assert.deepStrictEqual((await page.evaluate(() => window.__soundMidiRequests)).at(-1), {sysex: true})
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    assert.strictEqual(await page.evaluate(() => window.__soundServiceInput.connection), 'closed')
    for (const [note, velocity] of [[64, 64], [65, 64], [67, 64], [72, 64]]) {
      await page.evaluate(([value, level]) => window.__emitSoundMidi([0x91, value, level]), [note, velocity])
      await page.evaluate(value => window.__emitSoundMidi([0x81, value, 0]), note)
      await page.waitForTimeout(70)
    }
    await page.locator('.sound-lab[data-reveal-stage="calibrating"]').waitFor()
    await page.getByRole('heading', {name: 'Calibrating'}).waitFor()
    await page.getByText('Keep the plant, cables and device still. Wait for the device to confirm it is ready.').waitFor()
    // A legacy cue is a hint; only a matching firmware nonce confirms readiness.
    await page.waitForTimeout(1200)
    assert.strictEqual(await page.locator('.sound-lab').getAttribute('data-reveal-stage'), 'calibrating')
    await page.evaluate(nonce => window.__emitSoundMidi([0xf0, 0x0b, 125, nonce % 127 + 1, 3, 0xf7]), calibrationRequest[4])
    assert.strictEqual(await page.locator('.sound-lab').getAttribute('data-reveal-stage'), 'calibrating')
    await page.evaluate(nonce => window.__emitSoundMidi([0xf0, 0x0b, 125, nonce, 2, 0xf7]), calibrationRequest[4])
    await page.evaluate(nonce => window.__emitSoundMidi([0xf0, 0x0b, 125, nonce, 3, 0xf7]), calibrationRequest[4])
    await page.locator('.sound-lab[data-reveal-stage="ready"]').waitFor({timeout: 2000})
    await page.getByRole('heading', {name: 'Ready to play'}).waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x91, 64, 100]))
    await page.locator('.sound-lab[data-reveal-stage="revealed"][data-active-voices="1"]').waitFor()
    await page.getByRole('heading', {name: 'Notes arriving', exact: true}).waitFor()
    await openSoundHelp(page)
    await page.getByRole('heading', {name: 'Can you hear the notes?'}).waitFor()
    const helpedFeedback = page.getByRole('link', {name: 'Yes — WhatsApp'})
    assert((await helpedFeedback.getAttribute('href')).includes('wa.me/351937910673'))
    assert((await helpedFeedback.getAttribute('href')).includes('I%20heard%20Biotron%20play%20from%20the%20plant'))
    assert((await helpedFeedback.getAttribute('href')).includes('Reached%3A%20Sound%20from%20the%20plant'))
    await page.evaluate(() => window.__emitSoundMidi([0x81, 64, 0]))
    const calibrationCount = await page.evaluate(() => window.__soundMidiSent
      .filter(message => message[0] === 0xf0 && message[3] === 125).length)
    await page.evaluate(() => window.__soundContext.suspend())
    await page.locator('.sound-lab[data-audio-state="suspended"]').waitFor()
    await page.getByRole('button', {name: 'Resume sound'}).click()
    await page.locator('.sound-lab[data-audio-state="running"][data-reveal-stage="revealed"]').waitFor()
    assert.strictEqual(await page.evaluate(() => window.__soundMidiSent
      .filter(message => message[0] === 0xf0 && message[3] === 125).length), calibrationCount,
    'manual Resume unexpectedly restarted calibration')
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    const resumedSignalRms = await page.evaluate(async () => {
      const output = window.__soundOutputNode
      if (!output) throw new Error('Sound engine output unavailable for signal check')
      const analyser = window.__soundContext.createAnalyser()
      analyser.fftSize = 2048
      output.connect(analyser)
      window.__emitSoundMidi([0x91, 69, 110])
      let rms = 0
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const data = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(data)
        rms = Math.max(rms, Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length))
      }
      window.__emitSoundMidi([0x81, 69, 0])
      output.disconnect(analyser)
      return rms
    })
    assert(resumedSignalRms > 0.001, `no measurable audio after manual Resume: RMS ${resumedSignalRms}`)
    await page.getByRole('button', {name: 'Choose a sound'}).click()
    assert.strictEqual(await page.locator('.sound-lab__reveal-variants .sound-lab__variant').count(), 7)
    await page.evaluate(() => window.__emitSoundMidi([0x91, 64, 0]))
    await page.evaluate(() => window.__emitSoundMidi([0x91, 64, 100]))
    await page.getByRole('button', {name: 'Stop listening', exact: true}).click()
    await page.locator('.sound-lab[data-audio-state="closed"][data-active-voices="0"][data-tab-lease="free"]').waitFor()
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), false)
    await page.evaluate(() => { for (let i=0;i<20;i++) window.__emitSoundMidi([0x91, 64, 100]) })
    assert.strictEqual(await page.locator('.sound-lab').getAttribute('data-active-voices'), '0')
    await page.getByRole('button', {name: 'Start listening', exact: true}).click()
    await page.locator('.sound-lab[data-reveal-stage="settling"]').waitFor()
    const restartNonce = await page.evaluate(() => window.__soundMidiSent.filter(m => m[3] === 125 && m.length === 6).at(-1)?.[4])
    await page.evaluate(nonce => window.__emitSoundMidi([0xf0, 0x0b, 125, nonce, 3, 0xf7]), restartNonce)
    await page.locator('.sound-lab[data-reveal-stage="ready"]').waitFor()
    await page.evaluate(() => window.__emitSoundMidi([0x91, 64, 100]))
    await page.evaluate(() => window.__emitSoundMidi([0x81, 64, 0]))
    await page.getByRole('region', {name: 'Continue with Biotron'}).getByRole('link', {name: 'Settings', exact: true}).click()
    await page.getByRole('heading', {name: 'Settings', exact: true}).waitFor()
    assert.strictEqual(new URL(page.url()).hash, '#/biotron')
    await page.getByText(/Sound stays on while you adjust settings/i).waitFor()
    await page.getByText('Settings loaded. Individual changes apply live; presets need Apply preset to Biotron.').waitFor({timeout: 5000})
    const experimentToggle = page.getByRole('button', {name: 'Experiments', exact: true})
    await experimentToggle.click()
    const experiments = page.locator('#' + await experimentToggle.getAttribute('aria-controls'))
    await experiments.getByText(/turns off Input variation/).waitFor()
    const calmerButton = experiments.getByRole('button', {name: 'Reduce extra notes'})
    assert.strictEqual(await calmerButton.getAttribute('aria-describedby'), 'calmer-play-help')
    assert.strictEqual(await calmerButton.isEnabled(), true)
    assert((await experiments.innerText()).includes('keeps your tempo, scale and note velocity'))
    await experimentToggle.click()
    const settingHelpButtons = page.locator('details.hint > summary')
    assert(await settingHelpButtons.count() >= 8, 'settings info icons must be real help buttons')
    const muteHelp = page.getByRole('button', {name: /Help: Turns off notes coming off plant sensor/i})
    await muteHelp.click()
    await page.getByRole('tooltip').getByText(/Turns off notes coming off plant sensor/i).waitFor()
    await muteHelp.click()
    assert.strictEqual(await page.getByRole('tooltip').count(), 0)
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), true)
    assert.strictEqual(await page.evaluate(() => window.__soundContext.state), 'running')
    await page.evaluate(() => window.__emitSoundMidi([0x91, 67, 100]))
    const speedSlider = page.getByRole('slider', {name: '🌱 The beat slider', exact: true})
    const previousSpeed = Number(await speedSlider.inputValue())
    await speedSlider.evaluate((element, value) => {
      element.value = String(value)
      element.dispatchEvent(new Event('change', {bubbles: true}))
    }, Math.min(previousSpeed + 1, 1000))
    await page.getByText('Saved on Biotron.').waitFor({timeout: 10000})
    assert.strictEqual(await page.locator('#loader_div').count(), 0,
      'Play to Settings live change showed a blocking full-screen loader')
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    assert.strictEqual(await page.evaluate(() => window.__hasSoundMidiListener()), true)
    assert.strictEqual(await page.evaluate(() => window.__soundContext.state), 'running')
    await page.getByRole('link', {name: 'Sound & volume'}).click()
    await page.locator('.sound-lab[data-audio-state="running"][data-active-voices="1"]').waitFor()
    assert.strictEqual(await page.getByRole('slider', {name: 'Volume'}).getAttribute('max'), '100')
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'open')
    await page.evaluate(() => window.__emitSoundMidi([0x81, 67, 0]))
    await page.getByRole('navigation', {name: 'Biotron tasks'}).getByRole('link', {name: 'Settings', exact: true}).click()
    await page.getByRole('button', {name: 'Release device for DAW'}).click()
    await page.getByRole('button', {name: 'Reconnect settings'}).waitFor()
    assert.strictEqual(await page.evaluate(() => window.__soundInput.connection), 'closed')
    await page.getByRole('link', {name: 'Play', exact: true}).click()
    await page.locator('.sound-lab[data-reveal-stage="intro"][data-audio-state="closed"][data-tab-lease="free"]').waitFor()
    // No-clips watchdog (Sergey, 2026-09-03): with a device that never answers the
    // calibration request, Start listening must stop pulsing and return to intro within 15 s.
    await page.getByRole('button', {name: 'Start listening'}).click()
    await page.locator('.sound-lab[data-reveal-stage="settling"]').waitFor()
    await page.locator('.sound-lab[data-reveal-stage="intro"]').waitFor({timeout: 20000})
    assert((await page.locator('.sound-lab').innerText()).includes('The device did not confirm calibration.'))
    await openSoundHelp(page)
    const stuckFeedback = page.getByRole('link', {name: 'Not yet — WhatsApp'})
    await stuckFeedback.waitFor()
    assert((await stuckFeedback.getAttribute('href')).includes('I%20did%20not%20hear%20Biotron%20play'))
    assert((await stuckFeedback.getAttribute('href')).includes('Reached%3A%20Calibration%20not%20confirmed'))
    await page.getByRole('button', {name: 'Start listening'}).click()
    await page.locator('.sound-lab[data-reveal-stage="settling"]').waitFor()
    await page.evaluate(() => window.__setSoundInputState('disconnected'))
    await openSoundHelp(page)
    await page.getByRole('heading', {name: 'Can you hear the notes?'}).waitFor()
    const disconnectedFeedback = page.getByRole('link', {name: 'Not yet — WhatsApp'})
    assert((await disconnectedFeedback.getAttribute('href')).includes('Reached%3A%20Biotron%20disconnected%20before%20first%20sound'))
    await verifyCapabilityFallbacks(browser, origin)
    assert(telemetryEvents.some(event => event.event_name === 'session.started' && event.service_name === 'biotron'))
    assert(telemetryEvents.every(event => !('raw_midi' in event) && !('device_name' in event)))
    assert.deepStrictEqual(errors, [])
    if (realtimeSoak) writeSoakEvidence('PASS', 'suite-complete', realtimeSoak)
    console.log(`Sound browser verified: first-play Biotron reveal, Play → Settings → Speed live-save continuity, permission/audio-only/no-audio fallbacks, 7 variants, 6x-throttled Low CPU start ${constrainedStartMilliseconds} ms and burst ${constrainedBurstMilliseconds.toFixed(1)} ms, exclusive two-tab sound handoff, 100/100 lifecycle cycles in ${cycleMilliseconds} ms, 1000 burst ${burstMilliseconds.toFixed(1)} ms, 20000 soak ${soakMilliseconds.toFixed(1)} ms, optional real-time soak ${realtimeSoak ? `${realtimeSoak.elapsedMilliseconds} ms` : 'not requested'}, heap delta ${heapGrowth}, disconnect/background recovery and retryable release.`)
  } catch (error) {
    const evidenceDirectory = process.env.BIOTRON_TEST_EVIDENCE_DIR
    if (evidenceDirectory) {
      fs.mkdirSync(evidenceDirectory, {recursive: true})
      let number = 0
      for (const context of browser.contexts()) for (const tab of context.pages()) {
        const prefix = path.join(evidenceDirectory, `sound-fault-${Date.now()}-${++number}`)
        try {
          fs.writeFileSync(`${prefix}.txt`, `${tab.url()}\n${await tab.locator('body').innerText()}`)
          await tab.screenshot({path: `${prefix}.png`, fullPage: true})
        } catch (captureError) {
          console.error(`Could not capture failing page: ${captureError.message}`)
        }
      }
    }
    throw error
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {
  console.error(error)
  try { writeSoakEvidence('FAIL', 'suite-failed', latestRealtimeSoak, error) }
  catch (reportError) { console.error(`Could not write soak report: ${reportError.message}`) }
  server.close(() => process.exit(1))
})
