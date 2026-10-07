# Biotron PWA update QA — 2026-10-07

Runtime candidate: `30d978514f675d94950ae4a2af998a68e3a1e56e` (`manirko/WebMidiVue`, `codex/biotron-garden-release`, firmware-beta). This is internal review evidence, not customer release approval.

Durable evidence: `~/ProjectData/playtronica-firmware/biotron/2026-10-07-pwa-qa/`. `manifest.json` pins every file of the frozen builds. `report.json` records DOM assertions; screenshots and request paths corroborate transitions. No browser API was injected into the product page. A separate local control page called `registration.update()` only to trigger discovery and displayed worker/cache state. The production pages used their own Update app action. Device: Andrey’s confirmed Fibonacci; firmware was not rewritten in this run.

## Defects found by the browser, then fixed

1. First installation briefly offered Update app. A waiting worker during first installation is not a replacement of an existing controller. The first-install regression now covers that distinction. Fixed in `168559e`; exact final candidate installed on a fresh origin with zero update buttons.
2. After another tab accepted an update, an old tab could request a removed lazy Settings chunk and silently remain in Play. Recorded request: old C `js/biotron.7e56ee82.js` against B. Fixed in `30d9785`: the old tab keeps its current audio session, marks offline readiness pending, and focuses Update app before switching views. Explicit update stops sound before reloading. No automatic reload during firmware work.

## Real browser results

Frozen versions: A `2dfe207`, B `bf71d28`, C `168559e`, final D `30d9785`. Full commit IDs and SHA-256 values are in the manifest. Origins `localhost:49304` for update cycles and `localhost:49306` for final first installation.

- A→C and B→D: explicit action loaded the new hashed app assets. Discovery alone did not reload either page.
- C→B and D→B→D: web rollback and repeated update loaded the expected exact app assets; final worker had no waiting replacement.
- Another tab’s activation retained the old tab’s app asset hash and a running AudioContext. The old D tab’s Settings action focused Update app and retained Play/audio instead of requesting a removed chunk.
- Explicit update in the audio tab returned to intro with `data-audio-state="closed"` and new app assets.
- App file endpoints returned HTTP 503: cached Play and Settings reopened, and real AudioContext/MIDI started. This is a server failure test. OS network remained online; external panorama availability without internet was not established.
- Current D Play→Settings→Play preserved its sound session; Settings showed Sound stays on. Fullscreen close button and Escape after iframe focus both closed the viewport visual while audio remained running. Stop & release ended the session after each run.
- Fresh final D installation: offline-ready UI, current app asset hash, zero Update app buttons.

## Program checks and tester changes

`test:service-worker-ready` now covers initial/discovered waiting workers, first install, explicit activation, cross-tab control, hung activation, late control after deadline, message failure, and firmware becoming busy during activation. `test-app-update.js` covers failed sound release, multiple firmware owners, double click, navigation focus and router guard cleanup. Firmware state-machine tests retain the reload guard during an in-flight disk write after component unmount.

The software runner now explicitly records PWA browser, full browser flash, physical rollback/reinstall, visual browser QA, and Windows/DAW as NOT RUN instead of omitting those gates. It never converts these rows to PASS from mock/software success. Its own fault/timeout/interruption/strict incomplete regressions pass. The PWA browser script’s obsolete first-play labels and legacy-note readiness were corrected; it requires nonce-matched READY. The headless browser script was not launched in this session; CUA evidence is separate.

Both firmware-beta build/PWA structure and ordinary production isolation passed. The final sound chunk is 25,253 gzip bytes (25 KiB cap); normal entry is 92,149 gzip bytes (95 KiB cap). Sources are the build verifier outputs from this run, dated above. Source-size ratchet was explicitly reviewed for the PWA lifecycle and 8-line shared reload guard: 67 files / 10,299 source lines under caps 67 / 10,300. Blocking-wait, listener, lazy-import and largest-file safety caps were retained. No new dependency was added.

## Still open

Physical speaker recording on this exact UI; OS offline/installed-app process restart; Windows/DAW; mobile, weak GPU and long soak; live D1 delivery and clipboard diagnostics payload; full browser directory-picker firmware write and reconnect readback; accessible immutable Sergey preview; Garden/panorama rights for public use; canonical customer candidate and actual Sergey outcome. Existing native firmware cycle evidence remains separate. Old pre-button clients need all same-origin tabs/app windows closed once. No external delivery or deployment occurred.
