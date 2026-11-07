# Quiet native AI and independent listening controls

Date: 2026-11-07, Asia/Singapore. User approved ready-marker-only, full-screen answers and implementation in the same chat. Design: [spec](../superpowers/specs/2026-11-07-quiet-native-ai-design.md); [plan](../superpowers/plans/2026-11-07-quiet-native-ai.md).

## Delivered behavior

- A separate AI affordance remains usable when reader navigation sleeps. Hold to record, release to send, slide up to cancel. Permission preparation cancelled before release cannot start recording later. VoiceOver offers explicit start/finish/cancel actions.
- The book, edition and actual source/selection are captured before permissions/network awaits. Sending does not open Chat, move the page or wake reader navigation. Existing account/book conversation and idempotent request paths are reused; unrelated composer text, voice and reply references survive.
- A saved, nonempty completed answer lights an unread marker. No automatic panel or answer audio is presented. Tap opens the corresponding answer full screen. Actual answer visibility acknowledges the mark; returning preserves reader position and playing/paused/collapsed listening state.
- Original audio and frozen context first enter the account-local pending-capture outbox, before checking current auth or restoring other drafts. Failed retention/auth exposes recovery/export. The manifest contains book identity and the captured paragraph, not another whole-book copy. Existing voice receipts and transcript drafts remain independent.
- Listening navigation/settings can sleep while playback stays visible. Only the player's own down arrow folds transport. A mini strip provides direct pause/resume and a separate expand button, with independent hit targets. Native text/comparison regions are clipped away from controls. Portrait, landscape and accessibility-size layouts retain operable playback controls.
- Microphone handoff resumes only the original, unchanged playing reader. Manual commands, navigation, interruptions and replacement audio owners invalidate automatic resume. Finalizing one recording cannot replace its handoff with a second hold. A recorder which never acquired audio, or whose playback ownership was superseded, cannot deactivate the newer reader's audio session.

## Verification

Environment: Xcode 26.4, iOS 26.4 Simulator, dedicated `Leafhour Quiet AI` simulator. Existing allowlisted unsigned test identity `org.leafhour.quiet.testing`; application deployment floor remains iOS 17. No fixture allowlist was relaxed. Synthetic fixtures use isolated account/profile data, intercept every network destination and call no real model, OCR or cloud-book service.

| Check | Observed result |
|---|---|
| `npm test` | 5,191 tests; 5,177 passed, 14 skipped, 0 failed |
| `swift test --package-path apps/ios/LeafhourCore` | 426 tests; 2 skipped, 0 failed |
| `node --test tests/ios-*.test.mjs` | 246 passed, 0 failed |
| `node tools/check-module-boundaries.mjs` | Passed; 15 module files and 49 Agent dependency files checked |
| Affected native app tests | 108 passed, 0 failed, including retention-only intent and retryable write failure |
| Targeted native UI tests | 6 passed, 0 failed; 112 native tests in the original UI run, followed by 108 app tests after recovery-only fixes |
| `git diff --check` | Passed |

The native run includes `ReaderQuickQuestionTests`, `ReaderToolsTests`, `ReaderInteractionTests`, `ReaderImmersionTests` and `FollowUpRoutingTests`. UI cases cover quiet AI/full-screen return, exact saved-answer targeting and read acknowledgement, player/navigation independence, comparison/native selection, rotation/speed/pause and accessibility text size.

Actual simulator captures from that run (all content is synthetic): [saved reply opened at its target](2026-11-07-quiet-native-ai/saved-reply-fullscreen.png), [compact playback](2026-11-07-quiet-native-ai/compact-player.png), [collapsed player with direct pause and expand](2026-11-07-quiet-native-ai/mini-player.png).

Regression evidence:

1. Same-turn `start -> release/cancel` reproduced two microphone-start failures before the task ownership guard was added; its test now passes.
2. A second reader claiming shared audio reproduced the old reader stealing playback; ownership-generation regression now passes.
3. The pending-capture API first failed to compile because it did not exist. Its account isolation, original-byte retention, removal and library recreation tests now pass. An app-level auth-failure/relaunch test restores an indexed original without sending any request.
4. Manual mini-player collapse initially failed UI acceptance. Recorded simulator frames showed native comparison content overflowing behind transport; clipping, opaque controls and distinct transport/accessibility lifecycles fixed it. The repeated UI run passed.

The first UI attempt used the default development identity, which deliberately cannot seed synthetic books, and failed before reaching a book. It was not counted as acceptance. An optional whole-app-test-bundle attempt later stalled before any test paired with the simulator daemon; the process sample showed the main run loop idle and daemon readiness remained false. That attempt was interrupted, the task's simulator restarted without deleting data, and all 106 affected native tests passed on the next run. The broader app bundle is not claimed as passed.

## Independent review

A separate read-only reviewer identified permission-task ownership, failed-recording recovery, replacement playback ownership and repeated-hold handoff issues. All four were addressed with regression coverage. The final review then found two recovery-path issues: inferring send consent from nonempty transcription, and treating the same voice's failed draft save as a foreign pending capture. Both reproduced in two tests (three assertions failed before the fixes). Pending manifests now preserve original send intent (missing legacy intent means retain-only), and same-capture retry repairs persistence and revalidates or restores the retained original before removing staging. A regression also deletes the retained copy between failed save and retry, then verifies the exact audio bytes are restored. Subsequent checks also keep pending-capture manifests bounded and avoid repeated read acknowledgements while scrolling. No model-generated value changes account scope, source ownership or pricing authorization.

## Boundaries and publication

- This delivery uses the in-app status/ready marker. No AI ActivityKit/APNs transport, push credential, new notification permission or server-driven island update was added. Existing listening Live Activities remain independent.
- Background allowance is finite. Original request identities and account-local drafts survive uncertain delivery; reopening reconciles saved results, and explicit retry uses the same request. Device-local reading tools still need the device to run. No unlimited suspended execution is claimed.
- Physical microphone quality, first-use permission gestures on hardware, Bluetooth route changes, real-provider timing, prolonged lock-screen suspension and TestFlight installation have not been accepted in this run.
- No production database writes, private books/notes, paid provider requests, manual deployment or Apple upload were performed. Git/CI/merge state is reported separately in the delivery; code merge is separate from app distribution.

The initial PR CI run was cancelled after final recovery review identified required fixes, to avoid finishing checks on a superseded commit. A single follow-up commit carries the combined fixes; its current-head CI remains the merge gate. The six UI flows and screenshots predate only these recovery-path changes, not a later layout change.
