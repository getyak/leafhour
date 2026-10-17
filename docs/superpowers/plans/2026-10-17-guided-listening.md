# Guided Listening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Independent content and persistence modules use parallel agents; integration and final review remain sequential.

**Goal:** Deliver quiet source-grounded chapter/book audio assistance through the existing reader.

**Architecture:** Guide jobs read bounded source batches, verify scripts, register versioned dialogues and call the shared audio module. Durable audio tasks use CAS leases and private blobs. Reader actions share one player and existing conversation.

**Tech Stack:** Existing Node ESM/DOM application, Supabase document CAS/private blobs, official DeepSeek REST and Gemini Interactions; Vercel request-lifetime background support.

**Spec:** `docs/superpowers/specs/2026-10-17-guided-listening-design.md`

## Global Constraints

- `DEEPSEEK_API_KEY` and `GEMINI_API_KEY`; no new daily key.
- Original text and stable paragraph IDs remain unchanged; no private notes in guides.
- No automatic paid retry; explicit cancel; preserve previous sessions and backups.
- Public AGPL repository; secrets/runtime data remain ignored and private.
- Default persistent verification owner is the live Auth ID of `test@cubxxw.com`.

## Review Focus

- Repeated requests on two instances must not duplicate paid generation.
- Expired in-flight leases must not be silently reissued.
- A moved/current passage or fiction introduction must not expose later source.
- Guided scene backup restoration must recompute source/style/cache identities.
- Closing an asynchronous panel or switching accounts must not publish stale UI/audio.

### Task 1: Source-grounded guide module

Files: new `server/listening-guide-content.mjs`, `server/listening-guide-generator.mjs`, `server/listening-guide-service.mjs`, related tests.

Interfaces: `guideScope(book,input)` and `validateGuide(book,scope,candidate)` return `kind:'guided-listening'`, intent/scope/version/coverage, passage IDs, source hashes and validated turns `{speaker,text,style,sourceRefs}`. `createListeningGuideService({audio,library,generator,schedule})` exposes `prepare(owner,bookId,input)`, `create(owner,bookId,input)`, `get(owner,bookId,id)`, `cancel(owner,bookId,id)`. Jobs use `audio.store` and `audio.schedule`; final scripts enter `audio.registerDialogue(owner,bookId,candidate)`, then `audio.createSession`.

- [ ] Write/run failing scope, source, all-book coverage, bounded job, duplicate and cancellation tests.
- [ ] Implement bounded durable stages; include support verification and source-hash checks before publishing.
- [ ] Run focused tests; document public interfaces and commit only owned files.

### Task 2: Durable audio and native scenes

Files: `server/audio-service.mjs`, `audio-store.mjs`, `audio-backup.mjs`, new `audio-scenes.mjs`, `server/portal.mjs`, `api/[...path].js`, package dependency/lock, relevant tests.

Interfaces: `createAudioStore({dataDir,dataStore})` supports the existing methods using CAS/blob storage when hosted. `createAudioService` accepts `schedule(promise)` and `durable`; exposes `schedule`, `registerDialogue`. Guided candidates validate with Task 1's `validateGuide`. Legacy dialogues use existing validation. Scene version 3 groups speaker/style/source-preserving turns for a native two-speaker synthesis call. Hosting passes a request-attached scheduler, not untracked fire-and-forget work. `createPortal` additionally accepts `guideGenerator` and passes it to routes.

- [ ] Write/run failing cross-instance lease, interrupted/no-paid-retry, private persistence, limit and cancellation tests.
- [ ] Implement bounded workers, scene synthesis and versioned backup recovery.
- [ ] Enable hosted audio with safe quota guards and request-lifetime scheduling; no real secrets in code.
- [ ] Run affected legacy and new tests; commit owned files.

### Task 3: Reader integration

Files: `server/audio-routes.mjs`, `server/server.mjs`, `app/reader-audio.js`, new small audio interaction helper, `app/reader-conversation.mjs`, styles/labels, release allowlist and UI tests.

Interfaces: authenticated `/audio/guides/prepare`, `/audio/guides`, `/audio/guides/:id`, `/audio/guides/:id/cancel`; guide job polling yields an existing audio session ID. Reader conversation receives a bounded source-linked draft and explicit ask/continue events. Existing audio routes remain compatible.

- [ ] Write/run failing HTTP authorization, guide polling and player ask/resume tests.
- [ ] Implement three chapter choices, book orientation, scope/cost disclosure and optional transcript.
- [ ] Keep explanation pages stable; add Media Session controls and safe WAV download names.
- [ ] Verify keyboard, mobile, cancellation, source navigation and restore in a real browser.

### Task 4: Delivery

- [ ] Run `npm run verify:deploy`, review the complete diff independently, fix material findings.
- [ ] Run bounded real generation under the default account and record actual playback evidence separately from fixtures.
- [ ] Document configuration/acceptance and public preparation tooling; register new release files.
- [ ] Commit/push, create/attach PR, pass CI, merge normally, verify production source and representative flow.
