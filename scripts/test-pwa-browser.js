const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {launchPersistentContext, createStaticServer} = require('./browser-test-harness')

const root = path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist'))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'biotron-pwa-profile-'))
let origin
let serviceWorkerVersion = 1
let context
const server = createStaticServer(root, {
  headers: {'Service-Worker-Allowed': '/'},
  transform(relative, body) {
    if (relative !== 'service-worker.js') return body
    return Buffer.from(`${body.toString()}\nself.addEventListener('message',event=>{if(event.data&&event.data.type==='TEST_SW_VERSION'&&event.ports[0])event.ports[0].postMessage(${serviceWorkerVersion})})\n`)
  }
})

async function waitFor(predicate, message, timeout = 10000) {
  const started = Date.now()
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function openProfile(online, denyMidiOnce = false) {
  context = await launchPersistentContext(profile, {serviceWorkers: 'allow'})
  context.setDefaultTimeout(5000)
  await context.addInitScript(({ initiallyOnline, initiallyDenyMidi }) => {
    window.__testOnline = initiallyOnline
    window.__midiRequestCount = 0
    window.__midiRequestOptions = []
    window.__midiSent = []
    window.__respondSettings = true
    window.__denyMidiOnce = initiallyDenyMidi
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => window.__testOnline
    })

    let midiMessageListener = null
    let midiStateListener = null
    const input = {
      id: 'biotron-input-1', manufacturer: 'Playtronica', name: 'Biotron',
      connection: 'closed', onmidimessage: null,
      async open() { this.connection = 'open'; return this },
      async close() { this.connection = 'closed'; return this },
      addEventListener(type, listener) { if (type === 'midimessage') midiMessageListener = listener },
      removeEventListener(type, listener) {
        if (type === 'midimessage' && midiMessageListener === listener) midiMessageListener = null
      }
    }
    const persistedValues = [
      78, 3, 4, 4, 50, 10, 0, 4, 8, 98, 74, 75, 0, 1, 0, 12,
      0, 0, 1, 1, 0, 1, 60, 2, 3, 100, 0
    ]
    const persistedIndexByCommand = {
      1: 4, 2: 5, 3: 6, 4: 7, 5: 9, 6: 11, 9: 2, 10: 12, 11: 13,
      12: 3, 13: 15, 15: 8, 16: 19, 17: 10, 18: 20, 19: 16,
      21: 21, 22: 17, 23: 18, 24: 14, 25: 22, 26: 25, 27: 26
    }
    const output = {
      id: 'biotron-output-1', manufacturer: 'Playtronica', name: 'Biotron',
      connection: 'closed',
      async open() { this.connection = 'open'; return this },
      async close() { this.connection = 'closed'; return this },
      send(data) {
        const message = Array.from(data)
        window.__midiSent.push(message)
        const persistedIndex = persistedIndexByCommand[message[3]]
        if (message.length === 6 && message[0] === 0xf0 && message[1] === 20 &&
            message[2] === 13 && persistedIndex !== undefined && message[5] === 0xf7) {
          persistedValues[persistedIndex] = message[4]
        }
        if (message[0] === 0xf0 && message[1] === 20 && message[2] === 13 &&
            message[3] === 0 && message.at(-1) === 0xf7) {
          const bpm = message.slice(4, -1).reduce((sum, byte) => sum + byte, 0)
          persistedValues[0] = bpm & 0x7f
          persistedValues[1] = (bpm >> 7) & 0x7f
        }
        if (message.length === 7 && message[0] === 0xf0 && message[1] === 20 &&
            message[2] === 13 && message[3] === 127 && message[6] === 0xf7 &&
            [0, 1].includes(message[4])) {
          persistedValues[23 + message[4]] = message[5] + 1
        }
        if (window.__respondSettings && message[0] === 0xf0 && message[3] === 123 && message.length === 7) {
          const response = [
            0xf0, 0x14, 0x0d, 123, 1, 1, 1, message[5], 1,
            7, 0, 0, 0, 0, 7, 0, 0, 0, 0, ...persistedValues, 0xf7
          ]
          setTimeout(() => input.onmidimessage?.({data: Uint8Array.from(response)}), 0)
        }
      }
    }
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
      addEventListener(type, listener) { if (type === 'statechange') midiStateListener = listener },
      removeEventListener(type, listener) {
        if (type === 'statechange' && midiStateListener === listener) midiStateListener = null
      }
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async options => {
        window.__midiRequestCount += 1
        window.__midiRequestOptions.push(options)
        if (window.__denyMidiOnce) {
          window.__denyMidiOnce = false
          const error = new Error('permission denied for test')
          error.name = 'NotAllowedError'
          throw error
        }
        return access
      }
    })
    window.__emitFirstPlayMidi = data => midiMessageListener?.({data: Uint8Array.from(data)})
    window.__emitSettingsMidi = data => input.onmidimessage?.({data: Uint8Array.from(data)})
  }, { initiallyOnline: online, initiallyDenyMidi: denyMidiOnce })
  await context.setOffline(!online)
  return context.pages()[0] || await context.newPage()
}

