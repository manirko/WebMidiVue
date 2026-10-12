// Field report 2026-10-06 (Windows Chrome, 1366x768): the firmware modal was cut off and
// "Download & check" could not be clicked. Cause: backdrop-filter on its ancestor card made
// the card the modal's containing block and stacking context, below Bootstrap's backdrop.
// Runs on the firmware beta build; test:biotron rebuilds the plain beta into dist afterwards.
const assert = require('assert')
const path = require('path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')
const {launchBrowser, createStaticServer, browserCall} = require('./browser-test-harness')

const runtime = path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist'))
const internal = fs.existsSync(path.join(runtime, 'firmware/biotron-1.10.10-internal.uf2'))
const server = createStaticServer(runtime)
// Full 1366x768 window and its usual inner viewport in a maximised Windows Chrome.
const viewports = [{width: 1366, height: 768}, {width: 1366, height: 657}, {width: 390, height: 844}, {width: 320, height: 568}]
const evidence = fs.mkdtempSync(path.join(process.env.BIOTRON_QA_OUTPUT || os.tmpdir(),
  `firmware-modal-${process.env.BIOTRON_QA_BROWSER || 'chrome'}-`))
const observations = []
const write = (name, data) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(data, null, 2))
let currentPage

async function checkFooter(page, size) {
  const close = page.locator('#UpdateConf .modal-footer').getByRole('button', {name: 'Close', exact: true})
  assert.strictEqual(await close.count(), 1, 'Close button missing or duplicated')
  assert(await close.isVisible(), 'Close button is not visible')
  assert(await close.isEnabled(), 'Close button is not enabled')
  const footer = await page.evaluate(() => [...document.querySelectorAll('#UpdateConf .modal-footer .btn')].map(button => {
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      text: button.textContent.trim(),
      inside: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      hit: Boolean(hit && button.contains(hit))
    }
  }))
  for (const button of footer) {
    assert(button.inside, `${size}: "${button.text}" is outside the viewport`)
    assert(button.hit, `${size}: "${button.text}" is covered at its centre`)
  }

  return footer
}

async function check(browser, origin, viewport) {
  const context = await browser.newContext({viewport, reducedMotion: 'reduce'})
  context.setDefaultTimeout(5000)
  await context.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async () => ({inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}})
  }))
  const page = currentPage = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await page.locator('[data-bs-target="#UpdateConf"]').click()
  const action = page.locator('#UpdateConf .modal-footer').getByRole('button', {name: /Download & check/})
  const capability = await page.evaluate(() => ({picker: typeof window.showDirectoryPicker === 'function'}))
  observations.push({viewport, capability})
  write('capabilities.json', observations)
  await page.locator('#UpdateConf.show').waitFor()
  if (!internal) {
    assert.equal(await action.count(), 0, 'Public updater must not prepare firmware without device/version identity')
    await page.getByText(/Connect Biotron with a USB data cable to check its firmware version/).waitFor()
  } else if (capability.picker) await action.waitFor()
  else {
    assert.equal(await action.count(), 0, 'No automatic install action without a directory picker')
    await page.getByText('Firmware updates run from a computer with Chrome or Edge.', {exact: false}).waitFor()
    assert.strictEqual(await page.locator('#UpdateConf a[download]').getAttribute('href'),
      '/firmware/biotron-1.10.10-internal.uf2', 'Manual recovery link remains available')
  }

  const size = `${viewport.width}x${viewport.height}`
  const footer = await checkFooter(page, size)

  if (internal && capability.picker) {
    await action.click()
    await page.getByText(/Firmware 1\.10\.10 is checked and held in this page/).waitFor({timeout: 15000})
    assert.strictEqual(await page.locator('#UpdateConf a[download]').getAttribute('href'),
      '/firmware/biotron-1.10.10-internal.uf2')
  }
  assert.deepStrictEqual(pageErrors, [], `${size}: page errors`)
  await page.locator('#UpdateConf .modal-footer').getByRole('button', {name: 'Close', exact: true}).click()
  await page.locator('#UpdateConf').waitFor({state: 'hidden'})
  await page.locator('[data-bs-target="#UpdateConf"]').click()
  await page.locator('#UpdateConf.show').waitFor()
  // Real DOM counterexample: an absent footer must not pass an empty geometry loop.
  await page.locator('#UpdateConf .modal-footer').evaluate(element => element.remove())
  await assert.rejects(checkFooter(page, size), /Close button missing or duplicated/)
  await context.close()
  return `${size}: ${footer.length} footer buttons visible and clickable; automatic directory install ${!internal ? 'NOT RUN; disconnected version check has clear USB next step' : capability.picker ? 'download/check verified; physical NOT RUN' : 'NOT SUPPORTED; manual recovery UI verified'}`
}


