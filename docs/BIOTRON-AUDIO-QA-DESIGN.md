# Biotron: audio and adversarial QA design

Research and implementation proposal, 2026-10-07. This is a design, not a completed test run. Existing evidence: biotron-garden-release-audit-2026-10-07.html. Existing runner: scripts/run-biotron-qa.py. Existing browser harness: scripts/build-browser-qa-harness.py. Extend these rather than introduce another runner.

## The largest blind spot

A running AudioContext and arriving MIDI do not establish audible output. Current OfflineAudioContext checks cover the engine's digitally rendered samples, but not the real-time app graph, selected output, system mute, hardware output or speaker. Likewise a WAV with sound does not prove it came from the test: a reference marker and synchronized event log must identify its source.

Use independent evidence lanes, never one generic audio PASS:

| Lane | Method | What it establishes / remaining limit |
|---|---|---|
| Offline DSP | Existing exact-source harness; deterministic MIDI score; raw samples | DSP invariants; bypasses real-time app routing and hardware |
| Real-time application | Test-only PCM tap after final app gain/effects, recording via AudioWorklet | Production graph emits samples during actual UI/MIDI actions; does not prove OS output |
| System output | Local loopback capture of the actual selected browser output | Browser/OS route works; virtual capture alone does not prove speaker sound |
| Physical output | Audio-interface output-to-input cable, or speaker-to-microphone reference test | Physical path produces correlated sound; speaker microphone has room/noise/processing confounds |
| Perceptual review | Listen to identified, saved clips with expected-event annotations | Musical unpleasantness and timbre regressions; subjective and not a numeric release oracle |

No installed loopback driver is assumed. macOS BlackHole is one documented option, not an instruction to install or reroute system audio now. Physical loopback is preferable for a release workstation with an interface. Do not open ambient microphone recording silently. Capture only an explicitly chosen test source locally; never include audio in online telemetry.

## Implement first: a short reproducible score

One explicit QA UI action runs a bounded score using the same production engine and writes a WAV plus JSON. Include silence baseline, known low-level reference marker, each timbre, low/high velocity, short plant notes, overlapping notes and voice stealing, gain zero/normal/boost, NoteOff, Panic and post-stop silence. Put expected event windows in the score manifest, not in a visual screenshot or a wall-clock guess.

The score must be versioned and tied to source/artifact SHA. Randomness uses a recorded seed. Record sample rate, channels, PCM format, capture source, sink identity, context state transitions, performance clock, audio clock, MIDI port/channel/note/velocity and UI actions. For hardware runs also record board, firmware SHA/version, settings baseline and restored readback. Device identities stay local or are redacted before any sharing.

An AudioWorklet tap observes production output, not a separate oscillator connected straight to the capture node. It uses a bounded buffer and reports dropped blocks; missing blocks make results INCONCLUSIVE. It must not become the sole speaker route or create feedback. Keep all instrumentation out of ordinary product UI and disable it by default. Do not treat a sparse AnalyserNode poll as continuous glitch capture.

## Deterministic audio oracles

- Missing signal: event window contains no energy above calibrated noise floor; distinguish expected silence from muted/unstarted graph.
- Stuck notes: energy persists after NoteOff/Panic plus the selected preset's documented release/reverb tail. Do not flag intentional tails using one universal timeout.
- NaN/Infinity and hard clipping: inspect all channels, report first sample index and longest consecutive near-full-scale plateau. Floating PCM is needed to see pre-output over-range.
- DC offset and channel imbalance: per-channel mean/RMS, silence windows and stereo contract. Mono is legitimate if declared.
- Dynamics and volume: compare RMS/peak ratios for the same stimulus; zero gain is silent, boost remains bounded, velocity ordering follows the timbre contract.
- Pitch: evaluate fundamental/harmonic relationships for pitched test sounds, with confidence. Do not use dominant FFT bin alone on noise-rich timbres.
- Pops/dropouts: event-aligned waveform discontinuities, high-frequency transient residuals and missing expected-energy blocks; first detect candidates, then compare against reference envelope. Percussion attacks are not automatically bugs.
- Spectrum/timbre drift: loudness-aligned spectral bands, envelope, centroid and harmonic structure. Avoid bit-exact cross-browser comparisons and do not use one audio embedding as the sole acceptance test.
- Timing: align a unique reference marker with capture. Compute event-to-onset distribution and retry/late-note outliers. getOutputTimestamp is clock alignment assistance, not independent physical latency proof. Speaker capture includes acoustic propagation; measure it separately.

Thresholds must be calibrated on an accepted reference per environment/timbre and recorded with a rationale. No unmeasured universal latency or THD target is declared here. Retain current validated DSP limits; a new threshold cannot retroactively turn old evidence green.

## Listen without inventing hearing

