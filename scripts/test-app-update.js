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
  let stops = 0, requests = 0
  const context = {module: {exports: {}}, exports: {}, require: name => {
    if (name === '@/appUpdateSafety.mjs') return safety
    if (name === '@/audio/sessionState.mjs') return {stopPersistentSound: () => { stops++; return stop() }}
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
  console.log('App update safety passed: multiple firmware owners, no audio interruption during flash, failed stop, explicit release, double click')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
