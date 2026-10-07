export const OFFLINE_STATUS_EVENT = 'playtronica-offline-status'
export const APP_UPDATE_EVENT = 'playtronica-app-update'

const SETUP_DEADLINE_MS = 10000
const PRECACHE_PREFIX = 'web-midi-playtronica-precache-'
let offlineStatus = {
  state: process.env.NODE_ENV === 'production' ? 'installing' : 'development',
  code: process.env.NODE_ENV === 'production' ? 'SW_PREPARING' : 'DEVELOPMENT',
  ready: false
}
let setupPromise = null
let setupGeneration = 0
let updateStatus = {available: false, updating: false, error: ''}
let updateRegistration = null
let updatePromise = null
let watchingController = false
let knownController = null
const observedRegistrations = new WeakSet()

export const getOfflineStatus = () => ({...offlineStatus})
export const getAppUpdateStatus = () => ({...updateStatus})
const publishUpdateStatus = patch => {
  updateStatus = {...updateStatus, ...patch}
  window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT, {detail: getAppUpdateStatus()}))
}

const observeUpdates = registration => {
  if (!registration) return
  updateRegistration = registration
  const checkWaiting = () => {
    if (registration.waiting && registration.waiting.state !== 'redundant') {
      publishUpdateStatus({available: true})
    }
  }
  checkWaiting()
  if (!observedRegistrations.has(registration)) {
    observedRegistrations.add(registration)
    const trackInstalling = () => {
      const installing = registration.installing
      if (!installing?.addEventListener) return
      const changed = () => {
        checkWaiting()
        if (['installed', 'redundant'].includes(installing.state)) {
          installing.removeEventListener('statechange', changed)
        }
      }
      installing.addEventListener('statechange', changed)
      changed()
    }
    registration.addEventListener?.('updatefound', trackInstalling)
    trackInstalling()
  }
  if (!watchingController) {
    watchingController = true
    knownController = navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const current = navigator.serviceWorker.controller
      // Another tab may accept the update. This tab only offers a reload:
      // its audio and any firmware operation continue until its own click.
      if (current && knownController && current !== knownController) {
        publishUpdateStatus({available: true})
      }
      if (current) knownController = current
    })
  }
}

// GenerateSW(skipWaiting: false) provides the SKIP_WAITING message handler.
// Only this explicit action may activate a waiting worker and reload this tab.
export const requestAppUpdate = (canReload = () => true) => {
  if (updatePromise) return updatePromise
  if (!canReload()) {
    publishUpdateStatus({updating: false, error: 'SW_UPDATE_BLOCKED'})
    return Promise.resolve(getAppUpdateStatus())
  }
  if (!updateStatus.available || !updateRegistration) return Promise.resolve(getAppUpdateStatus())
  publishUpdateStatus({updating: true, error: ''})
  const waiting = updateRegistration.waiting
  if (!waiting) {
    // The worker was already activated by another tab.
    window.location.reload()
    return Promise.resolve(getAppUpdateStatus())
  }
  updatePromise = (async () => {
    try {
      await withDeadline(signal => {
        const controlled = waitForController(signal, navigator.serviceWorker.controller)
        controlled.catch(() => {}) // postMessage can throw before this promise is returned.
        waiting.postMessage({type: 'SKIP_WAITING'})
        return controlled
      })
      if (!canReload()) throw swError('Firmware is busy.', 'SW_UPDATE_BLOCKED')
      window.location.reload()
    } catch (error) {
      publishUpdateStatus({updating: false,
        error: error.code === 'SW_SETUP_TIMEOUT' ? 'SW_UPDATE_TIMEOUT' : error.code || 'SW_UPDATE_FAILED'})
    }
    return getAppUpdateStatus()
  })().finally(() => { updatePromise = null })
  return updatePromise
}

const swError = (message, code) => Object.assign(new Error(message), {code})
const assertCurrent = signal => {
  if (signal.aborted) throw swError('Offline setup timed out.', 'SW_SETUP_TIMEOUT')
}

const publishOfflineStatus = (state, ready = false, code = '') => {
  offlineStatus = {state, code, ready}
  window.dispatchEvent(new CustomEvent(OFFLINE_STATUS_EVENT, {detail: getOfflineStatus()}))
}

