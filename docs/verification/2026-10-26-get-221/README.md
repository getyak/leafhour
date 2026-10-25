# GET-221 verification

Base: public `getyak/leafhour` main `b6afebd453135acdfba2d614462a9de966ed8c39`. The isolated task checkout retains GET-219 interface-language behavior and GET-220 chat, overlay guard and bounded-send recovery.

## Source and reproduction

Native Linear MCP read back GetYak workspace `8c969130-4eed-4049-85f9-ae04796db4be`, GET team and the complete GET-221 description, relations, comment and resource attachment. Only GET-221 is in scope. GET-194, GET-222 and GET-225 are related work, not completion targets.

The old `35d4e66` object, `fix/reading-hover-dismiss`, `/tmp/leafhour-reading-hover-20261025`, and specified patch/report files were absent from the current host and isolated Git objects. Current Linear Resources contained the CTA screenshot, not the old patch. Consequently this delivery cannot claim byte-for-byte recovery or review of that original patch. It applies the fully recorded delta incrementally to the existing state machine and tests; it does not import a shared dirty tree or replace the reader.

Chromium 153.0.8010.12 on the actual local `/read?book=gutenberg-alice` page reproduced the defect at 1440×900: 800ms after moving to the AI sibling or body the card remained expanded with opacity 1, and hovering also opened navigation. Initial behavior tests were 29/29, demonstrating that the old suite missed these cases.

## Contract and red/green evidence

The card-only hover preview uses a 200ms gap allowance and 180ms closing transition. Explicit activation adds navigation and retains the existing five-second idle rule. Editing, keyboard use, text selection, in-flight pointer gestures and actual child overlays protect active work. Close, chapter/fullscreen changes and unmount release stale holds. The same coordinator owns state, timer, ARIA, inert and both surfaces.

New regressions use the actual `mountReaderTools` + `mountReadingToolbar` + `mountReaderImmersion` composition. The missing-beforetoggle checks parse production HTML and use its real Audio/Manual/Prompts/Drafts opener relationships, rather than giving a fake pill a control relation. Red evidence includes preview exit/AI boundary, card-only reveal, gap reentry, mouse focus, complete/cancelled/right/scroll gestures, window/chapter cleanup, pointer cancellation, remount, card selection, child-layer dismissal, mixed input, fullscreen exit and preview ARIA. Focused reader/evidence tests: **64 pass, 0 fail, 0 skip**; the final independent reader/Share combination is **87/87**.

Independent reviewer `/root/get221_review` reproduced the child-popover double-dismissal in actual Chrome native and forced fallback branches, then confirmed one outside action and retained outside focus after repair. The reviewer also found the real-opener compatibility and preview-ARIA defects; both received failing regressions and fixes. Final independent rerun: **87/87**, all findings closed, no unresolved P0/P1/P2. Reviewed source/test diff SHA256: `a9e2af62a125e5fcd7396064edd2da6350662568403fbe8dcf3a40e5400c2209`.

Additional real browser checks found and fixed these boundaries before acceptance:

