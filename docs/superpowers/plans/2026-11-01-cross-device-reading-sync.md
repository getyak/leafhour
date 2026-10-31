# Cross-device reading synchronization implementation plan

> **For agentic workers:** Use the applicable subagent-driven-development or executing-plans workflow. Work is already authorized by the user and repository delivery policy; no additional design approval gate is needed.

**Goal:** Make existing Web and iOS reading records, continuation and account book states converge without losing offline work.

**Architecture:** Extend the existing account domain service with a lightweight shelf snapshot and actual activity timestamps. Native Core supplies durable bounded queues and the shared time protocol; the existing app and Web interfaces consume those facts and retain explicit conflict choices.

**Tech Stack:** Existing Node modules, Foundation/SwiftUI, system SDKs; no new package dependency.

**Spec:** [Frozen design and wire contract](../specs/2026-11-01-cross-device-reading-sync.md).

## Global constraints

- Account UUID ownership; no original, credential or personal runtime data in Git.
- No invented past duration, automatic paid model call or background reading time.
- Stable source IDs/version fences, durable local writes and matched receipts.
- Shared totals union device intervals; active timers remain independent per device.
- Preserve original files, drafts and archived copies; missing/failed snapshots never delete local content.
- One complete PR batch; no preview and no bypass of failed checks.

## Review focus

1. A delayed offline position must not become newer just because it uploaded later.
2. A→B account switches must neither publish nor acknowledge A's pending writes in B.
3. A receipt for sequence N must retain a pending N+1, including quick pin toggles.
4. A cached downloaded book archived elsewhere must hide from the active account shelf but remain recoverable.
5. A cold auto-restore must not create activity or displace the genuine recent book from another device.

## Work ownership and interfaces

Core worker owns `apps/ios/LeafhourCore/**` except the new account-shelf modules delegated to the native shelf/app worker. Root first moves the unchanged CloudShelfBook declaration to its own file and exposes only an internal storage seam for Core extensions. Core worker owns ReaderSession, Models, CloudBookSync, clock/ledger/activity transport and upload time-anchor migration. Native app worker owns the moved CloudShelfBook file, new CloudShelfSnapshot/account action modules, `apps/ios/Leafhour/**`, and application tests. Coordinate exact clock/action API signatures before app wiring. Root owns existing OfflineLibrary changes beyond that agreed seam.

Web worker owns `app/**` changes and focused JS tests, including the additive observedAt field in resumeSummary. Root owns server files, server/HTTP tests, release allowlist, generated copy inventories, documentation and integration. No worker commits/pushes. Use `apply_patch` for shared-context edits; request ownership before touching another worker's files.

### Task 1: Native durable reading activity and observed positions

- [x] Write failing clock/outbox/receipt/owner/last-event timestamp tests; run the relevant RED cases.
- [x] Implement the clock and ledger in new Core files. Add optional ReaderState.lastActivityAt, ReaderSession events/flush, time sync, source/version-safe upload migration, and observedAt position payload/pull handling.
- [x] Run focused tests, then the full Core suite after the shelf types are available. Build jobs max two; coordinate one build slot.

### Task 2: Native account shelf and app integration

- [x] Test full vs legacy snapshots, cached metadata, explicit archived IDs, pins/CAS pending actions, date comparisons and recent selection.
- [x] Implement CloudShelfBook/Snapshot/client and typed account action outbox in separate Core modules; send exact integration signatures to the other workers.
- [x] Wire LibraryModel/LibraryScreen to complete snapshots and pending actions. Keep local files and pins separate. Add status/recency/order/archived management within existing menus.
- [x] Wire the agreed Core clock into existing ReaderScreen/tools, real gestures and lifecycle boundaries; do not start a timer on programmatic restore.
- [x] Run application tests in a task-owned simulator after Core checks and review rendered controls.

### Task 3: Web convergence and actual recency

- [x] Reproduce old-session/new-position and timezone-offset sorting failures.
- [x] Implement one finite timestamp helper and use max actual activity for continuation/recent ordering. Carry observedAt through the existing durable progress writer.
- [x] Coalesce same-owner foreground metadata refreshes, replace authoritative hydrated book sets/revisions, preserve loaded translation metadata and pending drafts. An active reader receives a remote-position choice rather than an automatic jump.
- [x] Add account pins using the new delta API and existing book-action menu; preserve manual sorting semantics.
- [x] Run focused Node/browser checks, including owner switches, stale hydration and failed refresh retention.

### Task 4: Domain snapshot, state and protocol proof

- [x] Write failing service/HTTP tests for lightweight account snapshot (canonical body reads forbidden), observedAt/version validation, stale offline recency, pin CAS and archived/restored visibility.
- [x] Implement server metadata projection, pins and source-bound event timestamps; retain current APIs and interval-union aggregation. Re-adding an archived duplicate must return it to the active shelf without overwriting its source or records.
- [x] Exercise a two-client synthetic account: time overlap, offline retries, recent book switch, conflict preservation, read/unread marks, archive/restore and pins/order.
- [ ] Safely inspect the default account's live summary without fabricated writes; use the existing downloaded simulator book for visual smoke.

### Task 5: Integrated delivery

- [x] Run affected checks, independent diff review, fresh copy export/lint and full required release verification once the batch is stable.
- [ ] Submit one branch/PR, wait exact-head CI, sync main and normally merge. Track exact-source Production and automatic native release; distinguish Apple processing, group state and actual phone installation.
- [ ] Record shipped/verified limits and any historical duration that cannot be reconstructed.

Local evidence and release boundaries are recorded in [verification](../../verification/2026-11-01-cross-device-reading-sync.md).
