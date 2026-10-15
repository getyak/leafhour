# Independent review — reading conversation

Final verdict: **approved for merge from independent code and supplied screenshot review**. Both P2 findings below are resolved. The reviewer independently inspected four final browser screenshots; live interaction and full-suite results remain coordinator-supplied evidence. Earlier evidence-limit statements below record earlier review stages and are superseded by the final visual review section. Reviewed complete tracked working diff against public base `6c8985d74ad123a4c3ae98cde8bd5b28e4b89929`, untracked adapter and tests, AGENTS.md, required briefs, implementation plan and approved refined HTML. No source/index/HEAD or production data changed.

## Findings found and resolved

1. **P2 — Nonmodal chat disables reader keyboard interactions.** `app/reader.js:329` returns on every `dialog[open]`. Open chat, focus a passage in the unobscured page and press Enter: paragraph tools no longer open. F and reader Escape also stop working. The chat intentionally remains open while reading, so the formerly modal-only guard is now a persistent keyboard regression. Exclude the chat from the modal guard and separately exclude key events originating within chat/launcher. Related outside-click guard at `app/reader-immersion.mjs:35` should be considered under the same nonmodal contract. Add a meaningful interaction regression.

2. **P2 — Keyboard-sized panel can clip the composer without a recovery scroll path.** `app/library-chat.css:17` sets mobile panel height to visual viewport height minus at least 84px; `app/library-chat.css:7`, `:11`, `:12`, `:13` retain non-shrinking header/context/status/composer/footer and `:9` retains a 60px minimum message area, while root `:5` clips overflow. With a 300px visible viewport the panel is at most 216px tall; coarse-pointer header (~64px), collapsed context (52px), composer (~122px), footer (12px), and message minimum (60px) already require about 310px. The send control is therefore clipped below the panel, even before expanded context or an error. Expanded source content makes this easier to hit. Furthermore the VisualViewport geometry is limited to width <=600px, leaving phone landscape widths outside keyboard adaptation. Provide a scrollable/compact small-height layout with reachable close and send actions, and validate with expanded context and missing-model/error state. Geometry finding is code-derived, not claimed as device observation.

## Fix re-review

- Reader keyboard issue resolved: `app/reader-conversation.mjs:3` now distinguishes nonmodal chat from blocking dialogs/popovers while ignoring chat-origin events. `app/reader.js:329` and `app/reader-immersion.mjs:37` use that shared guard. Inspected the callers and corresponding helper/immersion regressions.
- Compact viewport issue resolved in code: `app/library-chat.mjs:137` enables the compact layout at visual height <=500 independently of screen width. Final compact CSS overrides use visual height/offset, make the whole frame scrollable, keep the header sticky and bound expanded context. Thus composer and close are reachable by scrolling even when fixed sections exceed visible height. Real device interaction still requires parent acceptance.
- Additional quality fix reviewed: message rows now reconcile by owner/book/turn key and content signature; unchanged completed rows remain attached through refresh and another response, retaining citation disclosure state. No new owner crossover or stale source-link closure found.
- Independently re-ran focused UI, reader adapter and immersion tests after all three changes: **21/21 passed**.

## Positive review evidence

- Shared domain state remains unchanged: owner/book-scoped operation tickets, original pending IDs, durable drafts, uncertain recovery, cancel state and bounded polling are preserved.
- Reader adapter uses real session owner guard; session-change response resets chat and redirects; no new auth bypass or external model invocation path introduced.
- Selected paragraph is accepted only while selection tools are active; otherwise a valid visible anchor is used. Sources require current book and a real paragraph before in-page navigation, with ordinary link fallback and modifier-click preservation.
- Nonmodal show(), local launcher, hidden legacy entry, local CSS squirrel, reduced motion, explicit AI attribution, real source/translation states, dark tokens and namespaced typography fit the brief. Latest content-hugging bubble and disclosure-in-menu delta were inspected.
- Input renders preserve message/context/chooser DOM signatures; history scrollTop is preserved away from bottom. IME Enter guards remain. No fabricated answers, dependencies or remote fonts added.
- Adapter asset route and release allowlist are present; no runtime data is included in the reviewed change. Untracked node_modules must remain uncommitted.
- Independently ran only `node --test tests/library-chat-ui.test.mjs tests/reader-conversation.test.mjs`: **14/14 passed**. These use DOM/test doubles and do not establish browser rendering, keyboard geometry or real IME behavior.

