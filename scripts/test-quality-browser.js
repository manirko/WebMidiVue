const assert = require('assert')
const path = require('path')
const fs = require('node:fs')
const {devices} = require('playwright-core')
const {launchBrowser, gotoReady, contextOptions, qaOrigin, verifyOnlineIdentity, verifyOnlineArtifact, isolateOnlineWrites, createStaticServer} = require('./browser-test-harness')

const root = path.resolve(process.env.BIOTRON_QA_DIST_ROOT || path.join(__dirname, '..', 'dist'))
const server = createStaticServer(root)
const artifacts = process.env.QUALITY_BROWSER_OUTPUT || path.join(process.env.BIOTRON_QA_OUTPUT || require('node:os').tmpdir(), `biotron-quality-${Date.now()}`)
fs.mkdirSync(artifacts, {recursive: true})
let currentPage, currentProfile, currentHint

const profiles = [
  {name: 'desktop', options: {viewport: {width: 1440, height: 900}}, midi: true, heading: 'Settings'},
  {name: 'narrow-desktop', options: {viewport: {width: 320, height: 568}}, midi: true, heading: 'Settings'},
  {name: 'pixel-7', options: devices['Pixel 7'], midi: true, heading: 'Settings'},
  {
    name: 'compact-320',
    options: {...devices['Pixel 7'], viewport: {width: 320, height: 568}, screen: {width: 320, height: 568}},
    midi: true,
    heading: 'Settings'
  },
  {name: 'iphone-15-no-midi', options: devices['iPhone 15'], midi: false, heading: 'Settings'},
  {name: 'ipad-touch', options: devices['iPad Pro 11'], midi: true, heading: 'Settings'}
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
      '.audio-compare button, .computer-keys button, .computer-keys select, .computer-keys summary, ' +
      '.compatibility-notice__actions .btn, .sound-lab__controls button'
    )]
      .filter(visible)
      .map(element => ({text: element.textContent.trim(), rect: element.getBoundingClientRect().toJSON()}))
      .filter(({rect}) => rect.width < 44 || rect.height < 44)
    const logo = document.querySelector('img[itemprop="logo"]')

    return {
      cls: window.__layoutShiftScore,
      layoutShifts: window.__layoutShiftEntries,
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

async function auditHints(page, profile) {
  const hints = page.locator('details.hint:visible')
  const readings = []
  const controls = () => page.locator('.biotron-settings-beta input, .biotron-settings-beta select')
    .evaluateAll(elements => elements.map(element => ({value: element.value, checked: element.checked})))
  const originalControls = await controls()
  assert(await hints.count() > 0, `${profile.name}: no settings explanations checked`)
  for (let index = 0; index < await hints.count(); index++) {
    currentHint = {index, phase: 'open'}
    const hint = hints.nth(index), trigger = hint.locator('summary')
    if (profile.options.hasTouch) await trigger.tap(); else await trigger.click()
    const text = hint.locator('[role="tooltip"], .hint-text')
    currentHint.phase = 'scroll'
    await text.scrollIntoViewIfNeeded()
    currentHint.phase = 'read-and-close'
    const reading = await text.evaluate(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      return {text: element.textContent, rect: rect.toJSON(), viewport: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        style: Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
          'textTransform', 'textAlign', 'whiteSpace'].map(key => [key, style[key]]))}
    })
    readings.push(reading)
    fs.writeFileSync(path.join(artifacts, `${profile.name}-hints.json`), JSON.stringify(readings, null, 2))
    assert(reading.rect.left >= 0 && reading.rect.right <= reading.viewport + 1 && reading.overflow <= 1,
      `${profile.name}: help outside viewport: ${JSON.stringify(reading)}`)
    assert.equal(reading.style.fontWeight, '400', `${profile.name}: help inherits bold label`)
    assert.equal(reading.style.textAlign, 'left', `${profile.name}: help alignment differs`)
    if (index === 0) await page.screenshot({path: path.join(artifacts, `${profile.name}-help.png`), timeout: 2000})
    assert.deepStrictEqual(reading.style, readings[0].style, `${profile.name}: help formatting differs`)
    if (profile.options.hasTouch) await trigger.tap(); else await trigger.click()
    assert.equal(await hint.evaluate(element => element.open), false, `${profile.name}: help did not close`)
    assert.equal(await text.isVisible(), false, `${profile.name}: closed help remains visible`)
  }
  // Text enlargement and an unbroken token must remain readable in the same real disclosure.
  const firstHint = hints.first()
  currentHint = {index: 0, phase: 'enlarged-and-keyboard'}
  await firstHint.locator('summary').click()
  await firstHint.locator('[role="tooltip"], .hint-text').evaluate(element => {
    element.textContent = 'Long explanation\n' + 'x'.repeat(200)
    document.documentElement.style.fontSize = '200%'
  })
  await firstHint.locator('[role="tooltip"], .hint-text').scrollIntoViewIfNeeded()
  const enlarged = await firstHint.locator('[role="tooltip"], .hint-text').evaluate(element => ({
    overflow: element.scrollWidth - element.clientWidth, text: element.textContent,
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth
  }))
  fs.writeFileSync(path.join(artifacts, `${profile.name}-enlarged-help.json`), JSON.stringify(enlarged, null, 2))
  assert(enlarged.overflow <= 1 && enlarged.left >= 0 && enlarged.right <= enlarged.viewport + 1,
    `${profile.name}: enlarged/long explanation is clipped`)
  assert.equal(enlarged.text, 'Long explanation\n' + 'x'.repeat(200))
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))
  await firstHint.locator('summary').click()
  assert.deepStrictEqual(await controls(), originalControls, `${profile.name}: help changed settings values`)
  if (!profile.options.hasTouch) {
    const first = hints.first(), summary = first.locator('summary')
    await summary.focus(); await page.keyboard.press('Enter')
    assert(await first.evaluate(element => element.open), `${profile.name}: Enter did not open help`)
    await page.keyboard.press('Space')
    assert.equal(await first.evaluate(element => element.open), false, `${profile.name}: Space did not close help`)
  }
  currentHint = null
  return readings.length
}

