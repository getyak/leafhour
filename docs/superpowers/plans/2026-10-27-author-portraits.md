# Author Portraits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved literary-museum person experience, evidence-backed work context, sharing, authoring skill, scoped Agent management and measured acceptance.

**Architecture:** Keep the existing Node/HTML/DSH stack. A shared people service owns public seed records, private account overlays, revisions, tasks and public snapshots. The page and bounded tools project this same data; paid generation is separate from CRUD.

**Tech Stack:** Node 22, ES modules, existing JSON transactional storage, MCP SDK, official DSH runtime, native browser APIs and CSS/WAAPI.

**Spec:** `docs/superpowers/specs/2026-10-27-author-portraits-design.md`, approved by user on 2026-10-27. Additional direction: carefully craft every button, interaction and animation, with richer motion and uninterrupted completion.

## Global Constraints

- Preserve unrelated dirty work in the original checkout; use this worktree and `codex/author-portraits`.
- Four interface locales: `en/zh-Hans/zh-Hant/ja`; real content fallback must remain explicit.
- Exact originals and source identities survive editorial changes. Causal relationships require supporting claims.
- Ordinary tool request maximum 8 KiB, tool result maximum 24 KiB; revision-bound pagination.
- CRUD never starts a model request. Generation needs separate preparation, bounded funding and cancellation checks.
- Private records belong to captured Auth identity. Public snapshots contain only public projections; deletion revokes shares.
- Reduced-motion preserves content and controls. 44 px targets; 320/390/768/1440 px layouts.
- No Preview deployment. Normal PR/CI merge and same-commit Production verification are already authorized.

## Review Focus

- Same-name people and original author/translator ambiguity must not join identities.
- Closing a task, changing account or revoking access must fence late model writes.
- A private overlay and its old public shares must not leak private books or translations.
- Long translated names, excerpts, keyboard navigation and reduced-motion must preserve readable layout.
- Missing/inaccessible sources and approximate dates must remain honest, with no invented causal narrative.

## Execution and ownership

The user explicitly requested immediate complete execution; no further plan approval is needed. Apply `dispatching-parallel-agents` only to the disjoint ownership below. Keep a single integration controller and one fresh whole-change review. Tests precede behavior changes; cheap visual styling is checked in the real browser rather than by mirrored unit tests.

## Shared person contract

Records have `schemaVersion:1,id,revision,visibility,originalName,names,intro,birth,death,portrait,periods,events,works,contexts,excerpts,sources,claims`.

- `names/intro` are locale-to-string maps. Dates are `{value,precision,claimIds}` or null.
- Period: `{id,from,to,title,summary,eventIds}`; `title/summary` are locale maps.
- Event: `{id,date,title,body,kind,workIds,claimIds}` with locale maps for text.
- Work: `{id,title,originalTitle,kind,year,bookId,summary,claimIds}`; `bookId` only maps a public catalogue work.
- Context: `{workId,body,relationship,eventIds,claimIds,excerptIds}`; relationship uses spec's four values.
- Excerpt: `{id,text,language,workId,sourceId,locator,claimIds,translations}`; translation entries contain `{text,status,attribution}`.
- Source: `{id,url,title,publisher,accessedAt,license,excerpt,read,digest}`; excerpts are evidence text, not executable instructions.
- Claim: `{id,text,sourceIds,status}`; status is `verified|uncertain|interpretation`.

### Task 1: People domain, revisions, shares and bounded tools

**Files:** Create `app/person-model.mjs`, `server/people-service.mjs`, `server/people-tools.mjs`, `server/people-routes.mjs`; tests `tests/people-service.test.mjs`, `tests/people-tools.test.mjs`, `tests/people-http.test.mjs`.

**Interfaces:** `createPeopleService({dataDir,dataStore,seeds=[]})` returns async `list(user,options)`, `get(user,id,options)`, `create(user,input)`, `update(user,id,input)`, `remove(user,id,input)`, `restore(user,id,input)`, `exportRecord(user,id)`, `preview(user,id)`, `publish(user,id,input)`, `revoke(user,id,shareId)`, `getShare(shareId)`. Writes include `requestId`, updates/deletes include `expectedRevision`. `list` returns `{people,nextCursor}`. `createPeopleTools({people,user,allowedIds=null,allowWrites=false,allowCreate=false,signal})` returns `{definitions,execute}`. `createPeopleRoutes({people,auth,...})` supplies existing-portal compatible routing; integration owner wires it.

- [ ] Write/run failing isolation, CAS/idempotency, tombstone/share-revocation, invalid proof/quote, cursor/scope tests.
- [ ] Implement exact schema, local/durable store parity, strict projected exports and shared transactions.
- [ ] Implement tools and HTTP parsing with captured identity, origin checks delegated to portal, bounded results.
- [ ] Run task tests and record commands/results. Do not commit another owner's files.

### Task 2: Literary page, management, sharing and reader return

**Files:** Create `app/people.html`, `app/people.css`, `app/people.mjs`, `app/people-copy.mjs`, `app/person-share.mjs`, `app/person-motion.mjs`, `app/person-return.mjs`; modify only `app/reader-book-actions.mjs` and its CSS/bootstrap as needed for author entry. Tests `tests/person-return.test.mjs`, `tests/person-share.test.mjs`.

