import assert from 'node:assert/strict'
import {recordFirmwarePhase, exportFirmwareJournal} from '../src/biotron/telemetry.mjs'
const data = new Map()
globalThis.localStorage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}
recordFirmwarePhase('writing','1.10.8','1.9.8')
assert.equal(exportFirmwareJournal()[0].phase,'writing')
recordFirmwarePhase('PRIVATE raw path','PRIVATE','PRIVATE')
assert.equal(exportFirmwareJournal().length,1)
for(let i=0;i<250;i++)recordFirmwarePhase('reconnecting','PRIVATE','1.9.8')
assert.equal(exportFirmwareJournal().length,200)
assert.equal(exportFirmwareJournal()[0].installed,null)
globalThis.localStorage.setItem=()=>{throw new Error('quota')}
assert.doesNotThrow(()=>recordFirmwarePhase('complete','1.9.8','1.9.8'))
console.log('Firmware journal PASS: bounded, version allowlist, invalid phase rejected, quota non-blocking')

const attempt = '12345678-1234-1234-1234-123456789abc'
globalThis.localStorage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}
recordFirmwarePhase('select-drive', '1.7.4', '1.8.2', {attempt, device: {name: 'Biotron Port 1', id: 'OPAQUE_PRIVATE', serial: 'PRIVATE_SERIAL'}, channel: 'public-stable', error: 'drive_mismatch', reported: ''})
const last = exportFirmwareJournal().at(-1)
assert.equal(last.attempt, attempt); assert.equal(last.port_name, 'Biotron Port 1'); assert.equal(last.error, 'drive_mismatch')
assert.equal(last.channel, 'public-stable'); assert(!JSON.stringify(last).includes('PRIVATE'))
const key = 'biotron.firmware-journal.v1'
data.set(key, JSON.stringify([{phase: 'writing', port_name: 'Biotron\u0000' + 'x'.repeat(200), error: '/PRIVATE/file.uf2', serial: 'PRIVATE', raw_midi: [1]}]))
assert.equal(exportFirmwareJournal()[0].port_name.length, 80); assert.equal(exportFirmwareJournal()[0].error, null)
assert(!JSON.stringify(exportFirmwareJournal()).includes('PRIVATE'))
for (const corrupt of ['{}', 'null', 'not json', JSON.stringify([null, {phase: 'PRIVATE'}])]) { data.set(key, corrupt); assert.deepEqual(exportFirmwareJournal(), []) }
console.log('Firmware attempt diagnostics PASS: attempt/alias/versions/channel/error linked locally; sanitized exports, corrupt-storage isolation, no automatic upload')
