const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
const app = read('src/App.vue')
const taskNav = read('src/components/DeviceTaskNav.vue')
const biotron = read('src/components/BiotronPage/BiotronPageUpdated.vue')
const settingsReadback = read('src/biotron/settingsReadback.mjs')
const selector = read('src/components/MidiComponents/BiotronDeviceSelector.vue')
const sound = read('src/components/SoundLab/SoundLab.vue')
const gate = read('src/components/CompatibilityGate.vue')
const notice = read('src/components/CompatibilityNotice.vue')
const compatibility = read('src/compatibility.mjs')

assert(app.includes('v-if="!firstPlay && !betaBuild"'),
  'the isolated Biotron beta must not expose unrelated device navigation')
assert(app.includes('<router-link to="/biotron"'),
  'the top-level Biotron destination must open its settings workspace')
assert(!app.includes('<router-link to="/sound"'),
  'Sound must not appear beside physical devices in the top-level menu')
assert(app.includes('mailto:manirko@playtronica.com'),
  'the beta must offer a direct feedback channel to Andrey')
assert(app.includes('What would make Biotron better?') &&
  !app.includes('Where did you hesitate or get a result you did not expect?'),
  'the beta feedback action must ask one low-effort question')
assert(app.includes('Your text stays on this page.') && app.includes('Copy feedback'),
  'feedback must support local input and copying without requiring email')
assert(app.includes('v-if="betaBuild && !firstPlay"'),
  'first play must use its task-specific result prompt instead of a second generic prompt')
assert(app.includes('More tools → Apps → Install this site as an app.'),
  'the beta must show the current Edge install path')
assert(taskNav.includes("{id: 'play', label: 'Play'"), 'device tasks must include Play')
assert(taskNav.includes("{id: 'settings', label: 'Settings'"), 'device tasks must include Settings')
assert(taskNav.includes(':aria-current="task.id === activeTask ? \'page\' : null"'),
  'the selected device task must be exposed accessibly')
assert(biotron.includes('active-task="settings"'), 'Biotron settings must show Settings as current')
assert(biotron.includes('biotron-settings-beta') && biotron.includes('Shape your Biotron') &&
  biotron.includes('Connect Biotron, then shape how it listens, plays, and responds.'),
  'the beta settings page must preserve the outcome-first visual hierarchy')
assert(biotron.includes("betaBuild ? 'preset-actions'"),
  'the beta preset actions must use the responsive action grid')
assert(biotron.includes('play-route="/biotron/play"'), 'Biotron settings must link directly to Play')
assert(biotron.includes('Calibrate plant again'), 'Biotron settings must expose explicit recalibration')
assert(biotron.includes('Connect Biotron to unlock its settings.') &&
  biotron.includes('v-if="!betaBuild || settingsReady || (page_is_inited && !device)"'),
  'connected beta controls require confirmed settings; disconnected controls edit a local preset')
assert(biotron.includes('Already see RPI-RP2?') ||
  read('src/components/MidiComponents/UpdateFirmwareComponent.vue').includes('Already see RPI-RP2?'),
  'firmware recovery must remain available before MIDI settings are loaded')
assert(biotron.includes('📡 Input variation') && !biotron.includes('Input variation (experimental)') &&
  biotron.includes("It does not increase the sensor's measured sensitivity or control velocity."),
  'CC15 must describe the exact firmware behavior without a sensitivity claim')
assert(biotron.includes('Reduce extra notes') &&
  settingsReadback.includes('["randomness", 0]') &&
  settingsReadback.includes('["performance", 1]') &&
  settingsReadback.includes('["same_note_plant", 2]'),
  'the low-effort calmer-play action must disable added variation and suppress tiny repeated note changes')
assert(settingsReadback.includes('Note Hold changes note length, not the LEDs.') &&
  biotron.includes('Dismiss saved message') &&
  !biotron.includes('Done — use in DAW') &&
  selector.includes('Release device for DAW'),
  'a verified save must be dismissible without releasing the separate DAW port')
assert(biotron.includes('Copy diagnostics for Andrey') &&
  app.includes('Technical events are sent online.') &&
  app.includes('What is collected') &&
  settingsReadback.includes('buildBiotronDiagnosticPacket'),
  'the beta must disclose automatic technical events and retain manual detailed diagnostics')
assert(selector.includes('RECALIBRATE_COMMAND = 125'), 'Web and firmware recalibration command must stay aligned')
assert(selector.includes('123 is reserved for persisted-settings readback'), 'Settings readback ID must remain reserved')
assert(selector.includes('[0xf0, 0x14, 0x0d, RECALIBRATE_COMMAND, nonce, 0xf7]'),
  'recalibration must use the vendor SysEx command with a request nonce')
assert(selector.includes('data[1] === 0x0b'),
  'recalibration progress must require the device response envelope')
assert(sound.includes('active-task="play"'), 'Biotron first play must show Play as current')
assert(sound.includes("{{ revealExpanded ? 'Hide sounds' : 'Choose a sound' }}"),
  'sound choice action must use the same plain-language noun as the task')
assert(sound.includes('>Settings</router-link>'),
  'first play must offer the same Settings label as the task navigation')
assert(sound.includes('CONTACT PINS') && sound.includes('two separate points on the same plant'), 'connection steps must retain correct contact placement')
assert(sound.includes('Can you hear the notes?') &&
  sound.includes("firstSoundFeedbackUrl('helped')") &&
  sound.includes("firstSoundFeedbackUrl('not_yet')"),
  'first play must ask one binary outcome question after the task')
assert(compatibility.includes('https://wa.me/351937910673') &&
  compatibility.includes('Reached: ${reached}') &&
  sound.includes('Send it to share.'),
  'task feedback must open the direct channel with stage and build context without sending automatically')
assert(sound.includes("if (this.firstSoundOutcome !== 'helped') this.firstSoundOutcome = 'not_yet'") &&
  compatibility.includes("'Biotron disconnected': 'Biotron disconnected before first sound'") &&
  compatibility.includes("'Audio stopped unexpectedly': 'Audio stopped before first sound'"),
  'first-play feedback must stay visible and identify a disconnect before first sound')
assert(gate.includes(':feedback-url="feedbackUrl"') && compatibility.includes('taskFeedbackUrl') &&
  notice.includes('Tell Andrey where it stopped'),
  'first-play compatibility failures must keep the same task-specific result path')

console.log('Navigation contract verified: the beta is Biotron-only; Play and Settings remain device-level tasks.')