async function auditProfile(browser, origin, profile) {
  currentProfile = profile.name
  const context = await browser.newContext(contextOptions({...profile.options, reducedMotion: 'reduce'}, browser))
  if (process.env.BIOTRON_QA_ORIGIN !== undefined) fs.writeFileSync(path.join(artifacts, `${profile.name}-online-identity.json`), JSON.stringify(await verifyOnlineIdentity(context, origin, root), null, 2))
  context.setDefaultTimeout(5000)
  await context.addInitScript(hasMidi => {
    window.__copiedText = ''
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {
      if (window.__blockClipboard) throw Error('Injected clipboard denial')
      if (window.__deferClipboard) await new Promise(resolve => {window.__finishClipboard = resolve})
      window.__copiedText = text
    }}})
    window.__layoutShiftScore = PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? 0 : null
    window.__layoutShiftEntries = []
    if (window.__layoutShiftScore !== null) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__layoutShiftScore += entry.value
          window.__layoutShiftEntries.push({at: entry.startTime, value: entry.value,
            sources: entry.sources.map(source => ({node: source.node?.outerHTML?.slice(0, 180),
              before: source.previousRect.toJSON(), after: source.currentRect.toJSON()}))})
        }
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

  assert(await page.locator('.sound-lab').isVisible(), `${profile.name}: Settings hides the shared player`)
  assert.equal(await page.getByRole('navigation', {name: 'Biotron tasks'}).count(), 1,
    `${profile.name}: repeated workspace navigation`)
  assert.equal(await page.getByRole('heading', {level: 1}).count(), 1, `${profile.name}: competing page titles`)
  assert.equal(await page.getByRole('heading', {name: 'Settings', level: 2}).count(), 1,
    `${profile.name}: settings must be a section of the shared workspace`)

  const workspace = await page.evaluate(() => {
    const panel = document.querySelector('.sound-lab__reveal-copy')
    const palette = document.querySelector('.sound-palette')
    const visual = document.querySelector('.sound-lab__reveal .garden-visual')
    return {soundInPanel: panel.contains(palette), keyboardInPanel: panel.contains(document.querySelector('.computer-keys')),
      viewport: innerWidth, visual: visual.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON()}
  })
  fs.writeFileSync(path.join(artifacts, `${profile.name}-workspace.json`), JSON.stringify(workspace, null, 2))
  assert(workspace.soundInPanel && workspace.keyboardInPanel, `${profile.name}: sound and keyboard remain detached from the player panel`)
  if (workspace.viewport >= 960) assert(workspace.visual.width >= 380 && workspace.panel.left >= workspace.visual.right,
    `${profile.name}: desktop visual and controls do not form the intended two-column workspace`)

  const result = await readQuality(page)
  fs.writeFileSync(path.join(artifacts, `${profile.name}-initial-quality.json`), JSON.stringify(result, null, 2))
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
      if (!await section.evaluate(element => element.open)) await section.locator(':scope > summary').click()
      // Experiments has only the Reduce extra notes button since the calibration cue picker was removed (28.10).
      await section.locator('input:visible, select:visible, button:visible').first().waitFor()
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

  if (!profile.midi) {
    assert.equal(await page.locator('.beta-compatibility').count(), 0,
      `${profile.name}: Settings repeats the player browser guidance`)
    const notice = page.locator('.sound-lab .compatibility-notice')
    assert.equal(await notice.count(), 1, `${profile.name}: Settings needs one browser recovery`)
    await notice.getByRole('heading', {name: 'This browser can play examples.'}).waitFor()
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).click()
    assert.equal(await page.evaluate(() => window.__copiedText), page.url())
    await auditExpanded('Settings browser help')
  }

  const hintCount = await auditHints(page, profile)

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

  await page.goto(`${origin}/#/biotron/play${profile.midi ? '' : '?transfer=a%20b'}`, {waitUntil: 'domcontentloaded'})
  await page.getByRole('heading', {name: 'Plant music'}).waitFor()
  assert.strictEqual(await page.locator('.beta-feedback').count(), 0,
    `${profile.name}: first play must not duplicate the generic feedback block`)
  const captureState = () => page.evaluate(() => ({
    hover: matchMedia('(any-hover: none)').matches, coarse: matchMedia('(any-pointer: coarse)').matches,
    keyboard: getComputedStyle(document.querySelector('.computer-keys')).display
  }))
  const beforeCapture = await captureState()
  // Chromium fullPage capture can reset mobile pointer emulation. Keep the viewport and verify it.
  await page.screenshot({path: path.join(artifacts, `${profile.name}-play.png`), timeout: 2000})
  const afterCapture = await captureState()
  fs.writeFileSync(path.join(artifacts, `${profile.name}-capture-state.json`), JSON.stringify({beforeCapture, afterCapture}, null, 2))
  assert.deepStrictEqual(afterCapture, beforeCapture, `${profile.name}: screenshot changed the device presentation`)
  const playResult = await readQuality(page)
  // Hash-route navigation shares the observer with the prior disclosure gestures.
  assertQuality(playResult, `${profile.name}/Play closed`, false)
  assert.deepStrictEqual(pageErrors, [], `${profile.name}/Play closed: page errors`)
  if (!profile.midi) {
    const notice = page.locator('.sound-lab__reveal-copy .compatibility-notice')
    const proof = {url: page.url(), noticeCount: await notice.count(),
      startDisabled: await page.getByRole('button', {name: 'Start listening', exact: true}).isDisabled()}
    fs.writeFileSync(path.join(artifacts, `${profile.name}-browser-recovery.json`), JSON.stringify(proof, null, 2))
    assert.equal(proof.noticeCount, 1, `${profile.name}: missing MIDI leaves no browser recovery beside Start`)
    assert.equal(proof.startDisabled, true)
    await notice.getByRole('heading', {name: 'This browser can play examples.'}).waitFor()
    assert.equal(await notice.getByRole('link', {name: 'Web MIDI Browser app details'}).getAttribute('href'),
      'https://apps.apple.com/us/app/web-midi-browser/id953846217')
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).click()
    assert.equal(await page.evaluate(() => window.__copiedText), page.url(), 'browser transfer lost URL components')
    await notice.getByRole('button', {name: 'Link copied', exact: true}).waitFor()
    await page.evaluate(() => window.__blockClipboard = true)
    await notice.getByRole('button', {name: 'Link copied', exact: true}).click()
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).waitFor()
    assert.equal(await notice.getByLabel('Page link', {exact: true}).inputValue(), page.url())
    await page.evaluate(() => window.__blockClipboard = false)
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).click()
    await notice.getByRole('button', {name: 'Link copied', exact: true}).waitFor()
    assert.equal(await notice.getByLabel('Page link', {exact: true}).count(), 0)
    await auditExpanded('Browser recovery and clipboard fallback')
  } else {
    assert.equal(await page.locator('.sound-lab__reveal-copy .compatibility-notice').count(), 0,
      `${profile.name}: browser with MIDI is told to switch`)
  }
  const sound = page.locator('.sound-palette')
  assert.equal(await sound.count(), 1, `${profile.name}: missing Sound palette`)
  assert.equal(await sound.evaluate(element => element.open), false,
    `${profile.name}: Sound opened without a user request`)
  assert.equal(await sound.locator('.audio-compare').count(), 0,
    `${profile.name}: unopened Sound mounted its lazy controls`)
  await sound.locator(':scope > summary').click()
  await sound.getByRole('group',{name:'Quick sounds',exact:true}).waitFor()
  assert.equal(await sound.getByRole('group',{name:'Quick sounds',exact:true}).getByRole('button').count(),6)
  assert.equal(await sound.locator('.sound-experiments').evaluate(element=>element.open),false,'all experiments opened by default')
  await sound.locator('.sound-orbit > summary').click()
  await auditExpanded('Sound sphere controls')
  await sound.locator('.sound-orbit > summary').click()
  await sound.locator('.sound-experiments > summary').click()
  await sound.getByLabel('Sound', {exact: true}).waitFor()
  assert(await sound.evaluate(element => element.open), `${profile.name}: Sound did not open`)
  assert.equal(await sound.getByLabel('Sound', {exact: true}).locator('option').count(), 7,
    `${profile.name}: Classic sound choices are missing`)
  await page.getByLabel('Limit to 4 notes at once', {exact: true}).waitFor()
  const keyboard = page.getByRole('region', {name: 'Computer keyboard', exact: true, includeHidden: true})
  if (profile.options.hasTouch) {
    assert.equal(await keyboard.isVisible(), false, `${profile.name}: touch-only page offers computer keyboard controls`)
    assert.equal(await page.getByRole('button', {name: 'Play with keyboard', exact: true}).count(), 0,
      `${profile.name}: touch-only page exposes keyboard action to accessibility tools`)
    assert(!(await sound.locator('p').allTextContents()).some(text => text.includes('computer keyboard')),
      `${profile.name}: sound instructions assume a computer keyboard`)
  } else {
    await page.getByLabel('Keyboard octave', {exact: true}).waitFor()
    assert(await keyboard.isVisible(), `${profile.name}: computer keyboard controls are hidden`)
  }
  if (!profile.midi) {
    await sound.getByRole('button', {name: 'Listen to example', exact: true}).tap()
    await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor()
    await sound.getByRole('button', {name: 'Stop example', exact: true}).tap()
    await page.locator('.sound-lab[data-example="idle"]').waitFor()
  }
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

  // Real example playback must keep the same player and sound when Settings opens.
  const nav = page.getByRole('navigation', {name: 'Biotron tasks'})
  const palette = page.locator('.sound-palette')
  if (!await palette.evaluate(element => element.open)) await palette.locator(':scope > summary').click()
  await palette.getByRole('button', {name: 'Listen to example', exact: true}).click()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor()
  const playingSound = await page.locator('.sound-lab').getAttribute('data-sound')
  await nav.getByRole('link', {name: 'Settings', exact: true}).click()
  await page.getByRole('heading', {name: 'Settings', level: 2}).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Settings',
    `${profile.name}: opening Settings lost the task focus`)
  const settingsFocus = await page.getByRole('heading', {name: 'Settings', level: 2}).boundingBox()
  const settingsNav = await nav.boundingBox()
  assert(settingsFocus.y >= settingsNav.y + settingsNav.height,
    `${profile.name}: focused Settings title is obscured by navigation`)
  assert(await page.locator('.sound-lab').isVisible(), `${profile.name}: player hidden after opening settings`)
  assert.equal(await page.locator('.sound-lab').getAttribute('data-example'), 'playing',
    `${profile.name}: opening settings stopped the example`)
  assert.equal(await page.locator('.sound-lab').getAttribute('data-sound'), playingSound)
  assert.equal(await nav.count(), 1)
  assert.equal(await nav.getByRole('link', {name: 'Settings'}).getAttribute('aria-current'), 'page')
  await page.getByRole('heading', {name: 'Settings', level: 2}).scrollIntoViewIfNeeded()
  const navRect = await nav.boundingBox()
  assert(navRect.y >= 0 && navRect.y + navRect.height < profile.options.viewport.height,
    `${profile.name}: workspace navigation disappeared above Settings`)
  await palette.getByRole('button', {name: 'Stop example', exact: true}).click()
  await page.locator('.sound-lab[data-example="idle"][data-audio-state="closed"][data-active-voices="0"]').waitFor()
  await auditExpanded('Shared player and Settings after Stop')
  await nav.getByRole('link', {name: 'Play', exact: true}).click()
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1',
    `${profile.name}: returning to Play lost the title focus`)
  const playFocus = await page.getByRole('heading', {name: 'Plant music', level: 1}).boundingBox()
  const playNav = await nav.boundingBox()
  assert(playFocus.y >= playNav.y + playNav.height,
    `${profile.name}: focused Play title is obscured by navigation`)
  fs.writeFileSync(path.join(artifacts, `${profile.name}-workspace.json`), JSON.stringify({
    playerVisible: true, navigationCount: 1, preservedExample: true, playingSound, stopClosed: true,
    settingsFocus, settingsNav, playFocus, playNav,
    scope: 'Real browser audio with empty fake MIDI; no native device or hearing acceptance'
  }, null, 2))

  if (!profile.midi) {
    // The shared player survives navigation; copy feedback belongs to the exact route.
    const notice = page.locator('.sound-lab .compatibility-notice')
    await page.evaluate(() => {window.__deferClipboard = true})
    await notice.getByRole('button', {name: /^(Copy page link|Link copied)$/}).click()
    await page.waitForFunction(() => typeof window.__finishClipboard === 'function')
    const requestedUrl = page.url()
    await nav.getByRole('link', {name: 'Settings', exact: true}).click()
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).waitFor()
    await page.evaluate(() => {window.__deferClipboard = false; window.__finishClipboard()})
    await page.waitForFunction(url => window.__copiedText === url, requestedUrl)
    assert.equal(await notice.getByRole('button', {name: 'Link copied', exact: true}).count(), 0,
      `${profile.name}: stale clipboard completion claims the new route was copied`)
    await notice.getByRole('button', {name: 'Copy page link', exact: true}).click()
    await notice.getByRole('button', {name: 'Link copied', exact: true}).waitFor()
    assert.equal(await page.evaluate(() => window.__copiedText), page.url())
    fs.writeFileSync(path.join(artifacts, `${profile.name}-route-copy.json`), JSON.stringify({
      requestedUrl, currentUrl: page.url(), staleCompletionIgnored: true, freshCopyCorrect: true
    }, null, 2))
    await page.goto(`${origin}/#/sound`, {waitUntil: 'domcontentloaded'})
    await page.locator('.sound-lab .compatibility-notice').waitFor()
    const sharedQuality = await readQuality(page)
    fs.writeFileSync(path.join(artifacts, `${profile.name}-shared-sound-quality.json`), JSON.stringify(sharedQuality, null, 2))
    assertQuality(sharedQuality, `${profile.name}/shared Sound`, false)
  }

  await context.close()
  const cls = value => value === null ? 'NOT MEASURABLE in this engine' : value.toFixed(3)
  return `${profile.name}: initial CLS ${cls(result.cls)}, overflow ${result.documentOverflow}px; Play CLS ${cls(playResult.cls)}; ${expandedResults.length} opened states checked; ${hintCount} explanations checked`
}

