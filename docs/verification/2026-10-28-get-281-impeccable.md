# GET-281 implementation and verification

Date: 2026-10-28. Base: `fd16fd3`. Delivery follows the public `getyak/leafhour` repository policy. This record distinguishes implementation evidence from user research and production acceptance.

## Result

Installed upstream Impeccable 4.8.0 / engine 0.1.18 for Cursor at project scope, including reference playbooks and four agent definitions. The binary is checksum-verified, Git-ignored and absent from the runtime allowlist. Root PRODUCT.md records repository product truth; DESIGN.md records the incumbent reader system and the decisions made for this task. No new standing aesthetic preference was inferred.

The reader's launcher shell now sleeps with its controls and cannot intercept text input. A late lazy reading-hub stylesheet had restored its location/hourglass after the early chrome stylesheet; the conflicting rules were removed. Keyboard focus and unread messages reveal the existing conversation entry. The original toolbar owner, timer, edge-click, selection and focus contracts remain in place.

Ordinary mobile conversation takes half the visual viewport with a 360px minimum. Short keyboard viewports retain full-height compact mode. Attaching a real source quote expands the sheet to full height, then removing it restores the half sheet. Embedded annotations use a full-height scrollable frame so their source, answer and composer remain reachable. Answers use the book serif on the plain panel. Source previews, menus and highlight rules lose unnecessary card treatment without changing source content.

The final pass also fixes a circular chat/reader color-token alias that made the guest login action invisible, improves the bookplate contrast, replaces decorative blinking/pulsing with still indicators, clarifies the continuous chapter heading step on mobile, and removes obsolete floating-focus styles to retain the existing 200 KiB reader CSS budget. Protected text, accounts, model context, billing logic and data ownership are unchanged.

## Independent review and fixes

Method: dual-agent critique (A: `design_critique_a`; B: `design_detector_b`) plus independent pre-landing `code_review`. Each reviewer started with a fresh context and their own browser. Original snapshots are retained in [the evidence folder](2026-10-28-get-281/); the 29/40 A score describes its observed intermediate state, not a final score or reader-research result.

- A found the late hub stylesheet conflict and a 501–568px answer-area collapse. Computed-style, short-viewport and packaged-browser regressions now pass.
- B found an actual 1.0:1 guest button. The inherited reader palette now breaks the circular aliases. The real guest action is tested in all five explicit reader palettes.
- Code review found clipping with a real 302-character source quote. The regression uses the actual selection owner and quote action at 844/568/501px; expansion, visible send/answer and removal recovery pass. The adjacent annotation height risk receives a separately named layout specimen with frame scrolling; this specimen is not a saved annotation-service test.
- The hidden touch edges retain a first-use discovery tradeoff from the requested quiet-chrome direction. No claim of improved learnability, comprehension or long-term habits is made.

Questions skipped: the user requested complete design and implementation; all fixes above fit that scope and the repository's standing delivery authorization.

## Verification

- Full local suite: 4,000 tests, 3,986 passed, 0 failed, 14 explicit local-tool/platform skips. Node 24.19 with explicit TAP output avoids the newer default-reporter mismatch in an existing nested-run assertion. The initial Node 26 run also exposed its new network permission behavior in existing startup fixtures; no test was weakened.
- Final Node 22.23.3 (official binary, SHA-256 verified): 98 reader/build/toolbar/chat/location/flow tests passed after the review fixes. Another 52 startup, database, workspace and immersion checks passed.
- Official source detector and rendered scan receipts are preserved below. Primary findings and advisories remain separate; no detector ignores were added.
- Final packaged browser matrix: 1440×900 simplified Chinese/paper, 1200×800 English/leaf, 768×1024 traditional Chinese/paper, 390×844 simplified Chinese/night, and 320×700 Japanese/paper. Short heights 620/568/501, compact 420, quote expansion/removal and annotation layout scrolling are included. No page errors. All page API writes are blocked after synthetic local authentication. No model calls or production account records.
- Existing sidebar acceptance: five sizes/locales, resize keys, desktop reflow, anchor/focus restoration, spread pages and mobile/desktop modality transitions passed.
- Actual guest button contrast is measured separately across paper/warm/mist/leaf/night, with a nontransparent button background required. See `browser.json` for exact ratios.
- Runtime build and public build/release checks passed. Tooling is absent from the release allowlist. Existing copy export, pinned Vale/textlint checks and planted copy canaries passed; no wording debt was silently waived.

Baseline visual loading produces 22 inline-style CSP console messages in B's isolated no-detector run. No new interaction error was observed. The attempted Impeccable overlay was blocked by the existing CSP; no overlay is claimed and CSP was not weakened. Real rendered checks use the official CDP detector instead.

## Design references and interpretation

[Impeccable](https://github.com/pbakaus/impeccable) supplies the requested quieter/distill/critique/polish vocabulary. [Linear's 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) supports letting orientation controls recede and using fewer separators. [Arc's focus guide](https://start.arc.net/find-focus) is a reference for hidden chrome and explicit recovery. The issue's ambiguous Ambi reference is treated as the [ambient mixer listing](https://apps.apple.com/us/app/ambi-green-noise-nature-sound/id6753184615), for background sound and restrained control density; this is a design comparison, not an assertion that the user chose that exact app. No competitor interface is copied.

## Artifacts and limits

[Before](2026-10-28-get-281/before.webp), [plain reading](2026-10-28-get-281/reading.webp), [half sheet](2026-10-28-get-281/half-sheet.webp), [short sheet](2026-10-28-get-281/short-sheet.webp), [quoted source](2026-10-28-get-281/quote-sheet.webp), [guest action](2026-10-28-get-281/guest.webp), [browser receipt](2026-10-28-get-281/browser.json).

Answer/unread/annotation specimens are labelled layout fixtures; the source quote uses the actual reader selection flow. There is no physical iPhone keyboard, Safari, screen-reader speech, live generation or long-term reading acceptance in this task. Chinese progress/final copy is below the tone detector's minimum length and is reviewed sentence by sentence against `docs/writing.md` and the current lieflat-less-ai-tone whitelist; no invented statistics or gratuitous prose rewrites.

Delivery status and the final merge/production receipts are tracked in [PR236](https://github.com/getyak/leafhour/pull/236) and GET-281; this checked-in record is the pre-merge verification snapshot.

## Final detector receipts

No ignore rules. Source scan has zero primary findings; the raw source receipt retains design-token/radius advisories for linked surfaces and the optional weather-texture advisory. Six final CDP passes (desktop sleep/conversation; mobile paper/leaf/night conversation and sleep) each have zero primary findings and zero advisories. The independent B tools pass was held open through native keyboard focus and had zero findings; the final dialog/color/type fixes do not change that tool surface. The final recheck avoids claiming a timed-out tools scan as valid. See `detector-source.json`, `detector-rendered.json` and B's state receipt.

The full suite's 14 local skips include pinned copy-tool paths; the actual pinned tools were then supplied to the independent copy lint/canary commands, which passed. Final reader CSS is within 200 KiB and quiet chrome remains below 4 KiB.

## Integration with current main

After the initial PR CI passed (catalog, native iOS and full test/build job), main advanced to `c9958b72a03b5fe0a7f7d08e16df9ff922ef1ba8` for companion fault observability. It was merged normally without conflicts. Another 61 Node22 reader/build/companion-observability checks passed, both runtime and hosted builds passed, and the full packaged five-size/quote/guest-palette matrix passed again. Current-head GitHub CI remains a merge gate.
