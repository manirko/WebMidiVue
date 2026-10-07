# Biotron comprehensive QA contract — 7 October 2026

Use with DESIGN-UX-QA.md and FIRMWARE-LOGGING.md. Comprehensive means every risk
has an explicit test and verdict, not that unavailable hardware tests are green.

## Evidence rules

Record exact web build, firmware source SHA, artifact SHA-256, board revision,
platform, procedure, expected/observed result and evidence path per case.
Verdicts: PASS / FAIL / INCONCLUSIVE / BLOCKED / NOT RUN / NOT SUPPORTED.
Separate host/fixture tests, native hardware tests and actual browser acceptance.
Retain the first failure and rerun evidence. Never replace it silently.
Interrupted captures must explain window boundaries; do not change a runner merely
to turn a failure green. No packet-perfect claims from liveness alone.

## Required coverage and known-bug mapping

| Risk | Required cases | Acceptance |
|---|---|---|
| Wrong/latest firmware | Version, source, hash, board and settings schema | Number alone never authorizes release |
| Flash damage | Corrupt/truncated/wrong-family/wrong-address UF2, bad digest | No BOOT/write before verified preflight |
| Recovery | Update → older supported rollback → candidate reflash → original return | Exact versions and usable device after each; actual web reflash separate |
| Picker errors | Cancel, wrong directory, write failure, page reload, USB loss | No false success; concrete recoverable next action |
| USB disappearance | Both MIDI cables, reboot enumeration, release/reconnect, sleep/resume | No stale ready/loaded claim; bounded retry |
| USB alive/music silent | Repeated Settings/Play batches, calibration, mixed CC load | Notes continue/recover; version response alone insufficient |
| Stuck notes | Channel/note identity, panic, stop/release, saturated TX, capture boundaries | No leftover active notes; orphan events investigated |
| Settings loss/wear | RAM vs persisted readback, presets, reboot, rollback, rapid changes | Initial settings restored; read-only queries cause no saves |
| MIDI parser | Split packets, cable isolation, malformed SysEx, overflow, Clock Start/Continue/Stop | Recovery without corruption; host tests plus hardware probes |
| Calibration | Repeated request, automatic state, nonce, sensor loss, timeout, cancellation | Ready only from device; quiet cue; unchanged settings |
| Legacy firmware | Missing readback, missing software BOOT, settings reset risk | Explicit update/manual recovery guidance, no endless Retry |
| Sensor/controls | Plant, light, buttons, mute, scale, hold, BPM, swing, filter | Confirm physical action → intended output on this board |
| LED | Zone/source/pitch, calibration cue, density, polarity, power/temperature | Human/electrical validation; MIDI cannot prove light quality |
| Browser audio | Context suspend/interruption, stop, clipping, voice limits, soak | MIDI received and sound heard reported separately |
| Web lifecycle | Permission denied/cancel/no device, other tab/DAW, listeners, navigation | No leaked port/listener; correct recovery |
| PWA | Offline restart, update cache identity, stale chunks, install/uninstall | Exact served build; cached UI never substituted for fresh acceptance |
| UX/accessibility | Desktop/mobile/zoom, keyboard/focus, alignment, status and progress | Measure geometry; honest failure and one next action |
| Logging | Phase/export, quota failure, telemetry receiver delivery, command logs | Local evidence preserved; missing remote delivery disclosed |
| Platform matrix | macOS Chrome/Edge, Windows DAW, Android, iOS supported fallback | Only physically tested combinations are marked supported |

## Repeatable execution

1. Export settings and create verified restoration image before risky physical work.
2. Run scripts/run-biotron-qa.py with an explicit durable output directory.
3. Run journal test, lint and the exact firmware-beta build. Freeze build identity.
4. Run tests/run_host_tests.sh from the exact firmware artifact source commit.
5. Execute board-specific physical matrix using existing Mac bench evidence tools.
6. Exercise updater through real browser and native picker; record interruptions.
7. Restore original program/settings; query exact version and compare settings.
8. Reassess process friction; fix a concrete blocker and rerun affected tests.
9. Release verdict lists outstanding gates. Do not ship an internal candidate merely
   because host tests pass or the attached unit has a numerically newer version.

