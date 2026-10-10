# Biotron tester loop

One goal: demonstrated customer readiness for the exact web/firmware pair.
The runner is engineering evidence, not human approval or a release decision.

Run `python3 scripts/run-biotron-qa.py --browser --timeout 300 --output <ProjectData-run-dir>`.
Each attempt gets a new directory, source/input hashes, raw logs, JSONL results,
coverage inventory and summary. Failures do not stop unrelated safe lanes.
Timeout/interruption send SIGINT to the owned lane, then use bounded grace and PID/start-time checks for its descendants, including detached browser groups. Unconfirmed cleanup stops subsequent lanes. The cleanup field covers recorded host processes only, not MIDI/audio/device release; normal exits have null inventory evidence. Missing scripts
are NOT RUN, never green. Without --browser, browser lanes are NOT RUN.

Build order: production isolation → firmware beta/browser → general beta →
sound/PWA/quality/device variants. Browser updater tests use simulated MIDI and
cannot certify physical flash. Presets and digital audio levels are automated;
microphone/system/physical audio are distinct unavailable lanes.

Offline audition rendering uses a fresh page for each case, because native
OfflineAudioContexts cannot be closed. The retained 30s case deadline and all
PCM/FFT/alias/tail/voice assertions remain unchanged. Realtime lifecycle is a
separate test. Runner interruption controls wait for the fixture's readiness file
before SIGINT; elapsed startup time is not a readiness signal.

## Browser recovery — 10 October 2026

The existing `test:sound:browser -- --capability-only` checks missing API,
permission/policy denial, missing device and unavailable audio separately.
A touch-only no-MIDI page must offer a working example, never a hidden keyboard.
Quality checks cover Settings/Play/shared Sound, exact page-link copy,
success→denial→success, a selectable fallback URL and unique accessible names.
The shared production-isolation test also accepts `BIOTRON_QA_DIST_ROOT` and
rejects beta recovery text in production JavaScript. Source capability detection,
clipboard mocks and running browser audio do not prove native device transfer
or audible phone output. Keep the b15 handoff bytes frozen for Sergey.

## Autonomous browser matrix — 9 October 2026

The browser audition test sends trusted key down/up through the actual built UI.
It observes actual final-output PCM, DSP frequency/velocity/gate and voice release
for 43 choices: 7 Classic, 10 Timbres, 10 calibration cues, 10 high-note treatments,
6 Handpan. Focused Sound/Octave, text fields, IME, shortcuts, background, route
changes, repeated keys and cold device-free Play are separate cases. The native
popup's actual OS selection behavior remains a physical case.

The same audition tester now captures continuous final-gain PCM during examples:
9 active timbre changes, 9 same-timbre controls, and 6 Stop/restart segments for
Round reference, Clear glass and Deep bass. It saves WAV and change-time windows
before asserting finite samples, no clipping or missing blocks, RMS > .001,
the actually applied timbre and no MIDI requests. This is part of the full
audition path; `--keyboard-only` keeps its existing scope. Run the narrow subset:

```sh
BIOTRON_QA_DIST_ROOT=/absolute/path/to/pinned/dist \
AUDITION_BROWSER_OUTPUT=/absolute/path/to/new/evidence \
BIOTRON_QA_BROWSER=chrome node scripts/test-audition-browser.js --transitions-only
```

`AUDITION_TRANSITION_FAULT=clip` or `gap` deliberately damages the recorded PCM
in this subset. Each must exit nonzero and retain the first fault and WAV;
these are capture-oracle controls, not production defects. The recorder closes
with its AudioContext, so the boundary between Stop and a new context is
**not measured**. Contiguous final-gain blocks do not prove speaker output or
absence of device underruns. Large sample steps can belong to the timbre:
compare the same-timbre windows; no perceptual PASS is inferred.

10 October: exact frozen b15 passed 24 captures each in Chrome154 and
Playwright WebKit26.5. Earlier next-runtime0a diagnostic captures and oracle
faults are separate evidence. Phone crackle FB63 remains open; no DSP patch,
phone-hearing acceptance, full gate or replacement of the sent packet is claimed.

