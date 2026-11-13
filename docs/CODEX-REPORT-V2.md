# Codex report · Biotron web v2 · 2026-11-13
Base: `e3ad530`, branch `claude/biotron-web-20261113`; HEAD and clean status verified before changes; README and v1 report read.
K1 `f02dc9a`: 15 numeric settings + Volume use the unchanged TouchMe knob module, with its unchanged clamp dependency and SHA-256 provenance; Biotron adapter removes native ranges, preserves accessible sliders, integer steps/defaults, one commit/send, reset, and 4/2-column settings rows.
K2 `7f14f8a`: no keyboard toggle; all 13 existing physical keys and clickable/tappable caps play; fields/selects block notes; actual active voices drive highlights; blur/hide/stop release notes, including pending audio startup.
Unit evidence: `knobs.test.mjs` covers every numeric value mapping/range/step/default and exact commit/reset bytes; `keyboard.test.mjs` covers every key/cap, focus, cancellation, startup/retry, voice stealing and release. Negative controls accompany new checks.
Preserved: all v1 Node checks, including 33681/33686/33687/33688; locked protocol/readback/presets/firmware/feedback/README and DSP unchanged (only keyboard trigger wiring in sound/player.mjs changed).
Exit codes: `npm run check:core` 0; `npm run build` 0; `npm test` 0 (33/33); `git diff --check` 0.
`npm run test:browser`: 1 — EPERM binding 127.0.0.1 before Chrome launch; browser lane stopped and left for Claude, as required.
BUILD: `4e61ac03798d`; generated `dist/version.mjs` and `docs/build-manifest.json` committed.
Browser checks prepared for 1440×900 and 390×844: no ranges; exact knob drag/arrow/reset sends; 4/2 columns; Volume; cap click/highlight; keyboard focus/blur/hide; all carried-over UI/PCM gates and console errors, with fault controls.
Logs: `~/ProjectData/Playtronica/biotron-web/codex-v2-20261113/`; first failures: `docs/QA-FIRST-FAILURES-V2.md`.
Files = `git diff --name-only e3ad530..HEAD`: `dist/app.mjs`, `dist/biotron/keyboard-ui.mjs`, `dist/biotron/knob-ui.mjs`, `dist/biotron/settings-ui.mjs`, `dist/biotron/sound/player.mjs`, `dist/core/SOURCES.json`, `dist/core/knobs.mjs`, `dist/core/presets.mjs`, `dist/index.html`, `dist/style.css`, `dist/version.mjs`, `docs/CODEX-REPORT-V2.md`, `docs/QA-FIRST-FAILURES-V2.md`, `docs/build-manifest.json`, `scripts/sync-core.mjs`, `scripts/test-browser.mjs`, `tests/dom-fixture.mjs`, `tests/keyboard.test.mjs`, `tests/knobs.test.mjs`, `tests/shell.test.mjs`.
NOT VERIFIED: both browser viewports, layout/console/PCM gates (EPERM); real Biotron, Windows/Opera GX, hearing and Sergey acceptance; live feedback delivery/CORS remains out of scope.
No publish, deploy, push, outgoing message, board write or change to another repository.
