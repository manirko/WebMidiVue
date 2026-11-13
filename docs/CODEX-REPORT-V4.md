# Codex report · Biotron web v4 · 2026-11-13
Base: branch `claude/biotron-web-20261113`, HEAD `9ef7645`, clean worktree and README verified; source: HANDOFF-CODEX-V4-34303.md.
V1 / 34300: Play-style header Volume slider; 0…100, step 1, default 70 and squared engine gain preserved; settings knobs unchanged.
V2 / 34305 + 34301: full-bleed Garden stage, shared header/icons, two phone rows, full-screen Help/MIDI, Limit 4 in MIDI; feedback tracks header height.
V3 / 34303: Play physical-key drawing W E T Y U / A S D F G H J K, original notes, pointer/keyboard voices and pressed-pad state.
V4 / 34306/34309 + 34301: connect button and MIDI status remain visible in the header, including the 390px phone layout.
Item commits: V1 `2e567b0`; V2 `adec9f4`, `c671870`; V3 `4e83531`; V4 `1060a50`; checks/build `0a21df9`; all end with the required Co-Authored-By trailer.
Checks: `npm run check:core` exit 0; `npm run build` exit 0; `npm test` exit 0 (40/40, including 33681/33686/33687/33688, migration, feedback and negative controls).
BUILD: `18e8fb6f3201`; generated dist/version.mjs and docs/build-manifest.json committed.
Browser: `npm run test:browser` exit 1 — EPERM binding 127.0.0.1 before Chrome; lane stopped for Claude, without escalation, another port or retry.
Prepared browser checks: 1440×900 / 390×844 header visibility/order, full-bleed stage, A/W voices/highlights, keyboard rows, knobs, MIDI Limit 4, connection/replug, fullscreen and feedback; fault controls included.
Additional checks: browser-script syntax, `git diff --check`, allowed-path scope and byte-identical shared CSS prefix — exit 0.
Files = `git diff --name-only 9ef7645..HEAD`: `dist/app.mjs`, `dist/biotron/keyboard-ui.mjs`, `dist/biotron/volume-ui.mjs`, `dist/index.html`, `dist/style.css`, `dist/version.mjs`, `docs/CODEX-REPORT-V4.md`, `docs/build-manifest.json`, `scripts/test-browser.mjs`, `tests/keyboard.test.mjs`, `tests/knobs.test.mjs`, `tests/shell.test.mjs`, `tests/v4-browser.mjs`, `tests/volume.test.mjs`.
NOT VERIFIED: browser UI/negative controls/screenshots, fullscreen, browser migration and PCM (EPERM); physical Biotron, Windows/Opera GX, hearing, Sergey acceptance and live production behavior.
No publish, push, outgoing message, board write, locked-file change or change to another repository.
