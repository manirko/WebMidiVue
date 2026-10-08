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

## Animation and audio contention

Run animation + audio load ladder loads the current tracked Garden scene, waits for its renderer handshake, drives its ready/note animation and runs the same audio score at synthetic busy-loop budgets of 0, 4 and 10 ms per 16 ms timer interval. These are requested contention budgets, NOT measured CPU utilization or hardware throttle factors. The test records audio failure/continuity, host requestAnimationFrame p95/max and optional JS heap samples. Frame measurements describe the host page, not GPU render timing. Heap snapshots do not prove absence of leaks. Animation readability, low-end hardware acceptance and long soak remain NOT RUN.

Stop load test aborts capture, sends animation waiting/paused, clears all load/scene timers and frame measurement, and releases its audio context. Cancelled run reports INTERRUPTED, not PASS. The audio fault oracles remain the acceptance gate; visual responsiveness metrics are observations until calibrated criteria exist. Garden requires its external Three CDN resources and WebGPU support: a missing renderer handshake fails after a bounded wait rather than silently testing an empty frame.

The full QA runner now executes this existing ladder via `npm run test:audio:load`.
Its immutable run folder includes the source manifest, structured per-level
audio/frame report and browser trace. Missing Garden renderer, failed audio
oracles, uncaught errors, or retained host timers/frames/audio contexts fail
the lane. This is isolated production-engine PCM, not running Play output.
