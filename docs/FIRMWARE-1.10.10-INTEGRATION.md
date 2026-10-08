# Firmware 1.10.10 web integration — 8 October 2026

Latest available local web baseline: 5c59282 (manirko/WebMidiVue).
`npm run build:biotron-firmware-beta` now offers the exact internal 1.10.10
Release UF2 tested and delivered to Sergey. Source firmware commit:
2ae1973281f6b630abcda7ee3388197673090a41.
SHA256: 598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d.
Size: 114176 bytes. File: /firmware/biotron-1.10.10-internal.uf2.

The existing updater verifies size, SHA256, RP2040 family and UF2 geometry
before BOOT. It writes only to an INFO_UF2.TXT-confirmed RPI-RP2 drive and
requires reconnect version readback. No automatic flash, erase or settings
reset is added. Firmware stays outside the offline precache.

The known-good 1.10.9 image remains at /firmware/biotron-1.10.9-clean.uf2
for the documented manual rollback; the UI does not offer automatic downgrade.
Rollback SHA256: 823d044374268462d39b13c0e65dc2676cda2fb3d5162edba78aedccb0a09f3d.

General customer beta and normal production still exclude firmware artifacts
and this updater. This integration is not a deploy or customer release.
Sergey Windows/mobile tests, independent firmware-owner review, unresolved
stuck-note incidents, browser physical write/rollback/reflash and existing
product release gates remain open. The unrelated full-suite PWA failure is
also not closed by this change.

Validation: test:firmware; build:biotron-firmware-beta; test:firmware:browser;
test-pwa-build.js --firmware; test:production-isolation; test:beta-build.
Browser tests use simulated MIDI and do not flash a physical device.
