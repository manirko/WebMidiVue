const assert = require('assert')
const babel = require('@babel/core')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync('src/assets/js/LoadFirmware.js', 'utf8')
const compiled = babel.transformSync(source, {
  filename: 'src/assets/js/LoadFirmware.js',
  babelrc: false,
  configFile: false,
  plugins: ['@babel/plugin-transform-modules-commonjs']
}).code

const digest = 'a'.repeat(64)
const trustedAsset = {
  name: 'biotron-firmware_1.8.2.uf2',
  browser_download_url: 'https://github.com/Playtronica/biotron-firmware/releases/download/1.8.2/biotron-firmware_1.8.2.uf2',
  digest: `sha256:${digest}`,
  size: 1024
}

async function runLegacy({online, response}) {
  const events = []
  const context = {
    exports: {},
    module: {exports: {}},
    navigator: {onLine: online},
    fetch: async () => response,
    window: {location: {assign: url => events.push(['download', url])}},
    require: name => {
      assert.strictEqual(name, '@/assets/js/SysExCommand')
      return {bootDevice: async device => {
        events.push(['boot-start', device])
        await Promise.resolve()
        events.push(['boot-done', device])
      }}
    }
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context)
  let error
  try {
    await context.module.exports.LoadFirmware('Playtronica/biotron-firmware', 'device')
  } catch (caught) {
    error = caught
  }
  return {events, error}
}

const arrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