## Remaining evidence limits

No browser screenshots or successful live interaction evidence supplied at this review snapshot. Decline to judge pixel fidelity, real mobile keyboard behavior, focus across native modal top layers, actual 200% zoom, platform IME, visual contrast measurement or clipboard/download execution from test doubles. Parent owns full suite, build/public release checks and browser QA. Existing full-suite/HTTP claims in implementation report were not independently rerun. Stable completed nodes are now covered by a focused identity/disclosure regression; actual browser selection preservation has not been observed. Normal drafts persist text only (existing behavior); paragraph binding across a full document reload is not asserted by this review.

## Final integration delta re-review

Read the final CSS and implementation report after parent browser discoveries. No new blocking findings. `dialog.library-chat-dialog[aria-modal=false]` has higher specificity than actual host `dialog:not(.auth-dialog)` surface and field rules; transparent textarea/select backgrounds remain protected. Reader-only dock selectors scope the existing reading tools movement to the page with the actual adjacent launcher, and the -60px panel compensation restores its viewport-edge position. Compact `overflow:clip` leaves only the inner frame scrollable; compact-open launcher visibility rule restores automatically when dialog closes, retaining the explicit close action while open. The entrypoint still uses `readerInteractionBlocked` for page keyboard events and excludes events inside dialogs/launcher; no regression in that guard.

`git diff --check` passed for this final snapshot. Parent reports full serial tests 494 pass / 1 skip, runtime/public build and release allowlist checks passed; these were not independently rerun. Parent also reports actual compact-browser geometry (390×300, outer scroll 0, header top 9px, send 237–269px). This is coordinator-supplied evidence, not independently inspected screenshot evidence. No screenshots were provided/read during this delta review.

Scoped final verdict: **approved from code review; no unresolved code blockers**. Parent remains responsible for recording final browser evidence and completing authorized delivery checks. Do not describe this report as an independent visual screenshot acceptance.


## Final visual review — screenshots independently opened

Independently inspected `chat-reader-desktop.jpg`, `chat-mobile.jpg`, `chat-compact.jpg` and `chat-dark.jpg` with the image viewer. These depict isolated fixture data, not a real account or paid-model execution.

Desktop panel matches the approved small title, secondary book title, pale right-aligned question, unboxed AI response, restrained border/shadow, quiet context line and rounded composer. Reading tools and squirrel have visible separation. The narrow screenshot retains readable wrapping and panel margins with no horizontal overflow. Compact screenshot visibly retains title, more/close controls, composer and send button within the 390×300 image; squirrel no longer covers send, and the inner scrollbar provides the expected access path. Dark screenshot shows coherent panel, bubble and input surfaces with legible main text and secondary labels; no leftover light host-dialog surface is visible. History partially clipped at its scroll boundary is consistent with the captured scroll position rather than a lost control.

No remaining aesthetic or interaction blocker is visible in these four captures. Parent additionally reports actual UI checks for source navigation closing chat while retaining the same /read URL, exact draft restoration, and submission returning a real server fixture answer with source references. Those interaction assertions were supplied by the coordinator, not reproduced by this reviewer. Physical mobile keyboards and real platform IME remain untested; this does not turn the isolated browser evidence into real-device evidence.

Final scoped disposition: **approved**; no unresolved review findings. Screenshot review now supplements the independently passing 21 focused tests and inspected final code. Full suite/build/release validation remains attributed to the coordinator (494 pass, 1 skip plus runtime/public build and allowlist checks).
