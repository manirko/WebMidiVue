import assert from 'node:assert/strict'
import {setTimeout as wait} from 'node:timers/promises'
import {spawnSync} from 'node:child_process'
import worker, {validEvent} from '../beta-assets/telemetry-worker.mjs'
import retention from '../beta-assets/telemetry-retention-worker.mjs'

process.env.VUE_APP_BIOTRON_PWA_BETA = 'true'
process.env.VUE_APP_BUILD_ID = '0123456789ab'
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const previousFetch = globalThis.fetch
const requests = []
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {
  userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36',
  onLine: true, requestMIDIAccess() {}
}})
globalThis.fetch = async (url, options) => { requests.push({url, options}); return new Response(null, {status: 202}) }

try {
  const {recordBiotronEvent, recordSettingsState, diagnosticSessionId} = await import('../src/biotron/telemetry.mjs')
  recordBiotronEvent('play.attempted', {result: 'started', serial_number: 'PRIVATE', raw_midi: [240, 1, 247]})
  recordBiotronEvent('audio.state_changed', {audio_state: 'interrupted', last_midi_at: performance.now() - 1500})
  recordSettingsState('error', 'loading', '1.9.8')
  recordSettingsState('error', 'connecting', '1.9.8')
  recordBiotronEvent('unknown.event', {result: 'failed'})
  await wait(20)
  assert.equal(requests.length, 4)
  const event = JSON.parse(requests[0].options.body)
  assert.equal(event.service_version, '0123456789ab')
  assert.equal(event.browser_family, 'Chrome')
  assert.equal(event.os_family, 'macOS')
  assert.equal(event.session_id, diagnosticSessionId())
  assert.equal(requests[0].url, '/api/telemetry')
  assert.equal(requests[0].options.credentials, 'omit')
  assert(!JSON.stringify(event).includes('PRIVATE'))
  assert(!JSON.stringify(event).includes('raw_midi'))
  assert(!JSON.stringify(event).includes('Mozilla'))
  assert(validEvent(event))
  assert.equal(JSON.parse(requests[1].options.body).last_midi_age, '1_to_5s')
  assert.equal(JSON.parse(requests[1].options.body).error_type, 'audio_interrupted')
  assert.equal(JSON.parse(requests[2].options.body).error_type, 'readback_failed')
  assert.equal(JSON.parse(requests[2].options.body).firmware_version, '1.9.8')
  assert.equal(JSON.parse(requests[3].options.body).error_type, 'connection_failed')

  globalThis.navigator.onLine = false
  recordBiotronEvent('play.stage_changed', {stage: 'ready'})
  await wait(20)
  assert.equal(requests.length, 4, 'offline telemetry must be dropped without blocking play')
  globalThis.navigator.onLine = true

  const writes = []
  const database = {prepare(sql) { return {
    first: async () => null,
    run: async () => { writes.push({sql}) },
    bind(...values) { writes.push({sql, values}); return {run: async () => ({success: true})} }
  }}}
  const env = {SESSION_EVENTS: database, ASSETS: {fetch: async () => new Response('asset')}}
  const origin = 'https://beta.example.test'
  const makePost = (payload, headers = {}) => new Request(origin + '/api/telemetry', {
    method: 'POST', headers: {'Origin': origin, 'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(payload)
  })
  assert.equal((await worker.fetch(makePost(event), env)).status, 202)
  assert.equal(writes.length, 2)
  assert.match(writes[0].sql, /-90 days/)
  assert.equal(writes[1].values[0], event.event_id)
  assert.equal((await worker.fetch(makePost({...event, email: 'PRIVATE'}), env)).status, 400)
  assert.equal((await worker.fetch(makePost(event, {'Origin': 'https://other.test'}), env)).status, 403)
  assert.equal((await worker.fetch(makePost(event), {ASSETS: env.ASSETS})).status, 503)
  assert.deepEqual(await (await worker.fetch(new Request(origin + '/api/telemetry'), env)).json(), {status: 'ready'})
  assert.equal(await (await worker.fetch(new Request(origin + '/'), env)).text(), 'asset')
  const framedEnv = {ASSETS: {fetch: async () => new Response('scene', {headers: {
    'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'"
  }})}}
  for (const pathname of ['/garden/scene.html', '/garden/scene']) {
    const scene = await worker.fetch(new Request(origin + pathname), framedEnv)
    assert.equal(scene.headers.get('X-Frame-Options'), 'SAMEORIGIN', pathname)
    assert.equal(scene.headers.get('Content-Security-Policy'), "default-src 'self'; frame-ancestors 'self'", pathname)
    assert.equal(await scene.text(), 'scene')
  }
  for (const pathname of ['/', '/garden/scene/', '/garden/scene.js', '/other/garden/scene.html']) {
    const app = await worker.fetch(new Request(origin + pathname), framedEnv)
    assert.equal(app.headers.get('X-Frame-Options'), 'DENY', pathname)
    assert.match(app.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/, pathname)
  }
  let retentionQuery
  assert.deepEqual(await retention.scheduled({}, {SESSION_EVENTS: {prepare(sql) {
    retentionQuery = sql
    return {run: async () => ({success: true, meta: {changes: 1}})}
  }}}), {deleted: 1})
  // Run the actual query in SQLite: retain fresh and boundary rows, delete old
  // rows even when there are no incoming browser events.
  const sqlite = spawnSync('python3', ['-c', `
import sqlite3, sys
db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE session_events (event_id TEXT, received_at TEXT)')
db.execute("INSERT INTO session_events VALUES ('old', datetime('now', '-90 days')), ('boundary', datetime('now', '-89 days')), ('fresh', datetime('now'))")
db.execute(sys.argv[1])
assert db.execute('SELECT event_id FROM session_events ORDER BY event_id').fetchall() == [('boundary',), ('fresh',)]
`, retentionQuery], {encoding: 'utf8'})
  assert.equal(sqlite.status, 0, sqlite.stderr)
  await assert.rejects(retention.scheduled({}, {}), /binding missing/)
  await assert.rejects(retention.scheduled({}, {SESSION_EVENTS: {prepare() {
    return {run: async () => ({success: false})}
  }}}), /Retention query failed/)
  console.log('Telemetry contract verified: allowlist, no raw device data, offline isolation, receiver validation, D1 write and independent idle retention with SQLite boundary checks.')
} finally {
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
  else delete globalThis.navigator
  globalThis.fetch = previousFetch
}
