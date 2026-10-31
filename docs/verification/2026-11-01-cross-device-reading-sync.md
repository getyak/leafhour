# Cross-device reading synchronization verification

## What changed

Web and iOS reuse one account domain service for reading intervals, actual reading activity and shelf state. Native timing is explicitly started in reading tools, with focus and foreground-estimate modes. Time and shelf changes persist before upload. Account snapshots retain reading/resume metadata, pins, explicit order and archived entries without loading private canonical source bodies. Device downloads, originals, drafts and retained versions remain local.

Actual `observedAt` is separate from upload `updatedAt`. Continuation compares parsed activity timestamps, rather than preferring an older time session or a late network receipt. Foreground refreshes are coalesced and owner fenced. Existing readers retain their current passage and local drafts when another device changes progress.

Account cold start offers continuation, including an explicit download action for a cloud-only recent book. Device-only libraries retain automatic local restoration. A restore does not manufacture a reading event. Historical native duration that was never collected cannot be inferred from a last-opened bookmark.

## Local checks

| Area | Evidence |
| --- | --- |
| Native Core | 207 tests passed, zero failures/skips, including millisecond receipts, local histories above 20 sessions, cloud pending bounds, observation gaps, owner/version fences and interrupted checkpoints. |
| App unit checks | The stable full application run executed 163 tests with zero failures and one existing public-cover fixture skip. Subsequent affected groups passed: reading tools/activity 20, upload history/activity 6, summary/concurrency 20, presentation/activity/rendering 23. These are scoped runs, not additive unique counts. |
| Host deploy verification | 4,491 tests executed: 4,490 passed, one skipped, zero failures. Runtime build, hosted build, public-content exclusion, release allowlist and provenance checks passed. |
| Product copy | Deterministic export and real pinned Vale/textlint checks passed; existing unreviewed debt remains documented. |
| Fixed startup budgets | Actual reader asset 325,276 bytes against 327,680; targeted portal entry 204,757 against 204,800. Limits were not increased. Foreground-only coordination, pending-time drain and optional visual renderers are deferred. |

Independent reviews found six confirmed boundary issues before delivery: a local-only time outbox becoming permanently full, a manual-pause button hidden by visibility suspension, fractional-second receipt disagreement, late hydration rolling back order, public pin state surviving an account boundary, and backup losing an explicitly empty cloud pin state. Each was reproduced and fixed. Additional integration regressions cover summary refresh after foreground, partial migration failure, calendar test-clock portability and existing audio dismissal boundaries.

## Actual protocol and interface integration

A temporary loopback service with isolated synthetic account UUIDs was exercised by the actual Swift Core client and ordinary HTTP/Web clients. No production history was fabricated.

- A native 60-second focus interval and a Web 60-second estimate interval overlapped by 30 seconds. The service reported 90 seconds overall, not 120.
- Native time and account-action queues drained only after matched service receipts. Position acknowledgements matched source identity and observed activity.
- An older offline checkpoint arrived later but did not displace a genuinely newer book.
- Native pin, archive, restore and finished-mark requests were read back from the real service. Local source files remained available after archive.
- The real browser loaded the same fixture account, displayed the native pin as Unpin and the native finished mark under Finished. Unpinning through the browser was subsequently observed by the Swift client.
- A 25-session local upload drained batches of at most 20. On a simulated failure after ten acknowledgements, fifteen target records remained pending; retry did not duplicate acknowledged IDs. Source history, original bytes and drafts remained intact.
- A loaded native summary refreshed from 120 to 900 seconds after foreground. A delayed 240-second response could not leave the UI/cache stale; one coalesced follow-up read converged them to 900. Account switching discarded old-owner replies.

Rendered normal/accessibility-size time controls were inspected, including the reachable pause action while the tools panel has temporarily suspended visible reading. Synthetic runtime data, raw logs, credentials and source originals remain outside this repository.

The account cold-relaunch draft UI scenario also passed on the isolated iOS 26.4 simulator. The test explicitly uses the continuation card before checking the restored reader/draft; production identifiers cannot opt into its synthetic factory. Native terminology uses the same foreground-estimate label as Web.

## Release and device boundary

At this source record, exact-head remote CI, Production and the automatic TestFlight release are pending. Their final results belong to the corresponding PR/workflow receipts. Apple processing, a testing-group relationship, tester eligibility, physical installation and retained-data updates are distinct facts. A physical iPhone is unavailable in this session.
