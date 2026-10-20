# Book upload and chapter reading implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independently owned tasks and review the combined branch before delivery.

**Goal:** Make uploading quiet and asynchronous in chat, avoid repeated original transfer, and serve chapters without repeatedly fetching the full book.

**Architecture:** Keep current domain services and compatibility APIs. Add independently stored chapter projections; adopt verified original references; share one client upload/task controller between existing entry points and chat.

**Tech Stack:** Existing JavaScript modules, Node, PDF.js, Supabase private Storage/Postgres, native browser UI.

**Spec:** `docs/superpowers/specs/2026-10-20-book-upload-reading-design.md`

## Global constraints

- Preserve account isolation, source IDs/versions, drafts, original bytes and private runtime data.
- No scan-page or quota presentation; retain short source-bound external-processing consent.
- No model calls for progress messages, no automatic questions or translation.
- Only main creates Production deployments; existing CI and release policy apply.
- The user has authorized implementation and delivery; proceed through routine design decisions without redundant approval gates.

## Review focus

- A session changes while upload or poll is pending: old-owner callbacks must stop updating or sending.
- Completed upload parts survive interruption, but uncommitted signed targets never count as received.
- A fresh service reads chapter N without fetching the full book or another owner's data.
- A new translation/restore/revision cannot return an old chapter projection.
- Chat uploads work with no books, with a draft, and while another book remains open.

## Task 0: Baseline and orchestration

- [x] Capture base commit, source identity privately, real browser baseline and counted storage/HTTP baseline before product edits.
- [x] Run relevant existing tests, create the task ledger and rule on interface ownership.

## Task 1: True chapter storage and retrieval

**Owns:** `server/library-service.mjs`, new chapter read store modules, chapter/store tests. Parent integrates the two reading routes in `server/portal.mjs` after this task.

**Produces:** `library.readingView(user,id,{chapterId,passageId})`; `library.readingChapter(user,id,chapterId,contentVersion)`, preserving existing reading-view payload contracts. Existing getBook remains compatible.

- [x] Write failing durable-store tests proving fresh-instance chapter reads avoid full-book and full-overlay reads; pin owner/version and changed-translation behavior.
- [x] Implement manifest/chapter storage with guarded one-time old-book projection and write-path invalidation/update.
- [x] Run chapter, restore, source revision, translation and account-isolation tests; self-review.

## Task 2: Efficient original upload/publication and internal recognition accounting

**Owns:** `server/book-ingestion.mjs`, `server/ingestion-upload.mjs`, `server/ingestion-storage.mjs`, `deploy/hosted-store.mjs`, `app/pdf-ingestion.mjs`, ingestion/storage tests. Parent integrates route dispatch and a library verified-source hook; coordinate signatures before changes to library-service.

**Consumes:** Existing uploadPdf signature and byte import compatibility. **Produces:** scoped binary upload targets plus verified, account-bound source-reference adoption at final library publication.

- [x] Write failing tests for binary/resumed uploads, incomplete parts, publication without another original read/write, full preflight and recognition-page-only budget.
- [x] Implement using existing store capabilities; preserve original/hash checks, cancellation and uncertain provider-request protection.
- [x] Run upload, hosted and ingestion regressions; document any old-client fallback.

## Task 3: Quiet shared uploads in chat

**Owns:** chat/upload UI modules, `app/portal.js`, `app/reader-conversation.mjs`, relevant styles/catalogues and UI tests. Parent registers new static modules if needed.

**Consumes:** unchanged uploadPdf API and current ingestion status/action APIs. **Produces:** one shared controller/task subscription per page, stable upload card and accessible attachment/drop support on library and reader chat.

- [x] Write failing state/UI tests for empty-library upload, owner change, cancelled work, draft/focus retention and in-place relabeling.
- [x] Implement stage-based task cards, quiet inline external-processing consent, completed-book reading/chat actions, and existing-upload-entry handoff.
- [x] Run localization, chat, upload and lifecycle tests; self-review desktop/mobile layouts.

## Task 4: Integration, same-book comparison and delivery

- [x] Review each task and combined interfaces; integrate routes and release manifest.
- [x] Run the same real-book measurements and real browser interactions; publish only sanitized evidence and material limits.
- [x] Run full repository release verification and independent branch review; fix confirmed findings.
- [ ] Commit task changes, push, create/update PR, wait for current-head CI, merge normally, wait for matching Production and verify live flow.