const withDeadline = async operation => {
  const controller = new AbortController()
  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = window.setTimeout(() => {
      controller.abort()
      reject(swError('Offline setup timed out.', 'SW_SETUP_TIMEOUT'))
    }, SETUP_DEADLINE_MS)
  })
  try { return await Promise.race([operation(controller.signal), deadline]) }
  finally { window.clearTimeout(timeout); controller.abort() }
}

const waitForController = (signal, previous = null) => new Promise((resolve, reject) => {
  assertCurrent(signal)
  const controlled = () => navigator.serviceWorker.controller && navigator.serviceWorker.controller !== previous
  if (controlled()) { resolve(); return }
  const cleanup = () => {
    navigator.serviceWorker.removeEventListener('controllerchange', changed)
    signal.removeEventListener('abort', cancelled)
  }
  const changed = () => {
    if (!controlled()) return
    cleanup()
    resolve()
  }
  const cancelled = () => {
    cleanup()
    reject(swError('Offline setup timed out.', 'SW_SETUP_TIMEOUT'))
  }
  navigator.serviceWorker.addEventListener('controllerchange', changed)
  signal.addEventListener('abort', cancelled, {once: true})
  if (signal.aborted) cancelled()
  else changed()
})

// Workbox stores revisioned URLs with a query string. Check their paths in one
// precache, including the lazy Biotron/Sound chunks and this page's shell assets.
const hasRequiredPrecache = async signal => {
  if (!('caches' in window)) return false
  const base = new URL(process.env.BASE_URL, window.location.origin)
  const relative = url => {
    const path = new URL(url, window.location.href).pathname
    return path.startsWith(base.pathname) ? path.slice(base.pathname.length) : path
  }
  const required = ['index.html', 'manifest.json',
    'img/icons/icon-192x192.png', 'img/icons/icon-512x512.png']
  for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
    required.push(relative(element.src || element.href))
  }
  const names = await window.caches.keys()
  assertCurrent(signal)
  for (const name of names.filter(value => value.startsWith(PRECACHE_PREFIX))) {
    const cache = await window.caches.open(name)
    assertCurrent(signal)
    const keys = await cache.keys()
    assertCurrent(signal)
    const paths = new Set(keys.map(request => relative(request.url)))
    if (required.every(path => paths.has(path)) &&
        [...paths].some(path => /^js\/biotron\.[^.]+\.js$/.test(path)) &&
        [...paths].some(path => /^js\/sound-lab\.[^.]+\.js$/.test(path)) &&
        [...paths].some(path => /^js\/elementary-runtime\.[^.]+\.js$/.test(path))) return true
  }
  return false
}

const prepare = async signal => {
  const worker = navigator.serviceWorker
  const existingRegistration = await worker.getRegistration()
  assertCurrent(signal)
  observeUpdates(existingRegistration)
  if (!existingRegistration && !navigator.onLine) {
    throw swError('First offline installation needs internet.', 'SW_FIRST_INSTALL_OFFLINE')
  }
  if (!existingRegistration || navigator.onLine) {
    const registration = await worker.register(`${process.env.BASE_URL}service-worker.js`)
    assertCurrent(signal)
    observeUpdates(registration)
  }
  await worker.ready
  assertCurrent(signal)
  await waitForController(signal)
  assertCurrent(signal)
  if (!await hasRequiredPrecache(signal)) {
    throw swError('The offline cache is incomplete.', 'SW_CACHE_INCOMPLETE')
  }
}

export const prepareOfflineAccess = () => {
  if (setupPromise) return setupPromise
  if (!('serviceWorker' in navigator)) {
    publishOfflineStatus('unsupported', false, 'SW_UNSUPPORTED')
    return Promise.resolve(getOfflineStatus())
  }

  const generation = ++setupGeneration
  setupPromise = (async () => {
    publishOfflineStatus('installing', false, 'SW_PREPARING')
    try {
      await withDeadline(prepare)
      if (generation === setupGeneration) publishOfflineStatus('ready', true, 'SW_READY')
    } catch (error) {
      if (generation === setupGeneration) {
        console.error('Could not prepare Settings for offline use:', error)
        publishOfflineStatus('error', false, error.code || 'SW_SETUP_FAILED')
      }
    }
    return getOfflineStatus()
  })().finally(() => {
    if (generation === setupGeneration) setupPromise = null
  })
  return setupPromise
}

if (process.env.NODE_ENV === 'production') {
  window.addEventListener('load', prepareOfflineAccess)
}