function qualityJourneyHtml(report) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const rows = report.transitions.map((t, i) => `<tr data-result="${esc(t.result)}"><td>${i + 1}</td><td>${esc(t.from)} → ${esc(t.to)}</td><td>${esc(t.action)}</td><td>${esc(t.result)}</td><td>${esc(t.wallMs)}</td></tr>`).join('')
  const findings = report.findings.map(f => `<details><summary>${esc(f.label)} · ${esc(f.category)} · FAIL</summary><pre>${esc(JSON.stringify(f, null, 2))}</pre></details>`).join('')
  const surfaces = report.audits.map(a => `<tr><td>${esc(a.label)}</td><td>${a.viewport}</td><td>${a.overflow}</td><td>${a.contrast.length}</td><td>${a.unmeasured.length}</td><td>${esc(a.navigation?.ttfbMs)}</td></tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biotron browser paths — Playtronica</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f7f8fb;color:#111;font:16px/1.5 system-ui,-apple-system,sans-serif}.container{max-width:1100px;margin:auto;padding:24px 16px}header{background:linear-gradient(135deg,#5c6bc0,#3949ab);color:white;padding:32px;border-radius:12px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}.card,section{background:white;padding:24px;border-radius:12px;box-shadow:0 2px 12px #00000012}section{margin:24px 0}h1{font-size:28px;line-height:1.2}h2{font-size:20px}strong{font-size:24px}small{color:#444;overflow-wrap:anywhere}header small{color:white}button,summary{font:inherit;cursor:pointer;min-height:44px;padding:8px}button{background:white;color:#111;border:1px solid #687080;border-radius:8px}button:hover,summary:hover{background:#eef1ff}:focus-visible{outline:3px solid #3949ab;outline-offset:3px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;min-width:680px;width:100%}th{background:#3949ab;color:white;text-align:left}td,th{padding:16px;border-bottom:1px solid #dde1e8}tr:nth-child(even){background:#f7f8fb}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 monospace}details{margin:16px 0}@media(max-width:768px){.stats{grid-template-columns:repeat(2,1fr)}header{padding:24px}}
  </style><main class="container"><header><h1>Biotron · executed browser paths</h1><p>${esc(report.engine)} ${esc(report.version)} · ${esc(report.status)}</p><small>${esc(report.capturedAt)} · ${esc(report.origin)}</small></header>
  <div class="stats"><div class="card"><strong>${report.transitions.length}</strong><p>Executed transitions</p></div><div class="card"><strong>${report.audits.length}</strong><p>Measured surfaces</p></div><div class="card"><strong>${report.findings.length}</strong><p>Unresolved audit groups</p></div><div class="card"><strong>${report.notRun.length}</strong><p>Explicitly outside scope</p></div></div>
  <section><h2>Behaviour map</h2><p>Each arrow below comes from a completed fixture action. PASS applies to that action; separate accessibility FAILs still fail the lane. This is a test path, not analytics of real people.</p><button onclick="filter('all')">All transitions</button> <button onclick="filter('FAIL')">Failed transitions</button><div class="table-wrap"><table id="map"><thead><tr><th>#</th><th>From → To</th><th>Action</th><th>Result</th><th>Observed ms</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <section><h2>Measured interface</h2><div class="table-wrap"><table><thead><tr><th>Surface</th><th>Width</th><th>Overflow px</th><th>Contrast samples</th><th>Unmeasured samples</th><th>Observed TTFB ms</th></tr></thead><tbody>${surfaces}</tbody></table></div><p>Gradient/image/group-opacity contrast needs visual review. Timing is one lab observation, not field CWV or a speed comparison.</p></section>
  <section><h2>Findings</h2>${findings || '<p>No finding within these assertions.</p>'}<details><summary>First fault and cleanup</summary><pre>${esc(JSON.stringify({firstFault:report.firstFault,cleanup:report.cleanup,keyboardMethod:report.keyboardMethod},null,2))}</pre></details></section>
  <section><h2>Limits and next evidence</h2><ul>${report.notRun.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>${esc(report.limits)}</p><p>Next customer task: plant WAV → actual CapCut import/reopen/export → finished video. Automatic measurements do not select the aesthetic winner or establish demand.</p></section><footer><small>Generated from journeys.json · source SHA256 ${esc(report.sourceSha256)} · hosted bytes remain pinned.</small></footer></main><script>function filter(result){document.querySelectorAll('#map tbody tr').forEach(row=>{row.hidden=result!=='all'&&row.dataset.result!==result})}</script></html>`
}

