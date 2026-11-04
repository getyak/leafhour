# iPhone experience refinement — November 4

Scope: iPhone app first, minimal shared API/backup compatibility. No model was invoked for these automated checks. Screenshots use isolated synthetic fixtures, never a real user's books or chat.

## Design and implementation

| Group | Result | Acceptance target | Independent reviewer |
| --- | --- | --- | --- |
| Navigation and bounce | Native continuous horizontal paging; existing scroll pan arbitration; bounded vertical bounce; reduced-motion support | Finger tracking, correct tab state, vertical/selection/back coexistence; no accumulating blank space | review_navigation_avatar_share |
| Avatars | Nine bundled DiceBear CC0 illustrations; system photo picker; scoped local persistence, thumbnail decode and metadata removal | Offline default, >=44pt actions, safe cancel/error, owner isolation | review_navigation_avatar_share |
| Reading overview | Disk-first statistics, 30-second warm reuse, concurrent months, independent notebook fetch | Cached path <100ms; invalidate day/timezone/account/reading changes | review_navigation_avatar_share |
| Chat bubbles | User right, assistant left; adaptive fills and selectable Markdown; recurring role captions removed | Readable hierarchy and native selection, keyboard and large text usable | journal_performance |
| Message actions | Native long-press reactions/reply/copy/multiselect; ordered share/forward preview | Stable attribution, cancel/retry, next explicit send conveys validated reactions without triggering a model on marking | journal_performance |
| Long-image sharing | One content-measured image, three editorial treatments, no printed URL, validated QR, opt-in frosted neighboring messages | Full text or explicit size error, exact preview, QR decoding, accessible text review | review_navigation_avatar_share |

Independent final observed-scenario scores: navigation/bounce 9.5; avatars 9.5; overview 9.6; chat bubbles 9.5; message actions 9.5; sharing 9.5. The reviewers inspected actual captures and final test results, then closed the issues found in earlier runs. These are design judgments within the observed scenarios, not statistical user scores or physical-device guarantees. See [navigation/avatar/share review](independent-navigation-avatar-share.md), [journal review](independent-journal.md) and [chat review](independent-chat.md).

## Verification

- LeafhourCore: 353 tests executed, two conditional skips, zero failures.
- Final combined app run: 94 focused app checks passed, zero failures (BookShareCardTests, LibraryRecordsTests, ProfileAvatarTests, ReaderToolsTests, RootTabLayoutTests).
- Journal disk cache published before a held response in 1.539875 ms in the final combined app run (2.056167 ms in the earlier run). Twenty-five warm loads took 0.194917 ms total in the final run. These are simulator model-path measurements, not physical first-frame percentiles.
- Node 22.23.4 complete suite: 4,624 passed, 14 conditional skips, zero failures. The skipped external lint/tool/hardware cases are not claimed as verified.
- CI exposed stale generated copy inventory after the shared reaction module changed. The inventory was regenerated; real Vale 3.24.0/textlint 15.8.0 passed with zero new T1 errors and no stale bindings, and planted-negative copy canaries passed. Existing documented warnings remain visible.
- Production web build passed; the new pure reaction module is included in release files, the retained-backup dependency boundary and explicit server static routes.
- Initial UI runs exposed a fixture-identity setup mismatch, an ambiguous test button query, a real horizontal-gesture conflict and actual floating-tab-bar overlap. Failures were retained and drove fixes; passing functional checks did not override image evidence.
- Final simulator acceptance: six UI cases and three native layout cases passed, zero failures. These cover both-direction paging, gallery selection, repeated bottom overscroll, keyboard/send visibility, dark accessibility-size history, reactions, multiselect, complete action visibility, and three sharing previews.
- Native root keyboard ownership is explicit: validated local keyboard notifications set the hosted viewport; children retain container safe areas only. Real geometry diagnostics proved the nested system guide was stale before it was replaced. Temporary diagnostics were removed.

## Actual image evidence

[Avatar gallery](images/avatar-gallery.png) · [Reading overview](images/journal-overview.png) · [Chat bubbles](images/chat-bubbles.png) · [Complete selection actions](images/chat-multiselect.png) · [Keyboard](images/chat-keyboard.png) · [Large text](images/chat-large-text.png) · [Share preview](images/chat-share-preview.png)

[Paper export](images/share-paper.png) · [Ink export](images/share-ink.png) · [Night export](images/share-night.png)

All images are actual simulator captures or deterministic native exports of synthetic acceptance text.

## Constraints and boundaries

Avatar customization stays on this device and is visibly labeled. It does not upload a selected photo to a service or transmit account identifiers to DiceBear. Artwork provenance, license links and checksums are bundled in AvatarSources.json and AvatarThirdPartyNotices.txt; sources: https://www.dicebear.com/styles/thumbs/ and https://www.dicebear.com/styles/shapes/.

Chat reactions are profile/book scoped. Their authenticated message targets are resolved against saved owner/book/version data only on the next explicit send. No reaction enables tools or expands note permissions. Private chat sharing is an image/text export; its generic homepage QR does not publish or reopen the private conversation. Adjacent excerpts default off and are visible in the preview when explicitly included.

Images retain all selected text up to a safe allocation boundary of 1080 × 18,000 pixels. Larger input offers complete text export with an explicit error rather than silent truncation or extra image pages. Private books without a genuine public/gift link do not fabricate a book QR.

Merge, web production deployment, TestFlight distribution and physical-device acceptance remain separate. This task does not claim tester installation, real-device motion/VoiceOver acceptance or a new TestFlight release.
