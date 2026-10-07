const assert = require('assert')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.join(__dirname, '../src/registerServiceWorker.js'), 'utf8')
const originalNodeEnv = process.env.NODE_ENV
const originalBaseUrl = process.env.BASE_URL
process.env.NODE_ENV = 'production'
process.env.BASE_URL = '/'

let caseNumber = 0
const loadModule = () => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#case-${++caseNumber}`)
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const bounded = operation => Promise.race([
  operation,
  pause(250).then(() => { throw new Error('Offline setup did not terminate within its deadline') })
])

function environment({ready = Promise.resolve({}), cached = true, controller = {}} = {}) {
  const listeners = new Map()
  const eventTarget = (target = {}) => Object.assign(target, {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
      if (!listeners.get(type)?.size) listeners.delete(type)
    },
    emit(type) { for (const handler of [...(listeners.get(type) || [])]) handler() }
  })
  const registrationListeners = new Map()
  const registration = {
    waiting: null, installing: null,
    addEventListener(type, handler) { registrationListeners.set(type, handler) },
    emit(type) { registrationListeners.get(type)?.() }
  }
  const status = []
  const paths = [
    '/index.html?__WB_REVISION__=one', '/manifest.json?__WB_REVISION__=one',
    '/img/icons/icon-192x192.png', '/img/icons/icon-512x512.png',
    '/js/app.123.js', '/css/app.123.css', '/js/biotron.123.js',
    '/js/sound-lab.123.js', '/js/elementary-runtime.123.js'
  ]
  const cache = {
    paths: cached ? paths : paths.filter(value => !value.includes('sound-lab')),
    async keys() { return this.paths.map(value => ({url: `https://test.local${value}`})) }
  }
  const worker = eventTarget({
    controller,
    ready,
    registration,
    registerCalls: 0,
    getRegistration: async () => worker.registration,
    register: async () => { worker.registerCalls++; return worker.registration }
  })
  let reloads = 0
  const window = {
    location: {origin: 'https://test.local', href: 'https://test.local/biotron', reload: () => { reloads++ }},
    caches: {keys: async () => ['web-midi-playtronica-precache-v2'], open: async () => cache},
    setTimeout: (handler, milliseconds) => setTimeout(handler, Math.min(milliseconds, 30)),
    clearTimeout,
    addEventListener() {},
    dispatchEvent(event) { status.push(event.detail) }
  }
  global.window = window
  global.document = {
    querySelectorAll: () => [
      {src: 'https://test.local/js/app.123.js'},
      {href: 'https://test.local/css/app.123.css'}
    ]
  }
  Object.defineProperty(global, 'navigator', {
    configurable: true, value: {serviceWorker: worker, onLine: true}
  })
  return {worker, cache, listeners, status, window, reloads: () => reloads}
}

