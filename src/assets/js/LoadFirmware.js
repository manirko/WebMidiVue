const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const MAX_RP2040_UF2_BYTES = 4 * 1024 * 1024

export async function resolveFirmware(repoLink) {
    if (!navigator.onLine) {
        throw new Error('Firmware updates require an internet connection.')
    }
    if (!REPOSITORY_PATTERN.test(repoLink)) {
        throw new Error('Invalid firmware repository.')
    }

    const response = await fetch(`https://api.github.com/repos/${repoLink}/releases/latest`, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
    })
    if (!response.ok) {
        throw new Error(`Could not load the firmware release (${response.status}).`)
    }

    const release = await response.json()
    const releasePrefix = `https://github.com/${repoLink}/releases/download/`
    const firmwareAssets = (release.assets || []).filter(asset =>
        asset.state === 'uploaded' &&
        Number.isInteger(asset.size) && asset.size > 0 &&
        asset.size <= MAX_RP2040_UF2_BYTES &&
        typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.uf2') &&
        typeof asset.browser_download_url === 'string' &&
        asset.browser_download_url.startsWith(releasePrefix) &&
        typeof asset.digest === 'string' && SHA256_PATTERN.test(asset.digest)
    )
    if (firmwareAssets.length !== 1) {
        throw new Error('The release must contain exactly one uploaded .uf2 with a SHA-256 digest.')
    }

    const asset = firmwareAssets[0]
    return Object.freeze({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        sha256: asset.digest.slice('sha256:'.length),
        version: release.tag_name || 'unknown',
    })
}

// Compatibility alias for older callers. Resolving metadata never enters BOOT.
export const LoadFirmware = resolveFirmware