Generate a local review package: WAV, event list, short defect clips, waveform/spectrogram and exact build identity. Deterministic detectors locate suspicious intervals; perceptual review listens to those plus a fixed coverage set. If a capable audio input/model is actually available, supply the saved clip and expected events and label its finding as subjective supporting evidence. A text-only agent must not claim it heard the Mac speaker, or infer sound quality from MIDI counters. Transcription models are poor general musical defect oracles.

A/B the accepted reference and candidate at matched loudness. Hide version labels during the first review to reduce expectation bias, then reveal them. Keep both clips and the decision reason. Human judgement remains necessary for whether a sound is pleasant; no cheap local text model substitutes for correctness or final release judgement.

## The clever test: deliberately break the path

Before trusting an oracle, prove it rejects its own controlled faults in the isolated QA fixture:

1. disconnect final gain from output: real-time lane must detect silent output even though MIDI and AudioContext are healthy;
2. omit NoteOff: tail oracle must reject a stuck voice;
3. insert a clipping plateau or non-finite sample into analysis fixture: analyzer must reject it;
4. drop or delay a known event/block: timing/continuity result must become FAIL or INCONCLUSIVE;
5. route the marker to another sink: capture-source verification must fail rather than accept ambient sound;
6. spoof UI Ready while device nonce does not match: calibration gate must remain closed;
7. omit an evidence lane: runner must retain NOT RUN and fail the mandatory gate.

These mutations never run against user settings or flash storage. They verify the test system rather than simply repeat implementation logic.

## Cross-layer scenarios to add

| Scenario | Independent oracle |
|---|---|
| Stop during initialization, repeated Start, route Play↔Settings | One engine/listener owner; final output silence and no stale note after resume |
| Suspend/resume, background/foreground, output-device change | Real output before/after; explicit recovery; no duplicate voices |
| Denied/cancelled permission, unavailable MIDI, lost USB | Correct recovery UI plus silence/Panic, not counters alone |
| Fullscreen drag, iframe-focused Escape, close button, route away | Observable scene/camera change and overlay removed; desktop/touch; test screenshot after action |
| Offline cold start, stale PWA upgrade, asset failure | Exact assets/worker SHA; actual offline render; accepted version, not merely a changed date label |
| Preset quota, interrupted transaction, migration | Reload and exact readback, abort keeps previous value |
| Firmware rollback and upgrade | Preflash backup, pinned bytes, both-port version/settings readback, same physical input stimulus |
| Sensor plausibility | Known resistor/test fixture and open/short cases; correlated sensor/MIDI response, not uncontrolled plant variability |
| Stress and long soak | Bounded run, counters, allocation/listener growth, audio block gaps, final Panic and settings restoration |
| Model-based randomized actions | Recorded seed and action log; shrink failure to shortest replay; state invariants after every step |

Unsafe power interruption during flash is not a default automated test. It needs a recoverable sacrificial bench, validated recovery and a separately bounded experiment.

## Runner integration / evidence contract

Add named lane IDs to the existing runner: audio-offline, audio-realtime, audio-system-loopback, audio-physical, audio-perceptual. Result states remain PASS / FAIL / NOT RUN / INCONCLUSIVE / BLOCKED. Required lanes are set by the release claim and environment. Do not automatically require microphone capture for every small CSS edit; a full sound/firmware release requires the declared end-to-end output acceptance.

For every run: test ID, artifact/source/firmware hashes, seed/score version, environment, capture scope, timestamps, metrics and thresholds, WAV hash/path, event-log hash, first-failure clip, limitations and restoration result. Save raw PCM/WAV under ProjectData; Git contains design/manifest and deterministic code, not ambient recordings. No writes to live online telemetry for captured audio.

Priority: (1) exact-score WAV export and analyzer self-tests, (2) production real-time tap and Stop/recovery invariants, (3) independent loopback bench, (4) hardware synchronized stimulus, (5) bounded soak and perceptual A/B. This sequence closes the largest blind spots without rewriting the product or making the testing UI complicated.

## Primary sources checked 2026-10-07

- W3C Web Audio: https://www.w3.org/TR/webaudio/ — AudioWorklet, OfflineAudioContext, rendering and timestamp semantics. The 1.1 document retrieved is a working draft; feature detection is still required.
- Chrome autoplay: https://developer.chrome.com/blog/web-audio-autoplay — user gesture / suspended context; running context alone is not a speaker oracle.
- W3C Media Capture: https://www.w3.org/TR/mediacapture-streams/ — echoCancellation, noiseSuppression and autoGainControl. Request disabled processing for measurement and inspect actual track settings; unsupported constraints or enabled processing limit conclusions.
- BlackHole maintainer: https://github.com/ExistentialAudio/BlackHole — macOS software loopback option, not proof of physical speaker output.

Open regression from the user: fullscreen drag and closing are reported broken. Do not mark them fixed or covered by historical PASS; reproduce on the exact user build and save new evidence.
