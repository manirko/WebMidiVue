# Audio QA bench

Run `npm run test:audio-qa` for analyzer/WAV mutation tests. This is part of `run-biotron-qa.py`.

Run `npm run test:audio:realtime` for the existing bench's three-button check
automatically in actual Chrome/Chromium. The main QA runner includes it with
`--browser`; without that flag it remains NOT RUN. Existing Python, webpack and
Playwright dependencies are reused. JSON, three float WAVs, source/bundle hashes,
resource observations and a browser trace go to the printed unique evidence
directory (inside the QA attempt when launched by the runner).

Generate the existing browser bench with `python3 scripts/build-browser-qa-harness.py --output /private/tmp/unique-audio-bench`; bundle with `node /private/tmp/unique-audio-bench/build.cjs`; serve that folder locally and open it through the browser tool. Click Record real-time audio, Verify silent-output fault, Verify stuck-note fault. Each is a bounded seven-second score and automatically closes its AudioContext. No MIDI commands, firmware writes, microphone capture or telemetry upload.

Real-time capture observes the production Elementary engine's output gain through an AudioWorklet. It is an isolated engine instance, not instrumentation of the running Play application. Buttons serialize capture runs. The final gain still routes normally to speakers during this test. The tap's own downstream gain is zero to prevent doubling the output. Buffer is bounded to eight seconds; frame discontinuities, truncation or timing drift produce INCONCLUSIVE.

The UI exports a local 32-bit float WAV and JSON, and provides playback controls. Normal must PASS. Mutations must generate FAIL/MISSING_SIGNAL or FAIL/STUCK_TAIL in analysis; the mutation test itself passes only if the expected defect is detected. The fixture uses Round, volume70, MIDI69/100; thresholds .001 signal/release/tail RMS are fixture acceptance limits, not musical-quality standards. Score v2 checks the release window3.4–3.9s BEFORE panic4s, so a later panic cannot hide a lost Note Off. Tests verify missing signal, unreleased notes, stuck tail, clipping, NaN, truncated recordings, dropped blocks and invalid timing, plus float WAV structure.

Capture waits at most10s for the first actual AudioWorklet block before anchoring
PCM and score time. Warmup and event/audio clock offsets remain in the report;
timing drift or lost blocks still produce INCONCLUSIVE. Cleanup uses the actual
engine.stop path before closing the context. Repeated captures must leave zero
renderer intervals/Blob URLs and all observed contexts closed. The CLI rereads
downloaded WAV bytes and validates their analysis. It never requests MIDI.

Current lanes: offline DSP (existing), real-time engine capture (new), deterministic analyzer mutations (new), WAV listening (human playback available). System loopback, physical speaker acceptance, real-time production UI tap, automated perceptual judgement, full score across real-time presets and physical end-to-end latency are NOT IMPLEMENTED. They cannot be marked PASS from these results. No loopback driver is installed by this task.

Store downloaded evidence under ProjectData, with the generated source-manifest.json. No recordings belong in Git. Primary research and remaining implementation sequence: docs/BIOTRON-AUDIO-QA-DESIGN.md.

## Cold creator diagnostics

`node scripts/audio-qa/test-analyze.mjs --creator-cold-native` keeps the cold
Record → Example900ms → Stop sequence. It adds native listeners and one generated
recorder process-entry message, filtered from PCM, without warmup or extra waits
before Stop. The saved mono float WAV must contain finite, unclipped fixture music
with RMS and music probe above .001. This is a diagnostic subset, not the full
creator lifecycle suite or the immutable main-page candidate.

Add `--creator-cold-processor-fault` only with that flag for an intentional
generated recorder throw. A strict exit1 is expected; inspect the retained
firstfault/events, not just the exit code. On11Oct the Chrome154 control entered
process but emitted no processorerror; PWWebKit26.5 emitted it. Absence of that
event cannot rule out a worklet failure. Listener/message instrumentation changes
scheduling; normal retries do not establish the original no-block cause.
No native MIDI, microphone, camera, speaker, editor or phone acceptance is claimed.

## Animation and audio contention

Run animation + audio load ladder loads the current tracked Garden scene, waits for its renderer handshake, drives its ready/note animation and runs the same audio score at synthetic busy-loop budgets of 0, 4 and 10 ms per 16 ms timer interval. These are requested contention budgets, NOT measured CPU utilization or hardware throttle factors. The test records audio failure/continuity, host requestAnimationFrame p95/max and optional JS heap samples. Frame measurements describe the host page, not GPU render timing. Heap snapshots do not prove absence of leaks. Animation readability, low-end hardware acceptance and long soak remain NOT RUN.

