# iOS local-book AI and immediate chat — 2026-11-03

## Implemented

Local books in the active iOS book library can use the existing account-bound model service without uploading the original or adding a cloud-library book. Read-only context, outline, paged chapter and search tools execute on the device. The authenticated service retains the official DSH runtime and billing; relay calls/results are bound to owner, request, call, book and source version. Citations describe device-supplied material, not cloud-verified books. Requested text reaches the model service. Private notes, arbitrary files and other books are unavailable in this local scope. Image-only source pages need extracted text.

Send immediately publishes the outgoing message and clears the submitted draft. Provisional answer text streams into one assistant response area. Unknown outcomes retain the immutable request and billing key; later edits and recording receipts survive recovery. Tool reconnects work while the original runtime is alive; process termination/expiry is an interrupted outcome, not an automatic new model generation.

The native Chat removes routine scope/identity/refresh clutter and duplicate composer quotes, keeps one meaningful response/recovery state and uses the smaller system subheadline style with Dynamic Type. Markdown parsing/layout is cached. The reader stays mounted while covered, and local state saving reuses an index only while its size, modification date and inode match. Corrupt or replaced indexes invalidate it. Durable state/time saving remains required before shelf dismissal.

## Verification

- Full Swift Core suite: **324 tests, 2 skipped, 0 failures**. Includes split Unicode NDJSON, missing-terminal failure, transport owner checks, local paging/search/citation boundaries, missing translation layers and index-cache invalidation.
- Full native application-unit suite on iOS 26.4 Simulator: **295 tests, 2 skipped, 0 failures**; Xcode reports TEST SUCCEEDED. Includes actual streamed local tool requests through the native transport, restored pinned context after moving pages, optimistic send before authentication, same-text later drafts, voice restoration, uncertainty-safe retries, Markdown selection/cache and retained reader view.
- Final server affected set: **151 tests passed**. The first full host run had 4,606 tests: 4,590 passed, 14 skipped and two release-allowlist failures. Both release regressions were repaired; subsequent local-chat/release/local-instance set: **24/24 passed**. The entire host suite was not repeated after the packaging-only repair.
- Native navigation UI test: **1/1 passed** using the allowed isolated synthetic application identity. It opened local-book Chat, returned to reading and the shelf, then reopened with the draft intact. An initial run used the ordinary development identifier outside the fixture allowlist and timed out before arranging the scenario; the isolated rerun passed.
- Hosted web build passed. Independent review identified three native P2 issues (frozen tool context, later identical draft, preflight voice recovery); regression tests reproduced each and the fixes passed scoped rereview.
- Native synthetic chat snapshots cover ordinary and accessibility text sizes. These are simulator application-host snapshots, not physical-device screenshots or an installed TestFlight build.

[Standard text](2026-11-03-ios-local-ai-chat/chat-standard.png) · [Accessibility text](2026-11-03-ios-local-ai-chat/chat-accessibility.png)

## Delivery boundaries

At source commit, remote CI, merge, exact-source production checks and the automatic TestFlight workflow remain pending and will be reported in the PR/chat. No preview deployment is created. No real account book, private note, original file or recording was used as a fixture. Physical installation/upgrade, audible microphone playback, VoiceOver and end-user return latency remain separate device acceptance. No real local-book provider completion is claimed by the scripted integration tests.
