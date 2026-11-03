# Quiet iOS reader interactions — November 3, 2026

## Behavior delivered

The user approved the discussion in this chat and asked to proceed. The default book surface now contains only text: no persistent AI, timer, grip, progress or listening transport. Center tap reveals tools; a real selection reveals its excerpt/actions. Quiet text uses 4/8-point internal top/bottom margins inside system safe areas. Waking controls does not repaginate. Optional persistent progress reserves its scaled one-line height; explicit automatic-page countdown remains opt-in.

Every short contact turns independently, including both contacts of a rapid double tap. Long holds, moved contacts, links, existing selection and multitouch cannot become page turns. System VoiceOver activation is excluded from the custom recognizer. Public native selection handles, menus and PDF pinch remain in place. Navigation settings → More interactions contains the 0–500 ms response delay and optional persistent progress, with immediate/hidden defaults. Both persist in the existing profile-scoped preference file.

Delayed and animation-queued turns preserve order across internal chapter/window changes and book-boundary no-ops. Actual selection, external source/layout changes, hidden reader and backgrounding cancel stale work. A short contact defers due work rather than dropping a tap or moving text beneath a resting finger.

The pending excerpt is fixed above the composer with exact displayed text and source attribution. Removal leaves its captured paragraph visible as current paragraph. New explicit selection replaces an unsent draft quote without discarding the question. Preparation, generation and uncertain retry preserve the submitted quote; a newer pending excerpt is stored separately and survives draft restoration. Saved messages display their own stored quote. The existing translated-selection wire contract remains: the UI labels that sending cites the corresponding original paragraph, rather than pretending the translated string was submitted as original text.

## Reproduction and root causes

- The existing short-tap handler explicitly waited for native multitap/hold failure. Even after removing native multitaps, a hold recognizer can retain its own multitap wait. A real UI double-tap page-count assertion reproduced only one advance. A contact recognizer with duration/movement rules and no such failure dependency makes both advances visible.
- The existing animation queue had one last-value slot, replacing earlier directions. A FIFO now preserves accepted directions, including reverse turns after a boundary and transitions into another chapter/window.
- The old quiet footer kept the timer and AI visible and reserved space after tools hid.
- Quote context lived at the top of scrollable history. A nonempty question preserved an older context, swallowing a new selection. Send preparation and generation also needed separate pending context to keep the visible quote aligned with the immutable request.

Fresh review identified and resolved FIFO boundary/rebase and generation-cancellation details, a due-tap/short-contact race, preparation/generation quote races, base-paragraph display after removal, restored Chat removal controls, and a filtered second-finger case. The final source review reported no blocking findings.

## Local verification

Environment: Xcode 26.4, iOS 26.4 on the already booted dedicated Leafhour simulator. Unsigned isolated app identifier `org.leafhour.quiet.testing`; synthetic books and URLProtocol replies only. No private reading records or paid-model calls were used.

| Check | Result |
|---|---|
| LeafhourCore, full package | 303 executed; 301 passed, 2 skipped; no failures |
| LeafhourAppTests, full target | 284 executed; 282 passed, 2 skipped; no failures |
| Targeted native UI acceptance | 7 passed; no skips or failures |
| Affected host/native release checks | 100 passed; no skips or failures |
| Native build | Included in the successful application/unit/UI build |
| Independent source review | No remaining blocking findings |

Core skips require a separately selected local sample/directory. Native skips require separately selected sample books. They do not establish user-book acceptance. Existing test-harness FocusState/metadata warnings do not represent new success claims or physical accessibility acceptance.

Native UI acceptance covers: pure reading and actual double-tap advancement to screen 3; AX5 quiet/awake/selection controls; selection excerpt drop; direct native selected-text drag; expanded quote with keyboard and removal; listening return/chapter jump without timer/transport; time statistics and pause still available in tools. Unit regressions additionally exercise real TextKit/PDFKit FIFO boundaries, delayed native chapter restoration, contact deferral, cancellation, preference migration/profile persistence, exact Unicode request quotes and suspended preparation/generation with pending selection restored after restart.

Task-owned build, logs and result bundles remain under `/tmp/leafhour-quiet-reader-20261103/`: `core-final.log`, `host-final.log`, `delivery-native.log`, and `delivery-native.xcresult`. Earlier red bundles document the reproduced failures; the final batch is the delivery evidence. The installed signed user app and the separate Tormie simulator were not changed.

## Screenshots

All text shown is synthetic acceptance material.

- [Quiet reading](quiet-reading.png)
- [Expanded excerpt and keyboard at AX5](quote-keyboard-accessibility.png)
- [Excerpt removed; captured paragraph remains visible](quote-removed.png)

## Delivery and limits

This PR changes native source and documentation. It does not change deployment, signing, accounts or the native marketing version. GitHub CI, merge, existing Production verification and automatic TestFlight source/build receipts must be read independently from their actual runs; local unsigned build success does not establish Apple distribution.

Physical iPhone tap latency, real audio, VoiceOver activation, PDF pinch with mixed link contacts, an installed TestFlight upgrade and retained personal data remain separate device acceptance. The native gesture code preserves those boundaries, but no claim of physical verification is made here. Broad paper-theme matrices and unrelated Web flows were not rerun for this native change.
