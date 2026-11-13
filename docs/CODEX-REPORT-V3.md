# Codex report · Biotron web v3 · 2026-11-13
Base: HEAD `72992ba` and clean worktree verified before changes.
Item 1: `dist/_headers` is a byte-identical copy of rollback `e02b11e/dist/_headers`.
Item 2: old-path kill switch skips waiting; activation deletes every cache, unregisters, claims and navigates each controlled window to its own URL once; no fetch handler or page registration.
Item 3: unit checks cover headers, worker lifecycle/order, both window URLs and no page registration; browser check uses the real old app/worker on one switched origin, two windows and an unrelated cache, plus the missing-kill-switch negative control.
Item 4: `npm run build` exit 0; content-hash BUILD `2168e8eda105`; version and manifest included.
Checks: `npm run check:core` exit 0; `npm test` exit 0 (36/36, all v1/v2 checks retained); `git diff --check` exit 0.
`npm run test:browser` exit 1: EPERM binding 127.0.0.1 before Chrome launch; stopped without escalation or another port, for Claude to run.
Files = `git diff --name-only 72992ba..HEAD`: `dist/_headers`, `dist/service-worker.js`, `dist/version.mjs`, `docs/CODEX-REPORT-V3.md`, `docs/build-manifest.json`, `scripts/test-browser.mjs`, `tests/migration-browser.mjs`, `tests/migration.test.mjs`.
NOT VERIFIED: browser migration/negative control, desktop/mobile UI and PCM (EPERM); real Biotron, Windows/Opera GX, hearing, Sergey acceptance and live production behavior.
No publish, push, outgoing message, board write, locked-file change or change to another repository.
