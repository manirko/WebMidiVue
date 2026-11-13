# First failures retained · 2026-11-13

No acceptance threshold or carried-over sound assertion was lowered.

1. Initial local `git add`/`git commit` exited 128: `Unable to create .../.git/worktrees/biotron-web-20261113/index.lock: Operation not permitted`. The worktree's Git metadata is outside the writable worktree. The same local commit succeeded with the execution tool's approved Git permission. No push was attempted.
2. First `npm test` exited 1 on Node v24.11.1: `Cannot find module '/Users/andreymanirko/Projects/_worktrees/biotron-web-20261113/tests'` (`MODULE_NOT_FOUND`). The supplied `node --test tests/` invocation was corrected to `node --test tests/*.test.mjs`; README was left unchanged.
3. First browser run exited 1 before Chrome launched: `EPERM: local server bind denied; browser lane stopped and left for Claude.` Per the handoff there was no escalation, retry on another port, alternate server or browser-lane workaround. UI/layout and offline PCM assertions are implemented but unexecuted.
4. After extending MIDI ownership checks, a Node recovery assertion failed: output was still `null` while its asynchronous reopen was completing. The test's fixed count of 20 microtasks was replaced by a `setImmediate` event-loop barrier; the exact input/output identity assertions remain. The late-open test was strengthened to require a closed port after a hidden-page cancellation.

Full local logs: `.artifacts/node-first.log`, `node-third.log`, `browser-first.log`; copies live in `~/ProjectData/Playtronica/biotron-web/codex-v1-20261113/`.
