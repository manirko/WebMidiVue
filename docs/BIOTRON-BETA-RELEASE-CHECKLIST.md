# Biotron Settings beta — release checklist

> Historical reference only. Current release gates and cadence live in
> `~/Projects/Playtronica/product-experience`; use
> `./product-loop brief --product biotron`. The candidate's generated
> `PHYSICAL-TEST.md` is the only current hardware checklist.

This beta is shown to selected owners from a dedicated beta origin. It is not
published into the Playtronica production account or production service-worker
scope. A test deployment, customer email or Help draft never authorizes a
production merge.

## 1. Freeze and verify one candidate

- Record the branch and commit; keep the unrelated working tree clean.
- Run `npm run audit:web` and `npm run test:biotron` from that exact commit.
- Confirm `npm run test:production-isolation` passes.
- Build with an explicit visible `VUE_APP_BUILD_ID` matching the commit.
- Build the general customer candidate with
  `VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED=true` (12Oct owner request); its output
  must contain no firmware directory. The updater offers only newer verified
  public stable releases; physical firmware acceptance remains separate.
- Deploy only to the isolated beta Pages project and save its immutable URL.
- Confirm the remote response includes `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, the beta
  `Permissions-Policy`, `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex`.

## 2. Physical acceptance

- Complete `BIOTRON-BETA-COMPUTER-15MIN.md` on the owner's real computer.
- Complete the Android or iPhone/iPad branch in
  `BIOTRON-BETA-PHONE-15MIN.md`; do not convert emulation into hardware proof.
- Attach the exact reports to the candidate. A fix creates a new commit, build
  and URL, and reruns the affected checks; evidence does not transfer silently.
- Android stays experimental unless the exact phone combination passes. Normal
  iPhone/iPad browsers stay unsupported even when the responsive layout passes.

## 3. Align claims before inviting anyone

- Update README, tester instructions, email copy and Help from the accepted
  evidence. Separate “layout works”, “Sound works” and “USB Settings works”.
- Verify every firmware/CC statement against the current firmware source.
- Run `./help check --full`. Keep Help changes in draft/review until a human has
  verified the physical claims.
- Confirm the beta page names a reply path and build revision, and promises only
  the response rhythm the team can maintain.

## 4. Audience and sender gate

- In Shopify, select owners of the exact Biotron product, then retain only
  customers whose email marketing status is `SUBSCRIBED`. Do not infer consent
  from a purchase alone.
- Remove refunded/cancelled orders, duplicates, staff and anyone already
  participating. Keep the exact query and resulting count in the release
  record; the product ID must come from Shopify, never from a guess here.
- Send from Andrey's authenticated Playtronica address. Check the sender domain
  status in Shopify before any test send; changing DNS needs separate approval.
- Use `BIOTRON-BETA-INVITATION.md`. A draft or preview is not permission to
  send. Confirm the final count, subject and body immediately before sending.

## 5. Controlled release, not production

The 1 October 2026 evidence snapshot makes the channel boundary explicit. The
first two email waves delivered 90 messages, with 49 opens and 5 clicks, but no
substantive email reply. In a separate ten-person WhatsApp test, 4 of 5 people
given a contextual permission request replied, compared with 1 of 5 who
received a task immediately. Those groups were small, non-random and had
different asks. Treat both results as recruitment evidence only; neither
validates a product build.

Use a relative clock so an approval delay or code change cannot make the plan
silently stale:

1. **D0 — exact preview and physical acceptance.** Deploy one immutable
   candidate to the isolated beta origin. Complete the computer report and the
   applicable phone/negative-path report. Any code change resets D0 and creates
   a new URL and build ID.
2. **D+1 — micro-cohort of 3 engaged owners.** Ask permission first. After yes,
   give each person the same exact build, one task and one one-line outcome
   choice. Do not use another email blast as a substitute for this cohort.
3. **D+2 — review before expansion.** Classify every exposure as `helped`,
   `partly_helped`, `did_not_help`, `not_tested` or `unknown`. One reminder is
   allowed after 24 hours; silence never becomes success. Expand only when all
   three are resolved, at least two completed the task successfully, and there
   is no P0/P1 or repeated ambiguity.
4. **D+3 to D+6 — expansion cohort of up to 7 new owners.** Preserve the build
   and primary task. Choose people from directly relevant product history and
   cover the supported Windows/macOS browser paths before experimental mobile
   combinations. Stop and iterate when two people hit the same blocking step,
   or immediately for destructive settings, firmware risk or connection loss.
5. **D+7 — synthesis.** Send participants a short human update describing what
   changed, what is still being investigated and what will be tested next. A
   reply, open, click or successful firmware update alone is not a completed
   end-to-end test.
6. **Earliest D+8 — production decision, never automatic publication.** The
   exact unchanged candidate needs at least eight completed primary-task tests
   across the target Windows/macOS paths, at least six `helped` outcomes, no
   open P0/P1, no unresolved repeated blocker, aligned Help/compatibility
   claims and 72 hours without a candidate change. Any unmet gate starts
   another beta iteration; it does not lower the threshold.

Uploading the 30-customer list to SendPulse or another mail provider is a
separate transfer of customer data and needs Andrey's explicit authorization at
the moment of transfer. Preparing code and copy is not that authorization.

## 6. Go/no-go record

```text
Branch / commit / immutable beta URL:
Automated full gate: PASS / FAIL + timestamp
Computer physical report: PASS / FAIL + exact configuration
Android physical report: PASS / FAIL / NOT RUN + exact configuration
iPhone/iPad negative-path report: PASS / FAIL / NOT RUN
Help check + human claim review: PASS / FAIL
Internal seed: PASS / FAIL + replies reviewed
Shopify segment query + subscribed count:
Sender-domain status + preview checked by:
Micro-cohort: HOLD / 3 USERS + exact build + exposure times
Micro evidence: helped / partly / did not / not tested / unknown / P0 / P1
Expansion cohort: HOLD / UP TO 7 USERS + exact build + exposure times
Expansion evidence: helped / partly / did not / not tested / unknown / P0 / P1
Candidate unchanged since:
Production publication: HOLD / EXPLICITLY APPROVED
Owner and date of decision:
Known limitations included in invitation:
Rollback: stop invitations and retire this beta URL; production remains untouched
```

Public production release is a later decision, not an email wave. D+8 is the
earliest possible review point, not a promise to ship. Publish to everyone only
when the recorded gates above pass and production merge/deploy is explicitly
authorized. Otherwise reset the relative clock for the next exact candidate
instead of weakening a gate or carrying evidence across builds.
