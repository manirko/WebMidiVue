// Observe only this packet's dedicated browser. Never request MIDI or grant permission.
const fs = require('node:fs')
const path = require('node:path')
const {performance} = require('node:perf_hooks')
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const {chromium} = require(path.join(config.root, 'vendor', 'playwright-core'))
const output = file => path.join(config.run, file)
const write = (file, data) => fs.writeFileSync(output(file), JSON.stringify(data, null, 2)+'\n')
let records = 0, droppedRecords = 0
const append = (file, data) => {
  if (++records > 5000) {droppedRecords++; return}
  fs.appendFileSync(output(file), JSON.stringify({at: new Date().toISOString(), ...data})+'\n')
}
const bounded = async (promise, label, milliseconds=5000) => {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label+' timed out')), milliseconds)
    })])
  } finally {clearTimeout(timer)}
}

// Constructor observation is confined to this test profile. No MIDI listeners,
// global timer replacement, new audio graph, mute or automatic note generation.
function observeAudio() {
  const contexts = []
  let created = 0
  const Native = window.AudioContext || window.webkitAudioContext
  if (Native) {
    class ObservedAudioContext extends Native {
      constructor(...args) {
        super(...args)
        created++
        if (contexts.length < 64) contexts.push(new WeakRef(this))
      }
    }
    window.AudioContext = ObservedAudioContext
    if (window.webkitAudioContext) window.webkitAudioContext = ObservedAudioContext
  }
  window.__biotronFieldSnapshot = () => ({
    visibility: document.visibilityState,
    pageTime: performance.now(),
    route: location.hash,
    details: Array.from(document.querySelectorAll('details')).slice(0,16).map(element => ({
      summary: (element.querySelector('summary')?.textContent || '').trim().slice(0,120), open: element.open
    })),
    midiAvailable: typeof navigator.requestMIDIAccess === 'function',
    contextsCreated: created,
    contextObservationTruncated: created > 64,
    audio: contexts.map((ref,id) => ({context:ref.deref(),id})).filter(x=>x.context).map(({context,id}) => ({
      id, state: context.state, time: context.currentTime, sampleRate: context.sampleRate,
      baseLatency: context.baseLatency, outputLatency: context.outputLatency ?? null
    }))
  })
}

// A positive clock value alone may be stale. Require advancement in one context.
function hasAdvancingDspClock(rows) {
  if (rows.length < 2) return false
  const prior = new Map(rows.at(-2).snapshot.audio.map(audio => [audio.id,audio]))
  return rows.at(-1).snapshot.audio.some(audio => {
    const previous = prior.get(audio.id)
    return Number.isInteger(audio.id) && audio.state === 'running' && previous?.state === 'running' &&
      Number.isFinite(previous.time) && previous.time >= 0 && Number.isFinite(audio.time) && audio.time > previous.time
  })
}

