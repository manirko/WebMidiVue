const fs = require('fs')
const http = require('http')
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

function browserConfig(name = process.env.BIOTRON_QA_BROWSER || 'chrome') {
  if (name === 'chrome') return {name, engine: 'chromium', options: {executablePath: chromePath()}}
  if (Object.hasOwn(installed, name)) {
    if (!fs.existsSync(installed[name])) throw new Error(`${name} not installed: ${installed[name]}`)
    return {name, engine: 'chromium', options: {executablePath: installed[name]}}
  }
  if (name === 'msedge') return {name, engine: 'chromium', options: {channel: 'msedge'}}
  if (['chromium', 'firefox', 'webkit'].includes(name)) return {name, engine: name, options: {}}
  throw new Error(`Unknown BIOTRON_QA_BROWSER: ${name}`)
}

async function launchBrowser() {
  const config = browserConfig()
  const browser = await require('playwright-core')[config.engine].launch({...config.options, headless: true})
  console.log(JSON.stringify({browser: config.name, engine: config.engine, version: browser.version(),
    executable: config.options.executablePath || config.options.channel || 'Playwright pinned binary',
    scope: config.engine === 'webkit' ? 'Playwright WebKit, not installed Safari' :
      config.engine === 'firefox' ? 'Playwright patched Firefox, not installed Firefox' : 'Isolated browser profile'}))
  return browser
}

async function launchPersistentContext(profile, options) {
  const config = browserConfig()
  const context = await require('playwright-core')[config.engine].launchPersistentContext(profile,
    {...options, ...config.options, headless: true})
  console.log(JSON.stringify({browser: config.name, engine: config.engine, version: context.browser().version(),
    scope: 'Isolated persistent test profile; Firefox/WebKit are Playwright binaries, not installed Firefox/Safari'}))
  return context
}

function contextOptions(options, browser) {
  // Firefox does not implement Playwright mobile emulation. Preserve the
  // viewport/touch dimensions and record that this is responsive coverage.
  const result = {...options}
  if (browser.browserType().name() === 'firefox') delete result.isMobile
  return result
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

module.exports = {chromePath, browserNames, browserConfig, launchBrowser, launchPersistentContext, contextOptions, createStaticServer}