- A window-focus clock render rewrote unchanged pill text between touchend and its compatibility click, suppressing that click. Repeated identical toolbar updates now preserve the target node. The actual native sequence first lacked a click and remained closed, then included the click and opened correctly; a node-identity regression also failed before the fix.
- Trusted WebKit touch events used pointer ID 0, followed by a compatibility mouse click with ID 1. An immediate outside-close probe failed despite one target action and correct outside focus; waiting for the five-second idle timeout would have hidden the defect. Only a matched, released touch gesture receives that compatibility exception; cancel, inside origin, movement, overlay and unmatched-release guards remain tested. See the related [WebKit issue](https://bugs.webkit.org/show_bug.cgi?id=282988) for the pointer-type compatibility history; the local trace, not that issue, establishes the observed IDs.
- The old 14px transparent card-gap pseudo-element overlapped the AI button's top 4px. A native hit test first returned `reading-tools-panel`, then the AI entry after removing that invisible hit area. The existing 200ms grace now handles the gap alone. Every matrix cycle checks the AI entry's upper hit area.

- A late fullscreen event for an already-rendered state could close freshly reopened tools. Only a real state transition now closes the coordinator; delayed duplicate notification leaves the new user action intact.
- At 768px a selected passage toolbar intercepted the actual Book info button. Placement now measures the visible header's real bottom and reruns only the existing tool placement after a committed tools show/close. Selection and anchor do not need a global scene-layout event.
- A trusted continuous Chromium touch pan generated pointer cancellation and then scrolling; the card closed after five seconds even though scrolling continued. Actual card scrolling now renews explicit activity through the original timer. Passive layout scrolling cannot promote a hover preview. The native 6.4-second red/green trace and the final matrix retain this distinction.

The browser close assertion is bounded to 750ms, preventing idle concealment from substituting for a click/Escape transition. Native details consume the first Escape, then a second closes parent tools. One superseded task-owned WebKit process, PID 60131, was verified by start time, parent and task working directory and ended with SIGTERM; the harness then closed its own server in `finally`.

The fixed public reader asset budget initially rejected the added interaction code at 329,545 bytes. Pure Share canvas layout now loads only on opening Share, through one exact allowlisted dynamic edge. Existing Share state, font loading, cancellation checks and public module remain; budgets were not raised. Relevant build and Share tests: **27/27** before the final full checks.

## Browser and engineering evidence

The local full suite is **3429 pass, 0 fail, 1 skip (3430 total)**. The one existing skip is the Linux-only modified pinned-Node-license test on macOS; all three native PostgreSQL ledger/subscription fixtures executed successfully. The first full run's one Share VM failure remains in `logs/full-tests-red.log`: the fixture had not provided the new dynamic layout import. The adapted fixture loads the real module, still asserts real drawing, and verifies no layout loading while fonts are pending or on locale-only changes. Relevant reader/Share/build verification then passed independently 87/87.

Runtime construction and offline initialize/close verification passed with **928 traced files, 9,404,531 bytes**, without copy tooling or model requests. Public build, release allowlist, source provenance and pricing checks passed. The JavaScript bundle is **325,641 bytes / 327,680 budget**; CSS is **200,367 / 204,800**. Real pinned Vale/textlint and all **11 copy canaries** passed. Generated copy inventory changes only refresh source fingerprints and locations; all 4,849 candidate values are unchanged. After committing these generated files, export reproducibility is checked against the committed tree.

The actual built `read.html` and hashed reader bundle were served with the real local API. Both engines requested the lazy Share model on opening and exported validated **1080×1350 PNGs**; this is recorded in `browser/built-share.json` and the media directory.

Core replay produced **160 cycles and 320 timed exits**, including 20 AI exits and 20 body exits per engine/width. Close-state and hit-area release maxima are below 225ms; complete visual exit is at most **415ms**, including the 200ms grace and 180ms transition. Every case matches the same engine/version main-console baseline, with zero new console errors, zero forbidden model/reading-record writes and zero hover progress writes. See the full per-frame `browser/core.json`, the summary and 12-second clips.

| Engine | Width × height | Cycles | Timed exits | Maximum complete exit |
| --- | --- | --- | --- | --- |
| Chromium 153.0.8010.12 | 1440 × 900 | 20 | 40 | 401.7ms |
| Chromium 153.0.8010.12 | 768 × 900 | 20 | 40 | 401.8ms |
| Chromium 153.0.8010.12 | 390 × 900 | 20 | 40 | 400.6ms |
| Chromium 153.0.8010.12 | 320 × 900 | 20 | 40 | 400.1ms |
| WebKit 26.6 | 1440 × 900 | 20 | 40 | 415ms |
| WebKit 26.6 | 768 × 900 | 20 | 40 | 400ms |
| WebKit 26.6 | 390 × 900 | 20 | 40 | 401ms |
| WebKit 26.6 | 320 × 900 | 20 | 40 | 400ms | The replay tool `tools/verify-reading-hover.mjs` serves the actual local reader with isolated synthetic identities and public catalog content, real browser pointer/keyboard/touch events, per-frame timing, transition events, hit testing and ARIA/inert observations. It never sends a model job. Local synthetic acceptance is separate from Production.

The initial listener comparison detected Playwright's first-use hit-target listeners, including `__playwright_global_listeners_check__`; the staged baseline records the first completed interaction and compares it with the twentieth. Initial and final raw counts remain in the machine report. A mobile chat modal correctly blocked a locator's attempt to hover the covered pill; the probe now moves the native pointer to its coordinates and verifies the covered tools remain closed. These harness failures are not reported as product passes.

## Delivery boundary

The read-only pre-delivery check found Production still at `8b9838ddeab579c6a050021216785ef383635f87`, while main `b6afebd...` had Vercel failure `Deployment rate limited — retry in 24 hours`. No retry, Preview, project/provider/account switch or paid upgrade was initiated. Matching Production and online acceptance remain required before GET-221 can be Done.

Resource checks began with 62.44 GiB free, 10.87 GiB swap and 103 Node/npm processes. Tests and browsers are serialized. Existing Node, dependencies, Vale and WebKit are reused. GET-220's registered PostgreSQL directory had been removed and no retained engine/archive was found; the official Postgres.app 16.15 image was obtained once into this task's registered artifact, image checksum and application code signature verified, and mounted read-only. Its SHA256 is `2689dc64d6a02e0a66e4585616919060d8fbf5bb06886fccc05b7f87638bf081`. Only disposable local databases are used; no iOS simulator, production data write or model generation is used.

## Evidence limits

WebKit 26.6 collapses the native Selection when keyboard focus enters header navigation on both frozen main `b6afebd` and this change. A direct base/current trace preserves the same exact excerpt and anchor offset. The verifier permits only that version's empty native selection; different nonempty selections fail, and exact saved excerpt, chapter, passage, anchor offset and scroll remain required. Copy is exercised before focus leaves the native selection; this proves a native copy event, not OS clipboard bytes.

Chromium continuous pan and pen events use the browser's trusted CDP input pipeline, not physical hardware. WebKit's installed driver exposes native taps; its continuous scroll/cancellation supplement is explicitly labeled DOM scrolling and injected pointer cancellation. Window/document listener counters do not claim to inventory every element listener. Actual remounts also check the single toolbar timer. Public Alice has no glossary terms, so this run makes no live glossary-opening claim.

The core tool adds one clearly labeled outside-action input to check target click delivery and native focus. It serves the unchanged actual reader page and APIs; the extra input is a test target, not a product control. Built Share acceptance separately serves the real generated HTML and hashed bundle bytes, waits for the lazy model request, and saves/validates a real PNG.

The final stricter boundary matrix (`browser/boundaries.json`) passed 20 rounds in all eight cases, plus 20 real controller remounts per case. Exact excerpt, chapter, passage, anchor offset (under 2px) and scroll are checked. Reduced-motion hover exit is under 300ms in every case. All actual Manual openers retained the tools without delivered dialog beforetoggle; actual chapter changes, native fullscreen enter/exit, denied fullscreen restoration and saved Share PNGs passed. Chromium also passed 20 trusted pen hover/explicit open/close rounds and the continuous 6.4s trusted touch-pan case. `logs/review-receipt.md` records the independent review and `source-fingerprints.json` binds source bytes to these checks.

Repository plain-text log copies trim trailing whitespace only; `log-normalization.json` records the original and stored SHA256. Original local run logs remain available. Machine JSON and media are unchanged. The two archived helper sources (`*-replay.mjs.txt`) retain their original task paths; restore under `.symphony/` and choose a registered output to replay them.
