# Independent review: navigation, avatars and long-form sharing

## Current conclusion — accepted in the observed scope

Final independent review: **group 1 navigation/bounce 9.5/10; group 2 avatars 9.5/10; group 6 single-image sharing 9.5/10**. No unresolved blocking finding remains in these observed simulator/artifact scenarios. The historical gesture conflict, keyboard/container regression, opaque context plates, avatar newer-intent race and accessible chat-preview gap are all resolved and rechecked. Group 3's independent performance/visual conclusion is **9.6/10** in [the journal review](independent-journal.md).

The final acceptance run `/tmp/leafhour-experience-acceptance.log` reports **3 layout tests and 6 actual UI tests passed, zero failures**, including all three chat cases and all three root cases. The reviewer independently inspected that log and the actual keyboard, multiselect, overview and settled-bottom screenshots from its exported attachments. These are scoped agent design judgments, not human-study results, physical-device frame measurements or full VoiceOver acceptance.

Reviewer: `review_navigation_avatar_share`, independent of these implementations.
Scope: design groups 1 (horizontal navigation and bounded elasticity), 2 (avatars), and 6 (single-image editorial sharing).

## Evidence boundary

Initial pass inspected the task specification, implementation plan, complete diffs, RootTabPager, ProfileAvatar, NativeBookSharing, ChatSharePanel, NativeBookLink and their authored tests. Three actual bundled PNGs were viewed at native size (Thumbs 0, Thumbs 3, Shapes 1). Test authorship is not a passing result. Simulator interaction, exported raster inspection and test results are pending at this initial pass. No final 9.5/10 score is asserted from source inspection.

## Historical initial findings — actionable items resolved

- P2, avatar selection intent race: while a selected photo is loading/processing, curated presets and Restore default remain enabled. A later preset/default action can be overwritten when the earlier photo task finishes. Disable all choice-mutating controls while processing, or fence photo completion with a selection revision. Existing account fencing and cancellation checks are sound; this finding concerns newer intent within the same profile.
- P2, QR destination wording: chat exports deliberately encode the generic app homepage, while the renderer labels all QR codes “扫码，继续阅读”. Distinguish homepage branding from an actual book/gift continuation link so the image does not imply that scanning retrieves the selected private conversation.
- Verification gap: the authored root gesture test covers completed drags, but does not yet establish short reversal/cancel, rapid taps during dragging, deep navigation back priority, horizontal text-selection coexistence, or repeated bottom overscroll returning to a stable edge.
- Verification gap: long-form image export is synchronous on the main actor. Bound allocation and explicit failure protect completeness, but representative long exports need a measured duration and actual raster inspection before responsiveness can receive full marks.

## Design assessment before runtime evidence

| Group | Mechanism that supports the brief | Required evidence before score |
| --- | --- | --- |
| 1. Navigation and bounce | Native UIPageViewController tracks drag and velocity; native tab items retain selected semantics; page endpoints do not wrap; only the pager is disabled on a pushed route. Shelf/journal request native vertical elasticity without custom accumulating offsets. | Actual short/long/cancelled drags, tab synchronization, bottom overscroll release, pushed-route back, narrow/landscape and Reduce Motion. |
| 2. Avatars | Bundled playful Thumbs illustrations are readable and distinct at small sizes; Shapes provides a quieter alternative. Real artwork has been inspected. Owner-derived namespaces isolate device/account choices; photo decoder downsamples, corrects orientation and removes GPS before local persistence. | Gallery/account screenshots, actual preset restore/relaunch, system photo cancel/error, new-intent race fix, large type and VoiceOver focus. |
| 6. Sharing | A single measured 1080px raster replaces chunking; full selected text is retained or export fails explicitly; title/citation/QR have measured separate regions; QR has integer modules and four-module quiet zone. Three palettes share an editorial grid. | Actual exported paper/ink/night rasters, long CJK/emoji example, QR decoding and export time, explicit context preview/output match. |

Rubric for final evaluation: task clarity 2, responsiveness 2, hierarchy 2, control/recovery 2, accessibility/consistency 2. Unobserved criteria remain pending. The requested 9.5 threshold is an iteration target, not evidence.

