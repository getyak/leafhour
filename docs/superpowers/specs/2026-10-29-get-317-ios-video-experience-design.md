# GET-317 · iOS video experience review

Status: implementation decisions under the user's explicit autonomous design and delivery request. These are agent decisions, not a claim that the user approved a mockup.

## Evidence and intent

The supplied iPhone recording lasts 240.1 seconds and has a 220 × 480 video stream. All 21,175,938 decoded audio samples are zero. There are no spoken requirements to quote. Local frame extraction sampled every four seconds; closer inspection supports the issue ledger below. The original recording and screenshots contain personal library/record data and stay outside the public repository. The other reading application shown at 01:40–01:56 is comparison material.

Improve the actual native application, keeping reading quiet, original text selectable, notes durable and account ownership intact. One Linear issue, one PR, and a separate commit per resolved problem. Existing implementation and later main changes take precedence over an old recording when an issue has already been fixed.

## Approach

1. Cosmetic changes alone would leave cancellation, overlay and record-state errors intact.
2. Replacing the reader or adopting a new framework would risk stable anchors and duplicate the current native work.
3. Chosen: retain SwiftUI navigation and sheets, UIKit/PDFKit selection and the existing domain services. Improve each interaction in place and test the seams.

No new model provider, full-book translation, notification, cloud deletion, account migration, signing configuration or release switch is introduced. No real user's data is used as an automated fixture.

## Ordered issue ledger

| ID | Evidence | Problem / acceptance |
| --- | --- | --- |
| V01 | 00:04–00:16 | Download dims the whole shelf. Only the active item should show an activity state; downloaded books remain usable. |
| V02 | video + code | A generic cancel action cannot cancel cloud download. Connect cancellation to the actual task and preserve existing copies. |
| V03 | 00:04–00:16 | Download does not identify the book or completed chapters. Show truthful indeterminate/known progress, never an invented percentage. |
| V04 | 01:20–01:32 | A long shelf lacks search. Search title and author with a recoverable zero-result state. |
| V05 | comparison + observation | Add understandable sorting and a local grid/list preference; preserve identity and account boundaries. |
| V06 | observation | Identical leaf placeholders weaken recognition. Use legible title/author cover fallbacks without pretending they are original artwork. |
| V07 | code | Empty authenticated shelf hides synchronization errors. Distinguish initial loading, empty, offline cache and failure. |
| V08 | 00:32, 00:44, 03:08–03:12 + code | Text and top/bottom chrome visually collide. Keep controls legible and first/last lines reachable, including when controls do not auto-hide. |
| V09 | code | iPad lines grow to the entire screen width. Bound the reading measure and keep anchors through resize. |
| V10 | 00:48–00:56 | Contents needs clear current chapter and a useful initial scroll position; navigation must return to the chosen chapter. |
| V11 | 03:16–03:36 | Translation context and variants need a readable hierarchy. Clearly identify the current paragraph, separate draft/reviewed variants and allow long content to be read. |
| V12 | code | Loading/error must not be presented as missing translation, missing introduction or empty conversation. |
| V13 | code | Long conversations place the composer after all history. Keep a reachable composer and latest turn while preserving the default half sheet. |
| V14 | code | Changing speed/voice while paused starts speech. Preserve pause until explicit resume. |
| V15 | code | Cross-paragraph selection can silently fail; unrelated errors offer save retry. Use consistent valid actions and accurate recovery. |
| V16 | 02:20 | Notes show empty books as repeated content. Keep actual notes/questions and give honest empty/error/cache states. |
| V17 | 02:24 | Reading history is dominated by zero-second rows. Prioritize recorded time without changing the underlying data or claiming comprehension. |
| V18 | code | Account record requests fail into a false empty/cache claim. Track request outcome separately from synchronization. |
| V19 | code / supplementary test | Check note editor keyboard, draft recovery, duplicate-save protection and return-to-source. Improve only confirmed friction. |
| V20 | code | Preserve illustration alternative descriptions when an image successfully loads. |
| V21 | supplementary test | Test text selection/copy, middle/edge taps, panel exclusivity, dismissal, theme and Dynamic Type. |
| V22 | supplementary test | Test cold resume, offline integrity, import, cancellation/retry, search, export and account isolation. |
| V23 | supplementary test | Test compact iPhone and iPad adaptation using the existing guarded device pool. |
| V24 | supplementary review | Independent code and screenshot review, with unresolved findings reported explicitly. |
| V25 | independent review + regression | Download/import completion can replace a different book opened while the task ran. Preserve the active reader and finish the background item without navigation. |
| V26 | independent review + regression | Deduplicating a newer cloud copy can hide an older local version and its records. Keep the current copy canonical and older offline versions reachable without migration. |
| V27 | tall-toolbar layout regression | Text anchor capture/restoration must use the actual unobscured top inset instead of a fixed 50-point reference. |
| V28 | PDF page-seam regression | Capture the PDF page under the unobscured viewport probe, including seams in both directions, rather than the stale destination page. |
| V29 | native XCUITest | Text selection must suspend the six-second chrome idle timer to keep existing reading controls stable. Separately exercise both horizontal and expanded vertical forms of the native Copy menu. Cross-paragraph copying remains available without creating an invalid anchored quote. |
| V30 | native XCUITest | Expanded long translations need a direct return to reading, using the same save receipt check as the parent sheet. |
| V31 | native XCUITest + deterministic speech probe | Preserve an explicit pause even if the system rejects the immediate pause request or delivers a late completion callback. |
| V32 | native XCUITest | Keep the book meaningfully visible when the companion composer opens the keyboard, while retaining reachable input and native sheet dismissal. |
| V33 | final independent integration review | Disable native account-link actions during book processing and show failures for already signed-in accounts as well as signed-out accounts. Verify providers were enabled before exercising the busy state. |
| V34 | native menu inspection | Four optional reading actions precede the system editing actions and bury Copy. Keep UIKit's standard editing group first, preserving the original system actions and cross-paragraph copying. |
| V35 | native speech E2E | Multiple automatic-style buttons share one Form row. Make previous/play/next independently actionable, keeping the first passage selected when playback is paused. |
| V36 | native accessibility audit | The library sorting menu exposes a hit region smaller than 44 points. Put the size and hit shape inside the actual menu label and rerun the unfiltered system audit. |
| V37 | independent screenshot review | Reader sheets allow underlying book glyphs to show through their spare areas. Give record/translation surfaces a solid theme-aware background. |
| V38 | independent screenshot/code review | Repeated excerpt words make local notes hard to distinguish. Show their real chapter/passage and saved modification time; keep reopened draft editing inline and omit empty note sections. |
| V39 | supplementary interaction review | A note's return button must not make its entire List row navigate. Keep tapping/selecting personal text independent from the explicit return-to-source action. |