;(async () => {
  let context, page, cdp, fault, interrupted = false
  let samples = 0, closedEarly = false
  const started = performance.now()
  const finish = () => {interrupted = true}
  process.on('SIGINT', finish)
  process.on('SIGTERM', finish)
  try {
    const response = await fetch(config.origin+'/release-evidence.json', {signal: AbortSignal.timeout(10000)})
    if (!response.ok) throw new Error('Exact-site metadata unavailable: '+response.status)
    const release = await response.json()
    if (release.source_commit !== config.web_commit) throw new Error('Site differs from exact candidate')
    context = await chromium.launchPersistentContext(config.profile, {
      executablePath: config.executable,
      headless: config.smoke,
      viewport: null,
      timeout: 15000,
      // Keep audible output and normal background policies for a physical test.
      ignoreDefaultArgs: config.smoke ? [] : ['--mute-audio', '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
      acceptDownloads: false
    })
    await context.addInitScript(observeAudio)
    page = context.pages()[0] || await context.newPage()
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => {
      append('events.jsonl', {kind:'pageerror', message:error.message.slice(0,2000)})
      if (!fs.existsSync(output('first-pageerror.json'))) write('first-pageerror.json',{at:new Date().toISOString(),message:error.message,status:'OBSERVED_ERROR_NOT_ROOT_CAUSE'})
    })
    page.on('console', message => {
      if (['error','warning'].includes(message.type())) append('events.jsonl',{kind:'console',type:message.type(),message:message.text().slice(0,2000)})
    })
    page.on('requestfailed', request => {
      const url = new URL(request.url())
      append('events.jsonl',{kind:'requestfailed',origin:url.origin,path:url.pathname,error:request.failure()?.errorText})
    })
    await context.tracing.start({screenshots:true,snapshots:true,sources:false})
    await page.goto(config.origin+'/#/biotron/play', {waitUntil:'domcontentloaded',timeout:15000})
    cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const browserVersion = await cdp.send('Browser.getVersion')
    write('browser.json',{at:new Date().toISOString(),web_commit:config.web_commit,browser:config.browser,version:browserVersion,headless:config.smoke,instrumented:true,physical_result:'NOT_RUN',midi_capture:'NONE; app alone owns its ports',acoustic_capture:'NONE',firmware_version:config.firmware_version,firmware_source_commit:config.firmware_source_commit})
    if (config.smoke) {
      const palette=page.locator('details.sound-palette')
      await palette.waitFor()
      await palette.locator('summary').click()
      await page.locator('#compare-variant').waitFor()
      if (await page.getByRole('button',{name:'Calibration sounds',exact:true}).count()) throw new Error('Calibration cues leaked onto Play')
      if (await page.getByLabel('Low CPU',{exact:true}).count() !== 1 || await page.getByRole('button',{name:'Play with keyboard',exact:true}).count() !== 1) throw new Error('Play keyboard/quality controls missing')
      await page.getByRole('button',{name:'Handpan',exact:true}).click()
      if (await page.locator('#compare-variant option').count() !== 6) throw new Error('Exact candidate is missing six Handpan options')
      await page.getByRole('button',{name:'Listen to example',exact:true}).click()
      await page.getByRole('button',{name:'Stop example',exact:true}).waitFor()
    }
    const minimumEnd = performance.now()+2000
    const end = performance.now()+(config.smoke ? 10000 : config.seconds*1000)
    const smokeRows = []
    const budget = () => config.smoke ? Math.max(1,Math.min(5000,end-performance.now())) : 5000
    const withinDeadline = () => {if (config.smoke && performance.now() >= end) throw new Error('Smoke observation deadline exceeded')}
    while (!interrupted && !page.isClosed() && performance.now()<end) {
      const before = performance.now()
      const snapshot = await bounded(page.evaluate(() => window.__biotronFieldSnapshot()),'page heartbeat',budget())
      withinDeadline()
      const metrics = await bounded(cdp.send('Performance.getMetrics'),'browser metrics',budget())
      withinDeadline()
      const selected = Object.fromEntries(metrics.metrics.filter(x => ['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','TaskDuration'].includes(x.name)).map(x=>[x.name,x.value]))
      const row = {sample:++samples,roundTripMilliseconds:Math.round(performance.now()-before),snapshot,metrics:selected}
      append('samples.jsonl',row)
      if (config.smoke) {
        smokeRows.push(row)
        if (performance.now() >= minimumEnd && hasAdvancingDspClock(smokeRows)) break
      }
      await new Promise(resolve => setTimeout(resolve,1000))
    }
    closedEarly = page.isClosed() && performance.now()<end
    if (config.smoke) {
      withinDeadline()
      if (!hasAdvancingDspClock(smokeRows)) throw new Error('Smoke did not observe running real DSP clock')
      await page.getByRole('button',{name:'Stop example',exact:true}).click()
    }
    if (!page.isClosed()) await bounded(page.screenshot({path:output('last-page.png')}),'final screenshot')
  } catch (error) {
    fault=error
    write('first-capture-fault.json',{at:new Date().toISOString(),message:error.message,status:'CAPTURE_FAILED_OR_STALLED_NOT_PROVEN_APP_ROOT_CAUSE'})
    if (page && !page.isClosed()) {
      try {await bounded(page.screenshot({path:output('first-fault.png')}),'fault screenshot',3000)} catch (captureError) {
        write('screenshot-unavailable.json',{message:captureError.message})
      }
    }
  } finally {
    if (context) {
      try {await bounded(context.tracing.stop({path:output('trace.zip')}),'trace save',8000)} catch (error) {write('trace-save-fault.json',{message:error.message}); fault ||= error}
      try {await bounded(context.close(),'own test browser close',8000)} catch (error) {write('browser-close-fault.json',{message:error.message,instruction:'Close only the dedicated test window manually; never kill all Chrome/Edge processes'});fault ||= error}
    }
    write('capture-summary.json',{at:new Date().toISOString(),status:fault?'CAPTURE_FAULT':interrupted?'INTERRUPTED':closedEarly?'BROWSER_CLOSED_EARLY':droppedRecords?'CAPTURE_TRUNCATED':config.smoke?'SMOKE_PASS_NOT_PHYSICAL_ACCEPTANCE':'CAPTURE_COMPLETE_NOT_PHYSICAL_ACCEPTANCE',samples,droppedRecords,elapsedMilliseconds:Math.round(performance.now()-started),web_commit:config.web_commit,physical_windows_result:'NOT_RUN',customer_release:false,error:fault?.message || null})
    console.log('Evidence:',config.run)
    // Terminate this observer only; no taskkill/pkill or firmware action.
    process.exit(fault?1:interrupted?130:0)
  }
})()
