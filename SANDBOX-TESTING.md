# Biotron isolated test sandbox

This branch combines the draft MIDI handoff, lifecycle regression tests and
offline PWA work for testing only. It is hosted in `manirko/WebMidiVue`; it is
not connected to the Playtronica production deployment.

## Exact sources

- Integrated Settings: `manirko/WebMidiVue`, branch `sandbox/integrated-biotron`
- Help: `manirko/help`, branch `sandbox/biotron-help`
- Firmware: `manirko/biotron-firmware`, branch `sandbox/biotron-firmware`

Always record the tested commit SHA from each repository. Do not test or flash
an unrecorded moving branch.

## Automated Settings checks

```bash
npm install --no-package-lock
npm run lint
npm run build
npm run test:midi-lifecycle
npm run test:pwa
npm run test:firmware
npm run test:pwa:browser
```

The browser test starts a temporary localhost server and uses installed Chrome.

## Firmware host checks

```bash
tests/run_host_tests.sh
```

This does not replace a Pico SDK build or a physical Biotron test.

## Safety rails

- Never deploy this fork to the production Settings or Help domains.
- Never publish a firmware release from this fork.
- Never flash customer hardware without recording board revision, current
  firmware, candidate UF2 SHA-256 and a recovery path.
- Use one Biotron first. Two identical devices remain an explicit ambiguity:
  Web MIDI does not provide a reliable physical input/output correlation key.
- A passing automated suite does not prove Windows/Reaper port ownership,
  physical MIDI burst handling, flash persistence or BOOT-pad correctness.
