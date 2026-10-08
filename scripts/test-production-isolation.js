const assert = require('assert')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.resolve(__dirname, '..', 'dist')
for (const file of ['service-worker.js', 'manifest.json']) {
  assert(!fs.existsSync(path.join(root, file)), `${file} leaked into the normal production build`)
}
assert(!fs.existsSync(path.join(root, 'firmware')), 'beta firmware leaked into the normal production build')
assert(!fs.existsSync(path.join(root, '_headers')), 'beta deployment headers leaked into the normal production build')
assert(!fs.existsSync(path.join(root, '_worker.js')), 'beta telemetry worker leaked into the normal production build')
assert(!fs.existsSync(path.join(root, 'telemetry.html')), 'beta diagnostic notice leaked into the normal production build')

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
assert(!/rel=["']manifest["']/i.test(html), 'PWA manifest link leaked into the normal production build')
const entryAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
  .map(match => path.join(root, match[1].replace(/^\//, '')))
const entryGzipBytes = entryAssets.reduce((sum, file) => sum + zlib.gzipSync(fs.readFileSync(file)).length, 0)
assert(entryGzipBytes <= 95 * 1024, `normal entry exceeds its 95 KiB gzip budget: ${entryGzipBytes} bytes`)

const javascript = fs.readdirSync(path.join(root, 'js'))
  .filter(file => file.endsWith('.js'))
  .map(file => fs.readFileSync(path.join(root, 'js', file), 'utf8'))
  .join('\n')
assert(!javascript.includes('service-worker.js'), 'service-worker registration leaked into the normal production bundle')
assert(!javascript.includes('Release device for DAW'), 'beta MIDI lifecycle leaked into the normal production bundle')
assert(!javascript.includes('Play your device'), 'beta sound lab leaked into the normal production bundle')
assert(!javascript.includes('Meet Biotron'), 'beta first-play experience leaked into the normal production bundle')
assert(!javascript.includes('Three experiments, ten options each.'), 'audition page leaked into the normal production bundle')
assert(!javascript.includes('tone-reference'), 'audition bank data leaked into the normal production bundle')
assert(!javascript.includes('Round Bright'), 'beta synth presets leaked into the normal production bundle')
assert(!javascript.includes('Compatibility check'), 'beta compatibility UI leaked into the normal production bundle')
assert(!javascript.includes('needs a computer'), 'beta device advice leaked into the normal production bundle')
assert(!javascript.includes('Step back and keep still'), 'beta calibration UX leaked into the normal production bundle')

const fontDirectory = path.join(root, 'fonts')
const fontFiles = fs.existsSync(fontDirectory) ? fs.readdirSync(fontDirectory) : []
assert(!fontFiles.some(file => file.startsWith('fa-')), 'complete Font Awesome fonts leaked into the production build')

console.log(`Production isolation verified: no beta/PWA leak, no icon fonts, entry ${entryGzipBytes} gzip bytes.`)
