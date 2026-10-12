// One short-lived, best-effort diagnostic session. Only listed states leave the browser.
const EVENT_NAMES = new Set([
  'session.started', 'play.attempted', 'play.stage_changed', 'play.outcome_reported',
  'midi.connection_changed', 'audio.state_changed', 'settings.state_changed',
  'calibration.state_changed'
])
const RESULTS = new Set(['started', 'ready', 'blocked', 'failed', 'stopped', 'heard', 'not_heard', 'unknown'])
const STAGES = new Set(['intro', 'settling', 'calibrating', 'ready', 'revealed',
  'connecting', 'loading', 'loaded', 'changed', 'checking', 'saved', 'error',
  'waiting', 'measuring', 'unsupported', 'timeout', 'idle'])
const AUDIO_STATES = new Set(['running', 'suspended', 'interrupted', 'closed', 'error'])
const ERROR_TYPES = new Set(['capability_missing', 'permission_denied', 'device_missing',
  'connection_failed', 'readback_failed', 'save_unconfirmed', 'calibration_timeout',
  'audio_interrupted', 'audio_closed', 'release_failed', 'unknown'])
const beta = process.env.VUE_APP_BIOTRON_PWA_BETA === 'true'
const buildId = process.env.VUE_APP_BUILD_ID || 'local-build'
const uuid = () => globalThis.crypto?.randomUUID?.() || null
let sessionId = null
let eventsRecorded = 0
let sessionStarted = false
export function diagnosticSessionId() {
  if (!sessionId) sessionId = uuid()
  return sessionId
}
function environment() {
  const ua = globalThis.navigator?.userAgent || ''
  return {
    browser_family: /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other',
    os_family: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other',
    web_midi_available: typeof globalThis.navigator?.requestMIDIAccess === 'function',
    mobile: /Android|iPhone|iPad/.test(ua)
  }
}
function safeAttributes(input) {
  const attributes = {}
  if (RESULTS.has(input.result)) attributes.result = input.result
  if (STAGES.has(input.stage)) attributes.stage = input.stage
  if (AUDIO_STATES.has(input.audio_state)) {
    attributes.audio_state = input.audio_state
    attributes.result = input.audio_state === 'running' ? 'ready' : input.audio_state === 'closed' ? 'stopped' : 'blocked'
    if (input.audio_state === 'interrupted') attributes.error_type = 'audio_interrupted'
    if (input.audio_state === 'closed') attributes.error_type = 'audio_closed'
    attributes.visibility = globalThis.document?.hidden ? 'hidden' : 'visible'
  }
  if (input.midi_state === 'connected') attributes.result = 'ready'
  if (input.midi_state === 'disconnected') attributes.result = 'stopped'
  if (input.midi_state === 'release-error') { attributes.result = 'failed'; attributes.error_type = 'release_failed' }
  if (ERROR_TYPES.has(input.error_type)) attributes.error_type = input.error_type
  if (['visible', 'hidden'].includes(input.visibility)) attributes.visibility = input.visibility
  if (Number.isFinite(input.port_count)) attributes.port_count = Math.max(0, Math.min(8, Math.trunc(input.port_count)))
  if (Number.isFinite(input.last_midi_at)) {
    const age = globalThis.performance.now() - input.last_midi_at
    attributes.last_midi_age = age < 1000 ? 'under_1s' : age < 5000 ? '1_to_5s' : 'over_5s'
  }
  if (/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(input.firmware_version || '')) {
    attributes.firmware_version = input.firmware_version
  }
  return attributes
}
export function recordSettingsState(state, previous, firmwareVersion) {
  recordBiotronEvent('settings.state_changed', {
    stage: state, firmware_version: firmwareVersion,
    result: state === 'error' ? 'failed' : ['saved', 'loaded'].includes(state) ? 'ready' : 'started',
    error_type: state === 'error' ? previous === 'loading' ? 'readback_failed' :
      previous === 'connecting' ? 'connection_failed' : 'save_unconfirmed' : undefined
  })
}
export function recordBiotronEvent(eventName, input = {}) {
  if (!beta || !EVENT_NAMES.has(eventName) || eventsRecorded >= 80 ||
      globalThis.navigator?.onLine === false || !globalThis.fetch) return
  const eventId = uuid()
  const id = diagnosticSessionId()
  if (!eventId || !id || (eventName === 'session.started' && sessionStarted)) return
  if (eventName === 'session.started') sessionStarted = true
  eventsRecorded++
  const payload = {
    schema: 'playtronica.session-event.v1', event_id: eventId, session_id: id,
    service_name: 'biotron', service_version: buildId, event_name: eventName,
    captured_at: new Date().toISOString(), ...environment(), ...safeAttributes(input)
  }
  // Never await telemetry from MIDI, settings or audio code paths.
  globalThis.setTimeout(() => {
    try {
      Promise.resolve(globalThis.fetch('/api/telemetry', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        credentials: 'omit', keepalive: true, body: JSON.stringify(payload)
      })).catch(() => {})
    } catch { /* Diagnostics must never interrupt play. */ }
  }, 0)
}
// Local-only bounded evidence. Port names may identify a setup; preview before sharing. Never uploaded.
const KEY = 'biotron.firmware-journal.v1'
const PHASES = new Set(['idle', 'preparing', 'prepared', 'manual-boot', 'booting', 'select-drive', 'writing', 'reconnecting', 'complete', 'verification-error', 'preflight-error', 'booting-error', 'select-drive-error', 'reconnecting-error'])
const FIRMWARE_ERRORS = new Set(['metadata_failed', 'download_failed', 'descriptor_invalid', 'size_mismatch', 'checksum_mismatch', 'uf2_invalid', 'drive_mismatch', 'write_failed', 'cancelled', 'permission_denied', 'device_changed', 'reconnect_timeout', 'unknown'])
const journalVersion = value => /^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(value || '') ? value : null
const journalText = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) : null
const journalEntry = entry => ({at: journalText(entry.at), phase: entry.phase, installed: journalVersion(entry.installed), target: journalVersion(entry.target), reported: journalVersion(entry.reported), build: journalText(entry.build),
  attempt: /^[a-f0-9-]{36}$/i.test(entry.attempt || '') ? entry.attempt : null, port_name: journalText(entry.port_name),
  channel: ['internal', 'public-stable'].includes(entry.channel) ? entry.channel : null, error: FIRMWARE_ERRORS.has(entry.error) ? entry.error : null})
export function recordFirmwarePhase(phase, installed, target, context = {}) {
  if (!PHASES.has(phase)) return
  try {
    const entries = exportFirmwareJournal()
    entries.push(journalEntry({at: new Date().toISOString(), phase, installed, target, reported: context.reported, attempt: context.attempt, port_name: context.device?.name, channel: context.channel, error: context.error, build: process.env.VUE_APP_BUILD_ID || 'local-build'}))
    globalThis.localStorage.setItem(KEY, JSON.stringify(entries.slice(-200)))
  } catch { /* Logging cannot interrupt a firmware action. */ }
}
export function exportFirmwareJournal() {
  try { const entries = JSON.parse(globalThis.localStorage.getItem(KEY) || '[]'); return Array.isArray(entries) ? entries.slice(-200).filter(entry => entry && PHASES.has(entry.phase)).map(journalEntry) : [] } catch { return [] }
}
