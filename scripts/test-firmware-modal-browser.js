// Field report 2026-10-06 (Windows Chrome, 1366x768): the firmware modal was cut off and
// "Download & check" could not be clicked. Cause: backdrop-filter on its ancestor card made
// the card the modal's containing block and stacking context, below Bootstrap's backdrop.
// Runs on the firmware beta build; test:biotron rebuilds the plain beta into dist afterwards.
const assert = require('assert')
const path = require('path')
const fs = require('node:fs')
const os = require('node:os')
const {launchBrowser, createStaticServer} = require('./browser-test-harness')

const server = createStaticServer(path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist')))
// Full 1366x768 window and its usual inner viewport in a maximised Windows Chrome.
const viewports = [{width: 1366, height: 768}, {width: 1366, height: 657}]
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
  if (capability.picker) await action.waitFor()
  else {
    assert.equal(await action.count(), 0, 'No automatic install action without a directory picker')
    await page.getByText('Firmware updates run from a computer with Chrome or Edge.', {exact: false}).waitFor()
    assert.strictEqual(await page.locator('#UpdateConf a[download]').getAttribute('href'),
      '/firmware/biotron-1.10.10-internal.uf2', 'Manual recovery link remains available')
  }

  const size = `${viewport.width}x${viewport.height}`
  const footer = await checkFooter(page, size)

  if (capability.picker) {
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
  return `${size}: ${footer.length} footer buttons visible and clickable; automatic directory install ${capability.picker ? 'download/check verified; physical NOT RUN' : 'NOT SUPPORTED; manual recovery UI verified'}`
}

;(async () => {
  let browser, fault
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await launchBrowser()
    const results = []
    for (const viewport of viewports) results.push(await check(browser, origin, viewport))
    write('results.json', {results, physical: 'NOT RUN', midi: 'synthetic empty ports'})
    console.log(`Firmware modal verified — ${results.join('; ')}; evidence ${evidence}`)
  } catch (error) {
    fault = error
    write('first-fault.json', {message: error.message, name: error.name, physical: 'NOT RUN'})
    console.error(error)
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
