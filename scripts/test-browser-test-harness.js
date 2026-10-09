const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const {EventEmitter} = require('node:events')
const {chromium} = require('playwright-core')
const {chromePath, browserConfig, browserCall, qaOrigin, verifyOnlineIdentity, createStaticServer} = require('./browser-test-harness')

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
    for (const bad of [{...release, commit: null}, {...release, commit: 'old'}, {...release, firmware_update_enabled: true}]) {
      const bytes = Buffer.from(JSON.stringify(bad))
      fs.writeFileSync(path.join(root, 'release-evidence.json'), bytes)
      await assert.rejects(verifyOnlineIdentity(identityContext(200, bytes), origin, root), /updates disabled/)
    }
    console.log('PASS 12 immutable-origin and 6 pinned online-identity controls; no network in these controls')
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
