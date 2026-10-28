# Offline Reading Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Independent server, storage, and static-worker units are delegated under dispatching-parallel-agents; the primary implements and verifies integration.

**Goal:** Speed repeated reading and permit saved chapters/books to reopen without network, with account isolation and honest synchronization.

**Architecture:** Keep authoritative account checks and immutable chapter snapshots in the domain service. A scoped IndexedDB store holds verified chapter bodies, while a release-bound static Service Worker supplies the reader shell and its dependencies. Application transport validates an online reading manifest before reuse and uses a distinct offline state on network failure.

**Tech Stack:** Existing Node ES modules, native IndexedDB, Cache Storage, Service Worker, existing test runner/build; no new runtime service.

**Spec:** `docs/superpowers/specs/2026-10-29-offline-reading-cache-design.md` (user authorized implementation and full PR/merge/production release on 2026-10-29).

## Global Constraints

- Source/translation identities and source status remain separate. No generation or billing during downloading/prefetch/offline replay.
- Private content never enters a shared HTTP cache or service-worker response cache.
- Source-version alone cannot validate a chapter; use canonical SHA256 including translations.
- Offline content capacity starts at 100 MiB; immutable server cache at 32 MiB; prefetch concurrency 1.
- Logout/owner change revokes access before asynchronous cleanup; notes/progress are never normal-cache eviction targets.
- Preserve existing local storage keys, account ownership and unrelated checkout changes.
- CI only for branches; main-only production deploy. No preview deployment or bypass of checks.

## Review Focus

- Late downloads after logout or A/B/A changes must not publish private data.
- Updated translations with unchanged original version must refresh cached bodies.
- Storage eviction, partial downloads and worker install failure must not claim offline readiness.
- Saved location conflicts and failed writes must preserve the user's local words/position without silently publishing notes.
- Existing reader dependency policies and small startup budget must hold after external cache modules are added.

### Task 1: Authoritative manifest and immutable server cache

**Files:** `server/chapter-read-store.mjs`, `server/library-service.mjs`, `server/portal.mjs`, cache module and tests.
**Interfaces:** `readingManifest(user,id)`; existing reading responses add `readingCache:{schemaVersion:1,snapshotId,chapters:{id:hash}}`; canonical chapter response unchanged.
- [x] Add failing owner, changed-translation, clone, concurrent-load and byte-limit tests.
- [x] Implement manifest route and bounded immutable caching, preserving durable current checks.
- [x] Run reading/store/route tests; commit current task changes with integration.

### Task 2: Verified device book store

**Files:** `app/offline-book-store.mjs`, codec/IDB helpers and store tests.
**Interfaces:** `createOfflineBookStore`; adopt/owner/capture/current/clear; saveBook/saveChapter/book/chapter/list/status/remove/pin.
- [x] Prove failing integrity, owner epoch, quota and partial-book tests before implementation.
- [x] Store metadata separately from canonical hash-verified chapter documents; pinned data cannot be silently evicted.
- [x] Test invalidated same-version translations and failed-clear tombstone behavior.

### Task 3: Offline static release

**Files:** worker/build modules, `tools/build-vercel.mjs`, `tools/build-reader-web.mjs`, `vercel.json`, offline shelf and tests.
**Interfaces:** static reader navigation fallback; `LEAFHOUR_OFFLINE_STATUS` message request/reply; exact external `offline-reading.mjs` import from reader-api.
- [x] Fail worker/build tests for leaked API caching, incomplete asset sets and mixed release resources.
- [x] Bind verified public resources to one release; preserve existing readers during updates.
- [x] Add offline shelf; hashed static resource caching; pass public-build/asset-budget checks.

### Task 4: Reader transport and account lifecycle

**Files:** `app/offline-reading.mjs`, `app/reader-api.mjs`, `app/reader.js`, `app/portal.js`, narrow transport tests.
**Interfaces:** `createOfflineReadingTransport({store,fetcher,owner,online,...})` and browser facade used by existing reader API; existing user session is never fabricated offline.
- [x] Test no repeated chapter body transfer on manifest hit, network-failure fallback, explicit denial, stale owner and offline write rejection.
- [x] Integrate online manifest/changed-chapter retrieval, automatic cache saves and last-position boot.
- [x] Fence logout and cross-tab session changes; online restoration reloads verified identity before writes.
- [x] Reuse existing position/session conflict logic; keep unsent local drafts and require explicit note submission.

### Task 5: Download controls and prefetch

**Files:** new injected offline UI, existing reader/portal owners, four catalogues, copy evidence, release allowlist.
**Interfaces:** whole-book download with cancellation/resume; real per-book status + worker readiness; one-next-chapter prefetch with abort.
- [x] Test partial completion, cancellation, changing manifest, pinned capacity, unavailable resources and no model calls.
- [x] Expose save/remove/cancel in book actions and a device shelf link; show offline scope only when relevant.
- [x] Preserve selection, reading position and reading activity semantics. Refresh generated copy evidence.

### Task 6: Full verification and delivery

**Files:** `docs/verification/2026-10-29-offline-reading-cache.md`, README/change notes as appropriate.
- [ ] Establish baseline and inspect named failures rather than masking them.
- [ ] Run focused tests, full npm suite, configured copy lint, build and public release checks.
- [ ] Browser-test real IndexedDB/SW: save public book, disconnect, reload and reopen tab, read chapters, reconnect, remove; exercise isolated A/B identity tests and mobile layout.
- [ ] Independent whole-diff review, fix material findings and rerun affected checks.
- [ ] Sync origin/main, commit only this task, push, create/attach PR, await CI, normal merge.
- [ ] Verify remote merged commit, await Vercel Production for that commit, repeat anonymous offline and recovery checks; report actual measured latency and remaining unverified device coverage.
