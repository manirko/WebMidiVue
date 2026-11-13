# Biotron feedback ledger

Generated from [FEEDBACK-LEDGER.json](FEEDBACK-LEDGER.json) by `node scripts/check-feedback.mjs --write-view`.

30 Sergey records; 11 context records; 29 issues. Snapshot: 2026-11-13.

`software_verified` records software evidence only. Device, hearing and Sergey acceptance remain in the last column. Prior failures are retained.

| Item | Status | Sources (including context) | Remaining |
|---|---|---|---|
| firmware-pr-review: Review firmware through PRs | open | [33601](https://t.me/c/1797899795/33601) | No fresh firmware review is established; the historical source reports no reviews on the proposed PRs. |
| firmware-branches: Tidy firmware main/dev branches | open | [33601](https://t.me/c/1797899795/33601), [33602](https://t.me/c/1797899795/33602) | Repository cleanup remains open and requires coordination with Sergey. |
| firmware-plsdk: Keep PLSDK changes minimal or isolated | open | [33601](https://t.me/c/1797899795/33601) | The PLSDK scope request remains open outside this web task. |
| firmware-led-flag: Define the LED flag in one CMake location | open | [33601](https://t.me/c/1797899795/33601) | No current evidence resolves the duplicate LED flag concern. |
| firmware-board-support: Decide support for A03-A05 boards | open | [33601](https://t.me/c/1797899795/33601) | Board support has not been resolved by the supplied evidence. |
| firmware-led-include: Make the requested include unconditional | open | [33601](https://t.me/c/1797899795/33601) | The historical include review remark remains unresolved. |
| firmware-time-wrap: Handle time_us_32 overflow | open | [33601](https://t.me/c/1797899795/33601) | No verified firmware fix for timer wrap is supplied. |
| firmware-filter-migration: Write defaults during filter migration | open | [33601](https://t.me/c/1797899795/33601) | The migration/defaults remark remains open. |
| firmware-same-note-light: Clarify changed same_note_light behavior | open | [33601](https://t.me/c/1797899795/33601) | Changed semantics remain unconfirmed; no firmware acceptance is inferred. |
| firmware-identity: Identify the board and binary before any write | open | [33678](https://t.me/c/1797899795/33678), [33681](https://t.me/c/1797899795/33681) | Exact A06-A08 board and firmware binary remain unknown; historical BOOT/settings-write blocker is retained. |
| version-timeout: Disable Update firmware after unknown/stale version | software_verified | [33681](https://t.me/c/1797899795/33681) | Sergey must repeat the network/version-timeout case on his real device; Windows/Opera GX and hardware remain unverified. |
| limit4-toggle: Keep generator and keyboard playing after Limit 4 changes | software_verified | [33686](https://t.me/c/1797899795/33686) | Sergey and hearing checks on the real Windows/device setup remain open. |
| default-channels: Default Plant to channel 1 and Light to channel 2 | open | [33687](https://t.me/c/1797899795/33687), [34285](https://t.me/c/1797899795/34285), [34286](https://t.me/c/1797899795/34286), [34299](https://t.me/c/1797899795/34299), [34304](https://t.me/c/1797899795/34304) | Monday real-device check (34286 item 1); confirm 1.8.2 readback and both sensor channels with Sergey. |
| light-sound: Hear Light sensor notes in the built-in synth | open | [33688](https://t.me/c/1797899795/33688), [34285](https://t.me/c/1797899795/34285), [34286](https://t.me/c/1797899795/34286), [34299](https://t.me/c/1797899795/34299), [34304](https://t.me/c/1797899795/34304) | Monday real-device and hearing check with Sergey remains open, independently of the channel-default issue. |
| feedback-form: Offer a clear on-site feedback form in Help | software_verified | [33684](https://t.me/c/1797899795/33684), [34285](https://t.me/c/1797899795/34285) | Sergey must complete the form from his origin and confirm the receipt/outcome. |
| settings-no-plant-music: Remove Plant music from Settings | software_verified | [33689](https://t.me/c/1797899795/33689), [34286](https://t.me/c/1797899795/34286) | Sergey must compare Settings scrolling/performance in his environment and confirm play remains usable. |
| sound-chooser: Reduce Sound to choosing and trying a sound | software_verified | [33691](https://t.me/c/1797899795/33691), [34286](https://t.me/c/1797899795/34286) | Sergey must confirm the simplified flow and hear examples/device sound; prior design praise is preserved as historical only. |
| remove-beta: Remove the beta label | software_verified | [34285](https://t.me/c/1797899795/34285), [34286](https://t.me/c/1797899795/34286), [34299](https://t.me/c/1797899795/34299) | Sergey visual check on the intended build remains open; the original request ID is not supplied. |
| sphere-horizontal: Explain sphere horizontal movement with an axis/control | open | [33685](https://t.me/c/1797899795/33685) | Deferred until after release (historical plan: after 21 November); Andrey/Sergey decision and human review remain open. |
| sphere-space: Explain the sphere Space control | open | [33685](https://t.me/c/1797899795/33685) | After release: agree and review an explanation with Andrey/Sergey, then hear/observe its effect. |
| sphere-vertical: Remove the sphere vertical rotation limit | open | [33690](https://t.me/c/1797899795/33690) | Deferred until after release; Andrey/Sergey decision and real interaction check remain open. |
| W07: Resolve Windows browser freeze on USB unplug | open | [33681](https://t.me/c/1797899795/33681), [33692](https://t.me/c/1797899795/33692), [33804](https://t.me/c/1797899795/33804), [33814](https://t.me/c/1797899795/33814) | Sergey control test remains unanswered in supplied evidence; real Windows Chrome/Edge unplug tests remain open. |
| settings-knobs: Use compact knobs for device settings | software_verified | [34287](https://t.me/c/1797899795/34287), [34293](https://t.me/c/1797899795/34293), [34299](https://t.me/c/1797899795/34299), [34300](https://t.me/c/1797899795/34300) | Sergey must confirm compactness and real-device setting edits/readback; browser layout was not verified in the Codex reports. |
| play-keyboard: Match the Play keyboard drawing and interaction | software_verified | [34289](https://t.me/c/1797899795/34289), [34299](https://t.me/c/1797899795/34299), [34303](https://t.me/c/1797899795/34303) | Sergey visual/hearing review and actual browser/phone behavior remain open in the supplied reports. |
| volume-slider: Keep Volume as the header slider | software_verified | [34299](https://t.me/c/1797899795/34299), [34300](https://t.me/c/1797899795/34300) | Sergey must confirm the slider visually and by hearing; browser layout/PCM were not verified in the report. |
| shared-interface: Match the interface of the other sites | software_verified | [34301](https://t.me/c/1797899795/34301), [34305](https://t.me/c/1797899795/34305), [34307](https://t.me/c/1797899795/34307) | Sergey desktop/phone comparison, browser/fullscreen and hearing checks remain open. |
| visible-connection: Keep connection control and state visible | software_verified | [34301](https://t.me/c/1797899795/34301), [34306](https://t.me/c/1797899795/34306), [34307](https://t.me/c/1797899795/34307), [34308](https://t.me/c/1797899795/34308), [34309](https://t.me/c/1797899795/34309) | Sergey browser/phone inspection and real-device connect/unplug/replug remain open; W07 is still separate and open. |
| feedback-send: Resolve Send feedback missing confirmation | software_verified | [34288](https://t.me/c/1797899795/34288) | Sergey must retry from the affected origin and confirm receipt; end-to-end delivery was not retested here. |
| limit4-policy: Clarify fifth-note behavior at the four-note limit | needs_clarification | [33545](https://t.me/c/1797899795/33545), [33686](https://t.me/c/1797899795/33686) | The linked 33545 policy question has no supplied answer or full message; obtain the intended steal/reject rule. |

Coverage is limited to the supplied snapshots. See JSON for acceptance steps, evidence, outgoing references and gaps.
