# iOS reader, AI selection, time and immersive listening

Work began on 2026-11-02; local acceptance continued on 2026-11-03 (Asia/Singapore). Scope is iOS; the website's reader presentation and manual default timer remain unchanged.

## Behavior

All nine papers tint the reader's control layer. SDK 26 builds use native Liquid Glass on iOS 26; earlier systems and older-SDK builds use material, and increased contrast/reduced transparency use an opaque paper. The quiet footer remains inside the real touchable safe-area bounds. Paged text uses a 4-point top and 48-point bottom budget (eight points more body height than 16/44); awake tools still overlay a stable page. Temporary selection height does not enter the persistent scrolling inset budget.

Native long press keeps system handles/menu and reveals a quote/action dock. Copy, note, translation, sharing and AI remain anchored to the actual selected layer. Both dragging the native selection and dragging its excerpt card into AI open the existing full-height Chat with source attribution. Only one exact current quote is accepted; unrelated/multiple drops cannot impersonate book content. Opening Chat does not submit a question. Narrow actions collapse into a menu, with bounded icon sizes at accessibility text sizes.

A glass time capsule exposes the current session and opens full-height book/date details. Foreground estimate starts by default, with a profile-scoped opt-out; focus timing remains explicit. A newly visible book without a saved viewport can start from its current chapter's first stable passage, without moving reading position. Tools, Chat, listening and backgrounding pause reading time. Explicit pause/finish survive returning to reading. Local intervals and authenticated cloud month totals are labeled separately and never added together; failed reads remain errors. Historic unrecorded time is not inferred.

Listening is a full-screen destination with a sentence stage, actual current-word emphasis, transport, voice and 0.5–5× speed settings. Portrait stacks the stage and transport; landscape places them beside one another. Word callbacks use displayed UTF-16 coordinates and source anchors remain separate. Sentence boundaries are cached only for matching text, and each rendering pass reuses one transcript snapshot. Opening, returning, adjusting speed and choosing a voice do not autoplay; manual scrolling suspends transcript following. Explicit speed endpoint buttons also provide exact minimum/maximum access.

## Local evidence

- Core: 302 tests, zero failures, two declared optional private-input tests skipped.
- App: 275 tests, zero failures, two optional private-source/public-artwork fixture tests skipped. The final layout probes include narrow selection actions, emoji sentence ranges, drop rejection, viewport stability and AX5 reading.
- Host: 91 affected iOS-release/reading-time/summary checks, zero failures.
- Native UI: click-to-Chat, excerpt-card drag, direct native-text drag, manual time pause/history, full-screen listening portrait/landscape, speed endpoints, background pause, AX5 controls and listening/contents navigation are exercised with isolated synthetic books. Existing speech following across chapters, no-autoplay/read pause, persisted speed and tools/time entry regressions also pass.
- Paper verification uses the simulator's actual `simctl ui appearance` light/dark setting, nine papers each. `AppleInterfaceStyle` launch arguments alone do not establish iOS system-dark acceptance.

The original failed probes caught first-open missing-anchor timing, an out-of-bounds footer touch region, inherited accessibility identifiers, offscreen half-sheet history, and multiple automatic Form buttons sharing an action row. Each was corrected before delivery. The native drag test holds briefly over its target to exercise system drop delivery. A reset only touches the dedicated test bundle's synthetic workspace. No real account books, paid AI or third-party account data were used.

Screenshots are actual simulator captures of invented acceptance text, not a physical device or release receipt:

- [Nine-paper light/dark comparison](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/paper-glass-matrix.jpg)
- [Selection and AI dock](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/selection-dock.png)
- [Listening portrait](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/listening-portrait.png)
- [Listening landscape](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/listening-landscape.png)
- [Book/date time](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/book-day-time.png)
- [Native selected text in Chat](../../../apps/ios/verification/2026-11-03-immersive-reader/screenshots/native-selection-chat.png)

Reading-time Chinese documentation was checked with lieflat-less-ai-tone before/after and its 18 semantic candidates reviewed. No whitelist prose rewrite was needed: time notation, actual protocol enumerations and separate technical constraints were retained. Paths, wire source names and numeric limits were preserved. Before/after detection and labeled candidates are retained under `apps/ios/verification/2026-11-03-immersive-reader/tone/`; no private text is included.

## Limits and delivery

Only iOS 26.4 Simulator was used for runtime UI and speech callback acceptance. The repository CI currently builds with Xcode 16.4/SDK 18.5; compiler guards keep its material path buildable, while the SDK 26 release toolchain compiles native glass. Physical touch/haptics, audible hardware quality, full VoiceOver traversal, physical iPad behavior, iOS 17/18 material rendering and TestFlight installation/upgrade are not established by these tests. Cloud month-summary validation reuses the existing authenticated service; synthetic acceptance does not establish a new real-account cloud history audit. Merge, CI, production and Apple processing receipts are tracked separately in the PR and final delivery response.

Apple API references: [custom Liquid Glass](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views), [drag and drop](https://developer.apple.com/documentation/SwiftUI/Adopting-drag-and-drop-using-SwiftUI).
