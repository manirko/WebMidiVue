const assert = require('assert')
const babel = require('@babel/core')
const fs = require('fs')
const vm = require('vm')

function loadModule(path, contextValues = {}) {
  const source = fs.readFileSync(path, 'utf8')
  const compiled = babel.transformSync(source, {
    filename: path,
    plugins: ['@babel/plugin-transform-modules-commonjs']
  }).code
  const context = {
    exports: {},
    module: {exports: {}},
    console,
    Date,
    Promise,
    setTimeout,
    require,
    ...contextValues
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  return context.module.exports
}

const validAsset = {
  state: 'uploaded',
  size: 99840,
  name: 'biotron-firmware_1.8.2.uf2',
  browser_download_url: 'https://github.com/Playtronica/biotron-firmware/releases/download/1.8.2/biotron-firmware_1.8.2.uf2',
  digest: `sha256:${'a'.repeat(64)}`
}

async function resolveWith({online = true, response}) {
  const firmware = loadModule('src/assets/js/LoadFirmware.js', {
    navigator: {onLine: online},
    fetch: async () => response
  })
  try {
    return {value: await firmware.resolveFirmware('Playtronica/biotron-firmware')}
  } catch (error) {
    return {error}
  }
}

;(async () => {
  let result = await resolveWith({online: false})
  assert.match(result.error.message, /internet connection/)

  result = await resolveWith({response: {ok: false, status: 503}})
  assert.match(result.error.message, /503/)

  result = await resolveWith({
    response: {ok: true, json: async () => ({assets: [{...validAsset, digest: null}]})}
  })
  assert.match(result.error.message, /SHA-256/)

  result = await resolveWith({
    response: {ok: true, json: async () => ({assets: [validAsset, {...validAsset, name: 'second.uf2'}]})}
  })
  assert.match(result.error.message, /exactly one/)

  result = await resolveWith({
    response: {ok: true, json: async () => ({tag_name: '1.8.2', assets: [validAsset]})}
  })
  assert.ifError(result.error)
  assert.strictEqual(result.value.name, validAsset.name)
  assert.strictEqual(result.value.sha256, 'a'.repeat(64))
  assert.strictEqual(result.value.version, '1.8.2')

  const sysEx = loadModule('src/assets/js/SysExCommand.js')
  const events = []
  const device = {
    state: 'connected',
    open: async () => events.push('open'),
    send: message => {
      events.push(['send', Array.from(message)])
      setTimeout(() => { device.state = 'disconnected' }, 0)
    }
  }
  await sysEx.bootDevice(device, {timeoutMs: 100, pollMs: 1})
  assert.deepStrictEqual(events, [
    'open',
    ['send', [240, 11, 20, 13, 127, 247]]
  ])
  assert.strictEqual('close' in device, false)

  const stuckDevice = {
    state: 'connected',
    open: async () => {},
    send: () => {}
  }
  await assert.rejects(
    sysEx.bootDevice(stuckDevice, {timeoutMs: 2, pollMs: 1}),
    /did not enter update mode/
  )

  console.log('Firmware update verified: metadata fails closed; one exact SysEx stays open until USB disconnect.')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
