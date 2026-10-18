# GET-160 Book Introduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Parent implements; one independent Codex reviewer checks the complete diff.

**Goal:** Deliver persistent, bounded AI introduction drafts and the existing preview-first book gift flow from the reader title.

**Architecture:** Keep source descriptions immutable. Add an account/version introduction overlay, use the existing official Harness with no tools, and reuse the existing gift composer and publishing service. Local atomic files and hosted dataStore mutations enforce leases and quotas.

**Tech Stack:** Node ESM, native HTML popover/dialog, current DeepSeek Harness, current account storage.

**Spec:** `docs/superpowers/specs/2026-10-18-get-160-book-introduction.md`

## Global Constraints

- Exactly the B1–B11 frozen table in the spec; no weakening after implementation.
- No Pi/MiMo, new dependencies, new provider, global account/Onboarding changes or changes to another chat's work.
- Fixed max 6 paragraphs / 6000 characters / 24 chapter titles; 1 model request / 600 output tokens / 0.10 CNY / 60 seconds; no tools, notes, history or whole-book fetch.
- Local tests only; no Simulator. Default production acceptance account is test@cubxxw.com after actual auth identity readback.

## Review Focus

- A late response after a source revision or account logout cannot save a draft (Task 1 tests).
- A second service/process cannot claim an active lease or release a newer nonce (Task 1 tests).
- Restoring an old backup cannot invent reviewed status or overwrite an existing draft during preserveExisting restore (Task 1 tests).
- A popover closed during generation must not reopen or move the keyboard focus when the result returns (Task 2 tests/browser).
- Gift preview must never include the private AI introduction overlay or create a public link before sealing (Task 2 integration/browser).

### Task 1: Bounded generation, storage and portable provenance

**Files:** Create `app/book-introduction.mjs`, `server/book-introduction-store.mjs`, `server/book-introduction.mjs`, `harness/introduction-generator.mjs`, `tests/book-introduction.test.mjs`; modify `server/library-service.mjs`, `server/portal.mjs`, `app/library-backup.mjs`.

**Interfaces:** Shared `validateBookIntroduction(value,book)` returns a whitelisted AI draft or throws; `introductionFor(book)` returns display text/source. `createBookIntroductionService({library,store,generator,clock,timeoutMs})` exposes `view(user,id)` and `generate(user,id,{contentVersion},{authorize})`. Library applies/exports/restores its overlay without changing source description. Portal exposes GET/POST `/api/library/books/:id/introduction` with existing owner, CSRF and no-store boundaries.

- [ ] Write semantic failing tests for B1–B7, including two store instances and forced late generation.
- [ ] Run `node --test tests/book-introduction.test.mjs` and record expected RED.
- [ ] Implement validated input/provenance, atomic short leases/quotas, single bounded model call, response reauthorization, source-version fencing and portable overlay.
- [ ] Run targeted service/auth/backup/gift tests and record GREEN.
- [ ] Commit the complete reviewed deliverable after Task 2; retain source and test hashes.

### Task 2: Reader title actions and shared gift composer

**Files:** Create `app/reader-book-actions.mjs`, `app/reader-book-actions.css`, tests; modify `app/reader-navigation.mjs`, `app/reader.js`, `app/index.html`, `app/library-book-actions.mjs` and minimal existing styles/docs.

**Interfaces:** `mountReaderBookActions({document,getBook,api,session,bookId})` connects existing title popover controls to explicit generation and one actual gift composer dialog. It owns late-response/close/identity fences and returns refresh. Gift composer keeps its original publishing boundary and receives the actual current book, not a stale closure.

- [ ] Write failing tests for no generation on render/open, current book/version payload, closed-dialog callbacks, and no share publication on open/preview.
- [ ] Implement source/AI distinction and honest states; reuse gift composer, shared cover, close/focus behavior.
- [ ] Run targeted and full tests/build once; inspect actual 390/768/1440 UI and keyboard with synthetic local data; real default-account production acceptance only after normal release.
- [ ] Independent review against original issue, fixed table, full diff and evidence; fix confirmed P0/P1 and get re-review.
- [ ] Create/attach PR, verify exact head CI/deployment, merge normally, verify production and read back Linear Done only when B1–B11 all pass.
