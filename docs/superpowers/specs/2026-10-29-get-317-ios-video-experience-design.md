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

The video does not demonstrate settings content, note editing or a real AI conversation. These are supplementary investigations, not video-confirmed failures. Multi-select download and richer book management may be implemented only after their state/cancellation behavior is concrete; no destructive bulk action is inferred from the comparison application.

## State and navigation

- Shelf: query/filter/sort/layout are presentation state; selection uses stable book IDs. A cloud reading copy and the matching downloaded item appear once.
- Activity: distinguish import, download and upload. Cancellation is offered only while it has a real target; the server accepting an upload cannot be described as rolled back.
- Reader: chrome sleeps on idle/scroll and wakes from existing edges. Normal text taps and system selection retain their behavior. A sheet returns directly to reading; source/notes/AI keep their authorship.
- Records: request outcome is separate from a legitimately empty result, and cached results are identified only when they exist.

## Quality targets and limits

The requested 95/100 design target is a review target across content hierarchy, native behavior, visual legibility, recovery and accessibility, each with explicit acceptance cases. Independent review records findings rather than manufacturing a score. The requested 98% testing target means at least 98% of the agreed executable acceptance cases pass, with zero unresolved critical/high-impact failures; skipped/unavailable cases do not count as passed. Passing simulator or fixture checks does not establish real-device, cloud generation, TestFlight update or full VoiceOver acceptance.

Evidence must identify source revision, runtime, fixture/real-service scope, command outcome and screenshots. Final delivery must distinguish source merged, web production, native build and physical installation.

## References

Apple's [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) supports safe areas, readable measure and adaptation. Consulted 2026-10-29; this is design guidance, not evidence of application acceptance.