async function updateJourney(browser, origin, installed, mode = 'normal') {
  // No native port or filesystem handle is requested: the actual compiled updater sees controlled doubles.
  const stablePath = process.env.BIOTRON_QA_STABLE_UF2
  if (!internal && !stablePath) return {installed, result: 'NOT RUN: provide pinned stable UF2 test input', physical: 'NOT RUN'}
  const bytes = fs.readFileSync(internal ? path.join(runtime, 'firmware/biotron-1.10.10-internal.uf2') : stablePath)
  const target = internal ? '1.10.10' : '1.8.2', name = `biotron-firmware_v${target}.uf2`
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, internal ? '598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d' : 'd2406d66225f76779331714b0a9df814d1c72d7f3640178f29adc9d3b45b4251', 'Unpinned firmware fixture')
  const context = await browser.newContext({viewport: {width: 1366, height: 657}, serviceWorkers: 'block', reducedMotion: 'reduce'})
  context.setDefaultTimeout(5000)
  await context.route('**/api/telemetry', route => route.fulfill({status: 503, body: '{}'}))
  await context.route('https://api.github.com/repos/Playtronica/biotron-firmware/releases/latest', route => route.fulfill({json: {tag_name: target, draft: false, prerelease: false, assets: [{name, size: bytes.length, digest: `sha256:${sha256}`, browser_download_url: `https://github.com/Playtronica/biotron-firmware/releases/download/${target}/${name}`}]}}))
  await context.route(`https://github.com/Playtronica/biotron-firmware/releases/download/${target}/${name}`, route => route.fulfill({body: bytes}))
  await context.addInitScript(({installed, target, expectedBytes, mode}) => {
    let firmware = installed
    const record = window.__firmwareFixture = {queries: [], boot: 0, picks: 0, writes: 0, closes: 0, aborts: 0, byteSnapshot: null}
    const input = {id: 'fixture-in', name: 'Biotron Port 1', manufacturer: 'Playtronica', type: 'input', state: 'connected', connection: 'closed', open: async () => {input.connection = 'open'; return input}, close: async () => {input.connection = 'closed'; return input}, onmidimessage: null}
    const output = {id: 'fixture-out', name: 'Biotron Port 1', manufacturer: 'Playtronica', type: 'output', state: 'connected', connection: 'closed', open: async () => {output.connection = 'open'; return output}, close: async () => {output.connection = 'closed'; return output}, send(data) {
      const frame = [...data]
      if (frame[0] === 240 && frame[1] === 11 && frame.at(-2) === 127) {
        if (output.state === 'disconnected') throw new DOMException('Simulated immediate MIDI disconnect', 'InvalidStateError')
        record.boot++; record.disconnect(); return
      }
      if (frame[0] !== 240 || ![123, 124, 126].includes(frame[3])) throw new Error('Unexpected write/calibration/other-device command in firmware fixture')
      record.queries.push(frame[3])
      if (frame[3] === 126 && firmware) setTimeout(() => input.onmidimessage?.({data: new Uint8Array([240, 11, 126, frame[4], ...firmware.split('.').map(Number), 247])}), 0)
      if (frame[3] === 123) setTimeout(() => input.onmidimessage?.({data: new Uint8Array([240, 20, 13, 123, 1, 1, 1, frame[5], 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 4, 18, 4, 50, 10, 0, 4, 8, 98, 74, 102, 0, 1, 0, 12, 0, 0, 1, 1, 0, 1, 60, 2, 1, 100, 0, 247])}), 0)
    }}
    const midi = {inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null, addEventListener() {}, removeEventListener() {}}
    record.disconnect = () => {input.state = output.state = 'disconnected'; midi.inputs.clear(); midi.outputs.clear(); midi.onstatechange?.({port: output})}
    record.reconnect = version => {firmware = version; input.state = output.state = 'connected'; midi.inputs.set(input.id, input); midi.outputs.set(output.id, output); midi.onstatechange?.({port: output})}
    Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => midi})
    if (window.showDirectoryPicker) window.showDirectoryPicker = async () => {
      record.picks++
      if (record.picks === 1) throw new DOMException('Cancelled fixture picker', 'AbortError')
      return {name: '\\', getFileHandle: async (filename, options) => {
        if (filename === 'INFO_UF2.TXT') return {getFile: async () => ({text: async () => record.picks === 2 ? 'Board-ID: RP2350\n' : 'UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n'})}
        if (!options?.create) throw new Error('Firmware creation flag missing')
        return {createWritable: async () => ({write: async data => {record.writes++; record.byteSnapshot = [...data]; if (data.length !== expectedBytes) throw new Error('Incorrect byte count')},
          close: async () => {record.closes++; record.reconnect(mode === 'late-version' ? '1.7.4' : target)}, abort: async () => {record.aborts++}})}
      }}
    }
  }, {installed, target, expectedBytes: bytes.length, mode})
  const page = currentPage = await context.newPage(), pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await page.locator('#biotron-device').waitFor()
  if (!installed) {
    await page.getByRole('button', {name: 'Check firmware', exact: true}).waitFor()
    await page.getByRole('link', {name: 'Cannot read the version? Biotron recovery help', exact: true}).waitFor()
    assert.equal(await page.evaluate(() => window.__firmwareFixture.boot), 0)
    if (!internal) {await context.close(); return {installed: 'unknown', target, result: 'Check/help; no public install/BOOT', physical: 'NOT RUN'}}
    await page.evaluate(() => window.__firmwareFixture.disconnect())
  }
  const upToDate = installed && installed.split('.').reduce((sum, part) => sum * 100 + Number(part), 0) >= target.split('.').reduce((sum, part) => sum * 100 + Number(part), 0)
  if (upToDate) {
    const current = page.locator('[data-bs-target="#UpdateConf"]')
    await page.waitForFunction(version => {const button = document.querySelector('[data-bs-target="#UpdateConf"]'); return button?.disabled && button.textContent.includes(`Firmware ${version}`)}, installed)
    assert.match(await current.innerText(), /Firmware/)
    const fixture = await page.evaluate(() => ({...window.__firmwareFixture, byteSnapshot: undefined})); assert.equal(fixture.boot, 0); assert.equal(fixture.writes, 0)
    await context.close(); return {installed, target, result: 'no downgrade/reinstall', physical: 'NOT RUN'}
  }
  await page.locator('[data-bs-target="#UpdateConf"]').click()
  const action = text => page.locator('#UpdateConf .modal-footer').getByRole('button', {name: text, exact: false})
  await page.locator('#UpdateConf.show').waitFor()
  if (!await page.evaluate(() => Boolean(window.showDirectoryPicker))) {
    await page.getByText('Firmware updates run from a computer with Chrome or Edge.', {exact: false}).waitFor()
    assert.equal(await action(/Download & check/).count(), 0); await context.close()
    return {installed, target, result: 'desktop picker unavailable; manual file/help visible', physical: 'NOT RUN'}
  }
  await action(/Download & check/).click(); await page.getByText(new RegExp(`Firmware ${target.replace(/\./g, '\\.')} is checked and held`)).waitFor()
  if (installed) {
    await action(installed === '1.7.3' ? 'Continue to drive selection' : /Restart Biotron/).click()
    if (installed === '1.7.3') {assert.equal(await page.evaluate(() => window.__firmwareFixture.boot), 0); await page.evaluate(() => window.__firmwareFixture.disconnect())}
  }
  await action(/Choose RPI-RP2 → install/).waitFor()
  await page.waitForFunction(() => !document.querySelector('#UpdateConf .modal-footer .btn-primary:not(:disabled)')?.disabled)
  await action(/Choose RPI-RP2 → install/).click(); await page.getByText(/No drive chosen/).waitFor()
  assert.equal(await page.evaluate(() => window.__firmwareFixture.writes), 0)
  await action(/Choose RPI-RP2 → install/).click(); await page.getByRole('alert').filter({hasText: /Nothing was written/}).waitFor()
  assert.equal(await page.evaluate(() => window.__firmwareFixture.writes), 0)
  await action(/Choose RPI-RP2 → install/).click()
  if (mode === 'late-version') {
    await page.getByRole('alert').filter({hasText: /Expected firmware did not reconnect/}).waitFor({timeout: 35000})
    await action('Check connected firmware').click()
    assert.equal(await page.getByText(/installed and verified by its reported version/).count(), 0)
    await page.evaluate(target => window.__firmwareFixture.reconnect(target), target)
  }
  await page.getByText(/installed and verified by its reported version/).waitFor()
  const fixture = await page.evaluate(() => ({...window.__firmwareFixture, byteSnapshot: window.__firmwareFixture.byteSnapshot}))
  assert.equal(fixture.writes, 1); assert.equal(fixture.closes, 1); assert.equal(fixture.picks, 3)
  assert(Buffer.from(fixture.byteSnapshot).equals(bytes), 'Compiled updater wrote different bytes')
  const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('biotron.firmware-journal.v1') || '[]'))
  const attempt = journal.find(entry => entry.phase === 'preparing')?.attempt
  assert(attempt); assert(journal.some(entry => entry.attempt === attempt && entry.error === 'cancelled')); assert(journal.some(entry => entry.attempt === attempt && entry.error === 'drive_mismatch'))
  assert(journal.some(entry => entry.attempt === attempt && entry.phase === 'complete' && entry.reported === target))
  assert.deepStrictEqual(pageErrors, [])
  const report = {installed: installed || 'unknown/internal recovery', target, mode, bootRequests: fixture.boot, picks: fixture.picks, writes: fixture.writes, sha256, attempt, phases: journal.filter(entry => entry.attempt === attempt).map(entry => ({phase: entry.phase, error: entry.error})), physical: 'NOT RUN; simulated MIDI/picker/drive/reconnect with actual compiled updater and pinned UF2 bytes'}
  await context.close(); return report
}