// Additional coverage uses the existing quality lane and actual compiled pages.
// Maps describe executed fixture paths, never population behaviour or demand.
async function auditJourneys(browser, origin) {
  assert(['none', 'contrast'].includes(process.env.QUALITY_JOURNEY_FAULT || 'none'), 'Unknown journey fault')
  const crypto = require('node:crypto')
  const report = {status: 'RUNNING', capturedAt: new Date().toISOString(), origin,
    engine: browser.browserType().name(), version: browser.version(), transitions: [], audits: [], errors: [], findings: [],
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    limits: 'Existing5s UI and CLS0.1; contrast4.5 normal/3 large. Timing observations are not field CWV.',
    notRun: ['Native MIDI/speaker/phone', 'CapCut/final video', 'Novice discovery/aesthetic preference',
      'Sales/profit', 'Microphone/camera', 'Customer release', 'Telemetry delivery/retention', 'All possible state combinations']}
  const write = () => fs.writeFileSync(path.join(artifacts, 'journeys.json'), JSON.stringify(report, null, 2))
  let context, page, state = 'start'
  const tabKey = browser.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab'
  report.keyboardMethod = {key: tabKey, scope: 'Playwright WebKit uses Option/Alt+Tab for full control traversal; no OS setting change'}
  const step = async (action, next, fn) => {
    const from = state, began = Date.now()
    try { await fn(); report.transitions.push({from, action, to: next, result: 'PASS', wallMs: Date.now() - began}); state = next; write() }
    catch (error) {
      report.status = 'FAIL'; report.firstFault ||= {from, action, intended: next, error: String(error), at: new Date().toISOString()}
      report.transitions.push({from, action, to: next, result: 'FAIL', wallMs: Date.now() - began}); write()
      throw error
    }
  }
  const surface = async label => {
    if (process.env.QUALITY_JOURNEY_FAULT === 'contrast' && label === 'Play1440')
      await page.locator('h1').evaluate(e => {e.style.color = 'rgb(245,245,245)'; e.style.backgroundColor = 'rgb(245,245,245)'})
    const reading = await page.evaluate(() => {
      const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' &&
        !e.closest('[hidden],details:not([open]) > :not(summary)')
      const rgb = value => (value.match(/[\d.]+/g) || []).map(Number)
      const over = (front, back) => [...front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1))), 1]
      const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
      const contrast = [], unmeasured = []
      for (const e of document.querySelectorAll('h1,h2,h3,p,small,label,summary,button,a,select,textarea,span')) {
        if (!visible(e) || e.matches(':disabled') || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
        let ancestors = [], node = e
        while (node) {ancestors.unshift(node); node = node.parentElement}
        if (ancestors.some(a => getComputedStyle(a).backgroundImage !== 'none' || +getComputedStyle(a).opacity !== 1)) {
          unmeasured.push({text: e.textContent.trim().slice(0, 80), reason: 'Gradient/image/group opacity needs visual review'}); continue
        }
        let bg = [255, 255, 255, 1]
        for (const a of ancestors) bg = over(rgb(getComputedStyle(a).backgroundColor), bg)
        const s = getComputedStyle(e), fg = over(rgb(s.color), bg), l = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
        const ratio = (l[0] + .05) / (l[1] + .05), size = parseFloat(s.fontSize)
        const minimum = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5
        contrast.push({text: e.textContent.trim().slice(0, 80), ratio, minimum, foreground: s.color, background: bg.slice(0, 3)})
      }
      const controls = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible)
      const unnamed = controls.filter(e => !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length).map(e => e.outerHTML.slice(0, 120))
      const n = performance.getEntriesByType('navigation')[0]
      return {url: location.href, viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e => ({level: +e.tagName.slice(1), text: e.textContent})),
        lang: document.documentElement.lang, mainCount: document.querySelectorAll('main').length, unnamed,
        contrast, unmeasured,
        primaryTargets: [...document.querySelectorAll('button:not(:disabled),summary,select,a.save')].filter(visible).map(e => {
          const r = e.getBoundingClientRect(); return {text: e.textContent.trim().slice(0,80), width: r.width, height: r.height}
        }),
        ranges: [...document.querySelectorAll('input[type=range]')].filter(visible).map(e => ({id:e.id,height:e.getBoundingClientRect().height})),
        reducedMotion: matchMedia('(prefers-reduced-motion:reduce)').matches,
        navigation: n && {ttfbMs: n.responseStart - n.requestStart, domContentLoadedMs: n.domContentLoadedEventEnd,
          loadMs: n.loadEventEnd, transferSize: n.transferSize},
        paint: performance.getEntriesByType('paint').map(e => ({name: e.name, ms: e.startTime}))}
    })
    reading.label = label; report.audits.push(reading); write()
    assert(reading.overflow <= 1, `${label}: horizontal overflow`)
    assert.equal(reading.lang, 'en'); assert.equal(reading.mainCount, 1)
    assert.equal(reading.headings.filter(h => h.level === 1).length, 1)
    assert.deepEqual(reading.unnamed, []); assert(reading.reducedMotion)
    const failed = reading.contrast.filter(c => c.ratio < c.minimum)
    const smallTargets = reading.primaryTargets.filter(t => t.width < 44 || t.height < 44)
    const smallRanges = reading.ranges.filter(t => t.height < 24)
    if (smallTargets.length || smallRanges.length) {
      report.findings.push({label, category:'touch-target',result:'FAIL',smallTargets,smallRanges})
      if (!report.firstFault) {
        report.firstFault = {from:state,action:label,error:'Measured control target below existing44/24px budget',at:new Date().toISOString()};write()
        await page.locator('body').innerText({timeout:1000}).then(text=>fs.writeFileSync(path.join(artifacts,'journey-first-dom.txt'),text)).catch(()=>{})
        await page.screenshot({path:path.join(artifacts,'journey-first-fault.png'),timeout:1000}).catch(()=>{})
      }
    }
    if (failed.length) {
      report.findings.push({label, category: 'contrast', result: 'FAIL', controls: failed})
      if (!report.firstFault) {
        report.firstFault = {from: state, action: label, error: 'Measured text contrast below threshold', at: new Date().toISOString()}
        write()
        await page.screenshot({path: path.join(artifacts, 'journey-first-fault.png'), timeout: 1000}).catch(() => {})
      }
      write()
    }
  }
  try {
    for (const width of [1440, 320, 375, 414, 768, 1024]) {
      state = `fresh-${width}`
      context = await browser.newContext(contextOptions({viewport: {width, height: 900}, hasTouch: width < 500,
        reducedMotion: 'reduce', serviceWorkers: 'block'}, browser))
      context.setDefaultTimeout(5000)
      report.writes ||= []; const writes = await isolateOnlineWrites(context); report.writes.push(writes)
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: undefined})
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw Error('Clipboard fault control')}}})
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {throw Error('Native camera/microphone forbidden in this lane')}
      })
      if (process.env.BIOTRON_QA_ORIGIN !== undefined && width === 1440) {
        report.identity = await verifyOnlineArtifact(context, origin, root); write()
      }
      if (width === 1440 && tabKey === 'Alt+Tab') {
        const control = await context.newPage(); report.keyboardControl = {}
        for (const key of ['Tab', 'Alt+Tab']) {
          await control.setContent('<a href="#a">Link</a><button>Button</button><input type="range"><select><option>Choice</option></select>')
          const tags = []
          for (let i = 0; i < 6; i++) {await control.keyboard.press(key); tags.push(await control.evaluate(() => document.activeElement.tagName))}
          report.keyboardControl[key] = tags
        }
        write(); await control.close()
        assert(!report.keyboardControl.Tab.includes('BUTTON') && report.keyboardControl['Alt+Tab'].includes('BUTTON') &&
          report.keyboardControl['Alt+Tab'].includes('A'), 'WebKit keyboard policy changed; do not silently switch traversal')
      }
      page = await context.newPage(); currentPage = page; currentProfile = `journey-${width}`
      page.on('pageerror', error => report.errors.push({url: page.url(), error: error.message}))
      await step('cold Play', `play-${width}`, async () => {
        await gotoReady(page, origin + '/#/biotron/play?sound=1', timeout => page.locator('.sound-lab:visible').waitFor({timeout}))
        await surface(`Play${width}`)
      })
      if (width === 1440) {
        const focus = []
        await step('keyboard Tab traversal', 'keyboard-focus', async () => {
          for (let i = 0; i < 16; i++) {
            await page.keyboard.press(tabKey)
            focus.push(await page.evaluate(() => {
              const e = document.activeElement, s = getComputedStyle(e), r = e.getBoundingClientRect()
              return {tag: e.tagName, text: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 80),
                focusVisible: e.matches(':focus-visible'), outline: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth),
                boxShadow: s.boxShadow, height: r.height, width: r.width}
            }))
          }
          report.focus = focus; write()
          assert(focus.every(f => f.height > 0 && f.width > 0 && f.focusVisible), 'Tab focused an invisible/non-visible control')
          assert(focus.every(f => f.outlineWidth > 0 && f.outline !== 'none' || f.boxShadow !== 'none'), 'Keyboard focus has no measured outline/shadow')
        })
        await step('set browser Volume37', 'volume37', async () => {
          await page.locator('#biotron-play-volume').focus()
          await page.keyboard.press('Home')
          for (let i = 0; i < 37; i++) await page.keyboard.press('ArrowRight')
          assert.equal(await page.locator('.sound-lab').getAttribute('data-volume'), '37')
        })
        const fresh = await context.newPage()
        await step('fresh second tab readback', 'two-tabs37', async () => {
          await gotoReady(fresh, origin + '/#/biotron/play?sound=1', timeout => fresh.locator('.sound-lab[data-volume="37"]').waitFor({timeout}))
        })
        await fresh.close()
      }
      await step('Settings navigation', `settings-${width}`, async () => {
        await page.getByRole('navigation', {name: 'Biotron tasks'}).getByRole('link', {name: 'Settings', exact: true}).click()
        await page.getByRole('heading', {name: 'Settings', level: 2}).waitFor(); await surface(`Settings${width}`)
      })
      await step('return Play', `return-${width}`, async () => {
        await page.getByRole('navigation', {name: 'Biotron tasks'}).getByRole('link', {name: 'Play', exact: true}).click()
        await page.getByRole('heading', {name: 'Plant music', level: 1}).waitFor()
      })
      await step('creator cold load', `creator-${width}`, async () => {
        await gotoReady(page, origin + '/creator.html', timeout => page.waitForFunction(() => document.querySelector('#sound')?.options.length > 0, null, {timeout}))
        await surface(`Creator${width}`)
      })
      if (width === 1440) {
        await step('record example and finish', 'take-kept', async () => {
          await page.locator('#record-audio').click(); await page.getByText('Recording sound. Play the example, keyboard or connected Biotron. Maximum 30 seconds.', {exact: true}).waitFor()
          await page.locator('#example').click(); await page.waitForTimeout(1500); await page.locator('#example').click()
          await page.locator('#stop').click(); await page.locator('.take').waitFor()
          const take = await page.evaluate(async () => {
            const t = window.__CreatorPrototype.takes[0], bytes = new Uint8Array(await t.file.arrayBuffer())
            let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
            return {name: t.file.name, seconds: t.seconds, bytes: btoa(binary)}
          })
          const bytes = Buffer.from(take.bytes, 'base64'); delete take.bytes
          fs.writeFileSync(path.join(artifacts, 'online-example.wav'), bytes)
          const data = bytes.subarray(44), samples = Array.from({length: data.length / 4}, (_, i) => data.readFloatLE(i * 4))
          const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
          report.take = {...take, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), rms}; write()
          assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert(samples.every(Number.isFinite)); assert(rms > .001)
          assert(samples.every(v => Math.abs(v) < 1), 'Online take clipped')
        })
        await step('listen to kept file', 'file-reopened', async () => {
          await page.locator('.take audio').evaluate(async audio => {await audio.play()})
          await page.waitForFunction(() => document.querySelector('.take audio').currentTime > .1)
          await page.locator('.take audio').evaluate(audio => audio.pause())
        })
        await step('Return keeps file pending decision', 'leave-warning', async () => {
          await page.locator('#return').click(); await page.locator('#leave-confirm:visible').waitFor()
          assert.equal(await page.locator('.take').count(), 1); assert(new URL(page.url()).pathname.includes('creator'))
        })
        await step('Save before explicit leave', 'saved', async () => {
          const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', {name: 'Save sound', exact: true}).click()
          const download = await downloadPromise, destination = path.join(artifacts, 'downloaded-example.wav')
          await download.saveAs(destination)
          assert(fs.readFileSync(destination).equals(fs.readFileSync(path.join(artifacts, 'online-example.wav'))))
        })
        await step('confirmed return', 'returned-main', async () => {
          await page.locator('#leave-confirm').click(); await page.waitForURL(/#\/biotron\/play/); await page.locator('.sound-lab:visible').waitFor()
        })
      } else await step('empty return', `returned-${width}`, async () => {
        await page.locator('#return').click(); await page.waitForURL(/#\/biotron\/play/)
      })
      if (width === 1440 || width === 320) {
        const seed = width === 1440 ? 20261012 : 42
        let random = seed, route = 'Play', running = false
        const mixed = ['Settings', 'Play', 'Example', 'Stop', 'Settings', 'Play', 'Example', 'Stop']
        for (let i = mixed.length - 1; i > 0; i--) {
          random ^= random << 13; random ^= random >>> 17; random ^= random << 5
          const j = (random >>> 0) % (i + 1); [mixed[i], mixed[j]] = [mixed[j], mixed[i]]
        }
        const actions = ['Example', 'Settings', 'Play', 'Stop', ...mixed, 'Play', 'Stop']
        report.sequences ||= []; report.sequences.push({seed, width, actions, scope: 'Example/route/Stop UI, no native MIDI or PCM assertion'}); write()
        await page.locator('.sound-lab').evaluate(element => {window.__qaSequencePlayer = element})
        for (const [index, action] of actions.entries()) await step(`seed${seed}/${index} ${action}${action === 'Stop' && !running ? ' (already closed)' : ''}`,
          `sequence-${action === 'Play' || action === 'Settings' ? action : route}`, async () => {
          if (action === 'Play' || action === 'Settings') {
            await page.getByRole('navigation', {name: 'Biotron tasks'}).getByRole('link', {name: action, exact: true}).click()
            route = action
          } else if (action === 'Example') {
            const palette = page.locator('.sound-palette')
            if (!await palette.evaluate(element => element.open)) await palette.locator(':scope > summary').click()
            await palette.getByRole('button', {name: running ? 'Stop example' : 'Listen to example', exact: true}).click()
            running = !running
          } else if (running) {
            await page.getByRole('button', {name: 'Stop & release', exact: true}).click(); running = false
          }
          const lab = page.locator('.sound-lab')
          await page.getByRole('heading', {name: route === 'Play' ? 'Plant music' : 'Settings', level: route === 'Play' ? 1 : 2}).waitFor()
          await page.locator(`.sound-lab[data-audio-state="${running ? 'running' : 'closed'}"][data-example="${running ? 'playing' : 'idle'}"]`).waitFor()
          assert.equal(await lab.count(), 1); assert(await lab.isVisible())
          assert(await lab.evaluate(element => element === window.__qaSequencePlayer), 'Internal route replaced the player')
          assert.equal(await lab.getAttribute('data-tab-lease'), running ? 'held' : 'free')
          if (!running) {
            assert.equal(await lab.getAttribute('data-active-voices'), '0')
            assert.equal(await lab.getAttribute('data-example-timers'), '0')
          }
        })
      }
      assert.deepEqual(report.errors, [])
      if (process.env.BIOTRON_QA_ORIGIN !== undefined) report.identityAfter = await verifyOnlineIdentity(context, origin, root)
      await context.close(); context = null; report.cleanup = 'CONFIRMED: isolated contexts closed'; write()
    }
    state = 'fresh-resource-control'
    context = await browser.newContext({viewport: {width: 1024, height: 900}, serviceWorkers: 'block'})
    context.setDefaultTimeout(5000)
    report.writes.push(await isolateOnlineWrites(context))
    await context.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: undefined}))
    let resourceAttempts = 0
    await context.route('**/js/sound-lab.*.js', route => ++resourceAttempts === 1 ? route.abort('failed') : route.fallback())
    page = await context.newPage(); currentPage = page
    report.resourceErrors = []; page.on('pageerror', error => report.resourceErrors.push(error.message))
    await step('one Sound chunk network failure', 'retry-offered', async () => {
      await page.goto(origin + '/#/biotron', {waitUntil: 'domcontentloaded'})
      await page.getByRole('button', {name: 'Retry sounds', exact: true}).waitFor()
      assert(await page.locator('.biotron-settings-beta').isVisible(), 'Sound failure hides Settings')
      assert.equal(resourceAttempts, 1)
    })
    await step('Retry sounds actual reload', 'sound-recovered', async () => {
      await page.getByRole('button', {name: 'Retry sounds', exact: true}).click()
      await page.locator('.sound-lab:visible').waitFor(); assert.equal(resourceAttempts, 2)
      assert(await page.locator('.biotron-settings-beta').isVisible())
    })
    assert.deepEqual(report.resourceErrors, [], 'Lazy resource failure left an unhandled browser error')
    report.resourceFault = {attempts: resourceAttempts, result: 'PASS', scope: 'One deliberately aborted lazy Sound chunk and actual Retry; not arbitrary network failure recovery'}
    await context.close(); context = null; report.cleanup = 'CONFIRMED: all isolated contexts closed'; write()
    assert.deepEqual(report.findings, [], 'Accessibility findings remain FAIL; functional transitions do not waive them')
    report.status = 'PASS_SCOPED'; write()
  } catch (error) {
    report.status = 'FAIL'; report.firstFault ||= {from: state, error: String(error), at: new Date().toISOString()}; write()
    if (page && !page.isClosed() && !fs.existsSync(path.join(artifacts,'journey-first-fault.png'))) {
      await page.locator('body').innerText({timeout: 1000}).then(text => fs.writeFileSync(path.join(artifacts, 'journey-first-dom.txt'), text)).catch(() => {})
      await page.screenshot({path: path.join(artifacts, 'journey-first-fault.png'), timeout: 1000}).catch(() => {})
    }
    throw error
  } finally {
    if (context) {
      await context.close().then(() => {report.cleanup = 'CONFIRMED: failed isolated context closed'}, error => {
        report.cleanup = 'NOTCONFIRMED: ' + error; report.status = 'FAIL'
      })
    }
    write()
    fs.writeFileSync(path.join(artifacts, 'audit.html'), qualityJourneyHtml(report))
  }
}

