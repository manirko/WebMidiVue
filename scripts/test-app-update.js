const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const babel = require('@babel/core')

async function main() {
  const safetySource = fs.readFileSync('src/appUpdateSafety.mjs', 'utf8')
  const safety = await import(`data:text/javascript;base64,${Buffer.from(safetySource).toString('base64')}`)
  const ownerA = {}, ownerB = {}
  safety.setFirmwareUpdateBusy(ownerA, true)
  safety.setFirmwareUpdateBusy(ownerB, true)
  safety.setFirmwareUpdateBusy(ownerA, false)
  assert.equal(safety.canReloadApp(), false, 'One updater released another updater’s guard')
  safety.setFirmwareUpdateBusy(ownerB, false)
  assert.equal(safety.canReloadApp(), true)

  const source = fs.readFileSync('src/App.vue', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const compiled = babel.transformSync(source, {babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs']}).code
  let stop = async () => true
  let stops = 0, requests = 0, releaseSettings = async () => true
  const navigations = [], deadlines = new Map(), listeners = new Map()
  const context = {window: {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) }, location: {assign: url => navigations.push(url)}}, document: {},
    setTimeout: fn => { const id = {}; deadlines.set(id, fn); return id }, clearTimeout: id => deadlines.delete(id),
    module: {exports: {}}, exports: {}, require: name => {
    if (name === 'vue') return require('vue')
    if (name === '@/appUpdateSafety.mjs') return safety
    if (name === '@/audio/sessionState.mjs') return {stopPersistentSound: () => { stops++; return stop() }, releaseSettingsOwners: () => releaseSettings()}
    if (name === '@pwa-entry') return {requestAppUpdate: async canReload => {
      assert(canReload(), 'Firmware became busy while sound was stopping')
      requests++
      return {available: true, updating: true, error: ''}
    }}
    return {}
  }}
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  const definition = context.module.exports.default
  const build = () => {
    const instance = {appUpdate: {available: true, updating: false, error: ''}, appUpdating: false}
    instance.updateApp = definition.methods.updateApp.bind(instance)
    return instance
  }

  let app = build()
  safety.setFirmwareUpdateBusy(ownerA, true)
  await app.updateApp()
  assert.equal(stops, 0, 'App update interrupted sound while firmware was busy')
  assert.equal(requests, 0)
  assert.equal(app.appUpdate.error, 'SW_UPDATE_BLOCKED')
  safety.setFirmwareUpdateBusy(ownerA, false)

  app = build(); stop = async () => false
  await app.updateApp()
  assert.equal(requests, 0, 'Audio release failure still activated the new worker')
  assert.equal(app.appUpdate.error, 'AUDIO_RELEASE_FAILED')
  app = build(); stop = async () => { throw Error('close failed') }
  await app.updateApp()
  assert.equal(requests, 0)
  assert.equal(app.appUpdating, false)

  app = build(); stop = async () => true
  await app.updateApp()
  assert.equal(requests, 1)
  assert.equal(app.appUpdate.updating, true)
  assert.equal(app.appUpdating, false)

  // Double clicks share the pending sound release rather than two activations.
  let finishStop
  app = build(); stop = () => new Promise(resolve => { finishStop = resolve })
  const first = app.updateApp()
  await app.updateApp()
  assert.equal(requests, 1)
  finishStop(true)
  await first
  assert.equal(requests, 2)
  let navigationGuard, focuses = 0, removed = 0
  const routeApp = {betaBuild: true, appUpdate: {reloadRequired: false},
    $refs: {appUpdateAction: {focus: () => { focuses++ }}},
    $router: {beforeEach(guard) { navigationGuard = guard; return () => { removed++ } }}}
  definition.mounted.call(routeApp)
  assert.equal(navigationGuard(), true, 'Waiting update blocked a route before activation')
  routeApp.appUpdate.reloadRequired = true
  assert.equal(navigationGuard(), false, 'Old tab requested a deleted route chunk')
  assert.equal(focuses, 1, 'Old tab navigation did not direct the user to Update app')
  definition.beforeUnmount.call(routeApp)
  assert.equal(removed, 1, 'App router guard was not removed on unmount')
  const creatorApp = () => ({creatorOpening: false, creatorMessage: '', openCreator: definition.methods.openCreator})
  app = creatorApp(); safety.setFirmwareUpdateBusy(ownerA, true)
  const oldStops = stops
  await app.openCreator(); assert.equal(stops, oldStops); assert.equal(navigations.length, 0)
  safety.setFirmwareUpdateBusy(ownerA, false)
  stop = async () => false; await app.openCreator(); assert.equal(navigations.length, 0)
  stop = async () => true; releaseSettings = async () => false
  await app.openCreator(); assert.equal(navigations.length, 0); assert.match(app.creatorMessage, /could not be released/)
  releaseSettings = async () => { safety.setFirmwareUpdateBusy(ownerA, true); return true }
  await app.openCreator(); assert.equal(navigations.length, 0)
  safety.setFirmwareUpdateBusy(ownerA, false)
  let finishSettings
  releaseSettings = () => new Promise(resolve => { finishSettings = resolve })
  const pendingCreator = app.openCreator(); await Promise.resolve(); await Promise.resolve()
  await app.openCreator(); assert.equal(app.creatorOpening, true)
  assert.equal(deadlines.size, 1)
  for (const deadline of deadlines.values()) deadline()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(app.creatorOpening, true, 'Timeout released the native close barrier')
  assert.match(app.creatorMessage, /still pending/)
  finishSettings(true); await pendingCreator; assert.equal(app.creatorOpening, false)
  assert.equal(navigations.length, 0, 'late cleanup navigated after the visible timeout')
  releaseSettings = async () => true; await app.openCreator()
  assert.deepEqual(navigations, ['/creator.html']); assert.equal(deadlines.size, 0)
  navigations.length = 0; releaseSettings = () => new Promise(resolve => { finishSettings = resolve })
  finishSettings = null
  const hiddenCreator = app.openCreator()
  for (let i = 0; i < 20 && !finishSettings; i++) await Promise.resolve()
  assert.equal(typeof finishSettings, 'function', 'Handoff never requested Settings release')
  listeners.get('pagehide')(); finishSettings(true); await hiddenCreator
  assert.equal(navigations.length, 0, 'Late handoff redirected a restored page')
  assert.equal(listeners.has('pagehide'), false, 'Handoff leaked its lifecycle listener')
  releaseSettings = async () => true; await app.openCreator(); assert.deepEqual(navigations, ['/creator.html'])
  const session = {reactive: value => value, shallowRef: value => ({value}), DEFAULT_VOLUME: 70}
  vm.runInNewContext(fs.readFileSync('src/audio/sessionState.mjs', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '') +
    '\nglobalThis.api = {registerSettingsOwner, releaseSettingsOwners};', session)
  let retry = false, waited = 0, late = 0
  session.api.registerSettingsOwner(async () => { waited++; return retry })
  assert.equal(await session.api.releaseSettingsOwners(), false)
  retry = true
  session.api.registerSettingsOwner(async () => { session.api.registerSettingsOwner(async () => { late++; return true }); return true })
  assert.equal(await session.api.releaseSettingsOwners(), true)
  assert.equal(waited, 2); assert.equal(late, 1, 'owner added during release was skipped')
  assert.equal(await session.api.releaseSettingsOwners(), true); assert.equal(waited, 2)
  console.log('App update safety passed: multiple firmware owners, no audio interruption during flash, failed stop, explicit release, double click')
}
let completed = false
main().then(() => { completed = true }).catch(error => { completed = true; console.error(error); process.exitCode = 1 })
process.once('beforeExit', () => { if (!completed) { console.error('App update test ended with an unsettled operation'); process.exitCode = 1 } })
