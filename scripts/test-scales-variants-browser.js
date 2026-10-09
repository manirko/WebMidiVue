const assert = require('node:assert/strict')
const path = require('node:path')
const {launchBrowser, createStaticServer} = require('./browser-test-harness')
const root = process.env.SCALES_DIST_ROOT || path.resolve(__dirname, '..', 'dist')
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
    for (const [route, extra, deviceLabel, presetLabel] of [
      ['/scales', true, 'Select device', 'Preset'],
      ['/scales/test', false, 'Select device', 'Preset']
    ]) {
      await page.goto(`${origin}/#${route}`, {waitUntil: 'networkidle'})
      await page.getByRole('heading', {name: 'Scales change settings'}).waitFor()
      assert.equal(await page.getByText('Extra', {exact: true}).count(), extra ? 1 : 0, `${route} Extra changed`)
      await page.getByText(deviceLabel, {exact: true}).waitFor()
      await page.getByText(presetLabel, {exact: true}).waitFor()
      assert.equal(await page.evaluate(() => localStorage.getItem('ScalesWebMidiId_1')), '1')
    }
    await page.evaluate(() => {location.hash = '#/scales'})
    await page.getByText('Extra', {exact: true}).waitFor()
    await page.evaluate(() => {location.hash = '#/scales/test'})
    await page.getByText('Extra', {exact: true}).waitFor({state: 'detached'})
    assert.deepEqual(errors, [])
    await context.close()
    console.log('Scales browser variants verified: both routes, Extra controls, labels and shared preset namespace.')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {console.error(error); process.exitCode = 1})