Artwork provenance was independently checked against the official [Thumbs style](https://www.dicebear.com/styles/thumbs/) and [DiceBear artwork license inventory](https://github.com/dicebear/styles/blob/main/LICENSE.md), which identify Thumbs and Shapes as DiceBear CC0 1.0 work. This check concerns the illustration licenses, not the application's software license.

## Fix verification (source)

The photo-choice race finding has been addressed: curated presets and Restore default are now disabled during the photo task. The generic homepage QR now reads “在 Leafhour 阅读”; actual content/gift QR codes retain “扫码，继续阅读”. Both changes were re-inspected in the owning source. Runtime and image verification remain pending.

## First raster and test inspection

Independently viewed the actual unit-test export `78BEEF82-9B3B-4C7E-8CF9-A37B69AD3E8B.png` (public reading link). Its complete mixed Chinese/English body, long title, long author and QR occupy separate clear regions with no visible clipping or overlap; the actual URL is absent from printed text. The uniform left axis, restrained rules and quiet paper palette support the reading purpose. A possible aesthetic refinement is to use the app's bundled Chinese serif rather than system fallback for a closer Chinese/English typographic relationship.

The first context raster `AA2B22A2-B86C-404F-99F6-5834276DB016.png` contains dark opaque context plates rather than readable frosted excerpts. This is a blocking visual defect for the context-sharing subfeature despite the green functional tests. The controller identified and is correcting the blend behavior; this initial raster is not accepted as a finished design.

`/tmp/leafhour-experience-unit3.log` records 91 passing selected app tests, including four avatar cases (real downsample/GPS removal, relaunch/owner separation, invalid-photo recovery, all artwork bundled) and QR decoding cases. These observations establish the listed mechanisms, not physical-device photo permissions or final aesthetic quality.

## Packaging and test-identity follow-up

Inspected the final `release-files.json`, `server/portal.mjs` and retained-backup public-file graph changes. Each adds only the public, pure-data `app/chat-reactions.mjs` dependency on a fixed whitelist path. No runtime book data, credentials or broadened account permissions enter the public graph. The module has no reverse import of `portable-chat.mjs`, so the new dependency does not introduce a circular import.

The additional `org.leafhour.experience.testing` fixture identity remains behind `#if DEBUG` and the explicit fixture/XCTest gate. Its reset is still restricted to the named `GET317Acceptance` child of that test application's Application Support directory. The production app identity cannot opt into this fixture factory.

## Corrected visual pass

Viewed the corrected exported paper raster `8201597E-10DB-4637-AF57-5E783E677CB0.png`, night raster `C413FC37-4C58-44E1-9E39-0F7FCD773DA3.png`, and live share-preview screenshots `5F2B9118-1883-461C-93E1-7746B5884FA3.png` / `28A71682-EE43-4EE0-B431-3995FE364C20.png` from `/tmp/leafhour-experience-visual-attachments/`. The opaque context defect is fixed: adjacent excerpts are softly blurred inside fine outlined plates, the selected passage remains crisp, and the preview's explicit context switch explains what will be exported. Style controls remain above the long preview; the primary Share long image action stays reachable. The paper and night outputs retain the same hierarchy and a clear QR quiet zone. No new blocking sharing defect was observed.

The avatar gallery screenshot `B79A1BBE-E0C8-42C0-8906-13326CFE7FA0.png` confirms generous 4-column targets, a distinct selected ring, a matching large preview and clear photo/default choices. The failed test at completion is an ambiguous “Done” query matching more than one sheet toolbar, not a demonstrated failure of preset selection; the selector and selected-trait assertions had passed before that query. A unique top-sheet identifier was requested for reliable final verification.

## Historical navigation runtime defect — resolved

The actual second left drag, from Squirrel toward My Reading, remained on Squirrel in screenshot `36F7B63A-357B-4100-AC4F-08ED7AF4C4C9.png`; the overview never appeared in the UI test. This is an acceptance blocker for group 1. The first shelf-to-Squirrel drag had succeeded. The unconditional SwiftUI DragGesture used to fold the chat composer is a concrete suspect because it can recognize a horizontal drag before the ancestor native pager. The controller was advised to move iOS 18+ folding to native scroll-phase observation and, for iOS 17, observe the existing UIScrollView pan without adding another recognizer or replacing its delegate. Merely adding a directional check inside onChanged would occur after recognition and is not sufficient evidence of a fix.

## Accessible preview parity follow-up — resolved

P2: NativeBookSharePanel exposes full selectable text in a disclosure, while ChatSharePanel initially exposed selected main content only through an image whose accessibility label says it is a preview. The adjacent excerpts have separate text, but the selected subject's actual words and author attribution cannot be reviewed in the final sheet using VoiceOver. Requested a matching, initially collapsed full-text/attribution disclosure in ChatSharePanel. This is a functional accessibility improvement that preserves the visual composition.

## Observed-scenario scores after fixes

The final gallery screenshot `5DD4AD80-9F79-4537-B7AD-56575B70CF43.png` confirms the same clear selection design, and the current avatar interaction test now passes with the correctly scoped Done query. The latest app run passes 92 selected app tests. The current root interaction run passes gallery selection, both-direction paging and repeated bottom overscroll; the latter asserts that further swipes settle to the same boundary within 3pt.

Scores are this independent reviewer's design judgments over the observed simulator/artifact scope, not human-study measurements or blanket hardware acceptance:

| Group | Clarity /2 | Response /2 | Hierarchy /2 | Control and recovery /2 | Accessibility and consistency /2 | Score /10 |
| --- | --- | --- | --- | --- | --- | --- |
| 2. Avatars | 2.0 | 1.9 | 1.9 | 1.9 | 1.8 | **9.5** |
| 6. Single-image sharing | 2.0 | 1.8 | 2.0 | 1.9 | 1.8 | **9.5** |

Avatar clarity and hierarchy are supported by actual gallery/account screenshots, persistent selected state and bundled resources. Recovery/control is supported by failed-photo retention, atomic scoped persistence, restored defaults and the resolved newer-intent race. The photo-crop mechanism and GPS removal were exercised by app tests; a real photo-provider interaction was not.

Sharing clarity/hierarchy is supported by actual long public-link output, corrected paper/night context rasters and live style/context preview screenshots. The selection remains crisp while optional neighboring excerpts recede; no bare URL competes with the text. QR decoding and complete-text tests passed. The explicit safe-size failure retains the complete-text alternative. Accessible text-review parity was re-inspected after the disclosure was added. Full VoiceOver speech and performance of the largest allowed bitmap on older hardware remain untested; the score does not award those missing observations.

**Historical checkpoint, superseded by final acceptance:** Group 1 remained pending at that point: native paging and bounded overscroll pass, but the later native-container safe-area change caused three chat keyboard/composer regressions in the final integration run. A completed navigation review must include that integration fix and passing keyboard/composer checks before this group can be accepted. The prior passing gesture run alone does not override the newer regression.


## Final group 1 closure: keyboard, paging and bounce

The native root now owns keyboard occlusion exactly once; its separately hosted children use `safeAreaRegions = .container`. The root receives local keyboard frame/hide notifications only while its view is in a window and it owns the first responder, or while clearing its own previously tracked frame. It converts screen coordinates through the current window before intersecting the root bounds, preserves the native tab bar's position, and animates the content constraint with the keyboard's timing plus `beginFromCurrentState` and interaction enabled. The observer captures the controller weakly and is removed at deinitialization. This is UI geometry only: it does not read account records or message text, make network requests, alter data ownership, or broaden permissions. No multi-window/owner authority issue was found in the inspected handling.

Actual final screenshots inspected:

- `0E879045-268E-415B-9B55-C3B33F8DB09A.png`: the growing composer, microphone and send action remain fully above the real system keyboard, with a small clear gap and no floating-tab overlap.
- `ABD11786-3E66-4F3A-91D4-015C7938A176.png`: selected-message checkmarks and Copy / Share actions are clear and fully reachable above the tab area; reaction state remains attached to the message.
- `1266B883-09AF-46C8-8495-79CF6861BEBD.png`: the real seven-day overview appears after horizontal navigation with the correct My Reading tab selected.
- `517B0B12-2982-461D-A867-E21C7F5DBE7F.png`: repeated bottom overscroll settles with the final note/date retained and no accumulating empty region.

All four come from `/tmp/leafhour-experience-acceptance-attachments/`. The same final run passed actual native Markdown submission with the keyboard, large-type dark-chat latest navigation, reaction/multiselect/share, avatar return, both-direction root paging and repeated vertical boundary settling. Three layout tests separately cover the measured native tab boundary and keyboard-frame intersection/contraction/restoration. The former safe-area/keyboard blocker is therefore closed by newer integration evidence, not by relying on an earlier passing run.

Final observed-scenario group 1 score: **9.5/10** — clarity 2.0, response 1.9, hierarchy 1.9, control/recovery 1.9, accessibility/consistency 1.8. Native continuous paging and correct selected tabs support wayfinding; real keyboard and multiselect screenshots support safe control placement; the repeated-boundary assertion supports bounded return. Physical 120Hz touch feel, iOS 17 runtime, every rapid reversal combination and complete VoiceOver speech remain unverified. Those limits are retained rather than presented as tested scenarios.
