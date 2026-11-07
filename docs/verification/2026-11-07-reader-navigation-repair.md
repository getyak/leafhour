# iOS reader navigation repair, 2026-11-07

This follows the user's correction after #347: the AI affordance follows the menus. Reading/listening/contents must not leave blank transitions or lose the menus on return.

## Implementation

- One reader window owns reading/listening mode and the shared contents drawer. Listening no longer pushes a second system navigation destination or toggles the system navigation bar. Its header is inline.
- The original TextKit/PDFKit view remains mounted. Native visibility/accessibility and outer hit testing are explicit. TextKit interaction is updated directly; PDFKit keeps its internal gesture tree. The listening view retains its browsing/playback-control state while its visual subtree is absent from reading.
- The contents list and navigation background follow the book paper. Opening/closing the drawer restores the originating mode and visible controls. A listening chapter target remains separate from the source reading anchor.
- AI appears with the menus, stays visible during capture, and hides when those menus sleep. A completed answer never wakes the menus. Full-screen reply routing and independent mini-player collapse remain supported.
- Reading time, auto-page and foreground reading preparation require the reading surface. The review found and closed a missing reading-mode guard that otherwise resumed reading time after pausing listening.

## Evidence and limits

Baseline: the visibility regression failed because AI stayed hittable with sleeping chrome. A local listening-switch observation took 3.339 seconds including XCTest action/polling overhead and sampling; it is not a measurement of app CPU latency. Main-thread sampling was mostly idle. The short synthetic book did not consistently reproduce the user's large white glitches, so this change removes the conflicting navigation/material path without claiming that every physical-device symptom has been reproduced.

During implementation, SwiftUI opacity left duplicate accessibility controls and a nested hosting-controller experiment intercepted native hits. Both experiments were discarded; neither is in the final production implementation. The PDF matrix then reproduced a freeze in `PDFView.isUserInteractionEnabled` (a three-second main-thread sample, repeated after guarding same-value setters). The final PDF implementation avoids changing that property; it updates coordinator lifecycle/cancellation first, then changes native visibility and accessibility only when needed. That failed candidate is not counted as a pass.

An older task simulator twice failed to pair the in-app XCTest host with testmanagerd before any suite began. Those interrupted runs are not passes. Dedicated fresh iPhone 17 Pro simulators run iOS 26.4 with Xcode 26.4 and the isolated `org.leafhour.quiet.testing` bundle. Synthetic text, translated text and real text-layer PDF fixtures are used without cloud accounts, paid AI requests or runtime book data.

## Current local verification

- Source contract tests: 246 passed, 0 failures (`node --test tests/ios-*.test.mjs`).
- Node suite: 5,178 passed, 14 skipped, 0 failures (`npm test`).
- Full native app suite: 453 tests, 2 skipped; 2 tests fail with 5 assertions. Both failures were reproduced unchanged in a separate source snapshot of baseline `7a6896aa` on a fresh simulator. They concern obsolete paged accessibility labels (`下一屏`/`上一屏` versus current `下一页`/`上一页`) and missing-translation Markdown caption/quote mapping. This is not an all-green native-suite claim. No test was deleted, muted or changed to hide these failures.
- Isolated PDF regression passed after the lifecycle fix. It goes to the real second page, verifies its rendered source marker using system OCR, enters listening/contents and returns to the same rendered page with accessible menus. PDFKit can refit by a few pixels when shown again; the PDF check asserts actual page content rather than binary PNG identity. Text reading separately checks exact body PNG preservation.
- Final affected native suites: 218 tests, 1 skipped, 0 failures across fourteen suites. Ten-flow interface matrix: nine passed in the final batch. The night-paper flow failed in setup because the test resolved an absent text reader to a PDF query before the book opened; the helper now waits for a native reader before resolving its kind. The night-paper and PDF flows then both passed in the targeted rerun (2 tests, 0 failures, `TEST SUCCEEDED`). All ten flows therefore have passing evidence on the final production code; the original failed batch remains recorded rather than being described as all green. No application implementation changed after the 218-test pass.

Local diagnostic recordings, process samples and xcresults remain under `/tmp`; they are not source assets and are not product acceptance on a physical device. No TestFlight upload, App Store release or production deployment is performed by this repair.

## Review

A separate read-only review examined the final six production files. Its reading-time finding was fixed and rechecked. It also reviewed the PDF re-entry evidence and final lifecycle ordering; no open high-confidence P1/P2 remained. Reviewer observations do not replace test results.

## Reproduction

Source contracts and the Node suite use the commands above. Native builds use `apps/ios/Leafhour.xcodeproj`, scheme `Leafhour`, `-parallel-testing-enabled NO`, `LEAFHOUR_BUNDLE_ID=org.leafhour.quiet.testing`, `CODE_SIGNING_ALLOWED=NO` and a dedicated simulator destination. App suites: ReaderTools, ReaderQuickQuestion, ReaderInteraction, ReaderImmersion, ReaderLayout, ReaderResourcePosition, ReaderPagination, ReaderBottomBar, ReaderSelectionState, ReaderViewport, ReaderVisiblePage, ReaderAutoPageController, ContentsSearchApp and FollowUpRouting. Full suite names end in `Tests`.

The ten `ImmersiveReaderUITests` flows cover menu/AI visibility, text mode/contents return, night paper, PDF page return, accessibility XXXL, exact saved-answer targeting, full-screen AI return, live/paused/mini player state, idle listening chapter choice and reading-time pause on listening jumps. Fixtures contain invented text only.

## Hosted CI timeout repair

The first hosted run, [42389033493](https://github.com/getyak/leafhour/actions/runs/42389033493), passed Core tests and the arm64 app build, then exceeded the existing 30-minute native job limit while compiling the x86_64 simulator app. The job annotation explicitly reports `The job has exceeded the maximum execution time of 30m0s`; the log ends during Swift compilation, before card assertions. Its cancelled simulator step and failed CI gate are not counted as passes.

The native job limit is raised to a bounded 45 minutes on the same `macos-15-intel` standard runner. All existing tests, both architecture builds, serial execution and evidence uploads remain. No new runner class, token, permission, paid capacity, cache or publish path is introduced. The repository is public; standard hosted compute is free under [GitHub's documented policy](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow change conservatively selects all existing CI areas. Final current-head results are tracked on the PR.

The timeout-only follow-up passed all four CI resource-plan/gate tests and the repository-pinned actionlint v1.7.12 over every workflow. A separate read-only review found no new P1/P2 in the bounded deadline change. Application implementation and its local 218-test/ten-flow evidence remain unchanged.