Select a browser without editing a test:

```sh
BIOTRON_QA_BROWSER=brave npm run test:auditions:browser -- --keyboard-only
BIOTRON_QA_BROWSER=msedge npm run test:quality:browser
```

Supported selectors: `chrome` (default), `chrome-beta`, `brave`, `chromium-gost`,
`opera`, `vivaldi`, `arc`, `msedge`, and pinned Playwright `chromium`, `firefox`, `webkit`.
`CHROME_PATH` applies only to `chrome`. A missing or unknown browser fails;
there is no automatic Chrome fallback. Tests use isolated profiles.
Install official test engines with the existing dependency, without upgrading it:

```sh
node node_modules/playwright-core/cli.js install firefox webkit
python3 scripts/run-biotron-qa.py --browser --timeout 600   --browsers chrome-beta,brave,chromium-gost,msedge,firefox,webkit   --output /absolute/ProjectData/unique-parent
```

Extra matrix lanes reuse the complete sound/MIDI lifecycle, PWA, firmware modal,
audition, responsive-quality and other-device variant tests, sequentially.
Each browser gets separate JSONL/logs and audition artefacts. Firmware matrix cases run immediately after the single firmware build; general
matrix cases follow the single general-beta build. Chrome-only CDP CPU/heap and
installability probes are explicitly NOT SUPPORTED in Firefox/WebKit. The same
generic functionality still runs, without invented throttle or heap measurements.
Use `BIOTRON_QA_DIST_ROOT` for an already verified immutable build and
`AUDITION_BROWSER_OUTPUT` for a unique audition evidence folder when running directly.
The inner audition deadline is 300s (`AUDITION_BROWSER_TIMEOUT_MS`); choose matching
runner deadlines for slow browsers. A timeout preserves the first fault and closes
only its own test browser. A process launch failure must also release the server.

Playwright Firefox is patched Firefox, not the installed Mozilla release;
Playwright WebKit is not installed Safari. Responsive Firefox profiles retain
viewport/touch data; Playwright's unsupported `isMobile` option is removed explicitly.
Unsupported LayoutShift measurement is **NOT MEASURABLE**, never zero/PASS.
Brave can suppress this API despite advertising it: its measured zero is not
independent evidence of zero visual shift. Browser version/scope is printed per lane.

Short-sample RMS advisories flag relative quietness within a bank. They are not
LUFS or perceived-loudness verdicts. Calibration uses deliberately lower velocity.
The handpan short-gate test retains incremental spectra before assertions, including
failures. A single-task cue fixture verifies browser routing; tracker units retain the 700ms boundary and reject 701/823ms or reversed arrivals. It does not replace the retained timed-score finding or native cadence proof. `test:sound:browser -- --capability-only` is a development subset, not full-suite PASS. Digital PCM, FFT and WAV existence never imply speaker or musical acceptance.