;(async () => {
  if (process.env.BIOTRON_QA_ORIGIN !== undefined) assert.equal(process.env.QUALITY_BROWSER_JOURNEYS, '1', 'Hosted quality requires SW-free/write-protected journeys mode')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = qaOrigin(server)
  const browser = await launchBrowser()
  try {
    if (process.env.QUALITY_BROWSER_JOURNEYS === '1') return await auditJourneys(browser, origin)
    const results = []
    for (const profile of profiles) {
      results.push(await auditProfile(browser, origin, profile))
      fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({browser: process.env.BIOTRON_QA_BROWSER || 'chrome',
        engine: browser.browserType().name(), version: browser.version(), root, results}, null, 2))
    }
    console.log(`Responsive quality verified — ${results.join('; ')}`)
  } catch (error) {
    if (!fs.existsSync(path.join(artifacts, 'failure.json'))) fs.writeFileSync(path.join(artifacts, 'failure.json'), JSON.stringify({profile: currentProfile, hint: currentHint, error: error.message}, null, 2))
    await currentPage?.locator('body').innerText({timeout: 1000}).then(text => fs.writeFileSync(path.join(artifacts, 'failure-dom.txt'), text)).catch(() => {})
    await currentPage?.screenshot({path: path.join(artifacts, 'failure.png'), timeout: 1000}).catch(() => {})
    throw error
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
