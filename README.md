# Biotron web · simple

A small website for the Playtronica **Biotron**, a device that turns a plant's electrical signal and light into MIDI. You open the page, plug in Biotron, hear the plant play, and change the device settings in one pop-up. It is built on the same base and design code as TouchMe (`~/Projects/touchme-next`) and Play (`playtron-prototype`): the same buttons in the same places and the same plain-module stack. The old Biotron settings app in this repository (Vue 3, branch `claude/biotron-release-20261111`) is its source, not its base.

- Task: Andrey, 13.11.2026 ~10:20 (board card "Biotron веб: простой проект на общей базе"): "fork Biotron, remove and simplify everything so that it is really a simple project, on one base and one design code with TouchMe and Playtron, within hours".
- Status: v1 in progress (branch `claude/biotron-web-20261113`, an orphan branch of `manirko/WebMidiVue`). Not released. Production `settings.playtronica.com` is unchanged.

## What v1 does (each item has an automated check)
| # | Feature | Source |
|---|---|---|
| 1 | Header in TouchMe's places: Playtronica logo → shop in a new tab; device pictogram → Biotron settings pop-up; gear → Help and MIDI; bottom "?" → feedback. No "beta" label. | Andrey 4a (12.11); Sergey: remove "beta" |
| 2 | Plant music: Biotron's plant and light MIDI play the existing Elementary synth with its existing sounds; the Sound control is only "Choose a sound…". Mouse/keyboard can try sounds without the device. | old `/biotron/play` (SoundLab), Sergey 33689/33691; design accepted in 33691 |
| 3 | Biotron settings pop-up: the existing 26 settings commands, plant/light MIDI channels, readback of current values, save/load preset. A value is sent only when the user changes it. | old `BiotronPageUpdated.vue`, `BiotronIDB.js`, `settingsReadback.mjs` |
| 4 | Update Firmware: shown only after a valid version reply that differs from the official release 1.8.2 (GitHub `Playtronica/biotron-firmware`, published 2025-12-14, checked 2026-11-13). It opens `https://settings.playtronica.com/#/biotron` in a new tab. This site never writes firmware. | Play P14 pattern; firmware stays 1.8.2 |
| 5 | MIDI: Chrome/Edge Web MIDI with SysEx, choose the Biotron input/output, ignore the second Windows port, survive unplug/replug. | old `midi.mjs`, `midiAccess.mjs` |
| 6 | Feedback "?": same receiver and form as TouchMe (`playtron-reports` Worker), product `biotron`. | TouchMe `feedback.mjs`, Sergey 33684 |

Kept from the old app with their tests: 33681 (version timeout never leaves Update active), 33686 (Limit 4 does not silence the generator or keyboard), 33687 (plant/light channel readback), 33688 (Light reaches the synth).

**Not in v1:** TouchMe/Playtron/Scales/Circle/Scala pages, Vue, Bootstrap, PWA/service worker, telemetry/D1, the in-browser UF2 writer, the 3D ball (33685/33690, after release), Windows unplug freeze W07 (Chrome bug, 33681/33692).

## Stack and files (same as TouchMe)
- Plain ES modules in `dist/`, served as they are; no framework, no bundler for app code. Dependencies that need bundling (`@elemaudio/core`, `@elemaudio/web-renderer`) are built once into `dist/vendor/` by `npm run vendor` (esbuild).
- `dist/index.html`, `dist/app.mjs` (wiring), `dist/style.css` (TouchMe design tokens and skin plus a Biotron section).
- `dist/core/`: files shared with TouchMe/Play, copied by `scripts/sync-core.mjs`. `core/SOURCES.json` records origin repo, commit, path and sha256. `npm run check:core` fails on drift.
- `dist/biotron/`: Biotron only. `protocol.mjs` (SysEx frames, command table), `readback.mjs`, `settings-ui.mjs`, `sound/` (Elementary engine, timbres, fx with the chromatone MIT licence).
- `dist/version.mjs`: `BUILD`, written by `scripts/build-id.mjs`.
- `tests/*.test.mjs` (node --test) and `scripts/test-browser.mjs` (Playwright, controlled MIDI).

## Run and test
```bash
npm ci
npm run vendor          # only when Elementary versions change
npm run build           # writes dist/version.mjs
npm test                # node --test tests/
npm run test:browser    # desktop 1440×900 and phone 390×844, controlled MIDI
npm run check:core      # shared files match core/SOURCES.json
npx serve dist          # or any static server; open /
```

## Beta and release
- Beta: Cloudflare Worker `biotron-beta` on the same account as play-beta/love-beta, deployed only by `~/Projects/Claude/_ops/beta-deploy.sh biotron <worktree>`. That script checks the BUILD, deploys, verifies the live BUILD and HTML hash, and rolls back on failure. `workers.dev` only, noindex.
- Production (`settings.playtronica.com`, 20–21.11) only after Sergey's PASS on a real Biotron + Windows + Opera GX and Andrey's explicit "yes". Not part of this branch.

## Data
- No user data is stored except the feedback the user sends (receiver: `playtron-reports` Worker) and presets in the user's browser (localStorage/IndexedDB).
- Heavy or regenerable artefacts live in `~/ProjectData/Playtronica/biotron-web/`, not in git.

## Safety rails
- Never write firmware and never run `make release`. Firmware repositories are out of scope.
- Settings are sent to the device only on an explicit user edit, with `sysex:true` requested only when the user opens the settings pop-up or connects. No automatic writes on connect, preset load or page load.
- Do not merge into `master` or deploy to production without Andrey's "yes". Sergey-accepted design (Plant music, 33691) is preserved. A visual change to it is a question for Sergey, not a decision.
- Lock mode ("no creativity", 09.11): only the items in this README. Ideas go to the board's «Потом» column.

## Git
- One writer per worktree. Commit only your own paths and check `git diff --cached --name-only` first. Push only this branch. Commit messages end with a `Co-Authored-By` line.
