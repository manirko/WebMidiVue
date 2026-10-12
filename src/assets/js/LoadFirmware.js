import {bootDevice} from "@/assets/js/SysExCommand";
const UF2 = {block: 512, start0: 0x0a324655, start1: 0x9e5d5157, end: 0x0ab16f30,
    familyFlag: 0x2000, rp2040: 0xe48bff56, flash: 0x10000000, settings: 0x10080000}
const asHex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
export function compareFirmwareVersions(left = '', right = '') {
    const parse = value => String(value).replace(/^v/, '').split('.').map(part => Number(part) || 0)
    const [a, b] = [parse(left), parse(right)]
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const difference = (a[index] || 0) - (b[index] || 0)
        if (difference) return Math.sign(difference)
    }
    return 0
}
export async function GetLatestFirmware(repo) {
    if (!navigator.onLine) throw new Error('Firmware updates require an internet connection.')
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}})
    if (!response.ok) throw new Error(`Could not load the firmware release (${response.status}).`)
    const release = await response.json()
    const prefix = `https://github.com/${repo}/releases/download/`
    const assets = (release.assets || []).filter(asset => asset.name?.toLowerCase().endsWith('.uf2') &&
        asset.browser_download_url?.startsWith(prefix))
    if (assets.length !== 1) throw new Error('The latest release must contain exactly one verified .uf2 firmware file.')
    const [asset] = assets
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error('The firmware release has no trusted SHA-256 checksum.')
    return {version: String(release.tag_name || release.name || '').replace(/^v/i, ''), name: asset.name,
        url: asset.browser_download_url, sha256: asset.digest.slice(7).toLowerCase(), size: asset.size}
}
function validDescriptor(firmware) {
    if (!/^\d+\.\d+\.\d+$/.test(firmware?.version || '') || !/^[a-z0-9._-]+\.uf2$/i.test(firmware?.name || '') ||
        !firmware?.url || !/^[a-f0-9]{64}$/i.test(firmware?.sha256 || '') ||
        !Number.isSafeInteger(firmware?.size) || firmware.size <= 0) throw new Error('Firmware identity is incomplete.')
}
export function inspectBiotronUf2(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    if (!bytes.length || bytes.length % UF2.block) throw new Error('Firmware is not a complete UF2 file.')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), seen = new Set()
    const total = bytes.length / UF2.block; let payloadBytes = 0
    for (let offset = 0; offset < bytes.length; offset += UF2.block) {
        const word = index => view.getUint32(offset + index * 4, true)
        const [flags, target, size, number, declared, family] = [word(2), word(3), word(4), word(5), word(6), word(7)]
        if (word(0) !== UF2.start0 || word(1) !== UF2.start1 || view.getUint32(offset + 508, true) !== UF2.end)
            throw new Error(`Firmware block ${offset / UF2.block} has invalid UF2 markers.`)
        if (!size || size > 476 || size % 4 || target % 4 || declared !== total || number >= total || seen.has(number))
            throw new Error(`Firmware block ${number} has invalid geometry or sequence.`)
        if (target < UF2.flash || target + size > UF2.settings)
            throw new Error(`Firmware block ${number} is outside the safe Biotron program area.`)
        if (!(flags & UF2.familyFlag) || family !== UF2.rp2040)
            throw new Error('Firmware is not an RP2040 UF2 for this update path.')
        seen.add(number); payloadBytes += size
    }
    if (seen.size !== total) throw new Error('Firmware is missing one or more UF2 blocks.')
    return {blocks: total, familyId: UF2.rp2040, payloadBytes}
}
export const DESKTOP_ONLY = '💻 Firmware updates run from a computer with Chrome or Edge.'
export async function prepareFirmware(firmware, fetchImpl = fetch, cryptoApi = crypto) {
    validDescriptor(firmware)
    if (!cryptoApi?.subtle) throw new Error('This browser cannot verify firmware securely.')
    const response = await fetchImpl(firmware.url, {cache: 'no-store'})
    if (!response.ok) throw new Error(`Could not download firmware (${response.status}).`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== firmware.size) throw new Error('Firmware size does not match.')
    const sha256 = asHex(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', buffer)))
    if (sha256 !== firmware.sha256.toLowerCase()) throw new Error('Firmware checksum does not match. Biotron was not restarted.')
    return {buffer, sha256, uf2: inspectBiotronUf2(buffer)}
}
export async function writeFirmware(prepared, firmware, pickDirectory = window.showDirectoryPicker?.bind(window)) {
    validDescriptor(firmware)
    if (!prepared?.buffer || prepared.sha256 !== firmware.sha256.toLowerCase()) throw new Error('Verify firmware again before writing.')
    if (!pickDirectory) throw new Error(DESKTOP_ONLY)
    const directory = await pickDirectory({mode: 'readwrite'})
    // On Windows D: arrives as '\\'; identify the boot drive by INFO_UF2.TXT, not its directory name.
    const info = await directory?.getFileHandle('INFO_UF2.TXT')
        .then(handle => handle.getFile()).then(file => file.text()).catch(() => '')
    const boardIds = info.split(/[\r\n]+/).filter(line => /^[ \t]*Board-ID:/i.test(line))
    if (boardIds.length !== 1 || !/^[ \t]*Board-ID:[ \t]*RPI-RP2[ \t]*$/i.test(boardIds[0]))
        throw new Error(`You opened ${JSON.stringify(directory?.name ?? '')}. Nothing was written. Open the disk named RPI-RP2 instead.`)
    const file = await directory.getFileHandle(firmware.name, {create: true})
    const writable = await file.createWritable({keepExistingData: false})
    try { await writable.write(new Uint8Array(prepared.buffer)); await writable.close() }
    catch (error) { try { await writable.abort() } catch (_) { /* Volume may already be gone. */ } throw error }
    return {directory: directory.name, filename: firmware.name, bytes: prepared.buffer.byteLength}
}
// Legacy devices still use the documented download-and-copy path.
export async function LoadFirmware(repo, device) {
    const firmware = await GetLatestFirmware(repo)
    await bootDevice(device)
    window.location.assign(firmware.url)
}
