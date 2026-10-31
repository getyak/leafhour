# Cross-device reading and account shelf synchronization

The user requests consistent Web/iOS reading time, recent reading and account book states. Reuse the existing domain service and account UUID ownership. Current defects: iOS has no time recorder/outbox, fetches metadata-only books without personal state, and derives continuation only from local last-opened; Web masks newer positions with older sessions and does not refresh same-owner foreground changes; native downloaded books resurrect archived cloud entries.

## Behavior

Reading sessions retain the existing `reader_focus` / `reader_estimate` protocol, stable IDs, sequences, UTC intervals and IANA timezone. Pending time persists before upload, survives restart/account switching and only matching receipts acknowledge it. Overlapping devices remain interval-unioned by the existing service. No duration is reconstructed from a last-opened timestamp. Native default is explicit start, matching Web; start policy stays separate from the underlying clock. Background, hidden reader/tools and observation gaps pause capture; estimate mode has the existing 120-second idle cutoff. Programmatic restoration, model reads and automatic narration do not manufacture activity.

Positions carry optional `observedAt` (actual reading interaction), distinct from server `updatedAt` (receipt time). Old clients/records retain compatible fallback. Recent selection compares finite parsed timestamps and the maximum of actual position activity and session activity. Source/version and per-book CAS checks remain. A running reader never jumps when another device changes position; pending local changes remain available for explicit conflict resolution. Automatic restoration does not create a fresh reading event.

Account state includes active/archived books, explicit manual order, cloud pins, unread/reading/finished and resume summaries. Downloaded bytes, local originals, additional versions, notes and drafts are retained on each device. An absent item in a failed or legacy snapshot is never evidence of archive. Cloud pins synchronize; pure local pins remain on that device. Existing local pin preferences are retained during migration and must not override already initialized cloud pin state.

## Frozen service contract

`GET /api/library?view=account` is authenticated and returns:

`{kind:"leafhour-account-shelf-v1",user:{id,...},books:[...],archivedBooks:[...],shelfRevision, shelf:{revision,order:[bookId],archived:{bookId:isoDate},pinned:[bookId],pinsInitialized:boolean}}`.

Rows retain metadata and add `readingStateReady:true`, `resume` (validated stored chapter/passage position with revision, observedAt/updatedAt and an optional chapterTitle/label), `journey` (at least status, finishedAt, lastReadAt), canonical `lastReadAt`, and `pinned`. Account snapshots read indexes and personal records without materializing private canonical book bodies. Existing metadata/full-library contracts stay compatible. Shelf revision covers order/archive/pins, not subsequent reading activity. Native validates the returned owner; caches retain the entire snapshot. Legacy responses are explicitly non-authoritative for absence/archive.

`POST /api/library/pins` consumes `{bookIds:[rawBookId],pinned:boolean,baseRevision}` and returns the existing shelf-state shape extended with pinned/pinsInitialized. It applies a delta under existing shelf CAS, retaining archived slots/pins. Existing `/api/library/books/:id/archive`, `/restore` and `/reading-milestones` are reused. All native pending shelf actions are account scoped and durable. A stale CAS never silently overwrites another device; retries or discards require an explicit choice. A receipt for an older local intent cannot remove a newer intent.

`POST .../progress` accepts optional observedAt, validates its timestamp/source version and returns it with the existing position. New saved positions retain a source chapter label for lightweight summaries. Full `resumeSummary` also returns observedAt. Time sessions/milestones retain their existing payload/receipt contracts.

## Native boundaries

`CloudShelfBook` retains its existing initializer defaults and gains personal resume/journey/lastReadAt/shelfPosition/pin fields. `CloudShelfSnapshot` exposes ownerID, revision, books, archivedBooks, order, archivedBookIDs, pinnedBookIDs, pinsInitialized and isAuthoritative; `cacheData()` / `init(cacheData:ownerID:)` preserve legacy account-scoped caches. `CloudLibraryClient.accountShelf(ownerID:)` reads the new contract.

Core owns a pure clock, separate reading ledger, durable time/shelf outboxes and transport. ReaderSession exposes explicit start/pause/resume/finish, real interaction, visible-reader state, periodic observation and an awaitable local flush. ReaderState.lastActivityAt is optional for old Codable files. CloudBookSync independently drains time and syncs notes/positions, carrying observedAt and detecting remote changes even during push-only passes. Upload migration maps time anchors only through unique verified source matches; unresolved records remain in the source space.

The app uses the snapshot for resume candidates and account visibility; state filtering never removes cached files. Account order uses explicit manual order when present and actual added dates otherwise, preserving the recent upload fix. Recent reading is an explicit sort/continuation behavior and never uses import time as reading. Reader controls live in the existing reading tools. Foreground/reconnect/dismiss refreshes are coalesced, owner fenced and do not reload full book bodies merely to refresh a shelf.

## Evidence and delivery

Use isolated synthetic owners for mutations, protocol tests and overlapping-time scenarios. Real production checks use only the default account and Keychain credentials, never print/save credentials or seed fabricated history. Preserve unrelated work. No model generation is needed. Test stale/offline receipts, owner switches, source changes, archived local copies, old caches and cold restoration. Submit one reviewed batch, exact-head CI and normal merge; observe existing Production and TestFlight workflows separately from physical installation. Respect the rolling hourly production budget.
