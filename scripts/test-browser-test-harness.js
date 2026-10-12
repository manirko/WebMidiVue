const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const {EventEmitter} = require('node:events')
const {chromium} = require('playwright-core')
const {chromePath, browserConfig, browserCall, gotoReady, qaOrigin, verifyOnlineIdentity, verifyOnlineArtifact, isolateOnlineWrites, createStaticServer} = require('./browser-test-harness')

assert.throws(() => browserConfig('safari'), /Unknown BIOTRON_QA_BROWSER/,
  'Safari must never silently run Chrome or Playwright WebKit')
assert.equal(browserConfig('firefox').engine, 'firefox')
assert.equal(browserConfig('webkit').engine, 'webkit')
const originalOrigin = process.env.BIOTRON_QA_ORIGIN
try {
  delete process.env.BIOTRON_QA_ORIGIN
  assert.equal(qaOrigin({address: () => ({port: 12345})}), 'http://127.0.0.1:12345')
  assert.equal(qaOrigin(null, 'https://9a2de909.biotron-settings-beta.pages.dev/'), 'https://9a2de909.biotron-settings-beta.pages.dev')
  for (const origin of ['', 'http://9a2de909.biotron-settings-beta.pages.dev',
    'https://biotron-settings-beta.pages.dev', 'https://candidate-8bda7ab6e6d4.biotron-settings-beta.pages.dev',
    'https://9a2de909.biotron-settings-beta.pages.dev.evil.test', 'https://user@9a2de909.biotron-settings-beta.pages.dev',
    'https://9a2de909.biotron-settings-beta.pages.dev/path', 'https://9a2de909.biotron-settings-beta.pages.dev?q=1',
    'https://9a2de909.biotron-settings-beta.pages.dev/#/biotron', 'https://9a2de909.biotron-settings-beta.pages.dev:444']) {
    assert.throws(() => qaOrigin(null, origin))
  }
} finally {
  if (originalOrigin === undefined) delete process.env.BIOTRON_QA_ORIGIN
  else process.env.BIOTRON_QA_ORIGIN = originalOrigin
}
const originalEdgePath = process.env.EDGE_PATH
try {
  process.env.EDGE_PATH = __filename // Path contract only; this fixture is never launched.
  assert.deepEqual(browserConfig('msedge').options, {executablePath: __filename})
  process.env.EDGE_PATH = path.join(__dirname, 'missing-edge-executable')
  assert.throws(() => browserConfig('msedge'), /EDGE_PATH does not exist/)
  delete process.env.EDGE_PATH
  assert.deepEqual(browserConfig('msedge').options, {channel: 'msedge'})
} finally {
  if (originalEdgePath === undefined) delete process.env.EDGE_PATH
  else process.env.EDGE_PATH = originalEdgePath
}

// Non-ASCII CSS previously reached CDP response.body() in a different encoding
// from the actual HTTP bytes. Keep both observations: transport and browser.
const unicode = '—\u00a0Привет é'
const fixtures = [
  ['index.html', 'text/html; charset=utf-8', `<meta charset="utf-8"><title>Test</title><link rel="stylesheet" href="/fixture.css"><p>${unicode}</p><img src="/fixture.svg">`],
  ['fixture.css', 'text/css; charset=utf-8', `p::before{content:"${unicode}"}`],
  ['fixture.js', 'text/javascript; charset=utf-8', `/* ${unicode} */`],
  ['fixture.json', 'application/json; charset=utf-8', JSON.stringify({text: unicode})],
  ['fixture.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="9"><rect width="8" height="9"/></svg>'],
  ...[['ico', 'image/x-icon'], ['png', 'image/png'], ['webp', 'image/webp'],
    ['ttf', 'font/ttf'], ['woff2', 'font/woff2'], ['bin', 'application/octet-stream']]
    .map(([ext, mime]) => [`fixture.${ext}`, mime, Buffer.from([0, 128, 255, 13, 10])])
].map(([name, mime, body]) => ({name, mime, body: Buffer.from(body)}))

function readHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve({status: response.statusCode,
        headers: response.headers, body: Buffer.concat(chunks)}))
    })
    request.on('error', reject)
    request.setTimeout(5000, () => request.destroy(new Error('HTTP fixture timed out')))
    request.end()
  })
}

;(async () => {
  const handlers = []
  const writes = await isolateOnlineWrites({route: async (pattern, fn) => {assert.equal(pattern, '**/*'); handlers.push(fn)}})
  const transmitted = [], blocked = []
  for (const [method, url] of [['GET', 'https://fixture.test/js/app.js'], ['POST', 'https://fixture.test/api/telemetry'], ['PUT', 'https://other.test/private']]) {
    await handlers[0]({request: () => ({method: () => method, url: () => url}),
      fallback: () => transmitted.push(method), fulfill: options => blocked.push(options.status), abort: reason => blocked.push(reason)})
  }
  assert.deepEqual(transmitted, ['GET']); assert.deepEqual(blocked, [503, 'blockedbyclient'])
  assert.equal(writes.blocked.length, 2)
  const identityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biotron-online-identity-'))
  try {
    const payload = {'release-evidence.json': JSON.stringify({commit: 'a'.repeat(40), firmware_update_enabled: false}),
      'creator.html': '<h1>Exact creator</h1>', '_headers': 'config', '_worker.js': 'config'}
    for (const [name, body] of Object.entries(payload)) fs.writeFileSync(path.join(identityRoot, name), body)
    const fakeContext = {request: {get: async url => {
      const name = new URL(url).pathname.slice(1)
      return {status: () => 200, body: async () => Buffer.from(payload[name]), url: () => name === 'creator.html' ? url.slice(0, -5) : url}
    }}}
    assert.equal((await verifyOnlineArtifact(fakeContext, 'https://fixture.test', identityRoot)).files.length, 2)
    payload['creator.html'] += 'stale'; await assert.rejects(verifyOnlineArtifact(fakeContext, 'https://fixture.test', identityRoot), /artifact mismatch/)
    payload['creator.html'] = '<h1>Exact creator</h1>'
    const get = fakeContext.request.get
    fakeContext.request.get = async url => ({...await get(url), url: () => 'https://other.test/creator'})
    await assert.rejects(verifyOnlineArtifact(fakeContext, 'https://fixture.test', identityRoot), /artifact mismatch/)
  } finally {fs.rmSync(identityRoot, {recursive: true, force: true})}
  console.log('PASS hosted write isolation, exact bytes, canonical redirect and cross-origin negative controls')
  const qualitySource = fs.readFileSync(path.join(__dirname, 'test-quality-browser.js'), 'utf8')
  const colourStart = qualitySource.indexOf('      const rgb = '), colourEnd = qualitySource.indexOf('      const contrast = ', colourStart)
  assert(colourStart > 0 && colourEnd > colourStart)
  const colour = vm.runInNewContext(qualitySource.slice(colourStart, colourEnd) + ';\n({rgb,over,luminance})')
  const ratio = (fg, bg) => {const values = [colour.luminance(fg), colour.luminance(bg)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05)}
  assert.equal(ratio([0, 0, 0], [255, 255, 255]), 21)
  assert.equal(ratio([255, 255, 255], [255, 255, 255]), 1)
  assert.equal(colour.over([0, 0, 0, .5], [255, 255, 255])[0], 127.5)
  assert(ratio([13,110,253], [237,240,233]) < 4.5)
  assert(ratio([10,88,202], [237,240,233]) > 4.5)
  console.log('PASS contrast math/alpha compositing; current pale-surface link fails and darker control passes')


  const soundSource = fs.readFileSync(path.join(__dirname, 'test-sound-browser.js'), 'utf8')
  const evidenceStart = soundSource.indexOf('if (process.env.BIOTRON_QA_OUTPUT && !process.env.BIOTRON_TEST_EVIDENCE_DIR)')
  const evidenceEnd = soundSource.indexOf('const cacheTraceEnabled', evidenceStart)
  assert(evidenceStart > 0 && evidenceEnd > evidenceStart)
  for (const explicit of [false, true]) {
    const env = {BIOTRON_QA_OUTPUT: '/fixture', ...(explicit ? {BIOTRON_TEST_EVIDENCE_DIR:'/explicit'} : {})}, calls = []
    vm.runInNewContext(soundSource.slice(evidenceStart, evidenceEnd), {process:{env}, path, console:{log:()=>{}},
      fs:{mkdirSync:(...args)=>calls.push(args),mkdtempSync:prefix=>prefix+'unique'}})
    assert.equal(env.BIOTRON_TEST_EVIDENCE_DIR, explicit ? '/explicit' : '/fixture/sound-browser-unique')
    assert.equal(calls.length, explicit ? 0 : 1)
  }
  const renderStart = qualitySource.indexOf('function qualityJourneyHtml('), renderEnd = qualitySource.indexOf('// Additional coverage', renderStart)
  const render = vm.runInNewContext(qualitySource.slice(renderStart, renderEnd) + ';qualityJourneyHtml')
  const attack = '<img src=x onerror=alert(1)><script>evil()</script>'
  const html = render({engine:attack,version:'1',status:'FAIL',origin:attack,capturedAt:'now',sourceSha256:'x',limits:'scope',
    transitions:[{from:'x',to:'y',action:attack,result:'FAIL',wallMs:1}],findings:[],audits:[],notRun:[]})
  assert(html.includes('<main ') && html.includes('</main>'))
  assert(!html.includes('<img src=x') && !html.includes('<script>evil()'))
  assert(html.includes('&lt;img') && html.includes('data-result="FAIL"'))
  console.log('PASS direct gate evidence fallback/explicit preservation; generated report escapes untrusted text and retains main landmark')
  const traceStart = soundSource.indexOf('function installCacheLifecycleTrace(')
  const traceEnd = soundSource.indexOf('\nconst soakArgument', traceStart)
  const calls = [], events = {}, nativePromise = Promise.resolve([])
  class CacheStorage { keys() {assert.equal(this, caches); calls.push('native'); return nativePromise} }
  const caches = new CacheStorage()
  const traceScope = {CacheStorage, location:{href:'http://fixture/'}, window:{caches,
    __recordCacheTrace(row) {calls.push(row); return Promise.resolve()}, addEventListener(type, callback) {events[type] = callback}}}
  vm.runInNewContext(soundSource.slice(traceStart, traceEnd) + '\ninstallCacheLifecycleTrace()', traceScope)
  assert.equal(caches.keys(), nativePromise, 'trace replaced the native Cache promise')
  assert(calls.includes('native')); assert.equal(calls[0].type, 'cache-call')
  const reason = Error('native cache failure')
  events.unhandledrejection({promise:nativePromise, reason})
  assert.equal(calls.at(-1).operation.operationId, 1, 'trace lost exact native-promise correlation')
  assert.equal(calls.at(-1).message, reason.message)
  const releaseBegin = soundSource.indexOf("  await denied.getByRole('button', {name: 'Stop & release'}).click()")
  const releaseEnd = soundSource.indexOf('  const permissionHelp =', releaseBegin)
  assert(releaseBegin >= 0 && releaseEnd > releaseBegin)
  for (const failedRelease of [false, true]) {
    let released = false, navigations = 0, requests = 0
    const denied = {
      getByRole: (kind, options) => ({click: async () => {if (options.name === 'Stop & release') released = false; else requests++}}),
      goto: async () => {assert(released, 'Permission fixture moved before release completed'); navigations++},
      locator: () => ({waitFor: async () => {if (failedRelease) throw Error('Release remains pending'); released = true}}),
      getByText: () => ({waitFor: async () => assert.equal(requests, 1)}),
    }
    const attempt = vm.runInNewContext('(async()=>{' + soundSource.slice(releaseBegin, releaseEnd) + '})()', {denied, origin: 'https://fixture.invalid'})
    if (failedRelease) {await assert.rejects(attempt, /Release remains pending/); assert.equal(navigations, 0); assert.equal(requests, 0)}
    else await attempt
  }
  console.log('PASS permission fixture verifies closed audio/free ownership; failed release prevents the next step')

  const captureBegin = soundSource.lastIndexOf('    const evidenceDirectory = process.env.BIOTRON_TEST_EVIDENCE_DIR')
  const captureEnd = soundSource.indexOf('\n    throw error', captureBegin)
  assert(captureBegin >= 0 && captureEnd > captureBegin)
  const captureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biotron-fault-capture-control-'))
  try {
    for (const mode of ['reject', 'success', 'pending']) {
      const directory = path.join(captureRoot, mode); fs.mkdirSync(directory)
      let screenshots = 0
      const browser = new EventEmitter(); browser.isConnected = () => true; browser.version = () => 'fake-control'
      const tab = {url: () => 'https://fixture.invalid/#/biotron/play',
        evaluate: fn => mode === 'reject' ? Promise.reject(Error('DOM snapshot refused')) : mode === 'pending' ? new Promise(() => {}) : Promise.resolve(fn()),
        locator: () => ({innerText: async () => 'Fixture body'}), screenshot: async () => {screenshots++}}
      browser.contexts = () => [{pages: () => [tab]}]
      const window = {__permissionRequests: 0, __permissionNowAllowed: false}
      const document = {fonts: {status: 'loaded', [Symbol.iterator]: function*() {}},
        querySelectorAll: selector => selector === '.sound-lab' ? [{dataset: {audioState: 'closed'}}] : [{textContent: 'Start listening', disabled: false}]}
      const error = Error('Original permission fault sentinel'), started = Date.now()
      await vm.runInNewContext('(async()=>{' + soundSource.slice(captureBegin, captureEnd) + '})()',
        {fs, path, error, browser, browserCall, process: {env: {BIOTRON_TEST_EVIDENCE_DIR: directory}}, window, document, navigator:{maxTouchPoints:0}, console})
      const jsonFiles = fs.readdirSync(directory).filter(name => name.endsWith('.json')); assert.equal(jsonFiles.length, 1)
      const report = JSON.parse(fs.readFileSync(path.join(directory, jsonFiles[0])))
      assert.match(report.error, /Original permission fault sentinel/); assert.equal(report.beforeCleanup, true)
      if (mode === 'success') {assert.equal(report.fixture.permissionRequests, 0); assert.equal(report.fixture.permissionNowAllowed, false); assert.equal(report.fixture.ui[0].audioState, 'closed')}
      else assert.match(report.captureError, /DOM snapshot refused|timed out/)
      assert.equal(screenshots, 1); assert.equal(browser.listenerCount('disconnected'), 0)
      assert(Date.now() - started < 2500, 'First-fault state collection escaped its bound')
    }
  } finally {fs.rmSync(captureRoot, {recursive: true, force: true})}
  console.log('PASS first fault survives unavailable/pending DOM; native helper guard bounds capture, zero/false and UI state are retained')
  const auditionSource=fs.readFileSync(path.join(__dirname,'test-audition-browser.js'),'utf8')
  const faultBegin=auditionSource.indexOf('  const faultPage=diagnosticPage || page'),faultEnd=auditionSource.indexOf('  // A ZIP export',faultBegin)
  const bound=auditionSource.split('\n').find(line=>line.startsWith('const boundedCapture='))
  const auditionFaultRoot=fs.mkdtempSync(path.join(os.tmpdir(),'biotron-audition-fault-'))
  try {
    for(const mode of ['success','reject','pending']){
      const artifacts=path.join(auditionFaultRoot,mode);fs.mkdirSync(artifacts)
      const page={evaluate:()=>{assert(fs.existsSync(path.join(artifacts,'failure.json')),'DOM began before first fault persisted');return mode==='pending'?new Promise(()=>{}):mode==='reject'?Promise.reject(Error('capture unavailable')):Promise.resolve({fixture:true})},screenshot:async()=>{assert.equal(JSON.parse(fs.readFileSync(path.join(artifacts,'failure.json'))).error,'primary sentinel')}}
      await vm.runInNewContext('(async()=>{'+bound+'\n'+auditionSource.slice(faultBegin,faultEnd)+'})()',{fs,path,artifacts,page,diagnosticPage:null,stage:'sentinel',starts:0,error:Error('primary sentinel'),setTimeout})
      const first=JSON.parse(fs.readFileSync(path.join(artifacts,'failure.json')))
      assert.equal(first.error,'primary sentinel');assert.equal(first.beforeCapture,true)
      const sidecar=JSON.parse(fs.readFileSync(path.join(artifacts,'failure-state.json')))
      assert(mode==='success'?sidecar.state.fixture:sidecar.state.unavailable)
    }
  } finally {fs.rmSync(auditionFaultRoot,{recursive:true,force:true})}
  const fake = new EventEmitter()
  fake.isConnected = () => true
  assert.equal(await browserCall(fake, () => 42, 'resolved'), 42)
  assert.equal(await browserCall(fake, () => new Promise(resolve => setTimeout(() => resolve('export finished'), 20)), 'trace export', 100), 'export finished',
    'Cleanup must wait for an export that is still within its deadline')
  await assert.rejects(browserCall(fake, () => {throw new Error('original fault')}, 'rejected'), /original fault/)
  const pending = browserCall(fake, () => new Promise(() => {}), 'newPage')
  fake.emit('disconnected')
  await assert.rejects(pending, /disconnected during newPage/)
  await assert.rejects(browserCall(fake, () => new Promise(() => {}), 'deadline', 5), /timed out/)
  fake.isConnected = () => false
  await assert.rejects(browserCall(fake, () => {throw new Error('must not run')}, 'closed'), /disconnected before closed/)
  assert.equal(fake.listenerCount('disconnected'), 0, 'All completed guards release their listener')
  console.log('PASS pending browser call disconnect/deadline/original-fault guards')
  const cleanupRoot=fs.mkdtempSync(path.join(os.tmpdir(),'biotron-owned-close-'))
  try {
    const receipt=path.join(cleanupRoot,'cleanup.json'),executable=path.join(cleanupRoot,'fixture-browser')
    fs.writeFileSync(executable,'fixture only');let failClose=true
    const namespace={module:{exports:{}},console:{log(){}},process:{pid:process.pid,env:{CHROME_PATH:executable,BIOTRON_QA_CLEANUP_FILE:receipt,BIOTRON_QA_ATTEMPT:'12345678-1234-1234-1234-123456789abc'}},
      require:name=>name==='playwright-core'?{chromium:{launch:async()=>({version:()=> 'fixture',newContext:async()=>{},close:async()=>{if(failClose)throw Error('injected close failure')}})}}:require(name)}
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'browser-test-harness.js'),'utf8'),namespace)
    const first=await namespace.module.exports.launchBrowser(),second=await namespace.module.exports.launchBrowser()
    await assert.rejects(first.close(),/injected close failure/)
    assert.equal(JSON.parse(fs.readFileSync(receipt)).openBrowsers,2)
    failClose=false;await first.close();assert.equal(JSON.parse(fs.readFileSync(receipt)).browserApiClosed,false)
    await second.close();const proof=JSON.parse(fs.readFileSync(receipt))
    assert.equal(proof.openBrowsers,0);assert.equal(proof.browserApiClosed,true);assert.equal(proof.globalClaim,false)
    assert.equal(proof.attempt,namespace.process.env.BIOTRON_QA_ATTEMPT)
  } finally {fs.rmSync(cleanupRoot,{recursive:true,force:true})}
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biotron-http-fixture-'))
  let server, browser, fault
  try {
    const release = {commit: 'a'.repeat(40), build_id: 'a'.repeat(12), firmware_update_enabled: false}
    const metadata = () => Buffer.from(JSON.stringify(release))
    const identityContext = (status, body) => ({request: {get: async (url, options) => {
      assert.equal(url, 'https://9a2de909.biotron-settings-beta.pages.dev/release-evidence.json')
      assert.deepEqual(options, {timeout: 15000, maxRedirects: 0})
      return {status: () => status, body: async () => body}
    }}})
    const origin = 'https://9a2de909.biotron-settings-beta.pages.dev'
    fs.writeFileSync(path.join(root, 'release-evidence.json'), metadata())
    assert.equal((await verifyOnlineIdentity(identityContext(200, metadata()), origin, root)).byteIdenticalMetadata, true)
    await assert.rejects(verifyOnlineIdentity(identityContext(302, metadata()), origin, root), /metadata differs/)
    await assert.rejects(verifyOnlineIdentity(identityContext(200, Buffer.from('{}')), origin, root), /metadata differs/)
    const stable = {...release, firmware_update_enabled: true, firmware_update_channel: 'public-stable'}
    fs.writeFileSync(path.join(root, 'release-evidence.json'), JSON.stringify(stable))
    assert.equal((await verifyOnlineIdentity(identityContext(200, Buffer.from(JSON.stringify(stable))), origin, root)).commit, release.commit)
    fs.writeFileSync(path.join(root, 'release-evidence.json'), metadata())
    for (const bad of [{...release, commit: null}, {...release, commit: 'old'}, {...release, firmware_update_enabled: true}, {...release, firmware_update_enabled: true, firmware_update_channel: 'internal'}]) {
      const bytes = Buffer.from(JSON.stringify(bad))
      fs.writeFileSync(path.join(root, 'release-evidence.json'), bytes)
      await assert.rejects(verifyOnlineIdentity(identityContext(200, bytes), origin, root), /firmware channel/)
    }
    console.log('PASS immutable-origin and pinned online-identity controls, including stable-only and rejected internal firmware; no network in these controls')
    for (const {name, body} of fixtures) fs.writeFileSync(path.join(root, name), body)
    const before = fixtures.map(({name}) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'))
    server = createStaticServer(root)
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)})
    const localOrigin = `http://127.0.0.1:${server.address().port}`
    const transport = []
    for (const {name} of fixtures) transport.push(await readHttp(`${localOrigin}/${name}`))
    const telemetry = await readHttp(`${localOrigin}/api/telemetry`, {method: 'POST'})
    const fallback = await readHttp(`${localOrigin}/missing`)
    browser = await chromium.launch({executablePath: chromePath(), headless: true})
    const context = await browser.newContext({serviceWorkers: 'block'})
    await context.route('**/*', route => new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort())
    const page = await context.newPage()
    await page.goto(localOrigin, {waitUntil: 'load'})
    const cssContent = await page.locator('p').evaluate(element => getComputedStyle(element, '::before').content)
    const svgLoaded = await page.locator('img').evaluate(image => image.complete && image.naturalWidth === 8 && image.naturalHeight === 9)
    const received = []
    for (const {name} of fixtures) {
      const [response, raw] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/' + name, {timeout: 5000}),
        page.evaluate(async name => Array.from(new Uint8Array(await (await fetch('/' + name,
          {signal: AbortSignal.timeout(5000)})).arrayBuffer())), name)
      ])
      assert.equal(await response.finished(), null, name)
      received.push({status: response.status(), raw: Buffer.from(raw), captured: await response.body()})
    }
    // Gather all bytes before asserting so a missing MIME does not hide the
    // original encoding observation. No absent body counts as a match.
    const mismatches = fixtures.filter((fixture, i) => !received[i].captured.equals(fixture.body)).map(f => f.name)
    console.log(JSON.stringify({browser: browser.version(), fixtureRoot: root, fixtureCount: fixtures.length,
      cdpBodyMismatches: mismatches, cssContent, svgLoaded}))
    assert.deepEqual(mismatches, [], 'CDP response bodies differ from fixture bytes')
    for (const [i, fixture] of fixtures.entries()) {
      assert.equal(transport[i].status, 200, fixture.name)
      assert.deepEqual(transport[i].body, fixture.body, `${fixture.name}: HTTP bytes`)
      assert.equal(received[i].status, 200, fixture.name)
      assert.deepEqual(received[i].raw, fixture.body, `${fixture.name}: browser arrayBuffer`)
      assert.deepEqual(received[i].captured, fixture.body, `${fixture.name}: CDP response body`)
      assert.equal(transport[i].headers['content-type'], fixture.mime, `${fixture.name}: MIME`)
      assert.equal(transport[i].headers['cache-control'], 'no-store', fixture.name)
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, fixture.name))).digest('hex'), before[i])
    }
    assert.equal(cssContent, '"' + unicode + '"')
    assert(svgLoaded, 'SVG did not decode as an image')
    assert.equal(telemetry.status, 202)
    assert.equal(telemetry.headers['content-type'], 'application/json; charset=utf-8')
    assert.deepEqual(JSON.parse(telemetry.body), {accepted: true})
    assert.equal(fallback.headers['content-type'], 'text/html; charset=utf-8')
    assert.deepEqual(fallback.body, fixtures[0].body)
    console.log('PASS static tester HTTP/browser bytes, UTF8 CSS and SVG; local fixtures only')

    // Same page/actions/deadline: a pending ancillary fetch must not reject an
    // already usable view. A late view must still fail within the total budget.
    let backgroundRequests = 0
    await context.route(localOrigin + '/readiness-background', () => {backgroundRequests++})
    await context.route(localOrigin + '/readiness-view', route => route.fulfill({contentType:'text/html',
      body:'<button id="ready">Play</button><script>fetch("/readiness-background").catch(()=>{})</script>'}))
    const readiness = await context.newPage()
    const oldStarted = Date.now()
    await assert.rejects(readiness.goto(localOrigin + '/readiness-view', {waitUntil:'networkidle',timeout:5000}), /Timeout 5000ms/)
    assert(Date.now() - oldStarted < 5500); assert(await readiness.locator('#ready').isVisible()); assert.equal(backgroundRequests, 1)
    await gotoReady(readiness, localOrigin + '/readiness-view', timeout => readiness.locator('#ready').waitFor({timeout}))
    assert.equal(backgroundRequests, 2)
    await context.route(localOrigin + '/readiness-late', async route => {
      await new Promise(resolve => setTimeout(resolve, 1100))
      await route.fulfill({contentType:'text/html', body:'<script>setTimeout(()=>document.body.innerHTML="<button id=ready>Play</button>",4300)</script>'})
    })
    const lateStarted = Date.now()
    await assert.rejects(gotoReady(readiness, localOrigin + '/readiness-late', timeout => readiness.locator('#ready').waitFor({timeout})), /timed out|Timeout/)
    assert(Date.now() - lateStarted < 5500, 'Navigation plus view readiness received two deadlines')
    assert.equal(await readiness.locator('#ready').count(), 0, 'Late view was accepted')
    await readiness.close()
    console.log('PASS ready UI with pending background traffic; late view rejects within one unchanged 5s deadline')

    // A self-generated X glyph; no system font, download or runtime dependency.
    const font = Buffer.from('AAEAAAAKAIAAAwAgT1MvMkUAREwAAAEoAAAAYGNtYXAAogBFAAABkAAAADxnbHlmVl1WWwAAAdQAAAA0aGVhZGFsQ5wAAACsAAAANmhoZWEE2gIyAAAA5AAAACRobXR4AlgAAAAAAYgAAAAIbG9jYQANACcAAAHMAAAACG1heHAABQAGAAABCAAAACBuYW1lDWPUCAAAAggAAAG2cG9zdAAIADsAAAPAAAAAKAABAAAAAQAAgWEvX18PPPUAAQPoAAAAAAAAAAAAAAAAAAAAAABQAAACCAK8AAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYAAAAoAG4AAEAAAAAAAAAAAAAAAAAAAABAAEAAAADAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwJYAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAWAMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAACWAAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAKAAAAAYABAABAAIAIABY//8AAAAgAFj////h/6oAAQAAAAAAAAAAAA0ADQAaAAEAUAAAAggCvAADAAAzIREhUAG4/kgCvAAAAQBQAAACCAK8AAMAADMhESFQAbj+SAK8AAAAAAwAlgABAAAAAAABAAoAAAABAAAAAAACAAcACgABAAAAAAADACEAEQABAAAAAAAEABIAMgABAAAAAAAFAAsARAABAAAAAAAGABEATwADAAEECQABABQAYAADAAEECQACAA4AdAADAAEECQADAEIAggADAAEECQAEACQAxAADAAEECQAFABYA6AADAAEECQAGACIA/kJpb3Ryb24gUUFSZWd1bGFyQmlvdHJvbi1RQS1zZWxmLWdlbmVyYXRlZC1maXh0dXJlQmlvdHJvbiBRQSBSZWd1bGFyVmVyc2lvbiAxLjBCaW90cm9uUUEtUmVndWxhcgBCAGkAbwB0AHIAbwBuACAAUQBBAFIAZQBnAHUAbABhAHIAQgBpAG8AdAByAG8AbgAtAFEAQQAtAHMAZQBsAGYALQBnAGUAbgBlAHIAYQB0AGUAZAAtAGYAaQB4AHQAdQByAGUAQgBpAG8AdAByAG8AbgAgAFEAQQAgAFIAZQBnAHUAbABhAHIAVgBlAHIAcwBpAG8AbgAgADEALgAwAEIAaQBvAHQAcgBvAG4AUQBBAC0AUgBlAGcAdQBsAGEAcgAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAMAOw==', 'base64')
    page.setDefaultTimeout(5000)
    for (const fixture of [{name: 'old-success', timeout: 2000, expected: 'TIMEOUT'},
      {name: 'normal-success', expected: 'CAPTURED'},
      {name: 'first-fault', timeout: 2000, never: true, expected: 'TIMEOUT'}]) {
      const url = `${localOrigin}/font-control-${fixture.name}.ttf`
      let pending, finish
      const served = new Promise(resolve => { finish = resolve })
      await context.route(url, async route => {
        pending = route
        if (fixture.never) return
        await new Promise(resolve => setTimeout(resolve, 3000))
        await route.fulfill({status: 200, contentType: 'font/ttf', body: font})
        finish()
      })
      await page.setContent(`<style>@font-face{font-family:Delayed;src:url('${url}');font-display:swap}p{font-family:Delayed}button{font-family:Arial}</style><button onclick="document.body.dataset.state='connecting';window.trusted=event.isTrusted;const p=document.createElement('p');p.textContent='X';document.body.append(p)">Start listening</button>`)
      await page.getByRole('button', {name: 'Start listening'}).click()
      await page.waitForFunction(() => document.fonts.status === 'loading')
      assert.deepEqual(await page.evaluate(() => [document.body.dataset.state, window.trusted]), ['connecting', true])
      let outcome = 'CAPTURED', captureError = null
      const began = Date.now()
      try {
        await page.screenshot({path: path.join(root, fixture.name + '.png'),
          ...(fixture.timeout ? {timeout: fixture.timeout} : {})})
      } catch (error) { outcome = 'TIMEOUT'; captureError = error.message }
      console.log(JSON.stringify({fontCapture: fixture.name, outcome, elapsedMs: Date.now() - began, captureError}))
      assert.equal(outcome, fixture.expected)
      if (outcome === 'TIMEOUT') {
        assert.match(captureError, /Timeout 2000ms exceeded/)
        assert(Date.now() - began < 4000, 'First-fault evidence escaped its capture deadline')
      }
      if (fixture.never) await pending.abort()
      else await served
    }
    console.log('PASS delayed-font capture uses normal5s success deadline; first-fault capture stays bounded2s; trusted UI reacts before fonts finish')

  } catch (error) {
    fault = error
  } finally {
    // Cleanup each owned resource even when an earlier close fails; preserve
    // the original assertion/network fault rather than replacing it.
    if (browser) try {await browser.close()} catch (error) {fault ||= error}
    if (server?.listening) try {
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    } catch (error) {fault ||= error}
    try {fs.rmSync(root, {recursive: true, force: true})} catch (error) {fault ||= error}
  }
  if (fault) throw fault
})().catch(error => {console.error(error); process.exitCode = 1})
