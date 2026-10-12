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
  name: 'biotron-firmware_v1.8.2.uf2',
  browser_download_url: 'https://github.com/Playtronica/biotron-firmware/releases/download/1.8.2/biotron-firmware_v1.8.2.uf2',
  digest: `sha256:${digest}`,
  size: 1024
}

async function runLegacy({online, response}) {
  const events = []
  const context = {
    exports: {},
    module: {exports: {}},
    navigator: {onLine: online},
    AbortSignal,
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
  assert.match(generalEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED=true$/m)
  assert.doesNotMatch(generalEnvironment, /VUE_APP_BIOTRON_FIRMWARE_TARGET/)
  const betaEnvironment = fs.readFileSync('.env.biotron-firmware-beta', 'utf8')
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED=true$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_TARGET=1\.10\.10$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_SHA256=598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d$/m)
  assert.match(betaEnvironment, /^VUE_APP_BIOTRON_FIRMWARE_SIZE=114176$/m)
  const cleanBytes = fs.readFileSync('beta-assets/firmware/biotron-1.10.10-internal.uf2')
  assert.strictEqual(cleanBytes.length, 114176)
  assert.strictEqual(crypto.createHash('sha256').update(cleanBytes).digest('hex'),
    '598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d')
  assert.strictEqual(contextForHelpers().inspectBiotronUf2(arrayBuffer(cleanBytes)).familyId, 0xe48bff56)
  const rollbackBytes = fs.readFileSync('beta-assets/firmware/biotron-1.10.9-clean.uf2')
  assert.strictEqual(crypto.createHash('sha256').update(rollbackBytes).digest('hex'),
    '823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d')
  const biotronPage = fs.readFileSync('src/components/BiotronPage/BiotronPageUpdated.vue', 'utf8')
  assert.match(biotronPage, /v-if="betaBuild && firmwareTestEnabled"/)
  assert.match(biotronPage, /VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED === 'true'/)
  const updateComponent = fs.readFileSync('src/components/MidiComponents/UpdateFirmwareComponent.vue', 'utf8')
  // FB67: unknown software support is not proof that contacts must be bridged; a send is not a drive acknowledgement.
  assert.doesNotMatch(updateComponent, /Unknown or older firmware needs the hardware BOOT|Biotron is now drive RPI-RP2/)
  assert.match(updateComponent, /https:\/\/help\.playtronica\.com\/troubleshooting\/firmware-reset\/#biotron-recovery/)
  assert.match(updateComponent, /Confirm your board with support before touching contacts/)
  assert.match(updateComponent, /<a v-if="versionAware && !knownVersion && device && !prepared"[^>]+>Cannot read the version\? Biotron recovery help<\/a>/)
  assert.match(updateComponent, /An update can reset them, even when software BOOT is available/)
  assert.match(updateComponent, /<p v-if="versionAware && manualBoot" class="alert alert-warning">/)
  assert.match(updateComponent, /Downloading and checking firmware/)
  assert.match(updateComponent, /💾 Choose RPI-RP2 → install/)
  assert.match(updateComponent, /@click="\$emit\('check_firmware'\)"/)
  // F2 (2026-09-04): the folder picker opens in Documents; the drive must be named before and during the step.
  assert.match(updateComponent, /💾 Choose drive RPI-RP2 → Select\. 🍎 Mac: left sidebar · 🪟 Windows: This PC\./)
  assert.match(updateComponent, /<p v-if="versionAware && ready && canInstall" class="small text-muted">\{\{ pick \}\} 🍎 Tip: ⌘⇧G → \/Volumes\/RPI-RP2<\/p>/)
  // 3b (2026-09-05): no folder picker (Android Chrome) — one honest phrase instead of a step that throws.
  assert.match(updateComponent, /<p v-if="versionAware && ready && !canInstall">\{\{ desktopOnly \}\}<\/p>/)
  assert.match(updateComponent, /v-if="ready && actionText && \(!versionAware \|\| canInstall\)"/)
  // F3 (2026-09-04): page reloaded while Biotron sits in update mode — no MIDI, only the RPI-RP2 drive.
  assert.match(updateComponent, /Already see RPI-RP2\? Recover firmware/)
  // W4 (Sergey, 2026-09-08): he went looking for the downloaded file. The page must say it kept the
  // firmware in memory, and must offer the file itself as an equal manual fallback.
  assert.match(updateComponent, /is checked and held in this page — nothing was saved to your computer/)
  assert.match(updateComponent, /<a :href="firmware\.url" :download="firmware\.name">save \{\{ firmware\.name \}\}<\/a>/)
  assert.match(updateComponent, /copy the saved file onto the disk named RPI-RP2/)
  assert(updateComponent.includes("'Biotron did not report its firmware version.' : 'No Biotron over MIDI.'"))
  assert.doesNotMatch(updateComponent, /public updater is intentionally disabled/i)
  await testComponentStateMachine(updateComponent)

  let result = await runLegacy({online: false})
  assert.match(result.error.message, /internet connection/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({online: true, response: {ok: false, status: 503}})
  assert.match(result.error.message, /503/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({online: true, response: {ok: true, json: async () => ({tag_name: '1.8.2', assets: []})}})
  assert.match(result.error.message, /exactly one verified/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({
    online: true,
    response: {ok: true, json: async () => ({tag_name: '1.8.2', assets: [{...trustedAsset, digest: null}]})}
  })
  assert.match(result.error.message, /no trusted SHA-256/)
  assert.deepStrictEqual(result.events, [])

  result = await runLegacy({
    online: true,
    response: {ok: true, json: async () => ({tag_name: '1.8.2', assets: [trustedAsset]})}
  })
  assert.ifError(result.error)
  assert.deepStrictEqual(result.events, [
    ['boot-start', 'device'],
    ['boot-done', 'device'],
    ['download', trustedAsset.browser_download_url]
  ])

  for (const release of [{tag_name: '1.8.2', prerelease: true}, {tag_name: '1.8.2', draft: true}, {tag_name: '1.8.2-beta'}, {name: '1.8.2'}]) {
    result = await runLegacy({online: true, response: {ok: true, json: async () => ({...release, assets: [trustedAsset]})}})
    assert.match(result.error.message, /stable, numbered release/)
    assert.deepStrictEqual(result.events, [])
  }

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

  // A bootrom ID is an exact field, not a prefix or text quoted elsewhere in the file.
  for (const info of ['Board-ID: RPI-RP2350\n', 'Board-ID: RPI-RP2-other\n',
    'Not-Board-ID: RPI-RP2\n', 'Board-ID: RPI-RP2\nBoard-ID: RP2350\n']) {
    writes.length = 0
    await assert.rejects(() => updater.writeFirmware(fetched, firmware, async () => bootDrive('RPI-RP2', info)),
      /Nothing was written/, `Unconfirmed board marker accepted: ${JSON.stringify(info)}`)
    assert.deepStrictEqual(writes, [], 'Invalid board identity reached the write boundary')
  }
  for (const info of [INFO_UF2.replace(/\n/g, '\r\n'), 'Board-ID: RPI-RP2', '\tboard-id:\tRPI-RP2 \r\n']) {
    writes.length = 0
    const result = await updater.writeFirmware(fetched, firmware, async () => bootDrive('RPI-RP2', info))
    assert.strictEqual(result.bytes, firmware.size)
    assert.strictEqual(writes[1], 'closed')
  }

  const tampered = {...fetched, buffer: fetched.buffer.slice(0)}
  new Uint8Array(tampered.buffer)[40] ^= 1
  let picks = 0
  await assert.rejects(() => updater.writeFirmware(tampered, firmware, async () => { picks++; return bootDrive('RPI-RP2') }), /changed|checksum/)
  assert.strictEqual(picks, 0, 'Altered bytes reached the directory boundary')

  await assert.rejects(() => updater.writeFirmware(fetched, firmware, null), /computer with Chrome or Edge/)

  // UF2 mutations hit independent trust-boundary checks. Valid out-of-order blocks remain valid.
  const corruptions = [
    ['start marker', bytes => bytes.writeUInt32LE(0, 0)], ['end marker', bytes => bytes.writeUInt32LE(0, 508)],
    ['empty payload', bytes => bytes.writeUInt32LE(0, 16)], ['large payload', bytes => bytes.writeUInt32LE(480, 16)],
    ['unaligned payload', bytes => bytes.writeUInt32LE(3, 16)], ['unaligned target', bytes => bytes.writeUInt32LE(0x10000001, 12)],
    ['wrong block count', bytes => bytes.writeUInt32LE(1, 24)], ['bad sequence', bytes => bytes.writeUInt32LE(999999, 20)],
    ['duplicate sequence', bytes => bytes.writeUInt32LE(0, 512 + 20)], ['wrong family', bytes => bytes.writeUInt32LE(0, 28)],
    ['no family flag', bytes => bytes.writeUInt32LE(0, 8)], ['not-main-flash flag', bytes => bytes.writeUInt32LE(0x2001, 8)],
    ['file-container flag', bytes => bytes.writeUInt32LE(0x3000, 8)], ['overlap', bytes => bytes.writeUInt32LE(bytes.readUInt32LE(12), 512 + 12)],
    ['settings sector', bytes => bytes.writeUInt32LE(0x10080000, 12)]
  ]
  for (const [name, mutate] of corruptions) { const bytes = Buffer.from(firmwareBytes); mutate(bytes); assert.throws(() => updater.inspectBiotronUf2(arrayBuffer(bytes)), {name: 'Error'}, name) }
  const permuted = Buffer.concat([firmwareBytes.subarray(512), firmwareBytes.subarray(0, 512)])
  assert.strictEqual(updater.inspectBiotronUf2(arrayBuffer(permuted)).blocks, uf2.blocks)
  for (const bytes of [Buffer.alloc(0), firmwareBytes.subarray(1), firmwareBytes.subarray(0, -512)]) assert.throws(() => updater.inspectBiotronUf2(arrayBuffer(bytes)))
  await assert.rejects(() => updater.prepareFirmware({...firmware, size: firmware.size + 1}, fetchFirmware, crypto.webcrypto), error => error.firmwareCode === 'size_mismatch')
  await assert.rejects(() => updater.prepareFirmware(firmware, async () => { throw new Error('private network details') }, crypto.webcrypto), error => error.firmwareCode === 'download_failed' && !error.message.includes('private'))
  await assert.rejects(() => updater.prepareFirmware(firmware, async () => ({ok: true, arrayBuffer: async () => { throw new Error('partial body') }}), crypto.webcrypto), error => error.firmwareCode === 'download_failed')
  await assert.rejects(() => updater.prepareFirmware(firmware, fetchFirmware, {}), /verify firmware securely/)

  await assert.rejects(() => updater.writeFirmware(fetched, firmware, async () => { throw new DOMException('picker cancelled', 'AbortError') }), error => error.firmwareCode === 'cancelled', 'Native picker AbortError lost its cancellation classification')

  const ioResults = []
  for (const failAt of ['pick', 'create', 'open', 'write', 'close', 'abort']) {
    const events = [], ioError = Object.assign(new Error(`fixture-${failAt}`), {name: failAt === 'pick' ? 'NotAllowedError' : 'AbortError'})
    const volume = {name: '\\', getFileHandle: async (name, options) => {
      if (name === 'INFO_UF2.TXT') return {getFile: async () => ({text: async () => INFO_UF2})}
      events.push('create'); if (failAt === 'create') throw ioError
      assert.strictEqual(options.create, true)
      return {createWritable: async () => {
        events.push('open'); if (failAt === 'open') throw ioError
        return {write: async bytes => {events.push('write'); assert.strictEqual(bytes.length, firmware.size); if (failAt === 'write' || failAt === 'abort') throw ioError},
          close: async () => {events.push('close'); if (failAt === 'close') throw ioError},
          abort: async () => {events.push('abort'); if (failAt === 'abort') throw new Error('abort unavailable')}}
      }}
    }}
    await assert.rejects(() => updater.writeFirmware(fetched, firmware, async () => {if (failAt === 'pick') throw ioError; return volume}), error => error.firmwareCode === (failAt === 'pick' ? 'permission_denied' : 'write_failed'))
    assert(!events.includes('close') || failAt === 'close'); if (['write', 'close', 'abort'].includes(failAt)) assert(events.includes('abort'))
    ioResults.push({failAt, events, result: 'rejected; no copy-success claim'})
  }
  // Copy a private snapshot: mutation while the asynchronous directory picker is open cannot change written bytes.
  const duringPick = {...fetched, buffer: fetched.buffer.slice(0)}; writes.length = 0
  await updater.writeFirmware(duringPick, firmware, async () => {new Uint8Array(duringPick.buffer)[40] ^= 1; return bootDrive('RPI-RP2')})
  assert(writes[0].equals(firmwareBytes))
  for (const asset of [{...trustedAsset, name: 'biotron-firmware_v1.9.0.uf2'}, {...trustedAsset, browser_download_url: trustedAsset.browser_download_url.replace('/1.8.2/', '/1.9.0/')}]) {
    const result = await runLegacy({online: true, response: {ok: true, json: async () => ({tag_name: '1.8.2', assets: [asset]})}})
    assert(result.error); assert.deepStrictEqual(result.events, [])
  }
  console.log(JSON.stringify({uf2FaultsRejected: corruptions.length + 3, ioFailures: ioResults, writeSnapshotAndHash: 'PASS', assetVersionMismatch: 'held'}, null, 2))

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
    crypto: crypto.webcrypto,
    AbortSignal,
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
  let bootFailure = null
  let writeGate = null
  let prepareFailure = null, prepareGate = null
  const journal = []
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
      crypto: crypto.webcrypto,
      showDirectoryPicker: async () => ({name: 'RPI-RP2'})
    },
    setTimeout: fn => {
      calls.push(['timer', fn])
      return calls.length
    },
    clearTimeout: id => calls.push(['clear', id]),
    require: name => {
      if (name === '@/biotron/telemetry.mjs') return {recordFirmwarePhase: (phase, installed, target, context) => journal.push({phase, installed, target, ...context})}
      if (name === '@/appUpdateSafety.mjs') return {setFirmwareUpdateBusy: (owner, busy) => {
        if (busy) busyOwners.add(owner)
        else busyOwners.delete(owner)
      }}
      if (name === '@/assets/js/LoadFirmware') {
        return {
          compareFirmwareVersions: contextForHelpers().compareFirmwareVersions,
          isFirmwareVersion: contextForHelpers().isFirmwareVersion,
          GetLatestFirmware: async () => {},
          LoadFirmware: async () => {},
          prepareFirmware: async firmware => {
            calls.push(['prepare', firmware.version])
            if (prepareFailure) throw prepareFailure
            if (prepareGate) await prepareGate
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
        return {bootDevice: async device => { calls.push(['boot', device]); if (bootFailure) throw bootFailure }}
      }
      throw new Error(`Unexpected import: ${name}`)
    }
  }
  context.exports = context.module.exports
  vm.runInNewContext(compiledComponent, context)
  const definition = context.module.exports.default
  const build = props => {
    const instance = {...definition.data(), $emit: (...event) => calls.push(['emit', ...event]), repo: 'Playtronica/biotron-firmware', versionAware: true, ...props}
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
  assert.match(instance.message, /request sent\. Check that RPI-RP2 appears/)
  assert.doesNotMatch(instance.message, /is now drive/)
  instance.device = null; instance.currentVersion = ''
  await instance.runStep()
  assert.strictEqual(instance.phase, 'reconnecting')
  assert(busyOwners.has(instance), 'Version verification did not guard against app reload')
  assert.strictEqual(calls[2][0], 'write')
  instance.device = 'selected-midi-output'; instance.currentVersion = '1.9.8'
  definition.watch.currentVersion.call(instance, instance.currentVersion)
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
  lost.device = {id: 'recovered-port', name: 'Biotron'}; lost.currentVersion = '1.9.8'
  definition.watch.currentVersion.call(lost, lost.currentVersion)
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
  assert.match(retry.error, /^Select the RPI-RP2 drive\. No file was written\./)
  assert.strictEqual(retry.actionDisabled, false)
  writeFailure = null
  await retry.runStep()
  assert.strictEqual(retry.phase, 'reconnecting')
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare', 'write', 'write', 'write', 'timer'])

  // Older installed firmware never receives software BOOT; the file is still verified first.
  calls.length = 0
  const legacyBoot = build({device: 'legacy-output', currentVersion: '1.7.3'})
  await legacyBoot.runStep()
  assert.strictEqual(legacyBoot.actionText, 'Continue to drive selection')
  await legacyBoot.runStep()
  assert.strictEqual(legacyBoot.phase, 'select-drive')
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare'])
  assert.match(legacyBoot.message, /Confirm your board with support before touching contacts/)
  calls.length = 0
  const unknownVersion = build({device: 'no-version-response', currentVersion: ''})
  await unknownVersion.runStep()
  assert.strictEqual(unknownVersion.actionText, 'Continue to drive selection')
  await unknownVersion.runStep()
  assert.strictEqual(unknownVersion.phase, 'select-drive')
  assert.match(unknownVersion.message, /not validated/)
  assert.doesNotMatch(unknownVersion.message, /needs.*hardware BOOT/)
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare'], 'unknown firmware received software BOOT')
  const newer = build({device: 'newer-output', currentVersion: '1.10.8'})
  assert.strictEqual(newer.available, false)
  assert.strictEqual(newer.ready, false)

  // Public stable releases use the verified state machine too, never legacy BOOT-before-download.
  calls.length = 0
  const stable = build({device: 'stable-output', currentVersion: '1.7.4', latest: {...internalFirmwareForTest(), internal: false}})
  assert.strictEqual(stable.buttonText, 'Update to 1.8.2')
  await stable.runStep()
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare'])
  assert.strictEqual(stable.phase, 'prepared')
  await stable.runStep()
  assert.deepStrictEqual(calls.map(call => call[0]), ['prepare', 'boot'])
  // BOOT removes the normal MIDI ports: the selected, verified target must survive the version clearing.
  stable.device = null
  stable.currentVersion = ''
  assert.strictEqual(stable.ready, true, 'Public route lost its verified target when BOOT disconnected MIDI')
  await stable.runStep()
  assert.strictEqual(stable.phase, 'reconnecting')
  assert.strictEqual(calls.filter(call => call[0] === 'write').length, 1)

  // The BOOT transport can fail as MIDI disappears. Keep the checked file and an explicit drive/recovery step.
  bootFailure = new Error('Port disconnected')
  const bootError = build({device: 'stable-output', currentVersion: '1.7.4', latest: internalFirmwareForTest()})
  await bootError.runStep()
  await bootError.runStep()
  assert.strictEqual(bootError.phase, 'select-drive', 'BOOT error stranded a checked update without an action')
  assert.match(bootError.message, /RPI-RP2/)
  bootFailure = null
  for (const version of ['1.8.2', '1.10.10']) {
    calls.length = 0
    const current = build({device: 'current-output', currentVersion: version, latest: internalFirmwareForTest()})
    assert.strictEqual(current.ready, false)
    await current.runStep()
    assert.deepStrictEqual(calls, [], `Current/newer ${version} was prepared or restarted`)
  }

  // Device lost between verify and restart: restart needs MIDI, the action waits instead of guessing.
  const dropped = build({device: 'selected-midi-output', currentVersion: '1.9.7'})
  await dropped.runStep()
  assert.strictEqual(dropped.phase, 'prepared')
  dropped.device = null
  assert.strictEqual(dropped.actionDisabled, true)

  const matrix = []
  // These are program routes based on the retained source/version gate, not installed customer binaries.
  const versions = ['1.1.0', '1.2.1', '1.2.2', '1.2.5', '1.3.0', '1.4.0', '1.5.0', '1.6.4', '1.7.3', '1.7.4', '1.8.2', '1.9.8', '1.10.9', '1.10.10', '1.10.11']
  for (const target of ['1.8.2', '1.10.10']) for (const installed of versions) {
    calls.length = 0
    const device = {id: `fixture-${installed}`, name: 'Biotron Port 1'}
    const item = build({device, currentVersion: installed, latest: {...internalFirmwareForTest(), version: target, internal: target === '1.10.10'}})
    const newer = contextForHelpers().compareFirmwareVersions(target, installed) > 0
    assert.strictEqual(item.available, newer, `${installed} → ${target}`)
    await item.runStep()
    if (!newer) { assert.deepStrictEqual(calls, []); assert.strictEqual(item.ready, false) }
    else {
      assert.strictEqual(item.phase, 'prepared')
      await item.runStep()
      assert.strictEqual(item.phase, 'select-drive')
      assert.strictEqual(calls.filter(call => call[0] === 'boot').length, installed === '1.7.4' || contextForHelpers().compareFirmwareVersions(installed, '1.7.4') > 0 ? 1 : 0)
      assert.strictEqual(item.actionDisabled, true, 'MIDI-visible unit must not write to some other RP2040 drive')
      await item.runStep(); assert.strictEqual(item.phase, 'select-drive'); assert.strictEqual(item.fault, 'device_changed')
      assert.strictEqual(calls.filter(call => call[0] === 'write').length, 0)
      item.device = null; item.currentVersion = ''; item.online = false
      assert.strictEqual(item.actionDisabled, false, 'Checked offline file got stranded after BOOT')
      await item.runStep(); assert.strictEqual(item.phase, 'reconnecting')
      assert.strictEqual(item.buttonText, 'Continue firmware update')
      const timer = calls.findLast(call => call[0] === 'timer')[1]
      // Same version on another MIDI identity is insufficient.
      item.device = {id: 'another-unit', name: 'Biotron Port 1'}; item.currentVersion = target
      definition.watch.currentVersion.call(item, target); assert.strictEqual(item.phase, 'reconnecting')
      timer(); assert.strictEqual(item.phase, 'verification-error'); assert.strictEqual(item.fault, 'reconnect_timeout')
      await item.runStep(); assert(calls.some(call => call[0] === 'emit' && call[1] === 'check_firmware'))
      item.device = {...device}; definition.watch.device.call(item, item.device)
      assert.strictEqual(item.phase, 'complete'); assert(!busyOwners.has(item)); assert.strictEqual(item.prepared, null)
    }
    matrix.push({installed, target, route: newer ? contextForHelpers().compareFirmwareVersions(installed, '1.7.4') < 0 ? 'identified-board/help; no software BOOT' : 'software request, disconnected drive, reported-version check' : 'no downgrade/reinstall'})
    definition.beforeUnmount.call(item)
  }
  for (const version of ['', '1.7', '1.8.2-beta', 'unknown', 'NaN', '1.2.9007199254740993']) {
    calls.length = 0
    const item = build({device: {id: 'unknown-unit'}, currentVersion: version, latest: internalFirmwareForTest()})
    assert.strictEqual(item.knownVersion, false); assert.strictEqual(item.ready, false)
    assert.strictEqual(item.buttonText, 'Check firmware'); await item.runStep(); assert.deepStrictEqual(calls, [])
    definition.beforeUnmount.call(item)
  }
  // Download errors/cancellation never become the drive-selection step.
  prepareFailure = Object.assign(new Error('network timed out'), {name: 'AbortError', firmwareCode: 'download_failed'})
  const interrupted = build({device: {id: 'fixture'}, currentVersion: '1.9.7'})
  await interrupted.runStep(); assert.strictEqual(interrupted.phase, 'preflight-error'); assert.strictEqual(interrupted.prepared, null)
  assert.strictEqual(interrupted.fault, 'download_failed'); assert.match(interrupted.actionText, /Try again/)
  prepareFailure = null; await interrupted.runStep(); assert.strictEqual(interrupted.phase, 'prepared')
  interrupted.device = {id: 'replacement'}
  calls.length = 0; await interrupted.runStep()
  assert.strictEqual(interrupted.prepared, null); assert.strictEqual(interrupted.phase, 'preflight-error')
  assert.deepStrictEqual(calls, [], 'Replacement device received a BOOT command'); definition.beforeUnmount.call(interrupted)

  // A metadata change cannot replace a checked attempt's target during copy.
  const pinned = build({device: null, currentVersion: ''}); await pinned.runStep()
  pinned.latest = {...pinned.latest, version: '1.10.10'}
  calls.length = 0; await pinned.runStep()
  assert.strictEqual(calls.find(call => call[0] === 'write')[2], '1.9.8'); definition.beforeUnmount.call(pinned)

  // Duplicate actions are rejected at the method boundary, even if the DOM has not disabled yet.
  let finishPrepare
  prepareGate = new Promise(resolve => { finishPrepare = resolve })
  const double = build({device: null, currentVersion: ''}); calls.length = 0
  const firstPrepare = double.runStep(); await double.runStep(); assert.strictEqual(double.runStepPending, true, 'Duplicate action released pending operation guard'); assert.strictEqual(calls.filter(call => call[0] === 'prepare').length, 1)
  finishPrepare(); await firstPrepare; prepareGate = null
  let finishDouble
  writeGate = new Promise(resolve => { finishDouble = resolve }); calls.length = 0
  const firstWrite = double.runStep(); await double.runStep(); assert.strictEqual(calls.filter(call => call[0] === 'write').length, 1)
  // Firmware replies can arrive before close() resolves: do not lose the only version event.
  double.device = {id: 'returned', name: 'Biotron'}; double.currentVersion = '1.9.8'
  definition.watch.currentVersion.call(double, double.currentVersion)
  assert.strictEqual(double.phase, 'writing')
  finishDouble(); await firstWrite; writeGate = null
  assert.strictEqual(double.phase, 'complete'); assert(!busyOwners.has(double)); definition.beforeUnmount.call(double)
  const before = calls.length; await double.runStep(); assert.strictEqual(calls.length, before, 'Unmounted updater performed another action')
  assert(journal.some(entry => entry.error === 'reconnect_timeout' && entry.reported === entry.target && entry.attempt), 'Failure did not retain its attempt/version context')
  console.log(JSON.stringify({firmwareVersionRoutes: matrix, malformedVersionsHeld: 6, controls: ['MIDI loss', 'wrong unit', 'still-MIDI guard', 'offline checked file', 'download timeout/retry', 'pre-BOOT replacement', 'pinned target', 'double prepare/write', 'early reported version', 'unmount']}, null, 2))
}

function internalFirmwareForTest() { return {version: '1.8.2', ...trustedAsset, url: trustedAsset.browser_download_url, sha256: digest} }
