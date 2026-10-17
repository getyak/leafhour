# PaddleOCR PDF upload implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, task by task. The user explicitly requested direct implementation and real-book end-to-end acceptance.

**Goal:** Upload and read the supplied 779-page, 137 MiB scanned PDF through Leafhour using the official PaddleOCR-VL-1.6 API.

**Architecture:** Keep the existing library and personal-record services. Add a resumable private ingestion service: chunked original upload, server-side PDF splitting into at most 30-page batches at submission time, persisted remote job handles, page-result normalization, coverage checks, and one final publication. Each authenticated advance request performs bounded work; closing the browser pauses advancement and reopening resumes it. Remote OCR already submitted continues at the provider. This release makes no unattended scheduler promise.

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

- [x] Add failing tests for multi-chunk roundtrip, corruption rejection, large book storage, source/content hash separation, owner isolation and repeat-import record preservation.
- [x] Implement bounded private chunk objects, immutable compressed large JSON objects and CAS pointers, and source-hash verification independent of OCR content hash.
- [x] Run focused tests and commit.

### Task 2: Durable OCR orchestration

Files: server/book-ingestion.mjs; server/paddleocr.mjs; tests/book-ingestion.test.mjs; tests/paddleocr.test.mjs.
Interfaces: createBookIngestion({library,store,provider}) returns prepare(user,input), view(user,id), advance(user,id), cancel(user,id), list(user). Provider submit(bytes), status(handle), result(handle) use official VL-1.6.

- [x] Test explicit consent, batch/page mapping, all-page coverage, restart recovery, concurrent leases, cancellation, failure and ambiguous submit behavior.
- [x] Implement persisted phases and leases; save raw output before normalizing paragraphs; publish only after complete coverage. Exclude recognized page furniture from reading text while retaining raw evidence.
- [x] Run focused tests and commit.

### Task 3: Upload UI and routes

Files: server/portal.mjs; api/[...path].js; app/portal.js; app/pdf-ingestion.mjs; app/home.html; app/upload-state.mjs; .env.example; docs/configuration.md; tests/upload-state.test.mjs; tests/hosted.test.mjs.

- [x] Test route identity/CSRF checks, chunk size validation, resumable client state and provider consent.
- [x] Add PDF consent choice and true progress, chunk upload, task resume/cancel and reader navigation. Preserve TXT/Markdown/native PDF flow.
- [x] Add compressed hosted JSON transport for large readable books; verify decompression and response bounds.
- [x] Run complete suite and hosted build, then review branch.

### Task 4: Real-book acceptance and delivery

- [x] Query current Supabase Auth for test@cubxxw.com's real user ID. Keep the original and OCR evidence in that account.
- [ ] Configure the server credential without revealing it. Use browser UI to upload the supplied original PDF, consent to PaddleOCR, parse all pages and open the resulting reader.
- [ ] Independently transcribe visible samples across the book before calculating CER. Report sampling scope, raw versus normalized differences, reading-order/footnote defects and measured completion coverage.
- [ ] Verify refresh/resume, duplicate upload ID preservation, first/middle/last-page reading, original hash, anonymous rejection and no secret/book content in the Git diff.
- [ ] Commit public verification metadata, create PR, wait for checks, merge, verify deployment and repeat representative production reader flow.

## Execution ledger

- Initial inventory: clean main, existing upload is synchronous PDF.js only; supplied PDF is image-only, 143882741 bytes, 779 pages. No existing note migration is required for this new source.

- Ruling: accept PDFs up to 256 MiB/1200 pages to handle the explicitly supplied 137 MiB/779-page scan; text files and gifts keep their previous 20 MiB bounds.
- Ruling: this slice does not reparse existing books or migrate notes. New OCR books use UUID paragraph identities and independent source/content hashes; existing books remain unchanged.
- Ruling: explicit authenticated advances resume durable jobs; closing the browser pauses new work. No unattended worker is claimed.
- Ruling: split the next PDF batch only when submitting it. Uploaded chunks can be adopted directly, and a warm process caches the verified PDF. This avoids writing another whole book of temporary PDF batches; a cold process must reload the source once.
- Task 1-3 verification: Node 22 full suite 868 passed, 1 skipped (869 tests including nested cases); isolated runtime 928 files/9.0 MB; hosted public-build and 420-file release allowlist checks passed. Real credentials were excluded from tests.
- Independent review: four important findings (request bounds, interrupted upload resume, ambiguous publication and running cancellation) corrected; raw-evidence preservation was treated as important because it is an explicit acceptance requirement. Regressions cover interrupted/repeated sources, failed batch retry, lost publication response and raw-result preservation.
- Source branch advanced concurrently with PR #59; merged origin/main and retained guide/listening capabilities and dependencies, then reran the full suite.
- Real-book upload: 69 chunks are saved privately in the designated account. During implementation, the first upload index was adopted into the resume index; no book text or credentials were copied to the repository. Local cloud read measured 33.978 seconds for one 2 MiB chunk, so end-to-end hosted processing will be verified in the same-region deployed runtime.
- API credential was configured as a protected production environment variable through the deployment provider. No secret value is recorded here.

- Real sample gate: six fixed source pages (40/160/320/480/640/760), 1,108,016-byte derived PDF, official VL-1.6 job completed in 42.295 seconds. Provider emphasis/footnote markup initially made the plain reader unsuitable; added narrow, audited Chinese-emphasis/circled-note decoding and edge-number filtering. Actual formula syntax remains unchanged.
- Ground truth was visually transcribed before seeing output. An enlarged source check corrected two transcription mistakes (one omitted character and one mistaken character), with both reference versions preserved privately. The resulting 907-character fixed excerpt comparison is exact; this is not a whole-book or human-adjudicated accuracy claim. Additional page inspection found remaining OCR/margin defects outside these excerpts.
- A second six-page experimental request timed out before returning a handle; it was not resent. This motivated persisted per-attempt batch identifiers and read-only reconciliation for uncertain submissions, verified to recover without another submission.
- The latest origin/main difference after #60 is documentation-only (#61); fetched and inspected before integration. Fresh GitHub checks remain the final merged-code gate.
- Production acceptance exposed a multi-batch recovery ordering defect: uncertain requests must be reconciled before submitting later batches. Added a failing regression, corrected the scheduler and retained bounded internal failure-stage/error-code diagnostics without exception messages or private content.
- Direct multipart transport of a real 4,106,027-byte/30-page batch timed out at 90 seconds locally. After official request-ID lookup returned no jobs, signed private file-URL transport returned a job in 1.661 seconds. Hosted submissions now use this official transport with a one-hour URL and 20 MiB per-object bound; raw PDFs and results remain private. Controlled operator recovery for the two initial requests is recorded privately.
