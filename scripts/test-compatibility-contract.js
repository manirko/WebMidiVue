const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
const main = read('src/main.js')
const app = read('src/App.vue')
const compatibility = read('src/compatibility.mjs')
const notice = read('src/components/CompatibilityNotice.vue')
const webpack = read('vue.config.js')

const midiRoutes = new Map([
  ['/biotron', 'Biotron'], ['/touchme', 'TouchMe'], ['/touchme/test', 'TouchMe'],
  ['/touchme/standalone', 'TouchMe'], ['/playtron', 'Playtron'],
  ['/playtron/test', 'Playtron'], ['/scales', 'Scales'], ['/scales/test', 'Scales'],
  ['/biotron/update', 'Biotron'], ['/scala', 'Playtronica device'], ['/circle', 'Circle']
])

const deviceMetaHelper = main.slice(main.indexOf('const deviceMeta'), main.indexOf('const knownDirectRoutes'))
assert(deviceMetaHelper.includes('requiresMidi: true'), 'shared device metadata must require Web MIDI')
// Reddens if a device-name or browser-brand list returns (3b, 05.09.2026): the gate is Web MIDI capability only.
assert(!/requiresDesktop|requiresChromium/.test(deviceMetaHelper), 'device routes must gate on Web MIDI capability, not on device or browser lists')

for (const [route, product] of midiRoutes) {
  const line = main.split('\n').find(candidate =>
    candidate.includes(`{ path: '${route}'`) || candidate.includes(`{ path: "${route}"`))
  assert(line, `${route} route is missing`)
  assert(line.includes(`meta: deviceMeta('${product}')`), `${route} must use deviceMeta('${product}')`)
}

const firstPlay = main.slice(main.indexOf("path: '/biotron/play'"), main.indexOf("routes.push({path: '/sound'"))
assert(firstPlay.includes("meta: {requiresAudio: true, productName: 'Biotron', firstPlay: true}"),
  'Biotron Play must permit keyboard audio without a MIDI API')

const soundRoute = main.split('\n').find(line => line.includes("routes.push({path: '/sound'"))
assert(soundRoute.includes('requiresAudio: true'), 'Sound must block when Web Audio is unavailable')
assert(!soundRoute.includes('requiresMidi: true'), 'Sound must preserve its audio-only keyboard fallback')

assert(app.includes('<CompatibilityGate :route="$route">'), 'every beta route must pass through one compatibility gate')
assert(webpack.includes("'src/components/CompatibilityGate.vue'"), 'beta must use the real compatibility gate')
assert(webpack.includes("'src/components/DisabledCompatibilityGate.vue'"), 'normal production must use the no-op gate')
assert(compatibility.includes('https://apps.apple.com/us/app/midiweb-browser/id6757226617'), 'iOS recovery must use the reviewed MIDIWeb Browser listing')
assert(compatibility.includes('support is experimental'), 'iOS recovery must not claim verified device support')
assert(notice.includes('issue.action.href'), 'the compatibility popup must expose the MIDIWeb recovery action')
assert(app.includes('Browser &amp; phone compatibility'), 'the beta must include a discoverable compatibility guide')

console.log('Compatibility contract verified: every device route fails closed; Sound keeps audio-only fallback; MIDIWeb remains an explicit experimental iOS path.')

;(async () => {
  const {biotronFirstSoundFeedbackUrl} = await import('../src/compatibility.mjs')
  for (const [title, expected] of [
    ['Connect the device', 'Biotron was not found'],
    ['Calibration not confirmed', 'Calibration not confirmed'],
    ['Connection lost', 'Biotron disconnected before first sound'],
    ['Could not start listening', 'Biotron could not start'],
    ['Biotron disconnected', 'Biotron disconnected before first sound'],
    ['unknown future issue', 'Before first sound']
  ]) {
    const url = new URL(biotronFirstSoundFeedbackUrl('not_yet', title, 'test-version'))
    const text = url.searchParams.get('text')
    assert(text.includes(`Reached: ${expected}\n`), `${title}: feedback lost the actual stop point`)
    assert(text.includes('Version date: test-version'))
    assert(text.includes('I did not hear Biotron play from the plant yet.'))
  }
  assert(new URL(biotronFirstSoundFeedbackUrl('helped', 'Connection lost', 'test-version'))
    .searchParams.get('text').includes('Reached: Sound from the plant\n'))
  console.log('First-sound feedback retains current and legacy failure reasons, version and human answer.')
})().catch(error => { console.error(error); process.exitCode = 1 })
