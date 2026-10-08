export const MIDIWEB_BROWSER_URL = 'https://apps.apple.com/us/app/midiweb-browser/id6757226617'
export const taskFeedbackUrl = (result, reached, versionDate, task = 'first sound') => `https://wa.me/351937910673?text=${encodeURIComponent(`${result}\n\nReached: ${reached}\nVersion date: ${versionDate}\nTask: ${task}`)}`

export const recordBiotronEvent = (name, input) => void import(/* webpackChunkName: 'biotron-telemetry' */ './biotron/telemetry.mjs').then(module => module.recordBiotronEvent(name, input)).catch(() => {})

export function biotronFirstSoundFeedbackUrl(outcome, issueTitle, versionDate) {
  const result = outcome === 'helped' ? 'I heard Biotron play from the plant.' : 'I did not hear Biotron play from the plant yet.'
  const stops = {
    'Connect Biotron first': 'Biotron was not found', 'Connect the device': 'Biotron was not found',
    'Allow access to Biotron': 'MIDI permission',
    'No plant signal yet': 'No plant signal after 15 seconds',
    'Calibration not confirmed': 'Calibration not confirmed',
    'Calibration did not finish': 'Calibration did not finish',
    'Sound is open elsewhere': 'Sound open in another tab',
    'Biotron disconnected': 'Biotron disconnected before first sound', 'Connection lost': 'Biotron disconnected before first sound',
    'Audio stopped unexpectedly': 'Audio stopped before first sound',
    'Biotron could not start': 'Biotron could not start', 'Could not start listening': 'Biotron could not start'
  }
  const stoppedAt = outcome === 'helped' ? 'Sound from the plant' : (stops[issueTitle] || 'Before first sound')
  return taskFeedbackUrl(result, stoppedAt, versionDate)
}

export function detectPlatformCapabilities(runtime = globalThis) {
  const navigator = runtime.navigator || {}
  const userAgent = navigator.userAgent || ''
  const appleMobile = /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && Number(navigator.maxTouchPoints) > 1)

  const capabilities = {
    audio: typeof (runtime.AudioContext || runtime.webkitAudioContext) === 'function',
    midi: typeof navigator.requestMIDIAccess === 'function',
    secureContext: runtime.isSecureContext !== false
  }
  if (appleMobile) capabilities.appleMobile = true
  return Object.freeze(capabilities)
}

export function buildCompatibilityIssue(capabilities, requirements = {}) {
  const productName = requirements.productName || 'This device'

  if ((requirements.requiresMidi || requirements.requiresAudio) && !capabilities.secureContext) {
    return Object.freeze({
      kind: 'security',
      title: 'Open the secure Settings page',
      summary: 'This address cannot use protected browser access to sound and MIDI devices.',
      steps: Object.freeze([
        'Open the official Playtronica Settings link that starts with https://.',
        'Use the latest Chrome or Edge on a computer.',
        'Return to this device page and choose Allow when asked.'
      ]),
      copyLink: false
    })
  }

  // One capability check for every browser: an Android phone with Web MIDI passes, any browser without it stops here.
  if (requirements.requiresMidi && !capabilities.midi) {
    return Object.freeze({
      kind: 'midi',
      title: 'No MIDI in this browser',
      summary: `${productName} connects over Web MIDI, and this browser does not provide it.`,
      steps: Object.freeze([
        'Use current Chrome or Edge on a computer.',
        'Android is experimental: use current Chrome, a USB host/OTG connection, and a data-capable cable.',
        `On iPhone or iPad, standard browsers cannot connect. Try MIDIWeb Browser on iOS or iPadOS 17.6 or later; ${productName} support is experimental.`
      ]),
      action: capabilities.appleMobile ? Object.freeze({
        label: 'Get MIDIWeb Browser',
        href: MIDIWEB_BROWSER_URL,
        note: 'Then open this beta link inside MIDIWeb Browser.'
      }) : null,
      copyLink: true
    })
  }

  if (requirements.requiresAudio && !capabilities.audio) {
    return Object.freeze({
      kind: 'audio',
      title: 'Sound can’t start in this browser',
      summary: 'This browser does not provide the audio engine needed by Playtronica Sound.',
      steps: Object.freeze([
        'Open this page in the latest Chrome or Edge on a computer.',
        'Check that the browser is allowed to play audio.',
        'Press Start sound again.'
      ]),
      copyLink: true
    })
  }

  return null
}

export function buildMidiAdvisory(capabilities) {
  if (capabilities.midi) return null
  return Object.freeze({
    kind: 'midi-advisory',
    title: 'USB device connection isn’t available here',
    summary: 'You can still try every sound with your keyboard or screen. For USB, use current Chrome or Edge on a computer. Android Chrome and MIDIWeb Browser on iPhone or iPad are experimental.',
    steps: Object.freeze([]),
    action: capabilities.appleMobile ? Object.freeze({
      label: 'Get MIDIWeb Browser',
      href: MIDIWEB_BROWSER_URL,
      note: 'Requires iOS or iPadOS 17.6 or later.'
    }) : null,
    copyLink: false
  })
}
