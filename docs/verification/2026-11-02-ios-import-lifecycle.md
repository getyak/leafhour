# iOS import lifecycle verification

## Scope and implementation

Native iOS local import and explicit original-file upload. Local import remains local to the current account/device scope; this does not silently upload selected books or alter ownership. All automated acceptance uses synthetic material and isolated identities, without production credentials or user books.

The original parser ran on the profile actor. A deterministic slow-extraction regression demonstrated that shelf reads could not complete within 0.5 seconds while extraction occupied that actor. The new cancellable utility worker releases the profile actor during copy, parsing and integrity verification; final package publication and duplicate reconciliation remain serialized. Source retention finishes before acknowledging cancellation so an interrupted job can really retry. Sources, stable IDs, notes and drafts remain intact.

A separate observable progress object limits redraws to a compact shelf row and throttles chapter updates. The row covers source retention, extraction, verification, completion/open, cancellation and failure. Upload displays preparation, transfer, server organization and reading-copy synchronization. No fabricated elapsed-time percentages are used. Completion remains on the shelf and shared-file confirmation dismisses immediately. Account context changes cancel and clear prior operations and titles.

Explicit upload file reads and record matching run away from the main actor. The target reading copy is briefly protected from opening during personal-record migration; if it is already open, migration is deferred with an explanation and the complete source remains. Migration and cloud pull both compare the current stored snapshot before committing, preserving edits made during a network or matching wait.

Book naming prefers usable metadata and meaningful filenames. Placeholder/opaque names can recover from early EPUB headings, explicit text titles, or relative PDF title-font evidence within five pages. Wrapped PDF body lines are not titles. Uncertain names retain the original filename. This is local source extraction, with no AI title generation, OCR or paid model request.

The worker approach follows [Apple's responsiveness guidance](https://developer.apple.com/documentation/xcode/improving-app-responsiveness); async network calls alone do not move synchronous processing off its actor.

## Verification record

- RED: the profile-actor extraction test timed out while reading the shelf. GREEN: shelf reads complete while extraction is deliberately stalled.
- RED: placeholder TXT imported with its generic filename. GREEN: explicit early title recovery preserves all passages and original filename.
- Core coverage includes EPUB/PDF/TXT/Markdown, retained original bytes, cancellation/retry, concurrent duplicate workers, malformed archives, account isolation, PDF wrapped-body rejection and stale migration snapshots.
- App checks include staying on the shelf, logout/expired-session cleanup, monotonic progress, existing cloud activity and reading-time migration, and an already-open target preserving its reader and source records.
- Native acceptance uses the real system Files picker for a small TXT and a synthetic EPUB with 200 chapters / 100,000 paragraphs. It checks shelf progress, search responsiveness, reading an existing book, recovered title, explicit new-book opening and small-file cold restoration. Final command outcomes are added after execution below.

Independent review identified and resolved early completion-button availability, cross-account title retention, stale record writes, cold-start operation locks and PDF prose misclassification. The final review approved the patch; exact-head CI and release remain separate evidence.

## Limits and observations

The initial 100,000-paragraph single-chapter TXT fixture imported and allowed shelf search and opening an existing book, but opening that giant chapter exceeded the 30-second acceptance window. That existing first-opening/rendering limit is not fixed or counted as passing. The multichapter EPUB acceptance exercises a realistic chapter structure without hiding the TXT finding.

There is no connected physical iPhone in this session (`devicectl` reported no devices). Simulator results do not establish physical-device smoothness, Files-provider downloads, background execution after iOS suspension, VoiceOver speech or installation/upgrade. Terminated local imports restore as interrupted jobs with retained sources; indefinite background transfer is not promised. Real-cloud upload and provider processing latency are not certified by the synthetic transport tests.

Final local regression results: `swift test` executed 263 core cases (262 passed, one optional private-source case skipped). The iOS app activity group executed 26 checks across two iterations, all passed. The small system-picker import, shelf completion/open and cold-restoration UI case passed twice. Native release contracts passed 100/100; vendor verification and `git diff --check` passed. The first multichapter EPUB UI attempt exposed the existing picker helper only matching `.txt`; the helper now also matches `.epub`, and its final rerun is recorded separately.

The corrected EPUB system-picker case passed twice, in approximately 31.7 and 29.2 seconds per complete UI case (including launch, arranging the shelf, navigating Files, importing, searching, opening an existing book, returning and opening the new book). These are whole test-case durations, not upload-time claims. Both runs satisfied the under-three-second shelf-search interaction check while the lifecycle row was visible and opened the previous book successfully. Source book: 200 chapters / 100,000 synthetic paragraphs; recovered title: “The Quiet Orchard”. The final multichapter UI result bundle completed with two tests and zero failures.

Visual evidence: [processing with an active search field](2026-11-02-ios-import-lifecycle/processing-search.png), [completed import and recovered title](2026-11-02-ios-import-lifecycle/completed-title.png). The native runner also reported a UIKit `_UIReparentingView` diagnostic; both UI cases passed, but this does not establish a warning-free runtime.