;(async () => {
  let browser, fault
  try {
    assert(fs.existsSync(path.join(runtime, 'index.html')), 'Compiled runtime is missing: build before launching a browser')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await launchBrowser()
    const results = []
    for (const viewport of viewports) results.push(await check(browser, origin, viewport))
    const journeys = []
    for (const installed of ['1.7.3', '1.7.4', internal ? '1.10.10' : '1.8.2', internal ? '1.10.11' : '1.10.10', '']) journeys.push(await updateJourney(browser, origin, installed))
    if (internal) journeys.push(await updateJourney(browser, origin, '1.7.4', 'late-version'))
    write('journeys.json', journeys)
    write('results.json', {results, journeys, physical: 'NOT RUN', midi: 'synthetic empty ports/controlled firmware fixtures'})
    console.log(`Firmware modal verified — ${results.join('; ')}; evidence ${evidence}`)
  } catch (error) {
    fault = error
    write('first-fault.json', {message: error.message, name: error.name, physical: 'NOT RUN'})
    console.error(error)
    if (currentPage && !currentPage.isClosed()) try { write('first-fault-state.json', await browserCall(currentPage.context().browser(), () => currentPage.evaluate(() => ({text: document.body.innerText.slice(0, 12000), fixture: window.__firmwareFixture ? {...window.__firmwareFixture, byteSnapshot: undefined} : null, journal: JSON.parse(localStorage.getItem('biotron.firmware-journal.v1') || '[]').slice(-30)})), 'first-fault state', 2000)) } catch (captureError) {write('state-unavailable.json', {message: captureError.message})}
    if (currentPage && !currentPage.isClosed()) try {
      await currentPage.screenshot({path: path.join(evidence, 'first-fault.png'), timeout: 2000})
    } catch (captureError) {write('screenshot-unavailable.json', {message: captureError.message})}
  } finally {
    // Record the first assertion before closing; cleanup must not erase it.
    if (server.listening) server.closeAllConnections()
    if (browser) try {await browser.close()} catch (error) {fault ||= error}
    if (server.listening) try {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    } catch (error) {fault ||= error}
  }
  if (fault) throw fault
})().catch(error => {console.error(error); process.exitCode = 1})
