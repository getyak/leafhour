# Recording-led reading refinements

The user requested an ordered review and implementation from a 195.22-second desktop recording. The file has no audio track. Observations must not be attributed to spoken feedback. Raw recording frames remain local because browser chrome can contain personal information.

## Intent and evidence

Preserve the book-first paper reader. Temporary controls must yield when the reader resumes reading; historical conversation must retain its actual source and a way back. The recording shows paragraph controls remaining over prose while scrolling (01:12–01:27, 02:42–03:06), interface text joining a native selection (01:18), a long answer separated from its source (01:33–02:09), and multiple tool layers (02:15–02:33). Current Production reproduces the scroll persistence. Homepage changes are conservative unless the user selects a larger redesign.

The reference visible at 00:15–00:48 is https://ambi.ai/en. This corrects the tentative ambient-audio interpretation in the historical GET-281 verification record. Borrow the sequence of concrete scenes and clear type hierarchy; do not infer approval of every animation or copy its interface.

## Approaches and decision

1. Refine existing owners: keep native modules and current paper system; correct interaction lifecycles, quote navigation and the homepage's real trial. Recommended and used for repairs already authorized by the user's implementation request.
2. Rebuild the homepage around a larger scene sequence: potentially clearer storytelling, but a separate visual direction and more imagery. An optional preference question is pending; it does not block the reader repairs.
3. Replace the reader shell/framework: rejected; it adds migration risk without addressing the observed lifecycle bugs.

## Contracts

- Dismiss paragraph tools on deliberate reading input: wheel/touch outside tools or their nested menu, scrolling keys outside editable/overlay controls, and dragging another selection. Also dismiss on actual page scrolling, but preserve a focused toolbar and an actively extended native selection. Programmatic layout restoration must not cancel the open action. Never clear the browser's native selected text as a side effect of dismissal.
- Escape from a focused paragraph tool returns keyboard focus to its selected passage without scrolling. Escape from a nested menu closes that menu first and returns to More. Pointer dismissal does not steal focus.
- Base paragraph controls wrap without depending on audio styles, use 44px minimum targets and keep menu scrolling inside the viewport. Controls cannot join native book-text selections. Retain missing-translation facts and generation scope/cost disclosures.
- Global reading tools and paragraph tools are alternative temporary layers. Opening the former closes the latter; dialog handoff and active audio keep their existing ownership.
- A saved, attributed quote receives a real source link from `quote.bookId` and its first `passageId`; use existing `sourceLink` navigation and its modifier-key behavior. Same-book navigation preserves draft text; mobile closes the conversation before returning. Historical text remains a snapshot, not a verified current translation or a source newly read by the model.
- Preserve valid source selection, per-book positions, translation identities, guest behavior and all four interface languages. No new model calls, account writes, dependencies, framework or storage migration.
- Homepage uses actual public source and existing translations. Explain the trial through visible actions; do not invent an answer, claim a generated result is real, or turn a read-only example into an automatic generation action. Existing progress must still resume accurately.

## Verification

Reproduce before fixing using an isolated local server and synthetic account/public Alice. Test page scrolling versus nested-menu scrolling, native drag/keyboard selection, Enter/Tab/Escape, global-tools handoff, quote source return with an unsent draft, guest behavior, short/narrow viewports, audio clearance and source-return position. Inspect 320/390/768/1440px, four languages, paper/night and reduced motion. Run affected tests, copy export/lint and release builds, then required full CI. Report actual Production source and separate merge/deploy/browser acceptance. Physical iPhone, Safari, real provider audio and screen-reader speech remain separate unless actually tested.

## Ordered checklist

- [x] 1–4: temporary paragraph controls, native selection, responsive targets and keyboard return.
- [x] 5–6: historical quote return and temporary-layer coordination.
- [x] 7: verify audio departure/return and clearance; repair only reproduced failures.
- [x] 8–9: conservative homepage trial hierarchy and concrete reading process.
- [x] 10: correct the Ambi reference with this dated evidence.
- [x] 11–12: verify first trial versus resume and missing-translation disclosure; repair only reproduced failures.
- [ ] 13: responsive/localized verification, independent review, CI, merge and Production acceptance.

## User-selected homepage expansion

During implementation the user explicitly selected “参考 Ambi，较大幅度重做首页叙事与版式”. This supersedes the conservative-home assumption above. Keep the completed reading fixes and enlarge Task 3 into a visual narrative with a centered headline, asymmetrically placed existing book/reading-room imagery, a real multilingual sample, continuation/ownership sections and the live public shelf.

Design tokens retain the product system: paper `#faf9f5`, ink `#292a25`, muted `#6b695f`, forest `#3f594c`, panel `#fdfcf8`; night inherits the existing palette. Use the incumbent book serif for the central statement and source text, system sans for controls and explanatory copy. No extra fonts, media dependencies, invented quotes, testimonials, progress numbers or model answers. The images are existing documented brand illustrations, not screenshots of saved reader data.

Layout: a centered statement framed by two unequal image crops; then a split source/translation specimen and explanation; then a continuation section with a large page detail; then the actual catalogue and ownership/FAQ. Mobile puts content in reading order, removes decorative orbit imagery and keeps the real sample controls. The heading and prose remain readable without animation or JavaScript. The sample's four language controls are user-directed; its true-source link remains the separate explicit entry. Existing library pages must not download the new homepage stylesheet or mount homepage motion.

The deliberate distinction from Ambi is the book as the constant object. Section scale and image placement explain entering, pausing and returning to it; no capability is inferred from Ambi's marketing. Verify actual desktop/mobile/no-JS/night outputs and all four localized documents before delivery.
