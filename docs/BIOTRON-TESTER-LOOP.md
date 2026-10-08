# Biotron tester loop

One goal: demonstrated customer readiness for the exact web/firmware pair.
The runner is engineering evidence, not human approval or a release decision.

Run `python3 scripts/run-biotron-qa.py --browser --timeout 300 --output <ProjectData-run-dir>`.
Each attempt gets a new directory, source/input hashes, raw logs, JSONL results,
coverage inventory and summary. Failures do not stop unrelated safe lanes.
Timeout/interruption terminate only the runner's process group. Missing scripts
are NOT RUN, never green. Without --browser, browser lanes are NOT RUN.

Build order: production isolation → firmware beta/browser → general beta →
sound/PWA/quality/device variants. Browser updater tests use simulated MIDI and
cannot certify physical flash. Presets and digital audio levels are automated;
microphone/system/physical audio are distinct unavailable lanes.

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
| Reduce extra notes has no explanation | Browser opens NEW disclosure with exact three changes before click | Human comprehension and preset restoration |
| High notes are unpleasant | Spectra/level/non-finite measurements at pitches36/60/84/96 | Listening comparison; no pleasantness PASS from a spectrum |
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

Latest source changes are internal and have not updated Sergey's temporary site.
Baseline602d19c passed32 software lanes and a600s Mac Chrome synthetic-MIDI soak
(2892 cycles). That evidence does not attest the later feedback changes or close
Windows/physical mobile/musical acceptance. Canonical product-loop on8 October
still has no registered customer candidate and release_ready=false.
