# Sound Lab beta

Sound Lab is a small browser synthesizer inside the **Biotron offline beta** build of Playtronica Settings. It is not included in production Settings.

The installed beta opens `/#/biotron/play`: a minimal first-play path that
identifies one Biotron music input, asks for one plant gesture, shows the
matching note activity and explains that the browser turned the received MIDI
note into sound. Full Settings remain at `/#/biotron`; the general lab remains
at `/#/sound`.

## User flow

1. Open **Sound** in the beta navigation.
2. Press **Start sound** once (browser audio requires a user gesture).
3. Choose one of six numbered sound variants by ear. Names remain internal until listening confirms them.
4. Play with the on-screen keys, physical A–K positions in any keyboard layout, or one selected MIDI input.
5. On a slow computer, enable **Low CPU** before Start: it uses four voices, one oscillator per voice and no reverb.
6. Press **Stop & release** before another application needs that MIDI input.

The engine accepts MIDI Note On/Off on every channel and CC 120/123 panic. It requests MIDI input only with `sysex: false`; it never opens an output, changes device settings, sends firmware commands, or writes to the device.

When the Web Locks API is available, Sound Lab holds an exclusive lock while active. A second Settings window stays silent and does not open MIDI until the first window presses **Stop & release**. Browsers without Web Locks can still play, but show an explicit reminder to keep only one Settings window open.

Capabilities are checked before opening resources. Without Web MIDI, the
general Sound page remains usable from the keyboard or screen and explains that
the primary beta USB path needs current Chrome or Edge on a computer. Android
Chrome is an experimental physical-test path when the phone provides USB
host/OTG and Web MIDI. Standard iPhone/iPad browsers cannot connect to the
device. The device-specific first-play button stays blocked rather than
pretending it can hear the device. Without Web
Audio, Start stays disabled and the same page gives one supported alternative.
Denied MIDI permission and insecure-page failures are translated into one
specific recovery action instead of exposing a browser exception.

## Pipeline

`Playtronica MIDI input / physical keyboard / screen keys → bounded voice allocator → oscillators + pitch gesture + vibrato → shared filter/delay/reverb → headroom + compressor → browser audio output`

The engine caps active voices at 8 (4 in safe mode), caps retiring voices, suspends in the background, and hard-stops every voice on Panic/Stop.

## Files

- `src/components/SoundLab/SoundLab.vue` — beta UI and lifecycle.
- `src/App.vue` — one persistent Biotron player across Play, Settings and
  experiments; `src/main.js` awaits release when leaving that session.
- `src/components/SoundLab/AudioCompare.vue` — inline experiment controls only.
- `src/audio/sessionState.mjs` — shared controller and bounded local sound choice.
- `src/audio/revealProfiles.mjs` — validated product meaning/copy and
  deterministic music-input selection; future devices add a profile, not a
  second MIDI/audio lifecycle.
- `src/audio/capabilities.mjs` — browser capability detection and plain-language
  audio-only/unsupported fallbacks.
- `src/components/SoundLab/DisabledSoundLab.vue` — production-safe alias target.
- `src/audio/core.mjs` — MIDI parsing, any-layout keyboard map, bounded voice ledger.
- `src/audio/elementary/` — the sound engine on Elementary Audio: `engine.mjs` (our
  interface, live refs, voice slots), `timbres.mjs` (chromatone/elements timbres, the seven
  sounds, master chain), `fx/` (reverb).
- `src/audio/midi.mjs` — selected-input-only MIDI lifecycle.
- `src/audio/tabLease.mjs` — one-active-window lease for audio and MIDI.
- `scripts/test-sound-core.mjs` — deterministic contracts and close-failure retry.
- `scripts/test-sound-elementary.js` — offline engine gates: dynamics, THD, 27 ms plant note, clicks.
- `scripts/test-sound-browser.js` — real Chrome/Brave audio, keyboard and fake-MIDI flow.
- `scripts/test-production-isolation.js` — proves the synth does not leak into production.

Sound requests are authored through the project skill at `Playtronica Claude/.agents/skills/playtronica-sound-designer/`. The canonical research and render harness live in `Playtronica Claude/projects/web-audio-synth/`.

## Run and test

```bash
npm ci
npm run test:biotron
npm run serve -- --mode biotron-beta
```

Open `/#/sound`. For Brave:

```bash
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm run test:sound:browser
```

Elapsed-time lifecycle soak uses the same real-browser flow and emits one
privacy-safe `SOUND_SOAK_REPORT` JSON line:

```bash
npm run test:sound:soak:smoke  # 60 s harness check
npm run test:sound:soak        # 10 min before a review candidate
```

## Safety rails

- Beta only: `@sound-lab` points to the real component only when `VUE_APP_BIOTRON_PWA_BETA=true`.
- The Sound route is lazy. Its current beta chunk, including first-play profiles and capability fallbacks, is under 10.5 KiB gzip, is precached for offline use and must remain below the enforced 25 KiB budget.
- A MIDI close failure must stay visible and retryable; Start remains blocked until the input closes.
- In a background tab, active notes are stopped and incoming MIDI is ignored until the user returns and presses Start sound; this prevents invisible note accumulation.
- Browser/driver AudioContext suspension is reflected in the UI. An unexpected context close blocks Start until Stop & release closes the still-selected MIDI input, preventing an orphaned port.
- The MIDI input list follows Web MIDI state changes and excludes disconnected ports; reconnecting or adding a device refreshes the selector without opening it automatically.
- Losing window focus releases held computer-keyboard notes so a missed `keyup` cannot leave them sounding; hardware MIDI remains connected.
- Navigating away runs the same awaited teardown. If audio or MIDI cannot close, routing is cancelled and the visible Stop button remains available for retry.
- MIDI voice-count diagnostics are coalesced to one Vue update per animation frame; the browser test injects a 1000-message burst and verifies the 8-voice cap and Panic recovery.
- The same browser test runs a 20,000-message soak with garbage collection/heap comparison, then verifies disconnect, reconnect and background suspend/resume.
- Optional elapsed-time soak repeatedly exercises Note On/Off/Panic while the
  AudioContext and selected MIDI input remain open, then checks bounded cycle
  time, periodic post-GC retained-heap slope after warm-up, advancing audio
  clock, zero voices and successful final Release. The
  machine-readable report contains no MIDI performance or private device data.
- The browser test opens two Settings tabs and proves exclusive handoff: tab B cannot start until tab A releases the lease.
- The same real-browser test enables Low CPU, holds eight keyboard notes and proves the active graph remains capped at four voices before returning to Standard mode.
- Chrome and Brave also run Low CPU with 6× DevTools CPU throttling: Start must
  remain responsive, a 1,000-message burst stays bounded at four voices and
  Panic returns to zero. This is a constrained-CPU proxy, not physical low-end
  hardware evidence.
- After injected MIDI-close and AudioContext-close failures with successful retries, the browser test completes 100/100 Start → Stop & release cycles with no page error or stale tab lease.
- Automated rendering proves bounds and stability, not whether a timbre is beautiful. Human listening is a release gate.
- Current computer Chrome/Edge is the primary beta MIDI test path. Brave and
  Android Chrome are test paths, not blanket support promises. Safari and
  standard iPhone/iPad browsers can run Web Audio but do not provide Web MIDI,
  so device input is not promised there.
- Real-browser negative-path tests remove Web MIDI and Web Audio separately:
  audio-only keyboard play remains available, while impossible device/audio
  actions are disabled with a specific alternative.
- Never merge/deploy this beta branch to production without maintainer review and physical device listening.
