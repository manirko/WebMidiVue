# Audio QA bench

Run `npm run test:audio-qa` for analyzer/WAV mutation tests. This is part of `run-biotron-qa.py`.

Generate the existing browser bench with `python3 scripts/build-browser-qa-harness.py --output /private/tmp/unique-audio-bench`; bundle with `node /private/tmp/unique-audio-bench/build.cjs`; serve that folder locally and open it through the browser tool. Click Record real-time audio, Verify silent-output fault, Verify stuck-note fault. Each is a bounded seven-second score and automatically closes its AudioContext. No MIDI commands, firmware writes, microphone capture or telemetry upload.

Real-time capture observes the production Elementary engine's output gain through an AudioWorklet. It is an isolated engine instance, not instrumentation of the running Play application. Buttons serialize capture runs. The final gain still routes normally to speakers during this test. The tap's own downstream gain is zero to prevent doubling the output. Buffer is bounded to eight seconds; frame discontinuities, truncation or timing drift produce INCONCLUSIVE.

The UI exports a local 32-bit float WAV and JSON, and provides playback controls. Normal must PASS. Mutations must generate FAIL/MISSING_SIGNAL or FAIL/STUCK_TAIL in analysis; the mutation test itself passes only if the expected defect is detected. The fixture uses Round, volume 70, MIDI 69/100; thresholds .001 signal/tail RMS are fixture acceptance limits, not musical-quality standards. Tests verify missing signal, stuck tail, clipping, NaN, truncated recordings, dropped blocks and invalid timing, plus float WAV structure.

Current lanes: offline DSP (existing), real-time engine capture (new), deterministic analyzer mutations (new), WAV listening (human playback available). System loopback, physical speaker acceptance, real-time production UI tap, automated perceptual judgement, full score across real-time presets and physical end-to-end latency are NOT IMPLEMENTED. They cannot be marked PASS from these results. No loopback driver is installed by this task.

Store downloaded evidence under ProjectData, with the generated source-manifest.json. No recordings belong in Git. Primary research and remaining implementation sequence: docs/BIOTRON-AUDIO-QA-DESIGN.md.
