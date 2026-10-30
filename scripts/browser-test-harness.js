const fs = require('fs')
const http = require('http')
const crypto = require('node:crypto')
const path = require('path')

const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2'
}

function chromePath() {
  const executable = [process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  ].filter(Boolean).find(fs.existsSync)
  if (!executable) throw new Error('Chrome/Chromium not found; set CHROME_PATH')
  return executable
}

// One selector for the existing suites. Never replace a requested browser with
// Chrome: a missing binary or unsupported name is a coverage failure.
const installed = {
    'chrome-beta': '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'chromium-gost': '/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost',
    opera: '/Applications/Opera.app/Contents/MacOS/Opera',
    vivaldi: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
    arc: '/Applications/Arc.app/Contents/MacOS/Arc'
  }
const browserNames = ['chrome', ...Object.keys(installed), 'msedge', 'chromium', 'firefox', 'webkit']

// A fork can disconnect while Playwright leaves newPage/newContext pending.
// Keep these operations bounded; an unresolved promise must never exit as PASS.
function browserCall(browser, action, label, timeout = 30000) {
  if (!browser.isConnected()) return Promise.reject(new Error(`Browser disconnected before ${label}`))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); browser.off('disconnected', disconnected)
      if (error) reject(error); else resolve(value)
    }
    const disconnected = () => finish(new Error(`Browser disconnected during ${label}`))
    browser.once('disconnected', disconnected)
    const timer = setTimeout(() => finish(new Error(`Browser ${label} timed out after ${timeout}ms`)), timeout)
    Promise.resolve().then(action).then(value => finish(null, value), finish)
  })
}

function guardPages(context, browser) {
  const newPage = context.newPage.bind(context)
  context.newPage = (...args) => browserCall(browser, () => newPage(...args), 'newPage')
  return context
}

function browserConfig(name = process.env.BIOTRON_QA_BROWSER || 'chrome') {
  if (name === 'chrome') return {name, engine: 'chromium', options: {executablePath: chromePath()}}
  if (Object.hasOwn(installed, name)) {
    if (!fs.existsSync(installed[name])) throw new Error(`${name} not installed: ${installed[name]}`)
    return {name, engine: 'chromium', options: {executablePath: installed[name]}}
  }
  if (name === 'msedge') {
    if (process.env.EDGE_PATH) {
      if (!fs.existsSync(process.env.EDGE_PATH)) throw new Error('EDGE_PATH does not exist')
      return {name, engine: 'chromium', options: {executablePath: process.env.EDGE_PATH}}
    }
    return {name, engine: 'chromium', options: {channel: 'msedge'}}
  }
  if (['chromium', 'firefox', 'webkit'].includes(name)) return {name, engine: name, options: {}}
  throw new Error(`Unknown BIOTRON_QA_BROWSER: ${name}`)
}

const ownedBrowsers = new Set()
async function launchBrowser(options = {}) {
  const cleanupFile=process.env.BIOTRON_QA_CLEANUP_FILE, attempt=process.env.BIOTRON_QA_ATTEMPT
  if(cleanupFile && (!path.isAbsolute(cleanupFile) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(attempt)))throw new Error('Cleanup receipt needs an absolute file and attempt UUID')
  const config = browserConfig()
  const browser = await require('playwright-core')[config.engine].launch({headless: true, ...options, ...config.options})
  if(cleanupFile){
    const close=browser.close.bind(browser)
    const record=()=>fs.writeFileSync(cleanupFile,JSON.stringify({attempt,pid:process.pid,openBrowsers:ownedBrowsers.size,browserApiClosed:ownedBrowsers.size===0,globalClaim:false}))
    ownedBrowsers.add(browser);record()
    browser.close=async(...args)=>{await close(...args);ownedBrowsers.delete(browser);record()}
  }
  const newContext = browser.newContext.bind(browser)
  browser.newContext = (...args) => browserCall(browser, () => newContext(...args), 'newContext')
    .then(context => guardPages(context, browser))
  console.log(JSON.stringify({browser: config.name, engine: config.engine, version: browser.version(),
    executable: config.options.executablePath || config.options.channel || 'Playwright pinned binary',
    scope: config.engine === 'webkit' ? 'Playwright WebKit, not installed Safari' :
      config.engine === 'firefox' ? 'Playwright patched Firefox, not installed Firefox' : 'Isolated browser profile'}))
  return browser
}

// Background traffic is not UI readiness. Navigation and the actual ready
// marker share the existing 5-second deadline; neither gets a fresh allowance.
async function gotoReady(page, url, ready) {
  const began = Date.now()
  return browserCall(page.context().browser(), async () => {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 5000})
    const remaining = 5000 - (Date.now() - began)
    if (remaining <= 0) throw new Error('UI readiness exceeded 5000ms')
    await ready(remaining)
  }, 'UI readiness', 5000)
}

