# Biotron beta technical events

Status: temporary owner phone transport active, 7 October 2026, after Andrey's
explicit publication approval. Physical iPhone acceptance remains NOT RUN.
Andrey requested the exact test link before the Sergey handoff. The earlier
`728f69ab9017` archive stays immutable and has no automatic telemetry. This
internal request does not authorize customer exposure or a production release.

## Scope

The beta emits a small, explicit set of OTel-shaped events. It does not install
the experimental OpenTelemetry browser auto-instrumentation or capture console
output. This version records: session start, Play attempt/stage, MIDI connection,
AudioContext state, calibration state, saved-settings state, and the answer to
the first-sound question. The answer is a reported outcome; `audio_state=running`
is only an observed engine state. All emitted event names and fields are
allowlisted on both client and server. `event_id` deduplicates writes; a random
`session_id` lasts only in memory for the open page and appears in the manually
copied diagnostic packet so support can match a user report to a timeline.

The beta client is `src/biotron/telemetry.mjs`. It sends same-origin POSTs to
`/api/telemetry`, never awaits them in MIDI/audio/settings flows, drops events
when offline, and caps at 80 events per page session. Failures are swallowed.
The Pages advanced-mode handler is `beta-assets/telemetry-worker.mjs`, copied
into `dist/_worker.js`; all other requests pass through to `env.ASSETS.fetch`.
A read-only GET on the API checks that the `SESSION_EVENTS` D1 binding and table
are ready. The immutable preview guard requires that response after upload.

## Data and privacy

D1 database `playtronica-session-events` (ID
`0d385f91-f646-4f8c-b508-344b4b2f8a6e`) was created in the Cloudflare EU
jurisdiction in the account that owns `biotron-settings-beta`. It is separate
from the existing `puntus-core` database. Schema:
`beta-assets/telemetry-schema.sql`. The only configured Pages binding is
`env.preview.SESSION_EVENTS`; `wrangler.toml` is copied to each candidate as a
hashed sidecar. The production Pages environment has no D1 binding in that
file. A read-only aggregate check on 7 October 2026 found 488 stored events and
zero rows older than 90 days. That count does not establish customer provenance;
no individual event payloads were read. The temporary owner phone transport
described below cannot write to this database.

Stored fields: random event/session IDs, receive and event times, exact build,
fixed event/result/error codes, broad browser and OS families, mobile/Web MIDI
booleans, MIDI-port *count*, limited firmware version when the device reports
it, audio/visibility states, and coarse age of the last incoming MIDI message.
The server rejects unknown fields. It does not store names, contacts, port
names/IDs, serials, full User-Agent, URLs, raw MIDI/SysEx, audio, presets,
exception text, or the text of WhatsApp reports. Cloudflare may process network
metadata, including IP, outside this application table. Do not describe the
stream as fully anonymous.

`beta-assets/telemetry.html` is the user-visible notice, linked from the beta
shell. Before sending this candidate to real users, the owner must review that
notice, applicable legal basis, Cloudflare terms and data-subject handling.
The intended individual-event lifetime is 90 days. The handler deletes rows
older than 90 days before each successful insert. If the beta has no traffic,
that alone does not enforce a deadline. An approved independent retention
schedule and operational checks are needed before making the lifetime promise
to users. Running the 90-day manual SQL only every 90 days does not enforce a
90-day maximum lifetime during idle periods.
The dedicated `telemetry-retention-worker.mjs` and its Wrangler config implement
an independent daily prune at 03:17 UTC, without an HTTP route, against only this
beta database. Its 89-day cutoff leaves a one-day scheduling margin for the
90-day lifetime. Real SQLite checks retain boundary/fresh rows and remove only
older rows without browser traffic. Before a telemetry-enabled customer preview
the operator must obtain approval, deploy that worker and verify the configured
trigger; deployment/configuration
does not prove future scheduled executions. Check failures and perform the
manual prune if needed. Customer notice/legal-basis review remains separate.

Current operational state (2026-10-07): retention code passed the SQLite and
Wrangler dry-run checks but was **not deployed**. Automatic approval review
rejected the permanent deletion schedule without explicit human approval of
its scope. No remote rows were deleted. Andrey subsequently explicitly approved
the temporary static phone publication; this does not authorize the permanent
deletion schedule. The temporary transport deliberately has no database writes.
Do not treat it as a customer preview or proof of live telemetry delivery.

Scheduler contract: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
checked 2026-10-07. This is application infrastructure, not a Codex reminder.

## Temporary owner iPhone transport

Temporary URL (7 October 2026):
<https://calm-payroll-homeland-conditions.trycloudflare.com/#/biotron>.
This requires the owner's Mac, static server and Cloudflare tunnel to remain
running. It is not the immutable Pages candidate for Sergey or customers.

The fixed 71-file payload is the existing D build, source
`30d978514f675d94950ae4a2af998a68e3a1e56e`, served from
`/private/tmp/biotron-pwa-proof-20261007/d`. The server permits only listed build
files, disables directory listing, and has no D1 binding. Both GET and POST
`/api/telemetry` return 503; the unchanged client drops failures. The page's
generic online telemetry banner is not proof of persistence on this transport.

HTTPS readback verified matching original index and Garden scene bytes, app
frame denial, same-origin Garden framing, and 404 for an unknown path. The index
SHA256 is `1545a542c66ce018596e0b2f1f02eca7c611248b7a2b8867a40ced4a96dd1337`.
The agent browser loaded Settings and displayed the device selector. This is
transport/UI evidence only; phone MIDI, audible sound, settings readback,
background recovery and touch/fullscreen checks await Andrey's physical run.
No firmware write is part of this first phone step.

## Queries and operation

Use the exact build and event stage for denominators. Examples:

```sql
SELECT service_version, event_name, stage, result, error_type, COUNT(*) AS n
FROM session_events
GROUP BY service_version, event_name, stage, result, error_type
ORDER BY service_version, n DESC;

SELECT received_at, event_name, stage, result, error_type, audio_state,
       last_midi_age, browser_family, os_family, firmware_version
FROM session_events WHERE session_id = ? ORDER BY received_at;
```

Run the retention file only against the named Playtronica DB and confirmed
account. The file deletes old rows and prints the remaining count:

```bash
CLOUDFLARE_ACCOUNT_ID=e5e3da2238cbacdb5f8fd1cceefa99fc \
  wrangler d1 execute playtronica-session-events --remote \
  --file beta-assets/telemetry-prune.sql
```

The browser client is for Biotron only. The table has `service_name` for the
shared Playtronica direction, but the current intake deliberately accepts only
`biotron` until other tools have their own reviewed event dictionaries.

## Release checks

- `npm run test:telemetry` checks allowlisting, no raw device data, offline
  isolation, origin rejection, D1 write and 90-day prune query.
- `npm run test:biotron` is still the complete source/build/browser gate.
- `npm run candidate:biotron` can only package a clean exact commit. The archive
  includes `_worker.js` and the notice; its hashed `wrangler.toml` sidecar binds
  only preview. The preview guard checks remote `/api/telemetry` readiness.
- A local Wrangler Pages runtime accepted a test POST into **local** D1. Remote
  D1 was zero on 5 October 2026; the later 7 October aggregate readback above
  supersedes that operational count. No phone or DAW pass is established by
  these logger checks.
