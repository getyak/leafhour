# GET-356 · Native reading verification

[Issue](https://linear.app/getyak/issue/GET-356/make-ios-reading-resume-quietly-and-page-turns-feel-smooth) · 2026-11-01 · iOS Simulator on shared Apple M4 host

## Result

Startup selects the most recently read book after refreshing the account shelf and reconciles its position before constructing the reader. Ordinary remote progress no longer interrupts the active page. Displaced pending positions are retained in account/book-scoped recovery files. An explicit device choice remains protected if the remote revision advances again, including a later background pull.

The default short slide reuses the live native text/PDF surface and one old-page snapshot. Curl and instant presentation remain available; tap+swipe, swipe-only and tap-only are independent preferences. The slide commits after the gesture; it does not track the finger interactively. Reduce Motion uses instant presentation. Content/typography identity excludes behavior-only settings. Covers hide asynchronous chapter/layout restoration; repeated input coalesces one direction, and background/resize cancels stale completion. Selection/copy, link priority and PDF zoom remain native.

## Final local checks

| Check | Observed result |
| --- | --- |
| Core | 236 tests, zero failures |
| Native App tests | 225 executed, 1 skipped, zero failures |
| iPhone UI | 6 tests passed: shared navigation/cold resume, auto-turn background pause, presentation/input persistence, side taps, PDF boundaries/cold resume, native long-press copy |
| Host iOS/CI-contract checks | 104 tests passed |
| Independent code review | Confirmed sync-intent, stale queue and selection findings fixed; final static review found no remaining P0/P1 |
| iPad UI | Not run: session wrapper rejected starting the auxiliary device while an already borrowed primary Simulator remained booted; no other session was shut down |

The skipped App test requires a declared real public artwork fixture (`ReadingLayersAppTests.testActualPublicArtworkDecodesAndTheCoverViewDrawsItsImage`). It is not counted as passed. Early App checks exposed off-scene snapshot fixtures and waits tied only to the old curl controller; fixtures now mount in the real scene and wait for all covers. Early UI setup assumed a shelf on launch; it now handles the intended automatic resume before arranging shelf tests. The final complete runs above passed after those corrections; the failed earlier runs are retained as evidence rather than described as flaky.

## 50-turn benchmark

All source text is synthetic and contains distinct page witnesses. The native test records synchronous turn work, content/pagination build counters, settled nonblank samples and CADisplayLink callbacks. A test-only green marker identifies the benchmark segment in an independent Simulator video.

| Measure | Final observed | Gate |
| --- | --- | --- |
| Synchronous turn work p50 | 5.379 ms | Reported |
| Synchronous turn work p95 | 7.306 ms | <= 50 ms on shared Simulator |
| Content rebuilds / pagination rebuilds | 0 / 0 | 0 for ordinary turns |
| Blank settled samples | 0 | 0 |
| Marked encoded video frames | 278 of 1655 total | Every marked encoded frame inspected |
| White/black blank marked frames | 0 | 0 |
| Display-link intervals <= 25 ms | 700 / 705 (99.29%) | Diagnostic only |
| Maximum display-link interval | 98.815 ms | Reported, not discarded |

Before removing the second synchronous snapshot from the default slide, the same shared-Simulator 50-turn benchmark reported p95 35.62 ms. These are local measurements, not a controlled physical-device comparison. Callback intervals and encoded video frames do not establish actual GPU/display frame delivery. The video checker is `scripts/ios/check-reader-video.py RECORDING.mp4 REPORT.json`; it is deliberately scoped to this marked light-theme 402x874 fixture, fails on decode/no active frames, and checks both all-white and all-black content.

Correctness cases include latest local/cloud-only startup book, offline fallback and manual-open guard; newer local/remote progress, legacy timestamps, failed recovery write, CAS conflicts and explicit choice; behavior changes while selected; cross-chapter restoration coverage; repeated/alternating turns, background cancellation; PDF resizing during a turn; backward-compatible and cold-resume preferences. Existing text/resource/source-anchor tests remain in the complete App run.

## Evidence and remaining gates

Raw logs, xcresults, recording and metric JSON are retained in the task artifact `ai-test-GET-reader-smooth.nfvuxr` on this host; no real book, account token or reading record is included in the public repository. CI, merged SHA and Apple receipt are tracked in the linked issue and PR after delivery.

Physical iPhone/iPad acceptance remains open: install the exact processed TestFlight build, preserve existing account/book data during update, compare two-device progress, rotate, select/copy, rapidly alternate turns, test dark mode, larger type and Reduce Motion, and capture input-to-first-motion p95 <= 100 ms plus >= 99% actual frames within 1.5 display periods at the actual refresh rate. These targets are not claimed as passed by Simulator results. No synthetic overall score is assigned, and a functional failure cannot be averaged away.