Official references checked 9 October 2026:
[Playwright browser distinctions](https://playwright.dev/docs/browsers),
[Apple Safari WebDriver](https://developer.apple.com/documentation/safari-developer-tools/macos-enabling-webdriver),
[Mozilla Web MIDI capabilities](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API).
Real browser/OS permissions and hardware remain additional lanes.

A disconnected browser or pending newContext/newPage rejects immediately or at a
30s bound; it cannot silently leave an unresolved promise and exit0. Fake controls
cover resolution, original rejection, disconnect, deadline and listener cleanup.
Vivaldi8.2 disconnected on an independent empty-page newPage control before the
application loaded; this is a driver/startup failure, not a Biotron compatibility verdict.
The firmware modal lane records capabilities and first faults before cleanup.
Without showDirectoryPicker it verifies the truthful limitation/manual UF2 link,
no automatic install button and visible footer; download/install remains explicitly
NOT SUPPORTED. Actual picker browsers retain the original download/check oracle.
No synthetic picker is injected to manufacture firmware support.

## Exact online coverage — 10 October 2026

Use the existing scripts against one immutable published origin and its extracted
candidate `dist`. `BIOTRON_QA_ORIGIN` accepts only the unique eight-hex HTTPS beta
origin; aliases, arbitrary sites and metadata differing from the pinned artifact
are rejected. Sound, PWA, auditions, responsive quality and UI performance reuse
this guard. Running the local full runner is not an online acceptance claim.

```sh
BIOTRON_QA_ORIGIN=https://EXACT8HEX.biotron-settings-beta.pages.dev \
BIOTRON_QA_DIST_ROOT=/absolute/extracted-candidate/dist \
BIOTRON_TEST_EVIDENCE_DIR=/absolute/unique-evidence \
node scripts/test-pwa-browser.js
```

Replace EXACT8HEX with the verified publication ID. The PWA lane checks the actual,
unmodified published worker bytes and controller URL, then reopens its own profile
with network disabled. Permission, MIDI and missing-registration responses are
fixtures, not native USB or OS installation. Controlled worker A→B replacement
remains in the local fixture; it is **NOT RUN** on an immutable remote origin.
Sound retains its simulated telemetry receiver; this does not close delivery503.
First-fault JSON and bounded screenshots are recorded before cleanup when an
evidence directory is supplied. Incorrect identity must stop before a page opens.

The existing UI benchmark accepts `UI_PERF_QUALITY=safe` (4notes, no reverb) or
`standard` (8notes, reverb). It selects the real control and checks the engine
attribute. `UI_PERF_HEADED=1` records an explicit headed scope. Results keep phase,
requested browser, test-source SHA, route distributions, native output PCM and
cleanup. `captureProblems` explains invalid clocks, missing PCM or dropped blocks;
these remain **INCONCLUSIVE**, with unchanged musical thresholds. Frame/latency
samples are observations, not calibrated INP, physical latency or hearing tests.
A missing driver or invalid browser cannot be silently called a product failure.
The preserved headless first-click stall and actual-driver uncertainties remain
open in the existing project ledger; a headed PASS does not erase them.
Qualified matrix audio lanes retain INCONCLUSIVE for exit2, matching the default
lane. Exit2 in another script stays FAIL and no incomplete measurement becomes
PASS. Sound, PWA and the timed soak get separate first-fault directories. The soak
adds its duration to the normal full-suite timeout (at least180s), retaining the
Settings/lifecycle assertions around capture; this does not relax audio oracles.

## Faults that must remain regressions

| Observed fault | Automated oracle | Remaining physical oracle |
|---|---|---|
| Final Off dropped after Off→On→Off | Firmware host TX lifecycle/backpressure tests | Named receiver, incident trace, real pressure |
| Duplicate setters delay save | Firmware production params/storage tests | Save/restart/raw restore on pinned image |
| Malformed commands mutate state | Parser/registry/fuzz/negative controls | Raw USB CIN capture |
| Check/update appears inert on old firmware | Firmware state machine and legacy recovery tests | Sergey exact starting version and Windows browser |
| Chrome/Edge freeze or memory growth | Sound lifecycle/bursts/soak, listener ownership, PWA navigation | Real Windows process/memory and fault reproduction |
| Mobile offers unusable update | No-picker capability path | Actual phone/USB/browser |
| Settings unavailable without device | Offline local edit, no MIDI write, reconnect preserves draft | Human clarity and same preset across devices |
| Scale seems ineffective at low BPM | Preset encoding and musical settings contracts | Known tempo, plant/light stimulus, listening |
| PWA update probe reads destroyed context | Explicit navigation wait and persistent-profile restart | Real upgrade session with installed app |
| Readiness invisible on first-play screen | Check readiness on Settings; first-play stays clean | Human first-play outcome |
| Stop button restarts on the next MIDI note | Actual browser closes input/audio, rejects later On, can restart | Real held note and receiver Stop/Start |
| Volume boost is confusing | Percent normalization clamps legacy saved boost to 100 | Human volume control clarity |
| Help disclosure moves the sphere | Browser checks sphere document position before/after disclosure | Visual review on Windows/mobile |
| Calibration cue is too quiet | Render all seven sounds with old-level control; gain band and finite output | Listen through actual device/output |
| Cells stay at the ceiling and pulse | Actual physics/handler: capped lift and idle settling, negative old-source control | Human living/natural motion acceptance |
| Reduce extra notes has no explanation | Browser opens Experiments with exact three changes before click | Human comprehension and preset restoration |
| High notes are unpleasant | Spectra/level/non-finite measurements at pitches36/60/84/96 | Listening comparison; no pleasantness PASS from a spectrum |
| Chosen experiment stops on return to Settings | Actual native audio PCM/held MIDI through Settings → Play → Settings; independent collapses, reload restoration and stock reset | Real Biotron sound and reporter clarity |
| Fixture hides a protocol defect | Frozen actual readback vectors/real encoder frames | Native both-cable comparison |

## Manufacturing boundary, verified 8 October 2026

Factory source: Playtronica/biotron-test-jig-software commit
f3584b8d93782e4db383f0f577fbb03e765f9c28.
`src/main.py` calls update_firmware_files('Playtronica', 'biotron-firmware').
`src/firmware_updater.py` downloads /releases/latest; the current official
release is1.8.2. The jig matches biotron-firmware_vX.Y.Z.uf2 in its local folder.
The web's legacy production updater uses the same official repo.
Internal1.10.10 is pinned separately in the manirko web branch and its temporary
test site. Do not publish a Playtronica latest release as part of internal tests.
This confirms repository code; the installed Imakerbase checkout still requires
its operator's confirmation. No factory repository/config has been changed.

## Completion requires

Automated exact-source gates; native identity/settings/recovery; real browser
write→rollback→reflash; Windows DAW/reconnect/incident capture; physical mobile;
musical/visual human outcome; independent firmware-owner review; canonical
product release gates. The two self-resolved stuck notes remain unexplained.
No PASS from absent input, no inferred customer outcome, no self approval.

After each new fault: keep the first evidence, reproduce at the smallest scope,
add an oracle that fails on the original behavior, fix, rerun the affected lanes,
then integrate into this map and runner. Retrying does not erase the first fault.

## Feedback priorities —8 October, refreshed12:27 UTC

Andrey asks for substantial simplification and truthful descriptions. Sergey says
Input variation is an existing function, formerly Ultra sensitivity: do not label
it NEW or experimental. It adds sensor jitter, not measured sensitivity or
velocity. Group it under Plant response. NEW is for genuinely new experiments,
currently Reduce extra notes. Basic tasks stay visible; exact advanced behavior
is disclosed near the control. Do not erase intentional firmware/music choices
just to pass a test or hide uncertainty behind a vague label.

This paragraph records the earlier602d19c baseline, before later publication.
Baseline602d19c passed32 software lanes and a600s Mac Chrome synthetic-MIDI soak
(2892 cycles). That evidence does not attest the later feedback changes or close
Windows/physical mobile/musical acceptance. Canonical product-loop on8 October
still has no registered customer candidate and release_ready=false.

Internal web4bcc0d85c9f736a7e4defdc5192081d1d580432a was subsequently published
8 October14:47 UTC on the existing temporary site. Its immutable release metadata
was reread16:19 UTC: build4bcc0d85c9f7, firmware1.10.10, customer_release=false.
Final exact-archive QA37PASS/6NOT RUN remains its dated publication evidence.
Test/helper-only commits after4bcc do not identify another published runtime.

The existing real-time audio bench is now an executable `test:audio:realtime`
browser lane, using the same capture/analyzer/production engine. It records
actual final-gain PCM and proves silence/stuck-note mutations, then rereads WAVs.
Score v2 checks Note Off release before panic, and repeated capture cleanup.
Source-boundary, cold-audio-clock, retained bench poller and panic-masked release
counterexamples are preserved. Full physical output, Windows and mobile gates
remain separate; this is isolated engine capture, not a running Play UI tap.


## Thirty listening options — 8 October 2026

Andrey explicitly requests three separate banks of ten: timbres, calibration
sounds, upper-note treatment. NEW → Compare sounds opens a lazy, audio-only
comparison page. Each bank uses identical note events and master volume; cue
levels are the declared experimental variable. Calibration previews reproduce
firmware1.10.10's eight-note/velocity24 cue; they never start calibration or send
MIDI. High-note treatments transition at MIDI72–84. The three-register option
also blends the bass at48–60; middle note64 remains the current Round sound.

Run `npm run test:auditions`, `test:auditions:render` and `test:auditions:browser`.
The renderer writes30 unnormalized48kHz WAVs, parameter/source hashes and60
quality cases. Every option must be finite, have headroom, settle its tail and
release its voice pool. Upper processing must leave the middle-register control
unchanged. Actual WAV hashes must differ within each bank. A case timeout writes
failure.json; first failures remain evidence. OfflineAudioContext cannot close,
so each offline DSP case uses a new page. This isolation does not replace the browser's
same-page100-start/close resource regression, nor a real mobile/Windows test.

WebRenderer4.0.3 retained a polling interval and a worklet Blob URL after every
Stop (two of each after two renders, reproduced before the fix). Pin4.0.3 and keep
its small lifecycle adapter in engine.mjs: revoke this context's module URL,
clear its poller, reject pending requests and close the loaded worklet port.
Restore addModule immediately after initialize's synchronous call. A late load
must dispose again and cannot build a graph. Browser checks cover all30 options,
100 starts/closes, interrupted loading, close failure/retry/route blocking,
suspension, background release and local feedback. Do not identify this leak as
the cause of Sergey's Windows freeze without reproducing his environment.

8 October FB34 removes the former Prefer/comment/export workflow. Choosing a
known experiment immediately controls the same live session and saves only its
bank/variant IDs locally. Playing or selecting is never LISTENED/APPROVED.
Calibration choices still affect only the nonce-confirmed cue, not plant notes.
The30-option implementation increases the reviewed source budget from67/10300
to69/10598, adding bank data and a lazy comparison component. No voice-cap,
firmware ABI, eager-route, dependency-version or largest-component increase.

Fresh Sergey feedback13:00–13:12 UTC: status messages should read as text;
Swing note needs a distinct Rhythm group; light tempo is a count of plant beats,
including muted/unchanged notes, not independent BPM. Source music.c275–287 and
global.c195–201 confirm these descriptions. The offline download destination
is a browser/user choice; do not assert every user downloads to Desktop.

Quick disconnected-clip calibration is still a proposed firmware behavior.
Source global.c319–354 waits for raw frequency above MIN_FREQ60 and restarts
when it falls below; it has no physical clip-presence sensor. last_freq telemetry
is not a raw-sample oracle throughout Sleep. Avoid claiming “clips disconnected”
from silence, a timeout or stale telemetry. A short no-signal diagnostic needs
raw sample timing/threshold evidence, a bounded state transition and independent
firmware-owner review; keep valid low/unstable plant inputs and recovery intact.

Full aa72d9f run preserved34PASS/2FAIL/6NOT RUN: a direct comparison import
leaked presets into normal production; replace it with the existing build alias
pattern and add a production bank-data oracle. The PWA oracle wrongly required
shared presets to live in the SoundLab chunk; check their actual emitted chunk
and precache instead. Real offline comparison already passed on that run.
An explicit negative listening comment must save even without Prefer; an old-source
negative control reproduces the discarded comment. Save a comment with no vote,
then preserve that distinction in export. Machine fixtures remain non-human.


8 October, Andrey live feedback FB27–FB31: comparison now reuses SoundLab’s
existing engine, MIDI session, exclusive tab lease and calibration state. Play
has a direct30-option link before connection. In Compare, “Play with Biotron”
uses the selected timbre/upper treatment live; the cue bank changes only explicit
nonce-confirmed calibration sound and restores the normal plant sound afterward.
One “Listen to example” button toggles Stop; reference is option1. No settings,
velocity configuration or firmware bytes are changed by selecting sounds.

Decisive regression: test:auditions:browser covers all30 previews,100 context
closes,30 live MIDI selections, one engine during switches, held-note release,
wrong calibration nonce, cue-only levels, restoration of plant velocity, actual
final-gain PCM and octave-down spectral change. A label-only switch must fail.
Physical Biotron/listening/platform acceptance remains separate. PWA browser
checks all13 scale choices against emitted command4 bytes and confirmed readback;
SelectCommand commits the displayed value before emitting the change event.
First old-selector control emitted4 while display0; the fixed event emits0.
That source defect is not proof of the cause of Andrey’s live scale observation.
Local pending presets still require explicit Apply, preserving the agreed model.

## Handpan request —8 October2026, FB33

Three original modal rings (fundamental/octave/fifth) and a brief filtered finger
strike share the existing Elementary voice pool/master. Native pan envelopes use
seconds; legacy tempo-scaled voices and seven defaults are unchanged. Six bounded
options are separate from the existing three banks of ten; all use the existing
SoundLab MIDI lease/context and explicit Stop. The old two-oscillator prototype
renderer does not certify this different engine.

Automated acceptance: 36 options × standard/safe =72 real DSP render cases; six
unaltered-level handpan WAVs; three measured modes after27ms Note Off; full MIDI
range finite/headroom/settling and44.1/48k upper-mode alias negative control; real
browser short MIDI rings, six live choices,36 example starts/stops, four natural
ends and100 repeated closes; existing PWA, voice caps,25KiB lazy chunk and release
fault lanes. Source size adds37 lines in existing files; no dependency/controller
or additional context. Acoustics target: Sonores Acoustics handpan research
https://www.sonoresacoustics.be/portfolio/handpan (consulted8 October2026).

RENDERED does not mean LISTENED/APPROVED or authentic sampled handpan. The six
roles are clear/soft/finger texture/singing/room/deep; choose with the instrument
on speakers/headphones. Physical sound and existing customer gates remain open.

## Inline experiments —8 October2026, FB34

Experiments is an independent BootstrapCollapse in Settings, alongside Plant
sensor, More fun and Light sensor. Its controls remain available without a device
or confirmed settings; hardware writes retain their existing connection/readback
guards. App owns one Biotron SoundLab across Settings/Play/comparison. The old
DeviceFirstPlay wrapper and comparison voting UI are removed. AudioCompare is
only controls; sessionState stores bounded bank/variant IDs, never a serialized
preset. Selecting a stock sound clears that experiment. No new audio engine,
voice pool, dependency or higher source/chunk cap.

The original clean c4d source fails the retained actual-browser regression:
returning from live Deep ding to Settings closes its AudioContext. The new
regression measures actual PCM and one retained context/held MIDI note through
Settings/Play and panel close, checks all ordinary sections stay independently
open, nonce calibration survives route changes, and restores the choice after
reload without starting audio automatically. Storage denial keeps the live
selection; invalid stored IDs cannot inject a preset. Read-only Settings queries
123/126 are allowed; selecting sounds cannot write settings/firmware. First
failures remain private evidence. Windows/mobile/human musical acceptance stay
open.

## Online readiness and operator time —10 October

`domcontentloaded` does not prove that a lazy route has mounted. The initial
Sound check now waits for the first visible variant before preserving the exact
7-count/labels assertions and the existing5s deadline. Existing runner controls
reject missing/extra variants and altered labels; the original HTTPS faults
and before-control0!=7 remain saved. This changes the tester, not runtime643.

Sergey9Oct11:06 says he does not want his PC running overnight. Start with online
W01–W03; offer bounded daytime Claude automation separately. Declined automation
is NOT_RUN, neverPASS. Do not prescribe background/nightly machine commitments.

## WebGPU absence —10 October

The WebKit UI benchmark failed its realGarden handshake. Independent headed
probe: nativeWebGPU absent, WebGL2 present, static fallback andGPU unavailable
error. Source was rejecting the renderer before its built-in WebGL2 fallback.
Removing that guard in an isolated response control producedgarden-rendered,
hidden fallback andzero pageerrors without nativeMIDI. The first original
JSON is reconstructed from complete preserved ownstdout after an output-name
reuse mistake; the redirected.html route-control miss is retained separately.

The product removes one guard; renderer/library/options/physics unchanged.
Existing test:garden now exercises missingGPU setup; it is also in test:quick
(the broader runner already listed it). This stub is notGPU acceptance: run
the unchanged realGarden20s handshake in actual compiledWebKit/Chrome, then
exact online/phone checks. No new renderer, mode, dependency orweaker gate.
Library contract: https://threejs.org/docs/pages/WebGPURenderer.html and pinned
https://github.com/mrdoob/three.js/blob/r184/src/renderers/webgpu/WebGPURenderer.js .

## Creator recording feasibility — 10 October

`node scripts/audio-qa/test-analyze.mjs --creator-recording` extends the existing
isolated final-gain bench. `BIOTRON_QA_BROWSER` selects the real installed brand
or explicitly named Playwright engine; no silent browser substitution. The
native recorder receives the same production synth output as the reference PCM.
For supported Opus/WebM and MP4, save actual bytes, reopen them in a fresh audio
context and independently analyze the decoded channels. Normal versus muted
output, truncated-file rejection, unsupported format, constructor failure and
mid-take cancellation exercise the recording oracle and resource cleanup.

Finalize the take before closing the synth context. Retained renderer timers,
worklet URLs, contexts or stream tracks fail the test. No microphone, camera,
MIDI, upload or public sharing is requested. Format exposure is not success:
missing/empty/undecodable/silent normal output is a failure. This proof does not
implement a Play recorder, certify a phone, test editor import, measure acoustic
quality, solve FB63 or produce a finished creator video. Save/share/editor and
live-camera alternatives remain separate tasks in the existing T14 experiment.
`BIOTRON_QA_RECORD_MIME=audio/mp4` isolates one exposed format without replacing
another failed lane. Capture bytes and hashes are saved before decoder access;
capture/reopen calls are bounded by the shared browser guard. An earlier WebKit
decode failure lost its unsaved encoded file; retain that first incomplete
evidence and rerun the exact failure after this tester correction.

## Thin creator prototypes — 10 October

The existing generator now also bundles `creator.html`/`creator.js`: a reversible
experiment around the same production engine, not a shipped Play feature.
Generate with `python3 -I scripts/build-browser-qa-harness.py --output <new-dir>`,
then `node <new-dir>/build.cjs`; serve that directory with the existing static
server and open `/creator.html`. The production build/source and frozen b15 are
unchanged. No engine, dependency, framework, cloud account or editor is added.

The one page provides a short shoot/editor brief, final-gain WAV takes,
Save/native Share with cancellation, named sound/register URL plus repeatable
performance, and an optional native camera+synth/microphone video take. Only
explicit Connect requests non-SysEx MIDI inputs whose name contains Biotron;
no MIDI output, settings, calibration or firmware commands. Camera/microphone
are requested only by Record video; microphone defaults off. Three 30-second
takes bound retained buffers; previous takes survive a failed/cancelled start.
Reload clears them; Save before leaving. No file is uploaded automatically.

`node scripts/audio-qa/test-analyze.mjs --creator-prototype` extends this same
tester. It saves first faults, actual WAV/video bytes and SHA, checks fresh
decode/native video playback and independent ffmpeg decode, rejects silence,
tests controlled clipboard/Share/native API failures, late permission replies,
Stop/held-key replay and lifecycle boundaries. Camera/mic/MIDI providers are
controlled fixtures; assertions do not certify real hardware/permissions,
BFCache, phone/editor import, camera sync, human hearing or a completed clip.
ffprobe/ffmpeg are existing local test dependencies, not product dependencies.

Judge review and preserved before-fix controls found missing held-key panic and
revoked kept-take URLs on pagehide. The minimal fixes record a performance stop,
preserve completed URLs across controlled restoration, bound resume/preview and
defer finish requests instead of dropping them while busy. Native restoration
remains a separate test. Worklet registration is reused per context; three
Chrome takes did not reproduce a registration error before that simplification.

Business/user goal lives in existing T14/PLT-BIOTRON-001: compare the same finished
creator task with usual tools. Hypothesis: at least half the total time without
extra help or lost quality/reliability, followed by voluntary reuse. Software
PASS is not that outcome; views/likes are not orders or contribution profit.
Exact reference-video transcription/matching and the existing Waveform-route
check remain separate unfinished tasks. Final pinned results belong to the
existing context ledger; do not replace historical QA with this scoped proof.

Pinned creator proof `c702b17036176bd662f5eac562cd72158557486a`: Chrome154 and
PlaywrightWebKit26.5 each22check groups PASS_SCOPED. Native WAV/video bytes,
separate fresh/browser/ffmpeg decode and exact download/controlled Share checked.
`--creator-prototype-decode-fault` intentionally exits1 after saving WAV/first
fault; byte/SHA readback is the negative control. It does not close a product
decoder incident. Legacy3realtime PCM cases PASS separately; no full gate.

The first WebKit fixture failure is retained: an expando on the native
mediaDevices wrapper disappeared after audio capture. The existing tester now
pins a controlled navigator.mediaDevices object and asserts denial count/text;
it cannot silently call a real camera in this lane. Finalization errors release
MIDI in finally while preserving the primary error. More than2000 performance
events preserves the recorded file but visibly disables incomplete replay.

WAV is mono float32 from the first final-gain channel; full stereo/effect
equivalence and actual editor compatibility remain untested. Three takes and
30seconds bound count/duration, not measured native video heap/file size. Native
BFCache, permission sheets, camera+USB, synchronization, simultaneous speech and
music, phone/editor/final clip, off/on CPU/heap and novice accessibility remain
separate gates.61,302byte creator JS/gzip20,493 and single navigation observations
Chrome569ms/WebKit620ms are not a benchmark or speed-up claim.

The new built-in Goal is ACTIVE after Andrey cleared the previous Goal. Software
proof does not complete it: compare an actual finished-video task with usual
tools and test the at-least2x-time hypothesis without extra help or lost quality,
then voluntary reuse/viewer clarity. Current context T14 has the local page,
source/scopes,53learning records and unchanged influencer/support frame limits.

### Creator video handoff follow-up — 10 October 2026

Prototype9a fixes a real transport failure: bare Chrome MP4 contained VP9/Opus,
which Mac AVFoundation could not decode as video (-11833), while a known H264/AAC
control decoded. Prefer explicitly supported `video/mp4;codecs=avc1,mp4a.40.2`
in the existing format list. Keep WebM/generic fallback without claiming editor
compatibility. No constructor-error fallback was added; previous files remain.
Existing --creator-prototype now saves bytes/probe before asserting actual H264
and AAC when explicit encoding is supported; checks synth, controlled310Hzmic,
and their mixture. No real camera/mic/MIDI in controlled final tests.

Exact9a: Chrome154 and PWWebKit26.5 each24groups PASS_SCOPED; six videos H264/AAC.
Eight saved WAV/video files independently decode through Mac AVFoundation,
separately from ffmpeg decode and browser playback. This does not certify a GUI
editor, installed Safari, iPhone, human speech, hearing, lip-sync or finished clip.
Before34841 regression FAIL/actual VP9 bytes and environment-control failures
are retained. Current compiled creator.js61,336bytes equals9a UI-run bytes;
this size observation is not a speed benchmark.

Final testerf034 reanalyzes the saved files using the shared existing analyzer.
RMS+310Hz falsely accepted2x mic-only; global source maxima falsely accepted
non-overlapping source windows. Known score+310Hz now must exceed their separate
baseline thresholds in the same0.5s Hann window. Six actual file SHAs/fresh PCM,
positive mixtures and isolated music/mic/2xmic/silence/sequential controls PASS.
These are known-fixture co-occurrence checks, not general speech detection or
whole-take quality. Units/syntax/architecture and exact compiled readback PASS;
no new f034 UI/fullgate/benchmark run. Source/firstfault/scopes live in the
existing T14 ledger, now55learning entries. Production84inputs, DSP/firmware/
dependencies, frozenb15/SergeyZIP and old local c702 page remain unchanged.

Next actual creator test: preferred editor/device + intended task → local
recording → transfer/import/export → finished clip reopened outside editor;
compare total help/time/retries and quality with usual tools, then voluntary
reuse and viewer clarity. Optional editor-name question is pending. No benefit,
virality or profit is established by codec or PCM PASS.
