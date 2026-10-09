const assert = require('node:assert/strict')
const path = require('node:path')
const {launchBrowser, createStaticServer} = require('./browser-test-harness')

const root = process.env.PLAYTRON_DIST_ROOT || path.resolve(__dirname, '..', 'dist')
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
    for (const [route, chords] of [['/playtron', false], ['/playtron/test', true]]) {
      await page.goto(`${origin}/#${route}`, {waitUntil: 'networkidle'})
      await page.getByRole('heading', {name: 'Playtron settings'}).waitFor()
      await page.getByRole('button', {name: 'Save preset'}).waitFor()
      assert.equal(await page.getByText('🎼 Chords Mode', {exact: true}).count(), chords ? 1 : 0,
        `${route} Chords visibility changed`)
      assert.equal(await page.evaluate(() => localStorage.getItem('PlaytronWebMidiId')), '1',
        `${route} changed its preset namespace`)
    }
    await page.evaluate(() => { location.hash = '#/playtron' })
    await page.getByText('🎼 Chords Mode', {exact: true}).waitFor({state: 'detached'})
    await page.evaluate(() => { location.hash = '#/playtron/test' })
    await page.getByText('🎼 Chords Mode', {exact: true}).waitFor()
    await page.goto(`${origin}/#/playtron`, {waitUntil: 'networkidle'})
    const upload = page.getByRole('button', {name: 'Load preset'})
    await upload.focus()
    assert(await upload.evaluate(element => document.activeElement === element), 'preset upload is not keyboard focusable')
    const tooLarge = page.waitForEvent('filechooser')
    await upload.press('Enter')
    await (await tooLarge).setFiles({name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(1024 * 1024 + 1)})
    await page.getByRole('alert').getByText('File is too large. Choose a file smaller than 1 MB.').waitFor()

    await page.evaluate(() => { window.__originalReadAsText = FileReader.prototype.readAsText; FileReader.prototype.readAsText = function () { this.onerror() } })
    const failedRead = page.waitForEvent('filechooser')
    await upload.press('Enter')
    await (await failedRead).setFiles({name: 'preset.txt', mimeType: 'text/plain', buffer: Buffer.from('{"commands":[]}')})
    await page.getByRole('alert').getByText('Could not read this file. Please try again.').waitFor()
    await page.evaluate(() => { FileReader.prototype.readAsText = window.__originalReadAsText })

    const validFile = page.waitForEvent('filechooser')
    await upload.press('Enter')
    await (await validFile).setFiles({name: 'preset.json', mimeType: 'application/json', buffer: Buffer.from('{"commands":[]}')})
    await page.getByRole('alert').waitFor({state: 'detached'})
    await page.waitForFunction(() => localStorage.getItem('PlaytronWebMidiId') === '2')
    assert.deepEqual(errors, [])
    await context.close()
    console.log('Playtron browser verified: route variants, keyboard preset upload, file limits and read recovery.')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
