// Cloudflare Pages advanced-mode Function. This code is copied to dist/_worker.js.
const EVENTS = new Set(['session.started', 'play.attempted', 'play.stage_changed',
  'play.outcome_reported', 'midi.connection_changed', 'audio.state_changed',
  'settings.state_changed', 'calibration.state_changed'])
const RESULTS = new Set(['started', 'ready', 'blocked', 'failed', 'stopped', 'heard', 'not_heard', 'unknown'])
const STAGES = new Set(['intro', 'settling', 'calibrating', 'ready', 'revealed', 'connecting',
  'loading', 'loaded', 'changed', 'checking', 'saved', 'error', 'waiting', 'measuring',
  'unsupported', 'timeout', 'idle'])
const AUDIO = new Set(['running', 'suspended', 'interrupted', 'closed', 'error'])
const ERRORS = new Set(['capability_missing', 'permission_denied', 'device_missing',
  'connection_failed', 'readback_failed', 'save_unconfirmed', 'calibration_timeout',
  'audio_interrupted', 'audio_closed', 'release_failed', 'unknown'])
const FIELDS = new Set(['schema', 'event_id', 'session_id', 'service_name', 'service_version',
  'event_name', 'captured_at', 'browser_family', 'os_family', 'web_midi_available',
  'mobile', 'result', 'stage', 'audio_state', 'error_type', 'visibility', 'port_count',
  'last_midi_age', 'firmware_version'])
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const optional = (value, choices) => value === undefined || choices.has(value)
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
})

export function validEvent(e) {
  return e && typeof e === 'object' && !Array.isArray(e) &&
    Object.keys(e).every(key => FIELDS.has(key)) &&
    e.schema === 'playtronica.session-event.v1' && uuid(e.event_id) && uuid(e.session_id) &&
    e.service_name === 'biotron' && /^[0-9a-f]{12}$/.test(e.service_version) &&
    EVENTS.has(e.event_name) && typeof e.captured_at === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.captured_at) &&
    optional(e.browser_family, new Set(['Chrome', 'Edge', 'Firefox', 'Safari', 'Other'])) &&
    optional(e.os_family, new Set(['Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Other'])) &&
    typeof e.web_midi_available === 'boolean' && typeof e.mobile === 'boolean' &&
    optional(e.result, RESULTS) && optional(e.stage, STAGES) &&
    optional(e.audio_state, AUDIO) && optional(e.error_type, ERRORS) &&
    optional(e.visibility, new Set(['visible', 'hidden'])) &&
    (e.port_count === undefined || Number.isInteger(e.port_count) && e.port_count >= 0 && e.port_count <= 8) &&
    optional(e.last_midi_age, new Set(['under_1s', '1_to_5s', 'over_5s'])) &&
    (e.firmware_version === undefined || /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(e.firmware_version))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/telemetry') {
      const response = await env.ASSETS.fetch(request)
      if (!['/garden/scene.html', '/garden/scene'].includes(url.pathname)) return response
      // _headers forbids app framing. Only this decorative same-origin child may be framed.
      const headers = new Headers(response.headers)
      headers.set('X-Frame-Options', 'SAMEORIGIN')
      const policy = (headers.get('Content-Security-Policy') || '').replace(/(?:^|;)\s*frame-ancestors[^;]*/gi, '').trim()
      headers.set('Content-Security-Policy', `${policy}${policy ? '; ' : ''}frame-ancestors 'self'`)
      return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
    }
    if (request.method === 'GET') {
      if (!env.SESSION_EVENTS) return json(503, {status: 'storage_unavailable'})
      try { await env.SESSION_EVENTS.prepare('SELECT 1 FROM session_events LIMIT 1').first() }
      catch { return json(503, {status: 'storage_unavailable'}) }
      return json(200, {status: 'ready'})
    }
    if (request.method !== 'POST') return json(405, {error: 'method_not_allowed'})
    if (request.headers.get('Origin') !== url.origin ||
        !request.headers.get('Content-Type')?.startsWith('application/json')) {
      return json(403, {error: 'origin_or_type_rejected'})
    }
    if (!env.SESSION_EVENTS) return json(503, {error: 'storage_unavailable'})
    if (Number(request.headers.get('Content-Length')) > 2048) return json(413, {error: 'too_large'})
    const body = await request.text()
    if (body.length > 2048) return json(413, {error: 'too_large'})
    let event
    try { event = JSON.parse(body) } catch { return json(400, {error: 'invalid_json'}) }
    if (!validEvent(event)) return json(400, {error: 'invalid_event'})
    try {
      await env.SESSION_EVENTS.prepare("DELETE FROM session_events WHERE received_at < datetime('now', '-90 days')").run()
      await env.SESSION_EVENTS.prepare(`INSERT OR IGNORE INTO session_events
        (event_id, session_id, service_name, service_version, event_name, captured_at,
         browser_family, os_family, web_midi_available, mobile, result, stage,
         audio_state, error_type, visibility, port_count, last_midi_age, firmware_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        event.event_id, event.session_id, event.service_name, event.service_version,
        event.event_name, event.captured_at, event.browser_family || null,
        event.os_family || null, Number(event.web_midi_available), Number(event.mobile),
        event.result || null, event.stage || null, event.audio_state || null,
        event.error_type || null, event.visibility || null, event.port_count ?? null,
        event.last_midi_age || null, event.firmware_version || null
      ).run()
      return json(202, {accepted: true})
    } catch { return json(503, {error: 'storage_unavailable'}) }
  }
}