| V40 | native accessibility audit | Shelf author/status captions lack contrast and the long search prompt clips. Use theme-aware readable metadata, include author in the reading action, and shorten the field prompt. |
| V41 | native audit + actual SwiftUI render tests | The typography preview is capped to four lines and a fixed height. Let the real source excerpt grow with both chosen base size and every system text category; make the default state clear without a dimmed reset action. |
| V42 | native AX frame inspection | Visible reader button padding is not the native tap region. Verify at least 44 points for back, companion, settings, chapter navigation and progress. |
| V43 | maximum-type layout review | Five equal dock columns and a one-line title cannot accommodate accessibility sizes. Keep the complete title readable, scroll enlarged tools horizontally and put opaque navigation styling inside the actual panel stack. |

| V44 | independent screenshot review | Five small green action captions are harder to scan than the icons. Use slightly larger medium-weight semantic captions in primary text, retaining leaf-colored icons, and check both normal and accessibility layouts. This does not itself establish the cause of an unlocated system contrast warning. |


| V45 | actual OS AX5 shelf inspection | Decorative mini covers squeeze enlarged book information while title/author limits truncate it. At accessibility sizes give complete text the width, separate secondary actions, preserve a true single-column grid preference, and keep resume metadata readable. |
| V46 | grid action inspection | Explicit grid Read/Download captions expose only their small text bounds. Give each actual button label at least a 44-point target and verify download cancellation, details navigation and opening the real local source in both type profiles. |
| V47 | long-title boundary review | An unlimited enlarged title can consume the reading viewport. Keep navigation bounded to one normal or two accessibility lines, provide the complete title, author, source format and original filename in a scrollable information panel, and allow explicit copying without changing the source anchor. |
| V48 | native test provenance | A rebuilt XCTest runner can still load a cached earlier test image. Isolate each acceptance runner and verify the executed source path, immutable input hashes and actual saved export bytes before accepting its result. This is verification infrastructure, not a video-confirmed product defect. |
| V49 | complete native normal-size regression | The active download Cancel button has a measured 34-point width because its 44-point frame surrounds the Button. Put the real 44-point hit region inside its label, and verify both dimensions and cancellation without publishing an offline copy. |
| V50 | documented build support review | The semantic preview font calls an iOS 26 SDK member inside a runtime availability check, which older Xcode compilers still type-check. Guard the new member by compiler version while retaining the scaled-metric fallback and the documented Xcode 16 build path. A source guard does not establish an actual Xcode 16 build. |

The video does not demonstrate settings content, note editing or a real AI conversation. These are supplementary investigations, not video-confirmed failures. Multi-select download and richer book management may be implemented only after their state/cancellation behavior is concrete; no destructive bulk action is inferred from the comparison application.

## State and navigation

- Shelf: query/filter/sort/layout are presentation state; selection uses stable book IDs. A cloud reading copy and the matching downloaded item appear once.
- Activity: distinguish import, download and upload. Cancellation is offered only while it has a real target; the server accepting an upload cannot be described as rolled back.
- Reader: chrome sleeps on idle/scroll and wakes from existing edges. Normal text taps and system selection retain their behavior. A sheet returns directly to reading; source/notes/AI keep their authorship.
- Records: request outcome is separate from a legitimately empty result, and cached results are identified only when they exist.

## Quality targets and limits

The requested 95/100 design target is a review target across content hierarchy, native behavior, visual legibility, recovery and accessibility, each with explicit acceptance cases. Independent review records findings rather than manufacturing a score. The requested 98% testing target means at least 98% of the agreed executable acceptance cases pass, with zero unresolved critical/high-impact failures; skipped/unavailable cases do not count as passed. Passing simulator or fixture checks does not establish real-device, cloud generation, TestFlight update or full VoiceOver acceptance.

Evidence must identify source revision, runtime, fixture/real-service scope, command outcome and screenshots. Final delivery must distinguish source merged, web production, native build and physical installation.

Native JSON record export currently has no corresponding restore interface. Opening or saving the exporter does not establish restoration in another installation. Keep that capability gap explicit; do not count it as a passed round-trip test.

## References

Apple's [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) supports safe areas, readable measure and adaptation. Consulted 2026-10-29; this is design guidance, not evidence of application acceptance.
