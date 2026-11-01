# GET-356 · Quiet resume and smooth native reading

The user confirmed iPhone/iPad scope and automatic opening of the most recently read book, with its synchronized position restored before the first readable frame. Existing autonomous delivery authorization applies.

## Decisions

1. Refresh the account shelf before choosing the startup book; select by actual reading activity, independent of pins/sort. Open/download once per launch, protect incoming imports, cancellation, account changes and explicit navigation. Offline fallback uses the retained account shelf and local state. Return to shelf must not immediately reopen.
2. Reconcile positions automatically before opening. Compare real interaction timestamps; a newer remote position wins over stale local state, a newer offline event may CAS against the fetched revision. Preserve displaced positions in an account/book-scoped recovery file before adopting. A live reader keeps its visible anchor; remote-only revision updates defer to next opening. Notes/drafts and account isolation remain unchanged. Unknown timestamp conflicts retain existing recoverable conflict handling.
3. Keep a single native selectable text/PDF surface. Default to a short horizontal slide, with optional page curl and instant transitions; retain continuous scrolling. Configure tap/swipe input separately. Respect Reduce Motion. Do not rebuild text for theme, speech, timer or animation settings.
4. Install an opaque old-page cover synchronously before changing chapter/text/page offsets; keep it through asynchronous restoration. Animate to the settled destination; remove all temporary layers on cancellation, resize, background or teardown. Manual repeated input must not cancel a committed transition; retain one pending direction to prevent unbounded gesture queues.

## Alternatives

Retaining only page curl preserves appearance but retains per-turn controller setup and blocks rapid input. Replacing all content with a web renderer risks native selection, source geometry and PDF behavior. A light native transition around existing readers is the smallest approach that preserves these contracts; curl remains optional.

## Acceptance

Hard correctness gates: zero uncovered transition frames; no stale completion across source/session/size changes; no intermediate offset persisted; no ordinary cross-device interruption; latest book and exact source anchor on reopen; selection/copy/link/long press and PDF zoom retain precedence; input/preferences survive reopen. TXT/Markdown/EPUB and PDF, first/last page, cross chapter in both directions, rapid alternating input, background/foreground, orientation and accessibility sizes are covered.

Measure rather than invent a score: at least 50 sequential turns with unique witness text; report p50/p95 synchronous turn work and display-link intervals, blank-frame samples and layout rebuild count. Targets: p95 turn work <= 50 ms on the shared Simulator, no unintended whole-chapter rebuild during ordinary turns, no blank samples, stable anchor. Physical-device targets are p95 input-to-first-motion <= 100 ms and >= 99% frames within 1.5 display periods at the actual refresh rate; Simulator timing does not certify these. Functional failures cannot be averaged into a high score.

## Boundaries

No new dependencies, model calls, source/data migration or preview deployment. Local tests, CI, merge, TestFlight upload/Apple processing and physical-device acceptance are recorded separately. Keep the issue open for acceptance that cannot be established here.
