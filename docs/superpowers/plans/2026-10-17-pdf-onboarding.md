# PDF Onboarding Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task. The user explicitly requested implementation and real E2E with the supplied PDF; do not introduce another routine approval round.

**Goal:** One PDF selection leads to a complete, recoverable private reading experience, proved with the supplied779-page PDF.

**Architecture:** Extend the existing ingestion/library services: unified resource policy, native-page routing, source reuse, contextual consent, persisted background runner and quiet bookshelf progress. Preserve legacy jobs and all existing books. Use the existing private compressed storage with checked multipart book transport.

**Tech Stack:** Node22, PDF.js, pdf-lib, official PaddleOCR SDK, existing Supabase document CAS/private Storage, Supabase Cron/pg_net/Vault and Vercel waitUntil.

**Spec:** ../specs/2026-10-17-pdf-onboarding-design.md

## Global Constraints

- PDF256 MiB /1,200 pages; TXT/Markdown20 MiB; native text8,000,000 UTF-16 units; logical book including translations32 MiB; transport parts1 MiB.
- Page groups at most30 source pages /20 MiB, exact original-page mapping and complete source coverage.
- Default real resources belong to the freshly verified test@cubxxw.com Auth identity. Isolated tests do not write real account data. Secrets and source content stay outside Git.
- Duplicate sources retain paragraph IDs, content versions, notes and saved translations. No blind retry of an uncertain paid submission.
- No automatic full-book translation or audiobook generation. Preview remains read-only and visibly incomplete.

## Review Focus

- An already processed PDF must open without another upload, consent prompt or provider call, even after upload-token expiry.
- Mixed native/scan pages must retain exact original order and cannot silently omit empty extraction results.
- Closing the browser must not stop authorized work; duplicate wakeups/cancellation must not duplicate paid calls or publish cancelled work.
- A large imported book must remain readable and able to save bounded translations without a late small-document guard.
- A transport/source change or wrong account must fail closed without returning private content or clearing prior progress.

### Task 1: Shared capacity and large-book access

**Files:** server/document-import.mjs, server/library-service.mjs, server/book-transfer.mjs, app/reader-api.mjs, tests/library.test.mjs, tests/hosted.test.mjs, tests/book-transfer.test.mjs.

**Interfaces:** `bookCapacity(book, reservedTranslationBytes=0)` enforces32 MiB; library exposes owner-checked `bookTransfer(user,id,offset,snapshot)` returning1 MiB base64 parts plus snapshot hash. A reader requests multipart support explicitly; ordinary API consumers retain their existing response contract.

- [x] Add failing regressions for >3.5 MB native imports/translations, pre-call headroom rejection, multipart integrity and owner isolation.
- [x] Run the new tests and confirm intended failures.
- [x] Implement the common policy, checked transfer and legacy-compatible browser assembly.
- [x] Run focused library/hosted/transfer tests; commit and record actual results.

### Task 2: Automatic page routing and source reuse

**Files:** server/pdf-native.mjs, server/document-import.mjs, server/book-ingestion.mjs, server/ingestion-upload.mjs, tests/pdf-native.test.mjs, tests/book-ingestion.test.mjs, tests/ingestion-upload.test.mjs.

**Interfaces:** native inspection returns complete page rows with readable/needs-recognition status. Auto jobs preserve native rows, `recognitionPages` and OCR `pageMap`; `consent(user,id)` authorizes only that source/job. `findSource(user,sha256)` returns a same-owner existing job. `preview(user,id)` returns at most3 completed pages/12,000 characters and explicit coverage.

- [x] Add failing cases for native-only imports without provider consent, mixed-page mapping, awaiting consent, duplicate complete import, stale upload URLs and no partial publication.
- [x] Run red tests, implement native inspection and routing while retaining legacy explicit-OCR behavior.
- [x] Add reliable embedded-outline/observed-heading grouping for new imports, keeping automatic-group labels when uncertain.
- [x] Run extraction/ingestion/upload tests; commit and record results.

### Task 3: Unattended durable runner

**Files:** server/ingestion-runner.mjs, server/portal.mjs, api/[...path].js, vercel.json, deploy/ingestion-worker.sql, tests/ingestion-runner.test.mjs, tests/hosted.test.mjs.

**Interfaces:** `createIngestionRunner({store,ingestion,schedule,env,fetcher})` supplies enqueue, tick and close. Queue rows are server-only owner/job references; bounded slices call the existing CAS-fenced advance. A secret-authenticated internal wake processes only persisted queue entries. Cron wakes only when runnable work exists.

- [x] Test restart, concurrent slices, browser-independent progress, consent pauses, cancellation, failed/uncertain submission behavior and forbidden internal requests.
- [x] Run red tests; implement the bounded runner, internal wake and local continuation.
- [x] Prepare an idempotent Cron/pg_net migration and protected Vault setup using existing server secret derivation; no secret literal in SQL source or logs.
- [x] Run runner/route/ingestion tests; commit and record results.

### Task 4: Minimal upload and bookshelf progress

**Files:** app/pdf-ingestion.mjs, app/portal.js, app/home.html, app/portal.css, release-files.json, tests/upload-state.test.mjs, tests/pdf-onboarding-state.test.mjs.

**Interfaces:** upload returns an existing job immediately or uploads missing chunks. Client status polling never submits provider work itself; contextual consent/resume are explicit mutations. Bookshelf progress survives refresh and offers a read-only preview without claiming whole-book completion.

- [x] Test source reuse without chunk upload, interrupted status recovery, consent routing, owner switch and read-only preview coverage.
- [x] Run red tests, implement the single entry and meaningful progress/recovery states; retain keyboard/focus support and quiet visual style.
- [x] Run UI-state/route tests and local browser checks; commit and record results.

### Task 5: Full verification, review and real E2E

**Files:** docs/verification/2026-10-17-pdf-onboarding.md plus private account evidence.

- [ ] Run required complete checks and independent whole-branch review; fix important findings with regressions.
- [ ] Push/create PR, synchronize main, wait for checks, merge normally and verify deployed source.
- [ ] Configure the existing-project background wake, verify it actually progresses a bounded new private import after closing the browser; do not claim this from source alone.
- [ ] In the real browser select the supplied original PDF, confirm cache reuse and complete779-page reading; check first/middle/last pages, source hash and unchanged IDs/records.
- [ ] Save screenshots and private receipts; publish only validation metadata, explicitly distinguishing full coverage, sampled OCR quality and cached versus new provider work.

## Execution ledger

- Source inventory: clean main at a0fff72. The designated account already has the completed779-page job and book; source hash e4fcfaf7…be6f20,1,960 stable paragraph IDs. No source text is copied to public documents.
- Baseline: focused suite had one intermittent byte-sized PDF fixture failure; an isolated rerun passed. Investigate timestamp-dependent PDF byte sizes if it recurs; do not weaken production size checks to pass a fixture.
- Ruling: reuse completed OCR results for the actual original and disclose that reuse; prove cold/background behavior separately with a small new source. Cost if wrong: a duplicate-import test alone would not validate the new processing route, hence both gates are required.
- Ruling: reuse current compressed content storage and add bounded transport; no wholesale canonical-schema or physical chapter-storage migration in this slice. Cost if wrong: very large books still require loading a logical document, within the explicit32 MiB bound.