async function closeProfile() {
  if (!context) return
  await context.close()
  context = null
}

async function controllerVersion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No active service worker controller'))
      return
    }
    const channel = new MessageChannel()
    const timeout = setTimeout(() => reject(new Error('Service worker version probe timed out')), 3000)
    channel.port1.onmessage = event => {
      clearTimeout(timeout)
      resolve(event.data)
    }
    navigator.serviceWorker.controller.postMessage({type: 'TEST_SW_VERSION'}, [channel.port2])
  }))
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`

  let page = await openProfile(true, true)
  await page.goto(`${origin}/biotron`, { waitUntil: 'load' })
  await page.getByText(/Offline mode is ready/i).waitFor({state: 'visible', timeout: 15000})
  assert.strictEqual(await page.getByRole('button', {name: 'Update app', exact: true}).count(), 0,
    'first online installation should not offer an update of itself')
  const versionStamp = await page.locator('.beta-build').first().innerText()
  assert.match(versionStamp, /Biotron beta · \d{1,2} [A-Za-z]+ 20\d{2}/,
    'the visible beta version must use a calendar date')
  assert.doesNotMatch(versionStamp, /\b[0-9a-f]{12}\b/i,
    'the visible beta version must not expose a commit hash')
  await page.getByRole('button', {name: 'Tell me what to change', exact: true}).click()
  const feedbackLink = decodeURIComponent(await page.getByRole('link', {name: 'Open email', exact: true}).getAttribute('href'))
  assert(feedbackLink.includes(`Version: ${versionStamp.split(' · ')[1]}`),
    'feedback should carry the same version date shown to the user')
  await page.getByRole('button', {name: 'Close', exact: true}).click()
  assert.strictEqual(await controllerVersion(page), 1)
  await page.getByText(/MIDI access was blocked/i).waitFor({state: 'visible', timeout: 5000})
  await page.getByRole('button', {name: /Retry connection/i}).click()
  await waitFor(() => page.evaluate(() => window.__midiRequestCount === 2), 'MIDI permission retry did not run')
  assert.strictEqual(await page.evaluate(() => window.__midiRequestCount), 2, 'MIDI denial did not recover with exactly one retry')
  assert.strictEqual(await page.evaluate(() => window.__midiRequestOptions[0].sysex), true, 'SysEx was not requested in the single MIDI permission flow')

  const installButton = page.getByRole('button', {name: /Install app/i})
  await page.evaluate(() => {
    window.__installPromptCalls = 0
    const event = new Event('beforeinstallprompt', {cancelable: true})
    event.prompt = async () => { window.__installPromptCalls += 1 }
    event.userChoice = Promise.resolve({outcome: 'accepted'})
    window.dispatchEvent(event)
  })
  await installButton.click()
  assert.strictEqual(await page.evaluate(() => window.__installPromptCalls), 1, 'install prompt was not called exactly once')
  await installButton.click()
  await page.getByText(/Chrome: menu/i).waitFor({state: 'visible'})
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await page.getByText('App installed', {exact: true}).waitFor({state: 'visible', timeout: 5000})

  const manifest = await page.evaluate(() => fetch('/manifest.json').then(response => response.json()))
  assert.strictEqual(manifest.name, 'Biotron Settings Offline Beta')
  assert.strictEqual(manifest.id, './biotron-settings-offline-beta')
  assert.strictEqual(manifest.start_url, './#/biotron/play')
  assert.strictEqual(manifest.scope, './')
  assert.strictEqual(manifest.display, 'standalone')
  if (context.browser().browserType().name() === 'chromium') {
    const devtools = await context.newCDPSession(page)
    const manifestReport = await devtools.send('Page.getAppManifest')
    assert.deepStrictEqual(manifestReport.errors || [], [], 'Chromium rejected the generated PWA manifest')
    const installability = await devtools.send('Page.getInstallabilityErrors')
    assert.deepStrictEqual(installability.installabilityErrors || [], [], 'Chromium reports PWA installability errors')
  } else console.log('NOT SUPPORTED: Chromium CDP installability oracle; real service worker/offline/retry checks still run')
  console.log('1/7 online install fixture, active precache, manifest and MIDI denial/retry verified; native install/permissions are separate')

  await closeProfile()
  page = await openProfile(false)
  await page.goto(`${origin}/biotron/play`, { waitUntil: 'load' })
  await waitFor(() => page.url().includes('/#/biotron/play'), 'first-play route was not normalized to the cached hash route')
  await page.getByRole('heading', {name: 'Plant music', exact: true}).waitFor({state: 'visible', timeout: 10000})
  assert.strictEqual(await page.locator('.offline-status').count(), 0, 'first-play was crowded by the global offline banner')
  assert.strictEqual(await controllerVersion(page), 1)
  assert.strictEqual(await page.evaluate(() => window.__midiRequestCount), 0, 'first-play requested MIDI before a user gesture')
  await page.getByRole('button', {name: 'Start listening', exact: true}).click()
  await page.locator('.sound-lab[data-reveal-stage="settling"][data-audio-state="running"]').waitFor()
  assert.strictEqual(await page.evaluate(() => window.__midiRequestCount), 1, 'first-play did not use exactly one MIDI permission request')
  assert.strictEqual(await page.evaluate(() => window.__midiRequestOptions[0].sysex), true,
    'first-play did not establish the shared SysEx access required for uninterrupted Settings')
  for (const note of [92, 91, 92, 91]) {
    await page.evaluate(value => window.__emitFirstPlayMidi([0x91, value, 90]), note)
    await page.evaluate(value => window.__emitFirstPlayMidi([0x81, value, 0]), note)
    await page.waitForTimeout(70)
  }
  assert.strictEqual(await page.locator('.sound-lab[data-reveal-stage="ready"]').count(), 0,
    'Legacy cue notes falsely confirmed readiness')
  const firstNonce = await page.evaluate(() => window.__midiSent.filter(message =>
    message[0] === 0xf0 && message[3] === 125 && message.length === 6).at(-1)?.[4])
  assert(Number.isInteger(firstNonce), 'First Play did not request a nonce-bound calibration')
  await page.evaluate(nonce => window.__emitFirstPlayMidi([0xf0, 0x0b, 125, nonce, 2, 0xf7]), firstNonce)
  await page.locator('.sound-lab[data-reveal-stage="calibrating"]').waitFor()
  await page.evaluate(nonce => window.__emitFirstPlayMidi([0xf0, 0x0b, 125, nonce, 3, 0xf7]), firstNonce)
  await page.locator('.sound-lab[data-reveal-stage="ready"]').waitFor({timeout: 2000})
  await page.evaluate(() => window.__emitFirstPlayMidi([0x91, 64, 100]))
  await page.locator('.sound-lab[data-reveal-stage="revealed"]').waitFor()
  await page.getByRole('button', {name: 'Stop & release', exact: true}).click()
  await page.locator('.sound-lab[data-audio-state="closed"][data-active-voices="0"]').waitFor()
  await page.goto(`${origin}/#/sound`, {waitUntil: 'load'})
  await page.getByRole('heading', {name: 'Play your device'}).waitFor({state: 'visible'})
  await page.getByRole('button', {name: 'Start sound'}).click()
  await page.locator('.sound-lab[data-audio-state="running"]').waitFor()
  await page.dispatchEvent('body', 'keydown', {code: 'KeyA', key: 'ф'})
  await page.locator('.sound-lab[data-active-voices="1"]').waitFor()
  await page.dispatchEvent('body', 'keyup', {code: 'KeyA', key: 'ф'})
  await page.getByRole('button', {name: 'Stop & release'}).click()
  await page.goto(`${origin}/#/biotron/compare`, {waitUntil: 'load'})
  await page.getByRole('heading', {name: 'Plant music', exact: true}).waitFor()
  await page.locator('#compare-variant').waitFor()
  assert.strictEqual(new URL(page.url()).hash, '#/biotron/play?sound=1', 'offline compare alias did not open the Play palette')
  await page.getByRole('button', {name: 'Timbres', exact: true}).click()
  assert.strictEqual(await page.locator('#compare-variant option').count(), 10, 'offline musical options were not cached')
  await page.getByRole('button', {name: 'Listen to example', exact: true}).click()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await page.getByRole('button', {name: 'Stop example', exact: true}).click()
  await page.locator('.sound-lab[data-example="idle"][data-audio-state="closed"][data-example-timers="0"]').waitFor({state:'attached'})
  await page.getByRole('link', {name: 'Settings', exact: true}).click()
  await page.getByText(/Offline mode — Settings are working without internet/i).waitFor({state: 'visible', timeout: 10000})
  await waitFor(() => page.evaluate(() => window.__midiRequestCount === 1), 'Settings did not retain first-play MIDI access')
  assert.deepStrictEqual(await page.evaluate(() => window.__midiRequestOptions.map(options => options.sysex)),
    [true], 'Settings did not reuse first-play SysEx access')
  console.log('2/7 full Chrome restart, first-play reveal, cached Sound/comparison routes and any-layout keyboard with network disabled verified')

  const sendButton = page.getByRole('button', {name: /Check saved settings|Send to Device/i})
  await waitFor(() => sendButton.isEnabled(), 'fake Biotron did not connect offline')
  await page.getByText('Settings loaded. Individual changes apply live; presets need Apply preset to Biotron.').waitFor({state: 'visible'})
  assert.strictEqual(await page.locator('.settings-feedback').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Settings status still looks like a filled button')
  const sectionHeading = page.locator('.settings-section > summary h2').filter({hasText: /^Plant sensor$/})
  assert.strictEqual((await sectionHeading.innerText()).trim(), 'Plant sensor')
  assert.strictEqual(await sectionHeading.evaluate(element => getComputedStyle(element).textTransform), 'none',
    'section headings should use readable sentence case')
  const scaleSelect = page.getByLabel('🎼 Scale', {exact: true})
  const scaleCount = await scaleSelect.locator('option').count()
  for (let value = 0; value < scaleCount; value++) {
    const before = await page.evaluate(() => window.__midiSent.length)
    await scaleSelect.selectOption(String(value))
    await page.waitForFunction(({before, value}) => window.__midiSent.slice(before)
      .some(message => JSON.stringify(message) === JSON.stringify([0xf0,20,13,4,value,0xf7])), {before, value})
    await page.getByText('Saved on Biotron.').waitFor({state: 'visible', timeout: 10000})
    assert.equal(await scaleSelect.inputValue(), String(value), 'scale readback reset the displayed choice')
    await page.getByRole('button', {name: 'Dismiss saved message'}).click()
  }
  console.log(`All ${scaleCount} scale choices reached actual SysEx command4 and confirmed readback`)
  const liveWriteCount = await page.evaluate(() => window.__midiSent.length)
  await page.locator('#plantVelDis input[type="checkbox"]').evaluate(element => element.click())
  await page.getByText('Applied live — saving and checking…').waitFor({state: 'visible'})
  await page.getByText('Saved on Biotron.').waitFor({state: 'visible', timeout: 10000})
  assert(await page.evaluate(before => window.__midiSent.slice(before).some(message =>
    JSON.stringify(message) === JSON.stringify([0xf0, 20, 13, 22, 1, 0xf7])
  ), liveWriteCount), 'single setting did not reach Biotron immediately')
  const experimentToggle = page.locator('.settings-section > summary').filter({hasText: 'Experiments'})
  if (!await experimentToggle.evaluate(element => element.parentElement.open)) await experimentToggle.click()
  await page.getByText(/turns off Input variation/).waitFor()
  const calmerWriteCount = await page.evaluate(() => window.__midiSent.length)
  await page.getByRole('button', {name: 'Reduce extra notes'}).click()
  await page.getByText(/Calmer play is saved/i).waitFor({state: 'visible', timeout: 10000})
  const savedFeedback = page.locator('.settings-feedback')
  assert.notStrictEqual(await savedFeedback.evaluate(element => getComputedStyle(element).position), 'fixed',
    'saved feedback must not float over other controls')
  const desktopViewport = page.viewportSize()
  await page.setViewportSize({width: 320, height: 568})
  assert((await savedFeedback.evaluate(element => element.getBoundingClientRect().right)) <= 320,
    'saved feedback must fit the compact mobile viewport')
  await page.setViewportSize(desktopViewport)
  assert.strictEqual(await page.getByRole('button', {name: 'Done — use in DAW'}).count(), 0,
    'save feedback must not disguise the separate DAW release action')
  await page.getByRole('button', {name: 'Dismiss saved message'}).click()
  assert.strictEqual(await savedFeedback.count(), 0, 'saved feedback did not close')
  assert(await page.getByRole('button', {name: 'Release device for DAW'}).isVisible(),
    'dismissing a save must leave the device connected')
  assert.deepStrictEqual(
    (await page.evaluate(before => window.__midiSent.slice(before), calmerWriteCount))
      .filter(message => [10, 21, 11].includes(message[3])).map(message => [message[3], message[4]]),
    [[10, 0], [21, 1], [11, 2]],
    'calmer play did not send the exact three low-effort settings'
  )
  const calibrateButton = page.getByRole('button', {name: /Calibrate plant again/i})
  await waitFor(() => calibrateButton.isEnabled(), 'recalibration control did not become available')
  await calibrateButton.click()
  const recalibrationRequest = await page.evaluate(() => window.__midiSent.filter(message =>
    JSON.stringify(message.slice(0, 4)) === JSON.stringify([0xf0, 0x14, 0x0d, 125])
  ).at(-1))
  assert(recalibrationRequest, 'recalibration SysEx was not sent')
  const calibrationNonce = recalibrationRequest[4]
  await page.evaluate(nonce => window.__emitSettingsMidi([0xf0, 0x0b, 125, nonce, 1, 0xf7]), calibrationNonce)
  await page.getByText('Step away and keep the plant still.').waitFor({state: 'visible'})
  await page.evaluate(nonce => window.__emitSettingsMidi([0xf0, 0x0b, 125, nonce, 2, 0xf7]), calibrationNonce)
  await page.getByText('Measuring… keep the plant and cables still.').waitFor({state: 'visible'})
  await page.evaluate(nonce => window.__emitSettingsMidi([0xf0, 0x0b, 125, nonce, 3, 0xf7]), calibrationNonce)
  await page.getByText('Calibration complete — touch the plant.').waitFor({state: 'visible'})
  const sentBefore = await page.evaluate(() => window.__midiSent.length)
  await page.evaluate(() => {
    window.__midiHeartbeatMaxGap = 0
    let last = performance.now()
    window.__midiHeartbeat = setInterval(() => {
      const now = performance.now()
      window.__midiHeartbeatMaxGap = Math.max(window.__midiHeartbeatMaxGap, now - last)
      last = now
    }, 20)
  })
  await page.waitForTimeout(50)
  await sendButton.click()
  await waitFor(
    () => page.evaluate(before => window.__midiSent.length > before, sentBefore),
    'offline setting write did not reach the fake MIDI output'
  )
  assert.strictEqual(await page.locator('#loader_div').count(), 0,
    'read-only save check showed a blocking full-screen loader')
  await page.getByText(/Calmer play is saved/i).waitFor({state: 'visible', timeout: 5000})
  const settingsStatuses = await page.locator('[role="status"]').allTextContents()
  assert(settingsStatuses.some(text => text.includes('Calmer play is saved.')),
    `exact readback did not confirm save: ${JSON.stringify(settingsStatuses)}`)
  const checkMessages = await page.evaluate(before => window.__midiSent.slice(before), sentBefore)
  assert(checkMessages.length <= 2 && checkMessages.every(message => [123, 126].includes(message[3])),
    `save check unexpectedly rewrote settings: ${JSON.stringify(checkMessages)}`)
  const heartbeatMaxGap = await page.evaluate(() => {
    clearInterval(window.__midiHeartbeat)
    return window.__midiHeartbeatMaxGap
  })
  assert(heartbeatMaxGap < 500, `settings write blocked the browser event loop for ${heartbeatMaxGap} ms`)
  assert(await page.evaluate(() => window.__midiSent.some(message => message[0] === 0xF0 && message.at(-1) === 0xF7)), 'no complete SysEx setting was sent offline')

  await waitFor(() => sendButton.isEnabled(), 'save check did not finish cleanly')
  await page.evaluate(() => { window.__respondSettings = false })
  const timeoutCheckStart = await page.evaluate(() => window.__midiSent.length)
  await sendButton.click()
  await waitFor(
    () => page.evaluate(before => window.__midiSent.length > before, timeoutCheckStart),
    'timeout check did not send a settings query'
  )
  assert.strictEqual(await page.locator('#loader_div').count(), 0,
    'timeout recovery showed a blocking full-screen loader')
  await page.getByText(/saved copy could not be confirmed/i).waitFor({state: 'visible', timeout: 10000})
  assert(await sendButton.isEnabled(), 'save check stayed disabled after timeout')
  await page.evaluate(() => { window.__respondSettings = true })
  await sendButton.click()
  await page.getByText(/Calmer play is saved/i).waitFor({state: 'visible', timeout: 5000})
  const presetSentBefore = await page.evaluate(() => window.__midiSent.length)
  await page.locator('#patch-selector').selectOption({label: 'Fast role'})
  await page.getByText('Preset loaded in browser. Apply preset to Biotron to hear and save it.').waitFor({state: 'visible'})
  await page.locator('#patch-selector').press('Enter')
  assert.strictEqual(await page.evaluate(() => window.__midiSent.length), presetSentBefore,
    'selecting a browser preset or pressing Enter unexpectedly wrote to Biotron')
  const applyPreset = page.getByRole('button', {name: 'Apply preset to Biotron'})
  await applyPreset.click()
  await page.getByText('Saved on Biotron.').waitFor({state: 'visible', timeout: 15000})
  assert(await page.evaluate(before => window.__midiSent.slice(before).some(message => message[3] === 0), presetSentBefore),
    'applying a preset did not send its plant tempo to Biotron')
  console.log(`3/7 offline Biotron detection, nonce-bound recalibration and non-blocking SysEx write verified (max event-loop gap ${heartbeatMaxGap.toFixed(1)} ms)`)

  await page.evaluate(() => window.__emitSettingsMidi([0xf0, 0x0b, 126, 0, 1, 9, 3, 0xf7]))
  assert.strictEqual(await page.getByRole('button', {name: /Update to 1\.9\.8|Update Firmware/}).count(), 0,
    'general customer beta exposed a firmware update action')
  assert.strictEqual(await page.evaluate(() => window.__midiSent.some(message =>
    JSON.stringify(message) === JSON.stringify([240, 11, 127, 247]) ||
    JSON.stringify(message) === JSON.stringify([240, 11, 20, 13, 127, 247])
  )), false,
    'general customer beta entered BOOT')
  console.log('4/7 general customer beta keeps firmware update isolated')

  await context.setOffline(false)
  await page.evaluate(() => {
    window.__testOnline = true
    window.dispatchEvent(new Event('online'))
  })
  serviceWorkerVersion = 2
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
  await waitFor(
    () => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)),
    'updated worker did not enter waiting state'
  )
  assert.strictEqual(await controllerVersion(page), 1, 'updated worker replaced the active session')

  const spectator = await context.newPage()
  await spectator.goto(`${origin}/#/biotron/play`, {waitUntil: 'load'})
  await spectator.evaluate(() => { window.__pwaSpectator = 'still-open' })
  await Promise.all([
    page.waitForNavigation({waitUntil: 'domcontentloaded'}),
    page.getByRole('button', {name: 'Update app', exact: true}).click()
  ])
  await waitFor(async () => await controllerVersion(page) === 2, 'explicit update did not activate the new worker')
  // First-play intentionally hides readiness. Verify it on Settings after the explicit reload.
  await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await page.getByText(/Offline mode.*Settings.*without internet/i).waitFor({state: 'visible'})
  await spectator.getByRole('button', {name: 'Update app', exact: true}).waitFor()
  assert.strictEqual(await spectator.evaluate(() => window.__pwaSpectator), 'still-open',
    'an update accepted in another tab reloaded the spectator')
  await spectator.getByLabel('Biotron tasks').getByRole('link', {name: 'Settings', exact: true}).click()
  assert(spectator.url().endsWith('/#/biotron/play'), 'Old tab navigated toward a removed route chunk')
  assert.strictEqual(await spectator.evaluate(() => document.activeElement?.textContent.trim()), 'Update app',
    'Blocked route did not focus the explicit update action')
  await Promise.all([
    spectator.waitForNavigation({waitUntil: 'domcontentloaded'}),
    spectator.getByRole('button', {name: 'Update app', exact: true}).click()
  ])
  await spectator.getByRole('heading', {name: 'Plant music', exact: true}).waitFor()
  assert.strictEqual(await spectator.evaluate(() => window.__pwaSpectator), undefined,
    'spectator explicit update did not reload its page')

  await closeProfile()
  page = await openProfile(false)
  await page.goto(`${origin}/biotron`, {waitUntil: 'load'})
  await page.getByText(/Offline mode — Settings are working without internet/i).waitFor({state: 'visible', timeout: 10000})
  assert.strictEqual(await controllerVersion(page), 2, 'accepted update did not persist for the offline restart')
  assert.strictEqual(
    await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)),
    false,
    'old waiting worker remains after deliberate restart'
  )
  console.log('5/7 A→B update required a click, left another tab open, and persisted for an offline restart')

  await context.addInitScript(() => {
    const getRegistration = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker)
    window.__simulateMissingRegistration = true
    navigator.serviceWorker.getRegistration = (...args) => window.__simulateMissingRegistration
      ? Promise.resolve(undefined)
      : getRegistration(...args)
  })
  await page.reload({waitUntil: 'load'})
  await page.getByText(/Connect once to install the offline copy/i).waitFor({state: 'visible', timeout: 10000})
  console.log('6/7 clean-profile offline failure is truthful and actionable')

  await context.setOffline(false)
  await page.evaluate(() => {
    window.__testOnline = true
    window.__simulateMissingRegistration = false
    window.dispatchEvent(new Event('online'))
  })
  await page.getByRole('button', {name: 'Retry', exact: true}).click()
  await page.getByText(/Offline mode is ready/i).waitFor({state: 'visible', timeout: 15000})
  await closeProfile()
  page = await openProfile(false)
  await page.goto(`${origin}/biotron`, {waitUntil: 'load'})
  await page.getByText(/Offline mode — Settings are working without internet/i).waitFor({state: 'visible', timeout: 10000})
  console.log('7/7 Retry repairs offline setup and the same profile launches offline again')

  console.log(`Browser PWA verified across persistent-profile restarts: offline app shell, simulated permission/retry and MIDI setting write, firmware isolation and controlled update. ${context.browser().browserType().name() === 'chromium' ? 'CDP manifest/installability checks ran.' : 'Native installability NOT SUPPORTED by this driver; OS installation NOT RUN.'}`)
})().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await closeProfile()
  server.close()
  fs.rmSync(profile, {recursive: true, force: true})
})
