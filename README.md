# WebMidiVue

## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

The ordinary production build keeps the current website behaviour and does not
install a service worker. The dedicated Biotron beta below is an installable
PWA: after one successful online visit, its settings UI and hash routes are
cached for offline use. The general customer beta does not contain or expose a
firmware updater.

When a new PWA build is waiting, **Update app** appears in Settings and Play.
Discovery never reloads a page. The explicit action stops the persistent sound
session before reloading, and stays blocked while a firmware operation is in
progress, including a closed modal or an in-flight write after navigation.
An update accepted in another tab offers a reload here without interrupting it.
Until this tab accepts the new version, switching views focuses that action
instead of requesting an old lazy chunk that the new worker has removed.
The activation deadline is bounded and retryable. Regression checks:
`npm run test:service-worker-ready` and `npm run test:firmware`.
The lifecycle follows the [Workbox update flow](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
with `skipWaiting: false`. A build predating this button needs all tabs and
installed app windows for its origin closed once before reopening; this feature
cannot patch JavaScript that is already cached in an older worker.

Build the isolated Biotron beta (direct Biotron launch, visible source revision,
and a separate PWA identity) with:

```
npm run build:biotron-beta
```

Prepare an exact release candidate only from a clean checkout with:

```bash
npm run candidate:biotron
```

The tester loop also checks custom build destinations with
`npm run test:build-destination`: beta notices/security files and the exact
internal UF2 must appear in the chosen output, without modifying another
build's `dist`. Copy targets stay relative to Webpack's output directory.
Run the complete fault-preserving loop with
`python3 scripts/run-biotron-qa.py --browser --timeout 240 --output /absolute/run/path`.
Its NOT RUN entries remain separate from software passes.

That single command derives the visible build ID from `HEAD`, runs the complete
Biotron release gate, then atomically creates
`~/ProjectData/Playtronica/biotron-beta/release-candidates/<build-id>/`. The
directory contains the immutable `dist` archive and checksum, release and test
evidence, and the short hardware checklist. The command refuses to overwrite an
existing build ID and runs the offline preview guard before reporting
`candidate_ready`. It does not deploy or publish anything. For an isolated test
root, append `-- --output-root /absolute/path`.

Before a private Cloudflare preview, re-verify that prepared archive instead of
deploying the checkout or its mutable `dist` directory:

```bash
/opt/homebrew/bin/python3 scripts/biotron_preview_guard.py \
  --candidate-dir /absolute/path/to/release-candidate \
  --build-id <12-character-build-id> \
  --archive-sha256 <64-character-sha256>
```

The default is offline verification only. It checks the outer archive hash,
safe archive paths, every release-manifest byte and SHA-256, the exact clean
commit/build, the full test evidence, disabled firmware updates, security
headers and absence of a production CNAME. It then prints one build-specific
confirmation token. Only a second run with `--execute`, an already-installed
Wrangler executable and that exact token can upload the extracted immutable
archive. Before uploading, the guard makes a read-only Cloudflare project-list
request and proves that the current authenticated account can see the exact
`biotron-settings-beta` project; expired authentication or another account fails
closed. Production-like branch names are rejected, and the uploaded immutable
URL is accepted only after every remote file and required response header
matches the candidate. Never use the legacy `deploy.sh` for this beta: it builds
the mutable checkout and force-pushes a Git branch.

The hardware-confirmed firmware research build is separate:

```
npm run build:biotron-firmware-beta
```

Only that build copies the pinned 1.10.9 clean artifact and shows the Biotron updater.
It must not be sent to an unscreened customer segment. Firmware installation is
desktop Chrome/Edge plus internet only, and each board revision must be
confirmed before receiving its link.

The candidate handles browser audio interruptions explicitly: MIDI pauses with
the audio context, resumes when audio really returns, and retries on foreground
return rather than in a hidden retry loop. The automated test simulates WebKit's
`interrupted` state; it does not prove an iPhone or MIDIWeb defect is fixed. The
candidate hardware checklist includes a separate iPhone recovery check.

The primary beta test path is current Chrome/Edge on a Windows, macOS or Linux
computer. It is not an `.exe`: the browser installs a standalone app after the
first online visit. Android Chrome is an experimental field-test path and also
needs USB host/OTG support plus a data-capable cable. No exact phone model is a
release-certified target yet. Standard browsers on iPhone/iPad, desktop Safari
and Firefox do not provide the Web MIDI path required by device Settings.
No computer/OS combination becomes release-certified without the physical
check below. On iOS/iPadOS 17.6+, [MIDIWeb Browser by 5of12
LLP](https://apps.apple.com/us/app/midiweb-browser/id6757226617) is the preferred
experimental research path because it bridges Core MIDI to WebMIDI and supports
the SysEx flow required by Settings. It remains unverified with Biotron until it
passes the same physical evidence gate. Deploy this build only on a dedicated beta origin;
never under the production service-worker scope.

The beta shell deliberately exposes only Biotron's `Play` and `Settings`
tasks. The normal production device navigation remains unchanged. Settings,
presets and live controls stay hidden until the selected Biotron answers with
its saved state; firmware recovery remains reachable when the device is
already mounted as `RPI-RP2`. This prevents a tester from editing an
unverified placeholder state.

The beta sends small, structured technical events while online: connection,
calibration, audio, saved-settings state and the tester's explicit first-sound
answer. It sends no raw MIDI, SysEx, audio, preset contents, port names/IDs or
full user agent. The separate `Copy diagnostics for Andrey` action copies a
richer packet for the tester to share manually. The in-app notice links to
`telemetry.html`; the server-side intake is an isolated Pages Function backed by
an EU-jurisdiction D1 database. See `docs/BIOTRON-TELEMETRY.md` for its contract,
privacy/release checks and retention operation.

Beta routes declare their required capabilities in `src/main.js`. One shared
compatibility gate checks secure context, Web MIDI and Web Audio before mounting
a device page. Unsupported phones and browsers get one
plain-language recovery card; permission denial remains a separate retryable
state. The generic Sound route keeps its on-screen/keyboard audio mode when MIDI
is unavailable and hides the unusable USB controls.

Responsive layout is not evidence that USB control works. Firmware update is
computer-only and online-only; it must remain unavailable on phones. Each
immutable candidate contains its own short `PHYSICAL-TEST.md`; that generated,
build-specific file is the only manual hardware checklist. Release progression,
tester communication and outcome decisions belong to the product-learning
contract in `~/Projects/Playtronica/product-experience`, whose
`./product-loop brief --product biotron` output is the only current release
view. This repository does not maintain a second feedback log, outreach
template or release roadmap.

Biotron first play treats firmware stabilization as its own state. Released
firmware 1.8.2 and the current firmware branch sample the plant every 100 ms,
wait for roughly five seconds of stable signal, then measure a baseline for
roughly five seconds while the green LEDs pulse and MIDI notes 91/92 alternate
at velocity 90. `src/audio/biotronCalibration.mjs` recognizes four quick
alternations and waits for 700 ms of silence before inviting the user to touch
the plant. This is deliberately a bounded MIDI-pattern inference, not a new
firmware status claim; an explicit read-only status message would be stronger.

The beta Settings page also contains an explicit `Calibrate plant again`
control for the matching firmware draft. It sends vendor SysEx command `125`
with a nonce and accepts only nonce-matched progress (`waiting`, `measuring`,
`ready`) reported by the device. Older firmware is left untouched and gets a
clear reconnect fallback after the capability timeout. The command never uses
BOOT and the firmware-side contract forbids settings or flash mutation.

The ordinary `npm run build` deliberately contains no manifest, service worker,
or registration. `npm run test:production-isolation` enforces that boundary so
this beta cannot silently alter the existing production Settings lifecycle.
The beta build also emits a Cloudflare Pages `_headers` file that blocks
framing, limits powerful browser permissions, removes referrer leakage and
keeps the private beta out of search indexing. Production does not receive this
file.

Verify the generated service worker, revisioned app shell and manifest:

```
npm run build:biotron-beta
npm run test:pwa
npm run test:firmware
npm run test:pwa:browser
```

Use the smallest test lane that can answer the current question:

```bash
npm run test:quick       # lint, architecture and deterministic module contracts
npm run test:beta-build  # beta build plus artifact/protocol/PWA checks
npm run test:browser     # sound, PWA restart and responsive quality in Chromium
npm run test:firmware:browser  # firmware beta build: update modal fits 1366x768 and is clickable
npm run test:biotron     # exact release gate: every lane plus production isolation
```

The responsive quality gate covers desktop, Pixel 7, a compact 320 px viewport
and the iPhone no-MIDI path. It blocks global horizontal overflow, CLS above
0.1, duplicate IDs, visible unlabeled controls, undersized sliders and primary
tap targets below 44 px. These emulated profiles prove layout and browser
behavior, not a physical USB connection. The complete strategy and remaining
manual gates are in
[`docs/WEB-TEST-STRATEGY.md`](docs/WEB-TEST-STRATEGY.md).
The dated research corpus for browser, MIDI, audio, PWA, storage, telemetry,
accessibility and release failure modes is in
[`docs/research/web-apps/`](docs/research/web-apps/README.md).

Use scripts and the local browser tests before asking for human review; reserve
model review for architecture, customer claims and release decisions. No test
or automation in this branch pushes, deploys, publishes firmware, or touches
production.

`npm run audit:web` prints the current architectural debt and largest files.
`npm run test:architecture` is a ratchet inside the full gate: eager routes and
unmanaged component listeners cannot return, CPU-blocking MIDI waits cannot
return, and source/file-size caps cannot grow silently. The normative
anti-slop review contract (single state owner, bounded async work, no speculative
layers, explicit change budget) lives at the top of
[`docs/WEB-SIMPLIFICATION-REVIEW.md`](docs/WEB-SIMPLIFICATION-REVIEW.md).
`npm run test:midi-timing` proves delays yield to the event loop and
writes stop after device switch, disconnect or close; the browser PWA gate
measures responsiveness during a complete settings write. The
same document records the staged simplification plan and rejected rewrites.

The browser lifecycle test uses an installed Chrome/Chromium (`CHROME_PATH` can
override discovery) and covers service-worker install/control, offline direct
navigation, the offline firmware guard, and a non-disruptive waiting update.

### Lints and fixes files
```
npm run lint
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).
 
