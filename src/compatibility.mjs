export const WEB_MIDI_BROWSER_URL = 'https://apps.apple.com/us/app/web-midi-browser/id953846217'
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

  if (requirements.requiresAudio && !capabilities.audio) {
    return Object.freeze({
      kind: 'audio', title: 'Sound can’t start in this browser',
      summary: 'Copy this page link and try Chrome or Edge on a computer.',
      steps: Object.freeze(['Open the link in that browser, then start sound.']), copyLink: true
    })
  }
  if (requirements.requiresMidi && !capabilities.midi) {
    return Object.freeze({
      kind: 'midi', title: 'Device connection isn’t available here',
      summary: `To receive notes from ${productName}, open this page in a browser with device access.`,
      steps: Object.freeze(capabilities.appleMobile ? [
        'Using Web MIDI Browser with your instrument? Copy this page link and paste it into that app.',
        'Connect USB with your cable or adapter, then choose Start listening on Play.'
      ] : [
        'Copy this page link. Open Chrome or Edge on your computer and paste the link.',
        'Connect USB with a data cable, then start the device connection.'
      ]),
      action: Object.freeze(capabilities.appleMobile ? {
        label: 'Web MIDI Browser app details', href: WEB_MIDI_BROWSER_URL,
        note: 'USB, adapter and device support need a separate check on your phone. Presets and permissions do not transfer between browsers.'
      } : {label: 'Connection steps', href: '/midi-access.html#missing-midi'}),
      copyLink: true
    })
  }

  return null
}

export function buildMidiAdvisory(capabilities) {
  if (capabilities.midi) return null
  const issue = buildCompatibilityIssue(capabilities, {requiresMidi: true})
  if (issue.kind !== 'midi' || !capabilities.audio) return issue
  return Object.freeze({...issue, title: capabilities.audio ? 'This browser can play examples.' : issue.title,
    summary: 'To hear notes from your instrument, use a browser with device access.'})
}
