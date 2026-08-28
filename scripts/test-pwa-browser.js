const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright-core')

const root = path.resolve(__dirname, '..', 'dist')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'biotron-pwa-profile-'))
let origin
const mime = {
  '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon',
  '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2'
}
let serviceWorkerVersion = 1
let context

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean)
  const executable = candidates.find(fs.existsSync)
  assert(executable, 'Chrome/Chromium not found; set CHROME_PATH')
  return executable
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, origin).pathname
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  let file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    relative = 'index.html'
    file = path.join(root, relative)
  }
  let body = fs.readFileSync(file)
  if (relative === 'service-worker.js') {
    body = Buffer.from(`${body.toString()}\nself.addEventListener('message',event=>{if(event.data&&event.data.type==='TEST_SW_VERSION'&&event.ports[0])event.ports[0].postMessage(${serviceWorkerVersion})})\n`)
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/'
  })
  response.end(body)
})

async function waitFor(predicate, message, timeout = 10000) {
  const started = Date.now()
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function openProfile(online) {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    headless: true,
    serviceWorkers: 'allow',
    args: ['--no-first-run']
  })
  await context.addInitScript(({ initiallyOnline }) => {
    window.__testOnline = initiallyOnline
    window.__midiRequestCount = 0
    window.__midiRequestOptions = []
    window.__midiSent = []
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => window.__testOnline
    })

    const input = {
      id: 'biotron-input-1', manufacturer: 'Playtronica', name: 'Biotron',
      connection: 'closed', onmidimessage: null,
      async open() { this.connection = 'open'; return this },
      async close() { this.connection = 'closed'; return this }
    }
    const output = {
      id: 'biotron-output-1', manufacturer: 'Playtronica', name: 'Biotron',
      connection: 'closed',
      async open() { this.connection = 'open'; return this },
      async close() { this.connection = 'closed'; return this },
      send(data) { window.__midiSent.push(Array.from(data)) }
    }
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async options => {
        window.__midiRequestCount += 1
        window.__midiRequestOptions.push(options)
        return access
      }
    })
  }, { initiallyOnline: online })
  await context.setOffline(!online)
  return context.pages()[0] || await context.newPage()
}

async function closeProfile() {
  if (!context) return
  await context.close()
  context = null
}

async function controllerVersion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No active service worker controller'))
      return
    }
    const channel = new MessageChannel()
    const timeout = setTimeout(() => reject(new Error('Service worker version probe timed out')), 3000)
    channel.port1.onmessage = event => {
      clearTimeout(timeout)
      resolve(event.data)
    }
    navigator.serviceWorker.controller.postMessage({type: 'TEST_SW_VERSION'}, [channel.port2])
  }))
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`

  let page = await openProfile(true)
  await page.goto(`${origin}/biotron`, { waitUntil: 'load' })
  await page.getByText(/Ready offline —/i).waitFor({state: 'visible', timeout: 15000})
  assert.strictEqual(await controllerVersion(page), 1)
  assert.strictEqual(await page.evaluate(() => window.__midiRequestCount), 1, 'MIDI permission was requested more than once')
  assert.strictEqual(await page.evaluate(() => window.__midiRequestOptions[0].sysex), true, 'SysEx was not requested in the single MIDI permission flow')

  const manifest = await page.evaluate(() => fetch('/manifest.json').then(response => response.json()))
  assert.strictEqual(manifest.start_url, './#/')
  assert.strictEqual(manifest.scope, './')
  assert.strictEqual(manifest.display, 'standalone')
  console.log('1/5 online install, active precache, manifest and one SysEx permission flow verified')

  await closeProfile()
  page = await openProfile(false)
  await page.goto(`${origin}/biotron`, { waitUntil: 'load' })
  await waitFor(() => page.url().includes('/#/biotron'), 'direct route was not normalized to the cached hash route')
  await page.getByText(/Offline — Settings are available/i).waitFor({state: 'visible', timeout: 10000})
  assert.strictEqual(await controllerVersion(page), 1)
  assert.strictEqual(await page.evaluate(() => window.__midiRequestCount), 1, 'offline restart used more than one MIDI permission request')
  console.log('2/5 full Chrome restart with the same profile and network disabled verified')

  const sendButton = page.getByRole('button', {name: /Send to Device/i})
  await waitFor(() => sendButton.isEnabled(), 'fake Biotron did not connect offline')
  const sentBefore = await page.evaluate(() => window.__midiSent.length)
  await sendButton.click()
  await waitFor(
    () => page.evaluate(before => window.__midiSent.length > before, sentBefore),
    'offline setting write did not reach the fake MIDI output'
  )
  assert(await page.evaluate(() => window.__midiSent.some(message => message[0] === 0xF0 && message.at(-1) === 0xF7)), 'no complete SysEx setting was sent offline')
  console.log('3/5 offline Biotron detection and SysEx settings write verified')

  await page.getByRole('button', { name: /Update Firmware/i }).click()
  await page.getByText(/Firmware updates require an internet connection/i).waitFor({state: 'visible', timeout: 5000})
  const update = page.locator('.modal.show').getByRole('button', { name: 'Prepare update', exact: true })
  assert(await update.isDisabled(), 'firmware preparation remains enabled offline')
  console.log('4/5 offline firmware guard verified')

  await context.setOffline(false)
  await page.evaluate(() => {
    window.__testOnline = true
    window.dispatchEvent(new Event('online'))
  })
  serviceWorkerVersion = 2
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
  await waitFor(
    () => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)),
    'updated worker did not enter waiting state'
  )
  assert.strictEqual(await controllerVersion(page), 1, 'updated worker replaced the active session')

  await closeProfile()
  page = await openProfile(false)
  await page.goto(`${origin}/biotron`, {waitUntil: 'load'})
  await page.getByText(/Offline — Settings are available/i).waitFor({state: 'visible', timeout: 10000})
  assert.strictEqual(await controllerVersion(page), 2, 'waiting update did not activate after the browser process closed')
  assert.strictEqual(
    await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)),
    false,
    'old waiting worker remains after deliberate restart'
  )
  console.log('5/5 A→B update stayed non-disruptive, activated after restart and launched offline')

  console.log('Browser PWA verified across persistent-profile restarts: offline app shell, one MIDI/SysEx flow, setting write, firmware guard and controlled update.')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await closeProfile()
  server.close()
  fs.rmSync(profile, {recursive: true, force: true})
})
