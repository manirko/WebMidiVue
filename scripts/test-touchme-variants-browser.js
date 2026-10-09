const assert = require('node:assert/strict')
const path = require('node:path')
const {launchBrowser, createStaticServer} = require('./browser-test-harness')
const root = process.env.TOUCHME_DIST_ROOT || path.resolve(__dirname, '..', 'dist')
const server = createStaticServer(root)
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchBrowser()
  try {
    const context = await browser.newContext()
    context.setDefaultTimeout(5000)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => ({
        inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}
      })})
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const [route, modes] of [['/touchme', false], ['/touchme/test', true]]) {
      await page.goto(`${origin}/#${route}`, {waitUntil: 'networkidle'})
      await page.getByRole('heading', {name: 'TouchMe settings'}).waitFor()
      await page.getByRole('button', {name: 'Save preset'}).waitFor()
      assert.equal(await page.locator('label').filter({hasText: '🎼 Modes Page'}).count(), modes ? 1 : 0)
      assert.equal(await page.locator('label').filter({hasText: '🎼 Scale'}).count(), modes ? 0 : 1)
      assert.equal(await page.evaluate(() => localStorage.getItem('TouchmeWebMidiId_2')), '1')
    }
    await page.evaluate(() => {location.hash = '#/touchme'})
    await page.locator('label').filter({hasText: '🎼 Scale'}).waitFor()
    await page.evaluate(() => {location.hash = '#/touchme/test'})
    await page.locator('label').filter({hasText: '🎼 Modes Page'}).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
    console.log('TouchMe browser variants verified: both routes, mode controls and shared preset namespace.')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {console.error(error); process.exitCode = 1})