**Interfaces:** Page routes `/people/:id`, `/people` and `/p/:shareId` serve the same shell; fetch `/api/people`, `/api/people/:id`, `/api/people/shares/:shareId`. Other actions are POST `/api/people/:id/{update,delete,restore,preview,publish,export}` with revision/requestId. Optional generation uses prepare/generate/status/cancel routes defined by Task 3. Root provides route/static wiring. Avoid changing shared UI catalogues; this feature owns an equivalent four-locale module.

- [ ] Write/run meaningful tests for private return validation and export geometry/escaping.
- [ ] Implement discovery/search, person and work narrative, evidence drawers, complete chronology, author-entry return state, private management, loading/error/empty states.
- [ ] Implement share preview, copy/download/system sharing, full excerpt pagination and cancel recovery.
- [ ] Craft reusable motion: button feedback, sheet transition, active timeline marker, work expansion and return continuity; visible content without animation and reduced-motion fallback.
- [ ] Browser-check four sizes, keyboard, large text/night/reduced motion and image output. Record screenshots, then fix visible defects.

### Task 3: Researched cases, source reader, skill and generation

**Files:** Create `catalog/people/*.json`, `catalog/people/manifest.json`, local portrait assets with licence record, `skills/leafhour-author-portrait/SKILL.md`, `skills/leafhour-author-portrait/references/contract.md`, `server/people-sources.mjs`, `server/people-generation.mjs`, `harness/person-generator.mjs`; tests `tests/people-sources.test.mjs`, `tests/people-generation.test.mjs`, `tests/people-seeds.test.mjs`.

**Interfaces:** `loadPeopleSeeds({catalogDir})` exported from `server/people-sources.mjs` returns records in the shared contract. `searchPeople(query,{locale,signal})` returns bounded identity candidates. Registered source reading uses fixed/verified hosts and blocks private addresses/redirects. `createPeopleGeneration({people,generator,search,sourceReader,store,...})` supplies prepare/generate/status/cancel with explicit revision, requestId and funding checks; never auto-calls on page GET. `createPersonGenerator({env})` uses existing official DSH with actual loaded skill text and provenance. Integration owner wires billing/runtime/routes.

- [ ] Write/run failures for source allowlist/private targets, quote mismatch, cancellation/late result and schema rejection.
- [ ] Research and deliver complete Woolf/Shelley cases, supporting public facts for Carse, exact local/external excerpt version mappings, genuine portrait licences; four-language content where actually authored.
- [ ] Implement source search/read, bounded generation, actual versioned skill loading and validation; no template outcome presented as generation.
- [ ] Run tests; record actual network/model coverage and metering limits separately.

### Task 4: Integration, OAuth, funding and benchmark

**Files:** Modify `server/portal.mjs`, `server/server.mjs`, `server/reader-chat.mjs`, `server/reading-agent-tools.mjs`, `server/mcp-http.mjs`, `server/mcp-oauth.mjs`, `server/library-service.mjs`, `server/credit-gate.mjs`, billing catalogues as required, `vercel.json`, `tools/build-vercel.mjs`; create bounded people auth adapter if needed. Add `tools/benchmark-people.mjs`, `tests/people-integration.test.mjs`, frozen benchmark cases and verification record.

**Interfaces:** Consume Tasks 1–3 without changing their field names silently. Existing book grants stay unchanged. Independent people grants select at most 20 people, separately allow create/generate, and filter every operation. Per-run generation preparation never derives funding consent from read/write scopes.

- [ ] Run baseline tests after clean dependency setup; record pre-existing failures without hiding them.
- [ ] Add failing route/tool-scope/funding tests, integrate services, static/production routes and reader context; then make tests pass.
- [ ] Add selected-person OAuth and optional standalone/local MCP tool access, with origin, expiry and revocation checks.
- [ ] Freeze 24 benchmark scenarios × 3 runs and score rubric before execution; distinguish deterministic tests, real public search, real generation and independent visual review.
- [ ] Run required tests/build/copy checks; fresh independent whole-change review, fix Important/Critical findings and verify again.
- [ ] Commit only task changes, push, create/attach PR, wait CI, merge normally, follow Production and same-commit live acceptance.

## Progress ledger

2026-10-27: Design approved, worktree created at public `origin/main` f03d593. User requested full uninterrupted implementation with richer interaction/motion. Source checkout dirty work preserved. Preflight: Tasks 1/2/3 own disjoint files and share the exact contract above; Task 4 is the only owner of portal, grants, billing and deployment. No conflicting file ownership.

2026-10-27 implementation update: Tasks 1–3 implemented; domain 24/24, interface+component 68/68, generation/source 23/23 targeted checks. Independent OAuth/MCP transport checks 53/53. Real browser checked four sizes, public snapshots/revocation and exact reader-return draft. Full benchmark first pass preserved 62/72 (10 failures; no schema-invalid candidate saved); bounded format corrections are separate evidence.

Ruling: Preserve the existing 320 KiB reader JS and 200 KiB CSS budgets. Load person return and companion implementation on demand; keep companion anchor and reading controls immediate. Expose companionReady for real mount verification. New author-entry CSS loads with the optional book-information enhancement.

Ruling: Generation uses an explicit sponsored person-portrait gate capped at US$0.02 per attempt, 20 attempts per account/day and 80 globally/day; it does not debit reading credits or purchase capacity. Provider usage keeps unknown versus rated status.
