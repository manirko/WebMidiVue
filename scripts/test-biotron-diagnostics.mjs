import assert from "node:assert/strict"
import {buildBiotronDiagnosticPacket, buildBiotronPlayDiagnosticPacket, formatBiotronDiagnostic} from "../src/biotron/settingsReadback.mjs"

const packet = buildBiotronDiagnosticPacket({
  buildId: "abc123def456",
  route: "/biotron",
  device: {id: "private-port-id", name: "Biotron MIDI"},
  firmwareVersion: "1.9.8",
  settingsState: "saved",
  calibrationState: "ready",
  soundRunning: true,
}, {
  navigator: {
    onLine: true,
    userAgent: "Test Browser 1.0",
    requestMIDIAccess() {},
  },
  location: {origin: "https://beta.example"},
  matchMedia: () => ({matches: true}),
  isSecureContext: true,
  now: () => "2026-09-30T20:00:00.000Z",
})

assert.equal(packet.schema, "playtronica.biotron-diagnostics.v1")
assert.match(packet.diagnostic_session_id, /^[0-9a-f-]{36}$/)
assert.equal(packet.web_tool.build_id, "abc123def456")
assert.equal(packet.environment.web_midi_available, true)
assert.equal(packet.device.midi_port_name, "Biotron MIDI")
assert.equal(packet.device.firmware_semantic_version, "1.9.8")
assert.equal(packet.workflow.settings_state, "saved")
assert.equal(packet.workflow.calibration_state, "ready")
assert.equal(packet.workflow.sound_running, true)
assert(!JSON.stringify(packet).includes("private-port-id"),
  "opaque browser MIDI IDs must not enter a support packet")

const playPacket = buildBiotronPlayDiagnosticPacket({
  buildId: 'new-build-exact', route: '/biotron/play', device: {id: 'secret-id', name: 'Biotron'},
  revealStage: 'revealed', stoppedStage: 'revealed', audioState: 'interrupted',
  midiLastMessageAt: 4000, resumeOutcome: 'timed_out',
  trace: [{kind: 'in', data: [0x90, 60, 99], t: 4700},
    {kind: 'stage', data: 'revealed', t: 4600}, {kind: 'resume', data: 'timed_out', t: 4900}],
}, {
  performance: {now: () => 5000}, document: {visibilityState: 'visible'},
  navigator: {onLine: true, userAgent: 'Test Browser', requestMIDIAccess() {}},
  location: {origin: 'https://beta.example'}, now: () => '2026-10-05T00:00:00.000Z',
})
assert.equal(playPacket.web_tool.build_id, 'new-build-exact')
assert.equal(playPacket.workflow.task_stage, 'revealed')
assert.equal(playPacket.workflow.audio_state, 'interrupted')
assert.equal(playPacket.workflow.last_midi_message_age_ms, 1000)
assert.equal(playPacket.workflow.resume_outcome, 'timed_out')
assert.equal(playPacket.workflow.recent_events.length, 2)
assert(!JSON.stringify(playPacket).includes('secret-id'))
assert(!JSON.stringify(playPacket).includes('[144,60,99]'), 'raw MIDI payload entered support packet')
const report = formatBiotronDiagnostic(playPacket)
assert(report.startsWith('Biotron diagnostics\n'))
assert.deepEqual(JSON.parse(report.split('\n---\n')[1]), playPacket)
assert(!report.includes('no personal data'), 'Manual report contains browser and device identifiers')

console.log("Biotron diagnostics contract: PASS")