async function launchPersistentContext(profile, options) {
  const config = browserConfig()
  const context = await require('playwright-core')[config.engine].launchPersistentContext(profile,
    {...options, ...config.options, headless: true})
  console.log(JSON.stringify({browser: config.name, engine: config.engine, version: context.browser().version(),
    scope: 'Isolated persistent test profile; Firefox/WebKit are Playwright binaries, not installed Firefox/Safari'}))
  return guardPages(context, context.browser())
}

function contextOptions(options, browser) {
  // Firefox does not implement Playwright mobile emulation. Preserve the
  // viewport/touch dimensions and record that this is responsive coverage.
  const result = {...options}
  if (browser.browserType().name() === 'firefox') delete result.isMobile
  return result
}

function qaOrigin(server, supplied = process.env.BIOTRON_QA_ORIGIN) {
  if (supplied === undefined) return `http://127.0.0.1:${server.address().port}`
  const url = new URL(supplied)
  if (url.protocol !== 'https:' || !/^[0-9a-f]{8}\.biotron-settings-beta\.pages\.dev$/.test(url.hostname) ||
      url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BIOTRON_QA_ORIGIN must be an immutable Biotron beta HTTPS origin')
  }
  return url.origin
}

async function verifyOnlineIdentity(context, origin, root) {
  const expected = fs.readFileSync(path.join(root, 'release-evidence.json'))
  const response = await context.request.get(origin + '/release-evidence.json', {timeout: 15000, maxRedirects: 0})
  if (response.status() !== 200 || !(await response.body()).equals(expected)) {
    throw new Error('Online runtime metadata differs from the pinned artifact')
  }
  const release = JSON.parse(expected)
  if (!/^[0-9a-f]{40}$/.test(release.commit) || !(release.firmware_update_enabled === false || (release.firmware_update_enabled === true && release.firmware_update_channel === 'public-stable'))) {
    throw new Error('Online software lane requires a pinned disabled or public-stable firmware channel')
  }
  return {origin, commit: release.commit, buildId: release.build_id, byteIdenticalMetadata: true}
}

// Install before navigation in SW-free isolated contexts. Test POSTs never
// reach the hosted preview; the recorded attempts are not delivery evidence.
async function isolateOnlineWrites(context) {
  const evidence = {blocked: [], policy: 'GET/HEAD/OPTIONS only; telemetry POST receives local503'}
  await context.route('**/*', route => {
    const request = route.request(), method = request.method()
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.fallback()
    evidence.blocked.push({method, url: request.url()})
    if (new URL(request.url()).pathname === '/api/telemetry')
      return route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"isolated_test_no_remote_write"}'})
    return route.abort('blockedbyclient')
  })
  return evidence
}

// Cloudflare hides these config files and canonicalises .html. All other
// emitted bytes must match; a first successful HTTP read is not a runtime test.
async function verifyOnlineArtifact(context, origin, root) {
  const identity = await verifyOnlineIdentity(context, origin, root)
  const inventory = directory => fs.readdirSync(directory, {withFileTypes: true})
    .flatMap(entry => entry.isDirectory() ? inventory(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
  const readings = []
  for (const file of inventory(root).sort()) {
    const name = path.relative(root, file).split(path.sep).join('/')
    if (['_headers', '_worker.js'].includes(name)) continue
    const response = await context.request.get(origin + '/' + name, {timeout: 15000, maxRedirects: 3})
    const expected = fs.readFileSync(file), actual = await response.body()
    const final = new URL(response.url()), requested = '/' + name
    const permittedPath = name.endsWith('.html') && name !== 'index.html' ? requested.slice(0, -5) : requested
    if (response.status() !== 200 || final.origin !== origin ||
        ![requested, permittedPath, ...(name === 'index.html' ? ['/'] : [])].includes(final.pathname) || !actual.equals(expected))
      throw new Error(`Online artifact mismatch: ${name} -> ${response.status()} ${response.url()}`)
    readings.push({file: name, url: response.url(), bytes: actual.length,
      sha256: crypto.createHash('sha256').update(actual).digest('hex')})
  }
  return {...identity, files: readings, excludedConfigFiles: ['_headers', '_worker.js']}
}

function createStaticServer(root, options = {}) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    if (pathname === '/api/telemetry' && request.method === 'POST') {
      request.resume()
      response.writeHead(202, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
      response.end('{"accepted":true}')
      return
    }
    let relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    let file = path.resolve(root, relative)
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      relative = 'index.html'
      file = path.join(root, relative)
    }
    let body = fs.readFileSync(file)
    if (options.transform) body = options.transform(relative, body)
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...options.headers
    })
    response.end(body)
  })
}

module.exports = {chromePath, browserNames, browserConfig, browserCall, launchBrowser, gotoReady, launchPersistentContext, contextOptions, qaOrigin, verifyOnlineIdentity, verifyOnlineArtifact, isolateOnlineWrites, createStaticServer}
