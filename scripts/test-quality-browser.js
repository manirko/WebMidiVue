const assert = require('assert')
const path = require('path')
const {chromium, devices} = require('playwright-core')
const {chromePath, createStaticServer} = require('./browser-test-harness')

const root = path.resolve(__dirname, '..', 'dist')
const server = createStaticServer(root)

const profiles = [
  {name: 'desktop', options: {viewport: {width: 1440, height: 900}}, midi: true, heading: 'Settings'},
  {name: 'pixel-7', options: devices['Pixel 7'], midi: true, heading: 'Settings'},
  {
    name: 'compact-320',
    options: {...devices['Pixel 7'], viewport: {width: 320, height: 568}, screen: {width: 320, height: 568}},
    midi: true,
    heading: 'Settings'
  },
  {name: 'iphone-15-no-midi', options: devices['iPhone 15'], midi: false, heading: 'No MIDI in this browser'}
]

async function auditProfile(browser, origin, profile) {
  const context = await browser.newContext({...profile.options, reducedMotion: 'reduce'})
  context.setDefaultTimeout(5000)
  await context.addInitScript(hasMidi => {
    window.__layoutShiftScore = 0
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__layoutShiftScore += entry.value
      }
    }).observe({type: 'layout-shift', buffered: true})

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: hasMidi
        ? async () => ({inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}})
        : undefined
    })
  }, profile.midi)

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
  await page.getByRole('heading', {name: profile.heading}).waitFor()
  await page.getByText(/Offline mode is ready/i).waitFor({timeout: 15000})

  const result = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null
    }
    const hasName = element => Boolean(
      element.getAttribute('aria-label')?.trim() ||
      element.getAttribute('aria-labelledby')?.trim() ||
      [...(element.labels || [])].some(label => label.textContent.trim())
    )
    const unlabeledControls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter(visible)
      .filter(element => !hasName(element))
      .map(element => element.outerHTML.slice(0, 180))
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id).filter(Boolean)
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    const smallRanges = [...document.querySelectorAll('input[type="range"]')]
      .filter(visible)
      .map(element => ({name: element.getAttribute('aria-label'), height: element.getBoundingClientRect().height}))
      .filter(({height}) => height < 24)
    const smallPrimaryTargets = [...document.querySelectorAll(
      '[aria-label="Biotron tasks"] a, .beta-feedback__action'
    )]
      .filter(visible)
      .map(element => ({text: element.textContent.trim(), rect: element.getBoundingClientRect().toJSON()}))
      .filter(({rect}) => rect.width < 44 || rect.height < 44)
    const logo = document.querySelector('img[itemprop="logo"]')

    return {
      cls: window.__layoutShiftScore,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      duplicateIds,
      lang: document.documentElement.lang,
      logo: logo && {
        source: logo.getAttribute('src'),
        width: logo.getAttribute('width'),
        height: logo.getAttribute('height')
      },
      mainCount: document.querySelectorAll('main').length,
      smallPrimaryTargets,
      smallRanges,
      unlabeledControls
    }
  })

  assert.deepStrictEqual(pageErrors, [], `${profile.name}: page errors`)
  assert.strictEqual(result.lang, 'en', `${profile.name}: document language is not English`)
  assert.strictEqual(result.mainCount, 1, `${profile.name}: expected one main landmark`)
  assert(result.documentOverflow <= 1, `${profile.name}: page overflows viewport by ${result.documentOverflow}px`)
  assert(result.cls <= 0.1, `${profile.name}: CLS ${result.cls.toFixed(3)} exceeds 0.1`)
  assert.deepStrictEqual(result.duplicateIds, [], `${profile.name}: duplicate IDs`)
  assert.deepStrictEqual(result.unlabeledControls, [], `${profile.name}: visible unlabeled controls`)
  assert.deepStrictEqual(result.smallRanges, [], `${profile.name}: range target below 24px`)
  assert.deepStrictEqual(result.smallPrimaryTargets, [], `${profile.name}: primary target below 44px`)
  assert.deepStrictEqual(result.logo, {source: '/Logo-Black-280.webp', width: '280', height: '199'})

  if (profile.midi) {
    await page.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
    await page.getByRole('heading', {name: 'Plant music'}).waitFor()
    assert.strictEqual(await page.locator('.beta-feedback').count(), 0,
      `${profile.name}: first play must not duplicate the generic feedback block`)
    await page.getByRole('button', {name: 'Start listening'}).click()
    await page.getByText('No sound? · Help', {exact: true}).click()
    await page.getByRole('heading', {name: 'Can you hear the notes?'}).waitFor()
    const feedbackGap = await page.evaluate(() => {
      const main = document.querySelector('main')
      const feedback = document.querySelector('.sound-lab__task-feedback')
      return Math.round(feedback.getBoundingClientRect().top - main.getBoundingClientRect().bottom)
    })
    assert(feedbackGap <= 80, `${profile.name}: task feedback is hidden behind ${feedbackGap}px of empty space`)
  }

  await context.close()
  return `${profile.name}: CLS ${result.cls.toFixed(3)}, overflow ${result.documentOverflow}px`
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({executablePath: chromePath(), headless: true})
  try {
    const results = []
    for (const profile of profiles) results.push(await auditProfile(browser, origin, profile))
    console.log(`Responsive quality verified — ${results.join('; ')}`)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {
  console.error(error)
  server.close(() => process.exit(1))
})
