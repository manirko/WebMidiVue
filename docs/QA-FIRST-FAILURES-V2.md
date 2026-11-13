# First failures · v2 · 2026-11-13

- First K1 Node run: 4/7 passed; three test cleanup hooks restored the DOM before cancelling the settings session. Fixed fixture cleanup order. The control assertions had passed; no thresholds changed. Rerun: 7/7, exit 0.
- Local K1 staging/commit initially failed to create the worktree's external Git index lock (sandbox EPERM). The required local commits succeeded using approved Git-only escalation; no push.
- Final browser run: exit 1, EPERM binding the local server to 127.0.0.1, before Chrome launch. Stopped the browser lane as instructed; no escalation, alternate port or browser workaround. Log: `~/ProjectData/Playtronica/biotron-web/codex-v2-20261113/browser-first.log`.
