// Field report 2026-10-06 (Windows Chrome, 1366x768): the firmware modal was cut off and
// "Download & check" could not be clicked. Cause: backdrop-filter on its ancestor card made
// the card the modal's containing block and stacking context, below Bootstrap's backdrop.
// Runs on the firmware beta build; test:biotron rebuilds the plain beta into dist afterwards.
const assert = require('assert')
const path = require('path')
const {launchBrowser, createStaticServer} = require('./browser-test-harness')

const server = createStaticServer(path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist')))
// Full 1366x768 window and its usual inner viewport in a maximised Windows Chrome.
const viewports = [{width: 1366, height: 768}, {width: 1366, height: 657}]

async function check(browser, origin, viewport) {
  const context = await browser.newContext({viewport, reducedMotion: 'reduce'})
  context.setDefaultTimeout(5000)
  await context.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async () => ({inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}})
  }))
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await page.locator('[data-bs-target="#UpdateConf"]').click()
  const action = page.locator('#UpdateConf .modal-footer').getByRole('button', {name: /Download & check/})
  await action.waitFor()

  const footer = await page.evaluate(() => [...document.querySelectorAll('#UpdateConf .modal-footer .btn')].map(button => {
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      text: button.textContent.trim(),
      inside: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      hit: Boolean(hit && button.contains(hit))
    }
  }))
  const size = `${viewport.width}x${viewport.height}`
  for (const button of footer) {
    assert(button.inside, `${size}: "${button.text}" is outside the viewport`)
    assert(button.hit, `${size}: "${button.text}" is covered at its centre`)
  }

  await action.click()
  await page.getByText(/Firmware 1\.10\.10 is checked and held in this page/).waitFor({timeout: 15000})
  assert.strictEqual(await page.locator('#UpdateConf a[download]').getAttribute('href'),
    '/firmware/biotron-1.10.10-internal.uf2')
  assert.deepStrictEqual(pageErrors, [], `${size}: page errors`)
  await context.close()
  return `${size}: ${footer.length} footer buttons visible and clickable`
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchBrowser()
  try {
    const results = []
    for (const viewport of viewports) results.push(await check(browser, origin, viewport))
    console.log(`Firmware modal verified — ${results.join('; ')}`)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {
  console.error(error)
  server.close(() => process.exit(1))
})
