const assert = require('assert')
const path = require('path')
const fs = require('node:fs')
const {devices} = require('playwright-core')
const {launchBrowser, contextOptions, createStaticServer} = require('./browser-test-harness')

const root = path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist'))
const server = createStaticServer(root)
const artifacts = process.env.QUALITY_BROWSER_OUTPUT || path.join(process.env.BIOTRON_QA_OUTPUT || require('node:os').tmpdir(), `biotron-quality-${Date.now()}`)
fs.mkdirSync(artifacts, {recursive: true})
let currentPage

const profiles = [
  {name: 'desktop', options: {viewport: {width: 1440, height: 900}}, midi: true, heading: 'Settings'},
  {name: 'pixel-7', options: devices['Pixel 7'], midi: true, heading: 'Settings'},
  {
    name: 'compact-320',
    options: {...devices['Pixel 7'], viewport: {width: 320, height: 568}, screen: {width: 320, height: 568}},
    midi: true,
    heading: 'Settings'
  },
  {name: 'iphone-15-no-midi', options: devices['iPhone 15'], midi: false, heading: 'Settings'}
]

async function readQuality(page) {
  return page.evaluate(() => {
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
      '[aria-label="Biotron tasks"] a, .beta-feedback__action, ' +
      'details.settings-section > summary, .sound-palette > summary, ' +
      '.audio-compare button, .computer-keys button, .computer-keys select'
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
}

function assertQuality(result, label, checkCls = true) {
  assert.strictEqual(result.lang, 'en', `${label}: document language is not English`)
  assert.strictEqual(result.mainCount, 1, `${label}: expected one main landmark`)
  assert(result.documentOverflow <= 1, `${label}: page overflows viewport by ${result.documentOverflow}px`)
  if (checkCls && result.cls !== null) assert(result.cls <= 0.1, `${label}: CLS ${result.cls.toFixed(3)} exceeds 0.1`)
  assert.deepStrictEqual(result.duplicateIds, [], `${label}: duplicate IDs`)
  assert.deepStrictEqual(result.unlabeledControls, [], `${label}: visible unlabeled controls`)
  assert.deepStrictEqual(result.smallRanges, [], `${label}: range target below 24px`)
  assert.deepStrictEqual(result.smallPrimaryTargets, [], `${label}: primary target below 44px`)
  assert.deepStrictEqual(result.logo, {source: '/Logo-Black-280.webp', width: '280', height: '199'})
}

async function auditProfile(browser, origin, profile) {
  const context = await browser.newContext(contextOptions({...profile.options, reducedMotion: 'reduce'}, browser))
  context.setDefaultTimeout(5000)
  await context.addInitScript(hasMidi => {
    window.__copiedText = ''
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {
      if (window.__blockClipboard) throw Error('Injected clipboard denial')
      window.__copiedText = text
    }}})
    window.__layoutShiftScore = PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? 0 : null
    if (window.__layoutShiftScore !== null) new PerformanceObserver(list => {
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
  currentPage = page
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  try {
    await page.goto(`${origin}/#/biotron`, {waitUntil: 'domcontentloaded'})
    await page.getByRole('heading', {name: profile.heading}).waitFor()
  } catch (error) {
    fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({profile: profile.name, error: error.message}, null, 2))
    await page.screenshot({path: path.join(artifacts, 'failure.png'), timeout: 2000}).catch(() => {})
    throw error
  }
  await page.getByText(/Offline mode is ready/i).waitFor({timeout: 15000})

  const result = await readQuality(page)
  assert.deepStrictEqual(pageErrors, [], `${profile.name}: page errors`)
  assertQuality(result, profile.name)

  const expandedResults = []
  const auditExpanded = async state => {
    const expanded = await readQuality(page)
    assert.deepStrictEqual(pageErrors, [], `${profile.name}/${state}: page errors`)
    // The initial page retains its CLS budget. User-requested disclosure
    // expansion is audited separately for layout and control quality.
    assertQuality(expanded, `${profile.name}/${state}`, false)
    expandedResults.push({state, cls: expanded.cls, overflow: expanded.documentOverflow})
  }
  {
    await page.getByText(/Local preset — changes stay/).waitFor()
    const opened = []
    for (const name of ['Plant sensor', 'More fun', 'Light sensor', 'Experiments']) {
      const section = page.locator('details.settings-section').filter({
        has: page.locator('summary').filter({hasText: new RegExp('^' + name + '$')})
      })
      assert.equal(await section.count(), 1, `${profile.name}: missing ${name} section`)
      if (!await section.evaluate(element => element.open)) await section.locator('summary').click()
      await section.locator('input:visible, select:visible').first().waitFor()
      opened.push({name, section})
      for (const previous of opened) {
        assert(await previous.section.evaluate(element => element.open),
          `${profile.name}: opening ${name} closed ${previous.name}`)
      }
      await auditExpanded(`Settings ${name} open`)
    }
    const handles = page.locator('.biotron-settings-beta .slider-handle:visible')
    await handles.first().waitFor()
    const sliders = await handles.evaluateAll(elements => elements.map(element => getComputedStyle(element).cursor))
    assert(sliders.length > 0 && sliders.every(cursor => cursor === 'pointer'),
      `${profile.name}: visible settings slider uses a resize cursor`)
  }

  // Feedback is a local editor. No mail client, backend or recorded outcome is
  // required to write, close/reopen or copy a rejection on a phone.
  const feedbackPosts=[]
  page.on('request', request=>{if(request.method()==='POST') feedbackPosts.push(request.postData()||'')})
  await page.getByRole('button',{name:'Tell me what to change',exact:true}).click()
  await page.getByLabel('Your feedback',{exact:true}).fill('Automated feedback fixture: too harsh, no favourite')
  await page.getByRole('button',{name:'Copy feedback',exact:true}).click()
  const feedback=await page.evaluate(()=>window.__copiedText)
  assert(feedback.includes('Version:') && feedback.includes('Page: /biotron') && feedback.includes('too harsh'))
  await page.getByRole('button',{name:'Close',exact:true}).click()
  await page.getByRole('button',{name:'Tell me what to change',exact:true}).click()
  assert((await page.getByLabel('Your feedback').inputValue()).includes('too harsh'))
  await page.evaluate(()=>window.__blockClipboard=true)
  await page.getByRole('button',{name:'Copy feedback',exact:true}).click()
  await page.getByText('Copy was blocked. Select your text and copy it, or use Open email.',{exact:true}).waitFor()
  await page.evaluate(()=>window.__blockClipboard=false)
  assert(feedbackPosts.every(text=>!text.includes('too harsh')), 'feedback text was sent automatically')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth), 'feedback overflows viewport')
  assert.equal(await page.getByRole('link',{name:'Privacy',exact:true}).getAttribute('href'),'https://shop.playtronica.com/pages/privacy')

  if (profile.midi) {
    await page.getByText('Connection details & diagnostics',{exact:true}).click()
    await page.getByText('Show what will be copied',{exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('[aria-label="Diagnostic report"]')?.value.startsWith('Biotron diagnostics'))
    const preview=await page.getByLabel('Diagnostic report',{exact:true}).inputValue()
    await page.getByRole('button',{name:'Copy diagnostics for Andrey',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.__copiedText),preview, 'copied diagnostics differ from preview')
    const packet=JSON.parse(preview.split('\n---\n')[1])
    assert.equal(packet.device.connected,false)
    assert.equal(packet.web_tool.route,'/biotron')
    assert(!preview.includes('too harsh') && !preview.includes('minPlantVelocity') && !preview.includes('no personal data'))
    await page.evaluate(()=>window.__blockClipboard=true)
    await page.getByRole('button',{name:'Copy diagnostics for Andrey',exact:true}).click()
    await page.getByText('Copy was blocked. Open the preview, select the report and copy it.',{exact:true}).waitFor()
    await page.evaluate(()=>window.__blockClipboard=false)
  }

  await page.goto(`${origin}/#/biotron/play`, {waitUntil: 'domcontentloaded'})
  await page.getByRole('heading', {name: 'Plant music'}).waitFor()
  assert.strictEqual(await page.locator('.beta-feedback').count(), 0,
    `${profile.name}: first play must not duplicate the generic feedback block`)
  const playResult = await readQuality(page)
  // Hash-route navigation shares the observer with the prior disclosure gestures.
  assertQuality(playResult, `${profile.name}/Play closed`, false)
  assert.deepStrictEqual(pageErrors, [], `${profile.name}/Play closed: page errors`)
  const sound = page.locator('.sound-palette')
  assert.equal(await sound.count(), 1, `${profile.name}: missing Sound palette`)
  assert.equal(await sound.evaluate(element => element.open), false,
    `${profile.name}: Sound opened without a user request`)
  assert.equal(await sound.locator('.audio-compare').count(), 0,
    `${profile.name}: unopened Sound mounted its lazy controls`)
  await sound.locator('summary').click()
  await sound.getByLabel('Sound', {exact: true}).waitFor()
  assert(await sound.evaluate(element => element.open), `${profile.name}: Sound did not open`)
  assert.equal(await sound.getByLabel('Sound', {exact: true}).locator('option').count(), 7,
    `${profile.name}: Classic sound choices are missing`)
  await page.getByLabel('Low CPU', {exact: true}).waitFor()
  await page.getByLabel('Keyboard octave', {exact: true}).waitFor()
  await auditExpanded('Play Sound open')

  if (profile.midi) {
    await page.getByRole('button', {name: 'Start listening'}).click()
    // Wait for the async attempt's outcome before opening its disclosure.
    try {
      await page.getByRole('heading', {name: 'Can you hear the notes?', includeHidden: true}).waitFor({state: 'attached', timeout: 15000})
    } catch (error) {
      console.error('QUALITY_FIRST_FAULT', profile.name, await page.locator('body').innerText(), pageErrors)
      await page.screenshot({path: path.join(require('os').tmpdir(), `biotron-quality-${profile.name}-${Date.now()}.png`), fullPage: true})
      throw error
    }
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
  const cls = value => value === null ? 'NOT MEASURABLE in this engine' : value.toFixed(3)
  return `${profile.name}: initial CLS ${cls(result.cls)}, overflow ${result.documentOverflow}px; Play CLS ${cls(playResult.cls)}; ${expandedResults.length} opened states checked`
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchBrowser()
  try {
    const results = []
    for (const profile of profiles) {
      results.push(await auditProfile(browser, origin, profile))
      fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({browser: process.env.BIOTRON_QA_BROWSER || 'chrome',
        engine: browser.browserType().name(), version: browser.version(), root, results}, null, 2))
    }
    console.log(`Responsive quality verified — ${results.join('; ')}`)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(async error => {
  if (!fs.existsSync(path.join(artifacts, 'failure.json'))) fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({error: error.message}, null, 2))
  await currentPage?.screenshot({path: path.join(artifacts, 'failure.png'), timeout: 1000}).catch(() => {})
  console.error(error)
  server.close(() => process.exit(1))
})