(async () => {
  const previousError = console.error
  console.error = () => {}
  try {
    let env = environment({ready: new Promise(() => {})})
    let module = await loadModule()
    let result = await bounded(module.prepareOfflineAccess())
    assert.deepStrictEqual(result, {state: 'error', code: 'SW_SETUP_TIMEOUT', ready: false})
    assert.equal(env.worker.registerCalls, 1)
    env.worker.ready = Promise.resolve({})
    result = await bounded(module.prepareOfflineAccess())
    assert.equal(result.ready, true, 'Retry after never-resolving ready failed')

    env = environment()
    env.worker.getRegistration = () => new Promise(() => {})
    module = await loadModule()
    assert.equal((await bounded(module.prepareOfflineAccess())).code, 'SW_SETUP_TIMEOUT',
      'Hanging registration lookup escaped the overall deadline')

    let finishRegister
    env = environment()
    env.worker.register = () => new Promise(resolve => { finishRegister = resolve })
    module = await loadModule()
    assert.equal((await bounded(module.prepareOfflineAccess())).code, 'SW_SETUP_TIMEOUT',
      'Hanging update escaped the overall deadline')
    finishRegister(env.worker.registration)
    await pause(20)
    assert.equal(module.getOfflineStatus().ready, false, 'Late update changed expired UI state')
    env.worker.register = async () => env.worker.registration
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, true, 'Update timeout retry failed')

    let finishReady
    env = environment({ready: new Promise(resolve => { finishReady = resolve })})
    module = await loadModule()
    result = await bounded(module.prepareOfflineAccess())
    assert.equal(result.code, 'SW_SETUP_TIMEOUT')
    finishReady({})
    await pause(20)
    assert.equal(module.getOfflineStatus().ready, false, 'Late ready changed expired UI state')
    env.worker.ready = Promise.resolve({})
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, true, 'Late-ready retry failed')

    env = environment()
    env.worker.register = async () => { throw new Error('update failed') }
    module = await loadModule()
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, false, 'Failed update reported ready')
    env.worker.register = async () => env.worker.registration
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, true, 'Update failure retry failed')

    env = environment()
    delete global.navigator.serviceWorker
    module = await loadModule()
    assert.deepStrictEqual(await bounded(module.prepareOfflineAccess()),
      {state: 'unsupported', code: 'SW_UNSUPPORTED', ready: false})

    env = environment({cached: false})
    module = await loadModule()
    assert.deepStrictEqual(await bounded(module.prepareOfflineAccess()),
      {state: 'error', code: 'SW_CACHE_INCOMPLETE', ready: false})
    env.cache.paths.push('/js/sound-lab.123.js')
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, true, 'Incomplete cache retry failed')

    env = environment()
    env.window.caches.keys = () => new Promise(() => {})
    module = await loadModule()
    assert.equal((await bounded(module.prepareOfflineAccess())).code, 'SW_SETUP_TIMEOUT',
      'Hanging cache check escaped the overall deadline')

    env = environment({controller: null})
    module = await loadModule()
    assert.equal((await bounded(module.prepareOfflineAccess())).code, 'SW_SETUP_TIMEOUT')
    assert.equal(env.listeners.get('controllerchange').size, 1,
      'Only the persistent update observer should survive the offline deadline')
    env.worker.controller = {}
    assert.equal((await bounded(module.prepareOfflineAccess())).ready, true, 'Controller retry failed')

    assert.equal(env.status.at(-1).code, 'SW_READY')

    // First install briefly has a waiting worker too. It is not an update of
    // this page until an existing controller is being replaced.
    env = environment({controller: null})
    env.worker.registration.waiting = {state: 'installed'}
    module = await loadModule()
    const firstInstall = module.prepareOfflineAccess()
    await pause(0)
    assert.equal(module.getAppUpdateStatus().available, false, 'First installation offered an app update')
    env.worker.registration.waiting = null
    env.worker.controller = {}
    env.worker.emit('controllerchange')
    await firstInstall
    assert.equal(module.getOfflineStatus().ready, true)
    assert.equal(module.getAppUpdateStatus().available, false)

    // A waiting update on a previously opened page must be visible without
    // activating it or interrupting sound/firmware merely by discovering it.
    env = environment()
    const messages = []
    const waiting = {state: 'installed', postMessage: message => messages.push(message)}
    env.worker.registration.waiting = waiting
    module = await loadModule()
    await module.prepareOfflineAccess()
    assert.equal(module.getAppUpdateStatus().available, true)
    assert.equal(module.getAppUpdateStatus().reloadRequired, false, 'A merely waiting worker blocked navigation')
    assert.equal(messages.length, 0)
    assert.equal(env.reloads(), 0)
    await module.requestAppUpdate(() => false)
    assert.equal(module.getAppUpdateStatus().error, 'SW_UPDATE_BLOCKED')
    assert.equal(messages.length, 0, 'Blocked firmware action activated an update')
    const update = module.requestAppUpdate()
    assert.deepStrictEqual(messages, [{type: 'SKIP_WAITING'}])
    assert.equal(env.reloads(), 0, 'Reload happened before the new worker controlled the page')
    env.worker.registration.waiting = null
    env.worker.controller = waiting
    env.worker.emit('controllerchange')
    await update
    assert.equal(env.reloads(), 1)
    assert.equal(env.listeners.get('controllerchange').size, 1, 'Update listener leaked')

    // A new worker discovered after startup follows the same explicit path.
    env = environment()
    module = await loadModule()
    await module.prepareOfflineAccess()
    const installing = {state: 'installing',
      addEventListener(type, handler) { this.changed = handler },
      removeEventListener() { this.changed = null }}
    env.worker.registration.installing = installing
    env.worker.registration.emit('updatefound')
    assert.equal(module.getAppUpdateStatus().available, false)
    installing.state = 'installed'
    env.worker.registration.waiting = installing
    installing.changed()
    assert.equal(module.getAppUpdateStatus().available, true)
    assert.equal(env.reloads(), 0)
    assert.equal(installing.changed, null)

    // An update accepted in another tab never reloads this one automatically.
    env.worker.registration.waiting = null
    env.worker.controller = installing
    env.worker.emit('controllerchange')
    assert.equal(env.reloads(), 0)
    assert.equal(module.getOfflineStatus().code, 'SW_APP_UPDATE_PENDING',
      'An old tab claimed its removed shell assets were still ready offline')
    assert.equal(module.getAppUpdateStatus().reloadRequired, true)
    await module.requestAppUpdate(() => false)
    assert.equal(env.reloads(), 0)
    await module.requestAppUpdate()
    assert.equal(env.reloads(), 1)

    // Stalled activation is bounded and retryable; late control does not reload.
    env = environment()
    env.worker.registration.waiting = waiting
    module = await loadModule()
    await module.prepareOfflineAccess()
    await bounded(module.requestAppUpdate())
    assert.equal(module.getAppUpdateStatus().error, 'SW_UPDATE_TIMEOUT')
    assert.equal(env.listeners.get('controllerchange').size, 1)
    env.worker.controller = waiting
    env.worker.registration.waiting = null
    env.worker.emit('controllerchange')
    assert.equal(env.reloads(), 0)
    await module.requestAppUpdate()
    assert.equal(env.reloads(), 1)

    // A firmware operation may begin while activation is in flight.
    env = environment()
    env.worker.registration.waiting = waiting
    module = await loadModule()
    await module.prepareOfflineAccess()
    let safe = true
    const raced = module.requestAppUpdate(() => safe)
    safe = false
    env.worker.controller = waiting
    env.worker.registration.waiting = null
    env.worker.emit('controllerchange')
    await raced
    assert.equal(env.reloads(), 0)
    assert.equal(module.getAppUpdateStatus().error, 'SW_UPDATE_BLOCKED')

    env = environment()
    env.worker.registration.waiting = {state: 'installed', postMessage() { throw Error('gone') }}
    module = await loadModule()
    await module.prepareOfflineAccess()
    assert.equal((await module.requestAppUpdate()).error, 'SW_UPDATE_FAILED')
    assert.equal(env.reloads(), 0)
    assert.equal(env.listeners.get('controllerchange').size, 1)
    console.log('Service worker deadline regression passed: hung/late ready, failed update, missing worker/cache/controller, retry')
    console.log('App update regression passed: waiting/discovered worker, explicit activation, cross-tab control, deadline, firmware race, failed message')
  } finally {
    console.error = previousError
    process.env.NODE_ENV = originalNodeEnv
    process.env.BASE_URL = originalBaseUrl
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