Stop load test aborts capture, sends animation waiting/paused, clears all load/scene timers and frame measurement, and releases its audio context. Cancelled run reports INTERRUPTED, not PASS. The audio fault oracles remain the acceptance gate; visual responsiveness metrics are observations until calibrated criteria exist. Garden requires its external Three CDN resources and WebGPU support: a missing renderer handshake fails after a bounded wait rather than silently testing an empty frame.

The full QA runner now executes this existing ladder via `npm run test:audio:load`.
Its immutable run folder includes the source manifest, structured per-level
audio/frame report and browser trace. Missing Garden renderer, failed audio
oracles, uncaught errors, or retained host timers/frames/audio contexts fail
the lane. This is isolated production-engine PCM, not running Play output.


## Immutable hosted paths and maps — night11→12Oct2026

Extend the existing quality/performance lanes; do not create another tester.
Use an existing immutable beta artifact with its exact `release-evidence.json`
and firmware update disabled. The published bdaaf113 runtime285 is the pinned
baseline; a local dirty CSS proof is not a newly published release.

```sh
python3 -I scripts/run-biotron-qa.py --output /private/tmp/unique-hosted-attempt --browser --browsers webkit,firefox --timeout 180 --online-origin https://bdaaf113.biotron-settings-beta.pages.dev --artifact-root /private/tmp/biotron-layout-loading-20261011/dist-2852480 --journeys --only test:quality:browser,test:quality:browser@webkit,test:quality:browser@firefox,test:ui-performance,test:ui-performance@webkit,test:ui-performance@firefox
```

This opt-in lane never rebuilds its artifact. Inputs stay immutable during a run.
The quality lane checks73 public bytes before actions; it validates creator.html's
observed canonical redirect and rejects mismatched/cross-origin final bytes.
Exactly `_headers` and `_worker.js` are hidden config, not HTTP payload.
Fresh profiles block service workers and intercept non-GET/HEAD/OPTIONS: attempted
POSTs are recorded and fulfilled locally503/aborted, never delivered. Native MIDI
and getUserMedia are unavailable/test providers; no user profile is touched.
The runner observes owned PID/start identities; uncertain cleanup stops later lanes.

Six widths exercise actual Play/Settings/creator,16focus steps, Volume37 fresh-tab
readback, one actual lazychunk failure/Retry, short recorded Round WAV/Listen/Save
and confirmed Return. WebKit's full traversal uses Alt+Tab only after an explicit
nativeHTML Tab-vs-Alt+Tab control; no OS preference changes. `journeys.json` and
self-contained `audit.html` separate functional transitions from audit FAILs.
They map executed test paths, not live people, heatmaps, demand or sales.
Flat computed RGB/alpha contrast uses4.5 normal/3 large; gradients/group opacity
remain unmeasured. Existing design targets44px primary controls/24px ranges are
geometry budgets, not a blanket WCAG failure rule. `QUALITY_JOURNEY_FAULT=contrast`
injects1:1 in test DOM only; strict exit1/retained firstfault is expected.

Performance retains the existing20route/3synthetic-load final-gain score. It adds
TTFB/DCL/load/resources and supported LCP candidate/CLS/longtasks. Unsupported APIs
stay null/NOT MEASURABLE. One host run is not field CWV, a calibrated benchmark,
a speed-up, perceptual audio or native hardware acceptance. Existing RMS/spectrum/
timing/Delete/source caps must not be relaxed to obtain green.

For direct `npm run test:biotron`, create the output parent before setting
BIOTRON_QA_OUTPUT; the runner creates its own parent. Sound now derives a unique
firstfault folder from QA_OUTPUT when explicit BIOTRON_TEST_EVIDENCE_DIR is absent;
an explicit folder remains unchanged. Its existing page-error fault proves saved
state before DOM/screenshot/cleanup. Timing failures remain first FAIL/UNKNOWN even
if another attempt passes. Required full gate and selected repeats are separate.

Current findings on online285: tinted-surface links below4.5; WebKit's diagnostic,
Help and creator controls too small. Minimal existing CSS fixes are local/source
only. Exact stylesheet control proved explicit height44 fixes native WebKit select
while preserving its arrow. Main DSP/transport/FW/dependencies and source caps remain
unchanged. Real phone/speaker/Windows/DAW/novice/aesthetic/customer/telemetry delivery/
retention/BOOT/CapCut finished video are separate OPEN gates.