## Current result

Candidate source 7471707, 1.9.8 beta08, user-confirmed Fibonacci/A08.
Physical native path: 1.10.8 → 1.9.8 → official 1.8.2 → 1.9.8 passed exact-version
checks, with verified writes. Candidate readback passed both cables. Mixed Paul/P07
stress passed. Bounded liveness passed with packet-delivery claims explicitly blocked.
Source host suite passed sanitizer and optimized lanes. Logged web software suites,
architecture, lint and firmware-beta build passed.

Actual web path verified download/preflight and BOOT from 1.8.2, but native picker
selection/write was not completed. Resumed device was still 1.8.2. This is not a
web-update PASS. A prior note capture had one unmatched Note Off and no active
notes; its verdict remains unresolved, not silently converted to PASS.

Legacy UX fixed: firmware 1.x below 1.9 no longer retries unsupported settings
readback; it instructs update. The locked-page message also reports the error
instead of perpetually saying Reading. A regression test forbids that legacy query.

1.10.8 source/artifact was subsequently recovered: beta21 on the composition branch. All 262 artifact blocks match the installed program backup. It is superseded by clean 1.10.9 (source 303aafc), which removes the abandoned composition experiment.
1.9.8 remains INTERNAL CANDIDATE, not customer release. Full web flash, controlled note capture, physical sensor/button/LED/audio gates,
long soak, power-cycle and other-platform tests must be reported individually.

Original 1.10.8 return completed: program and settings writes verified, exact
version/readback passed both cables. Settings vector and plant BPM equal the initial
baseline; read-only query flash-save delta is zero. A picotool argument-order failure
was preserved in logs and corrected before reboot. Native cycle is complete; the
actual browser directory-picker/write/reconnect acceptance remains incomplete.

## Release preparation — 7 October 2026

Firmware 1.10.9 SHA-256 823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d, source 303aafc. Source host sanitizer/optimized suites and ARM build passed; no composition-engine symbols remain. Native verified 1.10.9 → 1.9.8 → 1.10.9 completed. Final exact-version/settings readback passed both cables. Earlier candidate settings compare equals baseline with zero read-only flash saves; final post-calibration comparison also equals baseline; read-only flash-save delta is zero. Final 30-second note capture is balanced with no orphan or active notes. Mobile 375 px: scroll width 375, one H1, visible main buttons at least 44 px high.

Fresh web at localhost:49294 targets this exact image. Download/preflight, BOOT, disappearance, reconnect to Firmware 1.10.9 ✓, settings load, device-confirmed calibration completion and release/reconnect for DAW observed. Browser directory selection/write is NOT RUN; native write is separate evidence. Do not infer web-flash success from the final version badge. Closing after BOOT exposes recovery but loses the prominent update-mode instruction; simplify this before broad rollout.

Software runner now creates immutable run directories, records dirty status and per-log SHA-256, kills hung process groups, reports NOT RUN separately and marks incomplete coverage. Its fixture proves nonzero exit, timeout and preservation across repeated runs. Final run c883035: 19 software suites PASS, presets and sound-level browser checks NOT RUN. An earlier sound-level run failed at npm network lookup before browser startup; retained as environment failure evidence. Neither skipped check is converted to PASS. Browser tests must use the active browser tools.

Remaining release gates: actual web write/reconnect, old-firmware update matrix, physical sensor/button/LED/audio judgement, clipping/voice-limit checks, mobile/Windows/Android/iOS device coverage, PWA offline restart/cache migration and long soak/power-cycle. This Mac/Fibonacci run does not establish those platforms. Retain prior orphan Note Off finding; balanced captures of another version cannot close it.
