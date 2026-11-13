# Codex report · Biotron web v1
2026-11-13 · branch `claude/biotron-web-20261113` · implementation source `28617be` · README unchanged.

| Feature | Automated evidence |
|---|---|
| Header / device pop-up / Help / feedback positions | `shell.test.mjs`: shell destinations + fault controls; `test-browser.mjs`: desktop/mobile DOM fault controls (NOT RUN: EPERM) |
| Plant music, existing sounds, pointer/keyboard, gesture audio | `sound.test.mjs`: 33686 held voices/keyboard focus, 33688 raw Light voices; `sound-browser.mjs`: original PCM assertions (NOT RUN: EPERM) |
| Exact 26 settings, channels, 47-byte readback, browser presets, explicit Send | `protocol.test.mjs`: all frames/ranges + 33687; `settings.test.mjs`: validation, no-write on connect/load/reply, stale edits, Send cancellation |
| Conditional Update Firmware link, pinned 1.8.2 | `settings.test.mjs`: version comparison, malformed/stale/wrong-port replies, 33681 timeout; browser exact href check (NOT RUN) |
| MIDI permission, selection, recovery, owned-port release | `midi.test.mjs`: gesture request, secondary/foreign ports, hotplug, borrowed ports, late completion and failures |
| TouchMe feedback receiver/form, product Biotron | `shell.test.mjs`: receiver/product/consent controls; browser preview/no-network check (NOT RUN) |

TouchMe origin: `~/Projects/touchme-next` at `db3d2a45b7252789d684f2896cfc64cbfefbd2d0`.
- Unchanged `dist/core.mjs` → `dist/core/core.mjs`: SHA-256 `e6e2d6d48efad35fcfacbb6bed8bae32baef7b6f95671dc9a55c770e93a1df0f`; recorded in `dist/core/SOURCES.json`.
- Unchanged logo: SHA-256 `2760dd87678ee6504a0e05b89bf6a830e0fc3231e2a5c86b887016bb2d260791`.
- Selected style tokens/skin: origin SHA-256 `31f9da581cbb742507044e0c65bb0d99566bdd5f3129becab86197d9fecfc78c`; final CSS including marked Biotron section `8ab0ff6a7a866a418e0d42b0a682b390107e34b1c8738452a4cbaa96e3153524`.
- Feedback adapted under `dist/biotron/`: origin SHA-256 `6d744424b07ac17ba72b5eec54a613f5a85ba091f85e1132febddf47c0b1ef75`; adapted SHA-256 `8f551202869703dc0113a1154319030b9b560f010d1bc078d8f5a6ccd1cde327`.
Feedback cannot be shared unchanged: it imports TouchMe setting fields and fixes its payload/subject to Love. Biotron uses its command fields/product; the existing receiver schema stays compatible, with `technical.env.product=biotron` retained by the receiver. MIDI is also Biotron-specific (SysEx permission, named selection and port ownership), outside core.
Old Biotron origin `d35e937`: DSP/core/calibration/sound banks match source except local vendor imports; Elementary MIT banner and Chromatone licence retained. Garden uses its existing static fallback and layout; no 3D renderer.

Dropped: Vue, Bootstrap, unrelated product/scale pages, PWA/service worker, telemetry/D1, in-browser firmware writing, 3D sphere experiments and additional sound controls.
Source discrepancies: BiotronIDB is under `src/components/BiotronPage/`, not `src/assets/js/`; it has 26 commands TOTAL (24 ordinary + 2 channel subcommands), not 26 + 2. The exact source table is preserved.
Queries are sent only by explicit Check saved settings; connect/preset load/incoming readback send no bytes. Live writes/Send require a confirmed snapshot, retaining the old initial-read guard. A loaded preset stays local until explicit Send; an explicit field edit sends that field only.

Exit codes: `npm run check:core` 0; `npm run build` 0; `npm test` 0 (24/24); vendor 0 and reproducible; `git diff --check` 0.
BUILD (tested): `28617be`, generated from the implementation commit before this report-only commit; `dist/version.mjs` is committed.
`npm run test:browser`: exit 1, EPERM binding 127.0.0.1, before Chrome launch. Browser lane stopped as required and left for Claude; no escalation or alternate port. Both viewports, console checks and PCM remain unverified.
First failures retained in `docs/QA-FIRST-FAILURES-V1.md`; full logs in `~/ProjectData/Playtronica/biotron-web/codex-v1-20261113/`. No assertion thresholds were weakened.

Files = `git diff --name-only f86eae5..HEAD` (including this report): `THIRD-PARTY.md`, `dist/app.mjs`, `dist/assets/playtronica-logo.png`, `dist/biotron/factory-presets.mjs`, `dist/biotron/feedback.mjs`, `dist/biotron/firmware.mjs`, `dist/biotron/midi.mjs`, `dist/biotron/presets.mjs`, `dist/biotron/protocol.mjs`, `dist/biotron/readback.mjs`, `dist/biotron/settings-ui.mjs`, `dist/biotron/settings.mjs`, `dist/biotron/sound/auditionBanks.mjs`, `dist/biotron/sound/biotronCalibration.mjs`, `dist/biotron/sound/core.mjs`, `dist/biotron/sound/elementary/engine.mjs`, `dist/biotron/sound/elementary/fx/LICENSE-chromatone.txt`, `dist/biotron/sound/elementary/fx/srvb.mjs`, `dist/biotron/sound/elementary/timbres.mjs`, `dist/biotron/sound/player.mjs`, `dist/core/SOURCES.json`, `dist/core/core.mjs`, `dist/index.html`, `dist/style.css`, `dist/vendor/LICENSE-elementary.txt`, `dist/vendor/elementary.mjs`, `dist/version.mjs`, `docs/CODEX-REPORT-V1.md`, `docs/QA-FIRST-FAILURES-V1.md`, `package.json`, `scripts/build-id.mjs`, `scripts/sync-core.mjs`, `scripts/test-browser.mjs`, `scripts/vendor.mjs`, `tests/fixtures.mjs`, `tests/midi.test.mjs`, `tests/protocol.test.mjs`, `tests/settings.test.mjs`, `tests/shell.test.mjs`, `tests/sound-browser.mjs`, `tests/sound.test.mjs`.
Later: the already deferred 3D visual and Windows W07; no new controls or variants.
NOT VERIFIED: real Biotron (including 1.8.2 readback compatibility), Windows/Opera GX, hearing, Sergey acceptance, live feedback delivery/CORS; browser layout/audio gates blocked by EPERM.
No publish, deploy, push, team/board write or outgoing message. All six requested implementation groups have local commits with the required Co-Authored-By trailer.
