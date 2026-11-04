# Journal responsiveness implementation

Status: implementation complete; syntax parsing passed. Simulator build, app tests, timing output and independent UX review remain pending the integration run. No physical-device or 9.5/10 claim is made here.

## Changes
- ReadingJournalModel publishes validated disk months before starting network requests. A complete real snapshot uses ready state while refreshing, so the overview keeps its seven-day total without a persistent loading indicator.
- Successful warm months are reused for 30 seconds. Identical in-flight requests share one task. Explicit refresh bypasses this freshness window.
- Account context or timezone changes clear scoped values; day and reading revision changes invalidate freshness. LibraryModel increments the revision after reader dismissal and completed shelf synchronization, ensuring new reading checkpoints refresh the journal.
- Cross-month seven-day reads start together with a task group. Every completion checks the request identity and current owner context. Incomplete/unavailable measurements remain unknown; failed refresh retains actual cached data.
- Notebook requests are independently owned by MyReadingScreen and retain existing notebook pagination behavior. Slow notebook completion cannot hold the journal state in loading.
- The main journal scroll view uses native vertical bounce. Deep journal routes report their navigation depth to the root paging coordinator.

## Verification prepared
Updated LibraryRecordsTests includes four new targeted tests:
1. Repeated warm reads issue no extra requests before 30 seconds; expiry and explicit refresh re-read. It prints total elapsed duration for 25 warm loads.
2. Disk snapshot is visible and ready while a network response is held; concurrent duplicate reads remain one request. It prints disk-cache availability duration.
3. A week spanning two months starts both requests before either is allowed to complete, preserving all seven real daily values.
4. Midnight, timezone change and completed shelf synchronization invalidate warm data.

The existing offline-retention test now explicitly forces refresh because an ordinary warm revisit intentionally does not hit the network. Existing corrupt-record, incomplete-month and late-account-response tests remain available.

Executed: `swiftc -frontend -parse` on ReadingJournalModel.swift, MyReadingScreen.swift, LeafhourApp.swift and LibraryRecordsTests.swift; exit 0. This checks syntax only. The parent agent owns app builds and the app-test run; no build/test pass or numeric timing is inferred from parsing.

## Acceptance limits
Cached-path target is under 100 ms; the two instrumented tests produce measured local numbers during integration. No network percentile or first-frame device latency has been measured. An uncached first request still depends on actual network availability. Cache visibility is an honest previously validated snapshot, not fabricated zero or a claim of freshness. Visual hierarchy is preserved from the existing journal; only loading behavior changes.
