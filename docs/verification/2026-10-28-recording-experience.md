# Recording-led experience refinement

Base: `0f59cbc` (public `getyak/leafhour` main). The user requested a detailed recording review, an ordered backlog and implementation. The 195.22-second MOV contains only a video stream; there is no transcript or attributed spoken feedback. Sixty-five sampled frames and the Chinese analysis remain local, outside the public repository.

## Recorded findings and resulting behavior

| Recording | Observation | Result |
| --- | --- | --- |
| 01:12–01:27; 02:42–03:06 | Paragraph tools remain above prose while the reader moves on | Wheel, touch scrolling and reading keys dismiss temporary actions. New pointer selection removes the old tools. Native selected text is retained. Programmatic layout restoration and menu scrolling keep their own behavior. |
| 01:18 | Interface text joins a native selection | Paragraph tools exclude their interface text from native selection. The base stylesheet owns wrapping and 44px targets, independently of audio styles. |
| 01:12–01:27 | Keyboard recovery needs a complete return path | Enter focuses an enabled action. Escape closes More first, then the toolbar and returns focus to its passage without moving the page. |
| 01:33–02:09 | A long historical answer is separated from its quoted source | Historical selected quotes have a source-return link. Same-book navigation uses the existing reader service, focuses only a successfully loaded destination, and preserves the unsent draft. Modifier clicks remain browser-owned. |
| 02:15–02:33 | Paragraph actions coexist with global reading tools | Opening global tools dismisses temporary paragraph actions through the existing coordinator. It does not stop a ready audio player or erase a conversation draft. |
| 00:00–00:12; 00:51–01:03 | The trial card has an ambiguous arrow; the main entry may resume a saved position | The card says “Read this page” in all four interface languages and opens its actual Alice passage. The main read entry retains saved-position behavior. The user then selected a larger Ambi-inspired homepage: centered localized headline, existing reading imagery, real sample, continuity scene, live shelf and ownership/FAQ. |
| 00:15–00:48 | The reference website is visible in the address bar | The actual reference is [Ambi](https://ambi.ai/en). The GET-281 record's tentative ambient-audio interpretation is historical; this is the dated correction. |

No new model calls, data permissions, private-account writes, storage migrations or dependencies. Source text and translation variants retain their identities. The historical quote is a saved snapshot, not a current verified translation or a newly checked model citation.

## Verification evidence

- Baseline placement/toolbar/conversation tests: 35 passed.
- Initial real-browser reproduction: eight checks failed for the recorded scroll, focus, competing-layer and interface-selection problems; programmatic layout and nested-menu scrolling already passed. The invalid assumption that audio CSS is absent was corrected before counting failures: this application currently loads that stylesheet in its shell.
- Paragraph and conversation unit checks after implementation: 249 passed. The three new quote-navigation tests were observed failing before the source link and successful-navigation focus changes.
- First complete Node 22 suite: 4,017 tests, 4,003 passed, zero failed, 14 explicitly skipped local-tool/platform cases. The release verification also passed: runtime build, hosted build, public snapshot, release policy and provenance checks. The final post-review suite is recorded below.
- `tools/verify-recording-experience.mjs` covers actual wheel, native selection, the 120ms delayed capture, reading keys and Shift extension, Enter/More/Escape, global handoff, 320/390/768/1440px in four languages, menu scrolling, real quote navigation with an unsent draft, and the exact homepage sample destination. The final twenty-check receipt passes with no page errors.
- Pinned Vale/textlint copy lint passed, retaining documented existing debt and warnings. Generated inventory is refreshed from this isolated checkout; no ledger bindings or debt exemptions are bulk-refreshed.

The quote-return browser specimen is explicitly labelled local fixture text, rendered through the real chat and navigation UI; it is not a model response or a live service acceptance. Automated auth uses an ephemeral synthetic local account. No source recording frames or browser chrome are published.

## Adjacent backlog disposition

Items 1–6 and 8–10 in the local thirteen-item review are implemented by the changes above. Item 7 uses the existing audio controls: the affected audio-boundary suite verifies playback intent capture, cancellation, follow/return and restoration with isolated media/provider fixtures. It does not prove real voice quality. Items 11–12 retain established reader-entry and missing-translation behavior; the related tests pass and the exact sample entry now has a separate explicit path. Item 13 is the responsive/localized verification and delivery gate. Physical iPhone, Safari, screen-reader speech, live provider audio and longitudinal reader research remain unverified.

The design uses temporary-layer recovery, visible focus and reflow as criteria from [WCAG 2.2](https://www.w3.org/TR/WCAG22/). These checks are scoped implementation evidence, not a complete accessibility certification or evidence of improved reading comprehension.

## Execution ledger

- Task 1: recorded eight failing browser checks, then thirteen passing checks; corrected the stale delayed-capture timer and prevented inactive selections from becoming later audio input. A follow-up reproduced redundant selection-end events while all paragraph tools were hidden; the input handler now does nothing in that state.
- Task 2: historical quote return and deferred destination focus have failing-then-passing tests. Existing owner, book, quote and modifier-key boundaries remain in place.
- Task 3: the user explicitly selected the larger Ambi-inspired homepage. The final narrative uses existing brand illustrations and the actual multilingual sample. Automatic language rotation is disabled on that specimen; its language is user-directed. A public-only stylesheet is registered in the static server and stripped from library documents. Visual readback corrected inherited hero width and a legacy section grid that squeezed the copy. Existing first-visit/resume, translation and audio contracts remain intact.
- Task 4: independent review found one Important focus race. The added delayed-navigation/newer-typing test failed on the reviewed code and passes with the focus-ownership guard. Final full suite, current-head CI and exact Production acceptance are recorded below. The user's standing repository instructions authorize normal commit, push, PR and merge after those gates.

## Independent review and limits

The fresh reviewer independently ran the three changed unit suites (193 passed) and reproduced the delayed-navigation focus theft against the actual module. It is fixed with a focused failing-then-passing regression; the post-fix conversation/chat suites pass 91 checks. There were no Critical findings. The reviewer found no expanded data access or model calls.

The review's minor audio-style test gap is now checked explicitly: a 320px Japanese specimen disables the independent audio stylesheet, then verifies wrapping, 44px action targets and viewport bounds. The final recording-flow receipt has 21 passing checks. Physical selection handles, Safari, screen-reader speech and real provider audio remain unverified. Near-bottom tools have placement-unit coverage; this browser verifier does not establish a separate near-bottom specimen.

[Final browser receipt](2026-10-28-recording-experience/browser.json), [initial failures](2026-10-28-recording-experience/before-browser.json), [homepage](2026-10-28-recording-experience/home.png), [320px tools](2026-10-28-recording-experience/tools-320.png), [source return](2026-10-28-recording-experience/quote-return-390.png).

## Expanded homepage acceptance

The user-selected expansion has eight passing rendered cases: 1440px Simplified Chinese/English, 1100px English, 768px Traditional Chinese, 390px Simplified Chinese, 320px Japanese, 390px Japanese/night and no-JavaScript English. Primary actions remain in the arrival viewport, text stays within the screen, the public stylesheet returns CSS, the sample language buttons work and the actual three-book shelf loads. The initial observation checked stability after a manual Spanish choice. A follow-up checks the untouched, visible and unfocused specimen under ordinary motion settings. With the private-shell network probe this is ten scoped browser checks, not a user study.

The source/translation specimen remains labelled as a reading example. Book and room illustrations reuse the existing documented brand assets; they are not new photography or a screenshot of anyone's saved library. No new media or font dependency was added. The homepage uses the existing palettes and follows the system's night mode.

[Homepage matrix](2026-10-28-recording-experience/home-story-browser.json), [mobile hero](2026-10-28-recording-experience/home-390.png), [reading story](2026-10-28-recording-experience/reading-story.png), [night specimen](2026-10-28-recording-experience/sample-night-390.png).

## Expanded review follow-up

The fresh homepage reviewer found one Important semantic-order issue: mobile CSS moved the explanation above a specimen that still preceded it in document order. A real Tab traversal assertion failed on that version. The document now puts the heading/explanation first and uses named desktop grid areas, so the mobile visual and keyboard order agree. The reviewer found no Critical issue, expanded account data or generated response. Its manual-rotation validation concern is covered by a normal-motion, visible, untouched specimen observation rather than relying on reduced motion or a preceding click.

The expanded first full local run exposed the new stylesheet's duplicate focus/action declarations and its missing release-allowlist entry. Those were fixed using the shared interaction foundation and the existing explicit release manifest; no policy was weakened. The same heavily parallel run also hit HTTP/startup/PDF timeouts. All 42 checks spanning those failures and the affected home/foundation contracts passed with bounded concurrency; the final suite uses bounded workers without concurrent runtime builds.

The homepage-only illustration boundary also receives a network probe. The first probe observed two eager illustration requests from the hidden homepage inside `/library`; the hero images now use native lazy loading. A clean, anonymous library context verifies that neither the public story stylesheet nor its illustration assets are downloaded. This keeps the redesign out of private-library startup. The reproducible homepage matrix is `tools/verify-home-story.mjs BASE_URL OUTPUT_DIRECTORY` with the same browser-module/executable environment seams as the existing browser verifiers.

## Final pre-PR receipts

The bounded full local run had 4,019 tests: 4,003 passed, two failed and 14 explicit local-tool/platform skips. The two remaining failures were a new 11px functional label and a stale Japanese hero-copy assertion. The homepage now respects the existing 12px functional minimum; the localized-entry test checks the new authored heading while retaining locale/canonical/first-paint boundaries. All 49 tests covering typography, shared components, public-shell isolation and initial language entry pass after those fixes. No test policy or assertion about source, privacy or data ownership was weakened. The unchanged remainder passed the full run; current-commit complete CI is still required before merge.

Reader/conversation fixes had a clean complete local run before the homepage expansion (4,004 passed, zero failed, 14 skips). The final public runtime/build/release checks and pinned copy checks are run again on the shipping tree. Actual merge and Production completion are tracked by the PR and the final delivery receipt rather than claimed by this pre-merge document.
