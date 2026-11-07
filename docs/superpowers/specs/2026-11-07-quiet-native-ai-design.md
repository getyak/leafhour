# Quiet native AI in reading and listening

Approved direction: the user selected a ready marker only, opening the corresponding answer full screen, and explicitly requested design and implementation on 2026-11-07.

## Experience

The book remains the primary surface. An AI affordance stays available while reader chrome sleeps. A short tap opens the book's existing conversation full screen. Holding starts voice capture with a haptic and a small recording indicator; release sends, an upward slide cancels. Permission preparation must never send after the finger has already left. VoiceOver has explicit recording and finish/cancel actions.

Freeze the book, source version and actual selected/visible quote at capture start. Keep original audio and transcript using the existing account-bound voice store. Do not overwrite an unsent chat draft, silently discard a recording, send an empty transcript, or create another conversation. Submission and generation live outside the chat view's lifetime. Reading, paging and sleeping chrome continue throughout preparation/generation. A submitted run remains recoverable through its existing persisted request identity. A failed/uncertain request has a distinct quiet recoverable state rather than a false ready mark.

Only a successfully saved answer gains an unread mark. Completion never opens UI, wakes navigation, plays audio, or moves the book. Tapping opens a full-screen existing conversation positioned at this answer. Mark it read only after that target is displayed; returning preserves the book and listening state. Replies for another book/account must not appear here. Reduce Motion replaces breathing with a static indicator.

Listening exposes the same AI affordance at the bottom trailing edge. Starting recording temporarily hands the audio session to the microphone. Resume only a previously playing session which is still paused at the captured position, with no intervening interruption, navigation, remote command or manual playback change.

## Listening controls

Separate navigation visibility from transport expansion. The existing five-second idle policy hides navigation/settings only. Transport stays visible until its own down arrow is used. Make transport visually compact while retaining at least 44-point hit targets. A collapsed transport leaves a visible mini strip with pause/resume and an expand action. Both actions receive touches independently of transcript seek gestures. AI stays available in all combinations. Explicit collapse survives pause/play and settings changes; automatic chrome changes never rewrite it. Support portrait, landscape, small windows and accessibility sizes.

## Architecture and choices

Keep account/book conversations and existing voice, pricing, idempotent retry, provenance and local-reading tools. Add a reader quick-question controller for capture/async orchestration, an independently testable visibility state for listening, and a shared AI affordance. Persist quick-question target/read state alongside the existing conversation draft so returning/relaunching can reconcile the original request. Full-screen presentation must be independent of the listening navigation destination; it must not replace the listening panel state.

Alternatives considered: automatically exposing a half-sheet was rejected by the user; putting voice capture in the chat composer retains the original interruption; keeping one visibility flag for playback/navigation hides the only pause control. Full-screen answer-on-demand and independently collapsing controls are selected.

The existing Live Activity extension may show a content-free leaf for a user-started request. It is a status surface, never an execution host. Do not add APNs credentials, a background microphone, provider changes, private-note access, paid automation, whole-book uploads, or cross-conversation search. Background time is finite: retain/reconcile original requests instead of claiming unlimited device execution. Device-local tool calls need the device running; suspension cannot be described as completed. A server-push transport is separate infrastructure and is not claimed in this delivery.

## Acceptance

- Capture can finish/cancel while permission/loading is pending without a late start or send.
- Current quote remains pinned across reader navigation; chat drafts survive quick capture.
- Completion creates a quiet mark, never navigation; errors and uncertain outcomes stay recoverable.
- Opening a target full screen and returning does not seek, restart or reset listening.
- Idle hides navigation only; manual collapse leaves usable pause/resume/expand controls in all layouts.
- Account/version changes, interruptions, rapid actions and relaunch do not produce stale publication or duplicate sends.
- Record unit, simulator/build, UI, physical-device and publication evidence separately. No real provider request is needed for synthetic acceptance.