;(async () => {
  const {compareFirmwareVersions} = contextForHelpers()
  assert.strictEqual(compareFirmwareVersions('1.9.8', '1.8.2'), 1)
  assert.strictEqual(compareFirmwareVersions('v1.8.2', '1.8.2'), 0)
  assert.strictEqual(compareFirmwareVersions('1.8.2', '1.9.8'), -1)

  const generalEnvironment = fs.readFileSync('.env.biotron-beta', 'utf8')
  assert.match(generalEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED=false$/m)
  assert.doesNotMatch(generalEnvironment, /VUE_APP_BIOTRON_FIRMWARE_TARGET/)
  const betaEnvironment = fs.readFileSync('.env.biotron-firmware-beta', 'utf8')
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED=true$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TARGET=1\.10\.9$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_SHA256=823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_SIZE=113664$/m)
  const cleanBytes = fs.readFileSync('beta-assets/firmware/biotron-1.10.9-clean.uf2')
  assert.strictEqual(cleanBytes.length, 113664)
  assert.strictEqual(crypto.createHash('sha256').update(cleanBytes).digest('hex'),
    '823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d')
  assert.strictEqual(contextForHelpers().inspectBiotronUf2(arrayBuffer(cleanBytes)).familyId, 0xe48bff56)
  const biotronPage = fs.readFileSync('src/components/BiotronPage/BiotronPageUpdated.vue', 'utf8')
  assert.match(biotronPage, /v-if="betaBuild && firmwareTestEnabled"/)
  assert.match(biotronPage, /VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED === 'true'/)
  const updateComponent = fs.readFileSync('src/components/MidiComponents/UpdateFirmwareComponent.vue', 'utf8')
  assert.match(updateComponent, /Downloading and checking firmware/)
  assert.match(updateComponent, /💾 Choose RPI-RP2 → install/)
  assert.match(updateComponent, /@click="\$emit\('check_firmware'\)"/)
  // F2 (2026-09-04): the folder picker opens in Documents; the drive must be named before and during the step.
  assert.match(updateComponent, /💾 Choose drive RPI-RP2 → Select\. 🍎 Mac: left sidebar · 🪟 Windows: This PC\./)
  assert.match(updateComponent, /<p v-if="internal && ready && canInstall" class="small text-muted">\{\{ pick \}\} 🍎 Tip: ⌘⇧G → \/Volumes\/RPI-RP2<\/p>/)
  // 3b (2026-09-05): no folder picker (Android Chrome) — one honest phrase instead of a step that throws.
  assert.match(updateComponent, /<p v-if="internal && ready && !canInstall">\{\{ desktopOnly \}\}<\/p>/)
  assert.match(updateComponent, /v-if="ready && actionText && \(!internal \|\| canInstall\)"/)
  // F3 (2026-09-04): page reloaded while Biotron sits in update mode — no MIDI, only the RPI-RP2 drive.
  assert.match(updateComponent, /Already see RPI-RP2\? Recover firmware/)
  // W4 (Sergey, 2026-09-08): he went looking for the downloaded file. The page must say it kept the
  // firmware in memory, and must offer the file itself as an equal manual fallback.
  assert.match(updateComponent, /is checked and held in this page — nothing was saved to your computer/)
  assert.match(updateComponent, /<a :href="latest\.url" :download="latest\.name">save \{\{ latest\.name \}\}<\/a>/)
  assert.match(updateComponent, /copy the saved file onto the disk named RPI-RP2/)
  assert.match(updateComponent, /<p v-if="recovery">🔌 No Biotron over MIDI\. 💾 Drive <strong>RPI-RP2<\/strong> on your computer\?/)
  assert.doesNotMatch(updateComponent, /public updater is intentionally disabled/i)
  await testComponentStateMachine(updateComponent)

  let result = await runLegacy({online: false})
  assert.match(result.error.message, /internet connection/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({online: true, response: {ok: false, status: 503}})
  assert.match(result.error.message, /503/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({online: true, response: {ok: true, json: async () => ({assets: []})}})
  assert.match(result.error.message, /exactly one verified/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({
    online: true,
    response: {ok: true, json: async () => ({assets: [{...trustedAsset, digest: null}]})}
  })
  assert.match(result.error.message, /no trusted SHA-256/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({
    online: true,
    response: {ok: true, json: async () => ({assets: [trustedAsset]})}
  })
  assert.ifError(result.error)
  assert.deepStrictEqual(result.events, [
    ['boot-start', 'device'],
    ['boot-done', 'device'],
    ['download', trustedAsset.browser_download_url]
  ])

  const updater = contextForHelpers()
  const firmwarePath = path.resolve('beta-assets/firmware/biotron-1.9.8-beta08-organic-led.uf2')
  const firmwareBytes = fs.readFileSync(firmwarePath)
  const firmware = {
    version: '1.9.8',
    name: path.basename(firmwarePath),
    url: '/firmware/biotron-1.9.8-beta08-organic-led.uf2',
    sha256: crypto.createHash('sha256').update(firmwareBytes).digest('hex'),
    size: firmwareBytes.length
  }
  assert.strictEqual(firmware.sha256, '38c7fd35ef5e456d86b03f50f380d499519835fa84b7516fbd7b1cd1012b91da')
  const uf2 = updater.inspectBiotronUf2(arrayBuffer(firmwareBytes))
  assert.strictEqual(uf2.blocks, 216)
  assert.strictEqual(uf2.familyId, 0xe48bff56)
  assert.strictEqual(uf2.payloadBytes, 55296)

  const fetchFirmware = async () => ({ok: true, arrayBuffer: async () => arrayBuffer(firmwareBytes)})
  const fetched = await updater.prepareFirmware(firmware, fetchFirmware, crypto.webcrypto)
  assert.strictEqual(fetched.sha256, firmware.sha256)

  const wrongHash = {...firmware, sha256: '0'.repeat(64)}
  await assert.rejects(() => updater.prepareFirmware(wrongHash, fetchFirmware, crypto.webcrypto), /checksum does not match/)

  const unsafeBytes = Buffer.from(firmwareBytes)
  unsafeBytes.writeUInt32LE(0x10080000, 12)
  assert.throws(() => updater.inspectBiotronUf2(arrayBuffer(unsafeBytes)), /outside the safe Biotron program area/)

  const writes = []
  const writable = {
    write: async bytes => writes.push(Buffer.from(bytes)),
    close: async () => writes.push('closed'),
    abort: async () => writes.push('aborted')
  }
  // Copied verbatim from the RP2040 bootrom that serves the drive (raspberrypi/pico-bootrom-rp2040,
  // bootrom/info_uf2.txt, read 2026-09-08). The bootrom writes this file, not our build (gate B2).
  const INFO_UF2 = 'UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n'
  const bootDrive = (name, info = INFO_UF2) => ({
    name,
    getFileHandle: async (entry, options) => {
      if (entry === 'INFO_UF2.TXT') {
        if (info === null) throw Object.assign(new Error('not found'), {name: 'NotFoundError'})
        return {getFile: async () => ({text: async () => info})}
      }
      assert.strictEqual(entry, firmware.name)
      assert.strictEqual(options.create, true)
      return {createWritable: async options => {
        assert.strictEqual(options.keepExistingData, false)
        return writable
      }}
    }
  })

  const written = await updater.writeFirmware(fetched, firmware, async () => bootDrive('RPI-RP2'))
  assert.strictEqual(written.directory, 'RPI-RP2')
  assert.strictEqual(written.filename, firmware.name)
  assert.strictEqual(written.bytes, firmware.size)
  assert.strictEqual(writes[0].length, firmware.size)
  assert.strictEqual(writes[1], 'closed')

  // Chromium names a picked directory after the path basename, and FilePath::BaseName() strips the
  // Windows drive letter, so the root of drive D: arrives as '\' — never as the volume label
  // (base/files/file_path.cc, content/browser/file_system_access/file_system_chooser.cc, read 2026-09-08).
  // Sergey's Windows FAIL of 2026-09-08 (finding W1). The boot drive is judged by its content, not its name.
  for (const name of ['\\', '', 'D:', 'RPI-RP2 (E:)', 'rpi-rp2', 'RPi-RP2']) {
    writes.length = 0
    const result = await updater.writeFirmware(fetched, firmware, async () => bootDrive(name))
    assert.strictEqual(result.bytes, firmware.size, `boot drive named ${JSON.stringify(name)} must be written`)
    assert.strictEqual(writes[1], 'closed')
  }

  // A directory without the bootrom marker is refused, and the message names what the person opened.
  writes.length = 0
  await assert.rejects(() => updater.writeFirmware(fetched, firmware, async () => bootDrive('Downloads', null)),
    /You opened "Downloads"\. Nothing was written/)
  assert.deepStrictEqual(writes, [])
  await assert.rejects(() => updater.writeFirmware(fetched, firmware, async () => bootDrive('RPI-RP2', 'Board-ID: RP2350')),
    /Nothing was written/)

  await assert.rejects(() => updater.writeFirmware(fetched, firmware, null), /computer with Chrome or Edge/)

  console.log('Firmware update verified: exact beta UF2 is hash/size/structure checked before BOOT; only RPI-RP2 receives bytes; failures stay fail-closed.')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})

function contextForHelpers() {
  const helperContext = {
    exports: {},
    module: {exports: {}},
    navigator: {onLine: true},
    require: () => ({bootDevice: async () => {}})
  }
  helperContext.exports = helperContext.module.exports
  vm.runInNewContext(compiled, helperContext)
  return helperContext.module.exports
}

async function testComponentStateMachine(componentSource) {
  const script = componentSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  const compiledComponent = babel.transformSync(script, {
    filename: 'src/components/MidiComponents/UpdateFirmwareComponent.vue',
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs']
  }).code
  const calls = []
  const busyOwners = new Set()
  let writeFailure = null
  let writeGate = null
  const prepared = {buffer: new ArrayBuffer(512), sha256: '38c7fd35ef5e456d86b03f50f380d499519835fa84b7516fbd7b1cd1012b91da'}
  const context = {
    exports: {},
    module: {exports: {}},
    navigator: {onLine: true},
    process: {env: {
      VUE_APP_BIOTRON_FIRMWARE_TARGET: '1.9.8',
      VUE_APP_BIOTRON_FIRMWARE_NAME: 'biotron-1.9.8-beta08-organic-led.uf2',
      VUE_APP_BIOTRON_FIRMWARE_URL: '/firmware/biotron-1.9.8-beta08-organic-led.uf2',
      VUE_APP_BIOTRON_FIRMWARE_SHA256: prepared.sha256,
      VUE_APP_BIOTRON_FIRMWARE_SIZE: '110592'
    }},
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      showDirectoryPicker: async () => ({name: 'RPI-RP2'})
    },
    setTimeout: fn => {
      calls.push(['timer', fn])
      return calls.length
    },
    clearTimeout: id => calls.push(['clear', id]),
    require: name => {
      if (name === '@/biotron/telemetry.mjs') return {recordFirmwarePhase: () => {}}
      if (name === '@/appUpdateSafety.mjs') return {setFirmwareUpdateBusy: (owner, busy) => {
        if (busy) busyOwners.add(owner)
        else busyOwners.delete(owner)
      }}
      if (name === '@/assets/js/LoadFirmware') {
        return {
          compareFirmwareVersions: contextForHelpers().compareFirmwareVersions,
          GetLatestFirmware: async () => {},
          LoadFirmware: async () => {},
          prepareFirmware: async firmware => {
            calls.push(['prepare', firmware.version])
            return prepared
          },
          writeFirmware: async (value, firmware) => {
            calls.push(['write', value, firmware.version])
            if (writeFailure) throw writeFailure
            if (writeGate) await writeGate
          }
        }
      }
      if (name === '@/assets/js/SysExCommand') {
        return {bootDevice: async device => calls.push(['boot', device])}
      }
      throw new Error(`Unexpected import: ${name}`)
    }
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiledComponent, context)
  const definition = context.module.exports.default
  const build = props => {
    const instance = {...definition.data(), repo: 'Playtronica/biotron-firmware', versionAware: true, ...props}
    let phase = instance.phase
    Object.defineProperty(instance, 'phase', {get: () => phase, set: value => {
      phase = value
      if (!instance.updaterUnmounted) definition.watch.phase.handler.call(instance, value)
    }})
    for (const [name, method] of Object.entries(definition.methods)) instance[name] = method.bind(instance)
    for (const [name, computed] of Object.entries(definition.computed)) {
      Object.defineProperty(instance, name, {get: computed.bind(instance)})
    }
    return instance
  }
  const drive = /💾 Choose drive RPI-RP2 → Select\. 🍎 Mac: left sidebar · 🪟 Windows: This PC\./

  // Normal path: Biotron answers over MIDI with 1.9.7 — verify, restart, choose drive, write, reconnect.
  const instance = build({device: 'selected-midi-output', currentVersion: '1.9.7'})
  assert.strictEqual(instance.buttonText, 'Update to 1.9.8')
  await instance.runStep()
  assert.strictEqual(instance.phase, 'prepared')
  assert(!busyOwners.has(instance), 'A completed download left the reload guard stuck')
  assert.deepStrictEqual(calls[0], ['prepare', '1.9.8'])
  await instance.runStep()
  assert.strictEqual(instance.phase, 'select-drive')
  assert(busyOwners.has(instance), 'BOOT/drive selection did not guard against app reload')
  assert.deepStrictEqual(calls[1], ['boot', 'selected-midi-output'])
  assert.match(instance.message, drive)
  await instance.runStep()
  assert.strictEqual(instance.phase, 'reconnecting')
  assert(busyOwners.has(instance), 'Version verification did not guard against app reload')
  assert.strictEqual(calls[2][0], 'write')
  definition.watch.currentVersion.call(instance, '1.9.8')
  assert.strictEqual(instance.phase, 'complete')
  assert.strictEqual(instance.prepared, null)
  assert(!busyOwners.has(instance), 'A verified update left the app reload guard stuck')
  assert.match(instance.message, /installed and verified/)

  // Navigating away must not clear the guard during an in-flight disk write.
  let finishWrite
  const unmounted = build({device: null, currentVersion: ''})
  await unmounted.runStep()
  writeGate = new Promise(resolve => { finishWrite = resolve })
  const pendingWrite = unmounted.runStep()
  assert.strictEqual(unmounted.phase, 'writing')
  definition.beforeUnmount.call(unmounted)
  assert(busyOwners.has(unmounted), 'Unmount released the guard while disk I/O was pending')
  finishWrite()
  await pendingWrite
  assert(!busyOwners.has(unmounted), 'Unmounted updater kept a stale guard after its write settled')
  writeGate = null

  // F3: page opened while Biotron is already in update mode — no MIDI device, no version, drive RPI-RP2 present.
  calls.length = 0
  const lost = build({device: null, currentVersion: ''})
  assert.strictEqual(lost.buttonText, 'Already see RPI-RP2? Recover firmware')
  assert.strictEqual(lost.recovery, true)
  assert.strictEqual(lost.ready, true)
  assert.strictEqual(lost.actionDisabled, false)
  assert.strictEqual(lost.actionText, '⬇️ Download & check')
  await lost.runStep()
  assert.strictEqual(lost.phase, 'select-drive')
  assert.match(lost.message, drive)
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare'])
  assert.strictEqual(lost.actionText, '💾 Choose RPI-RP2 → install')
  await lost.runStep()
  assert.strictEqual(lost.phase, 'reconnecting')
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare', 'write', 'timer'])
  definition.watch.currentVersion.call(lost, '1.9.8')
  assert.strictEqual(lost.phase, 'complete')

  // Device visible but version unknown: the button asks the parent to check firmware, the modal path is not taken.
  const silent = build({device: 'selected-midi-output', currentVersion: ''})
  assert.strictEqual(silent.buttonText, 'Check firmware')
  assert.strictEqual(silent.recovery, true)

  // F2: cancelled picker and a wrong folder both return to the drive step with the sidebar hint; nothing is lost.
  calls.length = 0
  writeFailure = Object.assign(new Error('cancelled'), {name: 'AbortError'})
  const retry = build({device: null, currentVersion: ''})
  await retry.runStep()
  await retry.runStep()
  assert.strictEqual(retry.phase, 'select-drive')
  assert.strictEqual(retry.error, '')
  assert.match(retry.message, /^❌ No drive chosen\. 💾 Choose drive RPI-RP2/)
  writeFailure = new Error('Select the RPI-RP2 drive. No file was written.')
  await retry.runStep()
  assert.strictEqual(retry.phase, 'select-drive')
  assert.strictEqual(retry.error, 'Select the RPI-RP2 drive. No file was written.')
  assert.strictEqual(retry.actionDisabled, false)
  writeFailure = null
  await retry.runStep()
  assert.strictEqual(retry.phase, 'reconnecting')
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare', 'write', 'write', 'write', 'timer'])

  // Older installed firmware never receives software BOOT; the file is still verified first.
  calls.length = 0
  const legacyBoot = build({device: 'legacy-output', currentVersion: '1.7.3'})
  await legacyBoot.runStep()
  assert.strictEqual(legacyBoot.actionText, 'Continue with manual BOOT')
  await legacyBoot.runStep()
  assert.strictEqual(legacyBoot.phase, 'select-drive')
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare'])
  assert.match(legacyBoot.message, /hardware BOOT/)
  const newer = build({device: 'newer-output', currentVersion: '1.10.8'})
  assert.strictEqual(newer.available, false)
  assert.strictEqual(newer.ready, false)

  // Device lost between verify and restart: restart needs MIDI, the action waits instead of guessing.
  const dropped = build({device: 'selected-midi-output', currentVersion: '1.9.7'})
  await dropped.runStep()
  assert.strictEqual(dropped.phase, 'prepared')
  dropped.device = null
  assert.strictEqual(dropped.actionDisabled, true)
}
