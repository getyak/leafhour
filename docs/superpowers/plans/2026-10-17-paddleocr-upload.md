# PaddleOCR PDF upload implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, task by task. The user explicitly requested direct implementation and real-book end-to-end acceptance.

**Goal:** Upload and read the supplied 779-page, 137 MiB scanned PDF through Leafhour using the official PaddleOCR-VL-1.6 API.

**Architecture:** Keep the existing library and personal-record services. Add a resumable private ingestion service: chunked original upload, server-side PDF splitting into at most 30-page batches, persisted remote job handles, page-result normalization, coverage checks, and one final publication. Each authenticated advance request performs bounded work; closing the browser pauses advancement and reopening resumes it. Remote OCR already submitted continues at the provider. This release makes no unattended scheduler promise.

**Tech Stack:** Node.js, pdf-lib for lossless PDF splitting, the official @paddleocr/api-sdk, existing PDF.js baseline, Supabase private Storage and document CAS.

**Spec:** ../specs/2026-10-17-book-ingestion-design.md. This user-authorized implementation slice supersedes the initial 20 MiB/500-page limits only for PDFs: 256 MiB/1200 pages. TXT/Markdown stay at 20 MiB. It does not implement re-parsing of existing books, MCP batch imports, universal canonical-v2 backups, or migration of existing notes. Existing books and IDs remain unchanged. New OCR books retain source hashes independently of content hashes.

## Global Constraints

- All source files, provider output and page evidence stay private under the authenticated account; no real book content enters Git.
- Explicit per-book consent identifies PaddleOCR official service and the whole-PDF scope; no other model/provider receives content.
- Never publish incomplete page coverage; blank pages are recorded as blank, not invented text.
- Preserve original bytes and verify SHA-256, including chunk manifests.
- Store credentials only server-side; do not expose provider job handles, signed provider results or secrets in UI responses.
- Provider uncertain submissions are not silently retried; cancellation prevents further submission and publication.
- New OCR paragraphs retain page and bounding-box evidence; original raw blocks remain available privately.

## Review Focus

- 779-page scans must avoid vendor's 100-page truncation and serverless request deadlines.
- Refresh, concurrency and cancellation must preserve durable progress and block stale publication.
- Same-source uploads must reuse a book without regenerating IDs or touching notes.
- Private job IDs and blob paths must not grant another user access.
- Large extracted books must fit durable storage and hosted response limits without dropping paragraphs.

### Task 1: Storage and safe publication

Files: deploy/hosted-store.mjs; server/library-service.mjs; server/document-import.mjs; tests/hosted.test.mjs; tests/library.test.mjs.
Interfaces: hosted store keeps read/mutate/putBlob/blob/blobInfo compatible, adds chunk upload operations; library adds importExtracted(user,{filename,bytes,extracted}) for internal service use only.

- [ ] Add failing tests for multi-chunk roundtrip, corruption rejection, large book storage, source/content hash separation, owner isolation and repeat-import record preservation.
- [ ] Implement bounded private chunk objects, immutable compressed large JSON objects and CAS pointers, and source-hash verification independent of OCR content hash.
- [ ] Run focused tests and commit.

### Task 2: Durable OCR orchestration

Files: server/book-ingestion.mjs; server/paddleocr.mjs; tests/book-ingestion.test.mjs; tests/paddleocr.test.mjs.
Interfaces: createBookIngestion({library,store,provider}) returns prepare(user,input), view(user,id), advance(user,id), cancel(user,id), list(user). Provider submit(bytes), status(handle), result(handle) use official VL-1.6.

- [ ] Test explicit consent, batch/page mapping, all-page coverage, restart recovery, concurrent leases, cancellation, failure and ambiguous submit behavior.
- [ ] Implement persisted phases and leases; save raw output before normalizing paragraphs; publish only after complete coverage. Exclude recognized page furniture from reading text while retaining raw evidence.
- [ ] Run focused tests and commit.

### Task 3: Upload UI and routes

Files: server/portal.mjs; api/[...path].js; app/portal.js; app/pdf-ingestion.mjs; app/home.html; app/upload-state.mjs; .env.example; docs/configuration.md; tests/upload-state.test.mjs; tests/hosted.test.mjs.

- [ ] Test route identity/CSRF checks, chunk size validation, resumable client state and provider consent.
- [ ] Add PDF consent choice and true progress, chunk upload, task resume/cancel and reader navigation. Preserve TXT/Markdown/native PDF flow.
- [ ] Add compressed hosted JSON transport for large readable books; verify decompression and response bounds.
- [ ] Run complete suite and hosted build, then review branch.

### Task 4: Real-book acceptance and delivery

- [ ] Query current Supabase Auth for test@cubxxw.com's real user ID. Keep the original and OCR evidence in that account.
- [ ] Configure the server credential without revealing it. Use browser UI to upload the supplied original PDF, consent to PaddleOCR, parse all pages and open the resulting reader.
- [ ] Independently transcribe visible samples across the book before calculating CER. Report sampling scope, raw versus normalized differences, reading-order/footnote defects and measured completion coverage.
- [ ] Verify refresh/resume, duplicate upload ID preservation, first/middle/last-page reading, original hash, anonymous rejection and no secret/book content in the Git diff.
- [ ] Commit public verification metadata, create PR, wait for checks, merge, verify deployment and repeat representative production reader flow.

## Execution ledger

- Initial inventory: clean main, existing upload is synchronous PDF.js only; supplied PDF is image-only, 143882741 bytes, 779 pages. No existing note migration is required for this new source.
