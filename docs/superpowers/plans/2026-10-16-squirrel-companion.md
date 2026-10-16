# Squirrel Companion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. The user reviewed the design, changed the interval to five minutes, and explicitly requested implementation. Finish with one fresh whole-branch review.

**Goal:** Let a reader enable the existing squirrel to occasionally send a short asynchronous message that opens the same book conversation.

**Architecture:** Deterministic browser observation and server admission control select bounded current-book context. The existing DSH runtime generates one message or silence; the existing chat record stores AI-origin companion messages without user-question side effects. Consent revisions and shared leases govern cancellation.

**Tech Stack:** Existing Node ES modules, native DOM/CSS, official DSH SDK, existing atomic local/hosted store. No new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-squirrel-companion-design.md`.

## Global Constraints

- Default off, current account and book, no private notes, no future chapter or other book reads for proactive generation.
- First attempt: 90 seconds foreground reading and two observed passages; subsequent attempts: five minutes and three newly observed passages. A passage qualifies after eight visible seconds; new chapter needs 45 foreground seconds.
- Three attempts per reading session and three per account per rolling hour, including silence/failure. Shared ten-per-hour chat total and two global concurrent runs still apply.
- One model request, no tools or automatic retries; conservative maximum reservation 0.10 CNY. Silence is a valid outcome.
- Wait six seconds after scrolling, avoid selection/input/dialogs; wait at most 60 foreground seconds for presentation. Auto-collapse after 12 seconds except hover/focus/selection.
- Closing companion invalidates pending runs; no background catch-up, false user turns, overwritten drafts, copied squirrel, new IM, or runtime data in Git.

## Review Focus

- A second tab or rapid toggling must not bypass consent revision, session limits, or shared quotas; cover concurrent service instances in Task 2.
- A completed companion entry must not be restored as a user draft or question when loading chat; cover mixed histories in Tasks 2 and 3.
- Account/version changes or disable during generation must reject late publication; cover persisted state and HTTP guards in Task 2.
- Hidden windows, long paragraphs, rapid chapter jumps and an open note/IM must never produce a surprise bubble; cover clocks in Task 1 and browser flows in Task 4.
- Clicking a bubble with a preexisting draft must locate the AI message without clearing text or scrolling the book; cover UI and live browser flows in Tasks 3 and 4.

## Task 1: Reading clock and eligibility

**Files:** create `app/reader-companion-state.mjs`, `tests/reader-companion-state.test.mjs`.

**Interfaces:** `createReaderCompanionState({clock=Date.now})` returns configure, sample, activity, attempted, suspend, view. `sample({passageId,chapterId,visible,focused,blocked,eligiblePassage})` advances bounded foreground time; view exposes activeMs, qualified IDs, eligibility and safeToPresent. Export `COMPANION_TIMING` with production defaults. No test-only runtime flags.

- [x] Write behavior tests for warm-up, five-minute minimum, new passage counts, long passage observation, idle/hidden exclusion, chapter warm-up, interruption windows and reset/revision changes.
- [x] Run `node --test tests/reader-companion-state.test.mjs`; expect missing module/API failures before implementation.
- [x] Implement the deterministic state machine and run the same tests to PASS.
- [x] Commit this task's state and tests with the approved spec and plan.

## Task 2: Authorized companion messages and bounded generation

**Files:** create `server/reader-companion.mjs`, `harness/companion-generator.mjs`, `tests/reader-companion.test.mjs`, `tests/companion-generator.test.mjs`, `tests/reader-companion-http.test.mjs`; modify `server/reader-chat.mjs`, `harness/chat-generator.mjs`, `server/portal.mjs`, `server/server.mjs`.

**Interfaces:** existing chat service gains `companion.view(user,bookId)`, `configure(user,bookId,input)`, `observe(user,bookId,input)`, `generate(user,bookId,input)` and cancellation through normal chat cancel. Configure accepts enabled/contentVersion; observe accepts revision/contentVersion/passageId and bounded activity; generate accepts stable id/revision/contentVersion/sessionId/passageId. HTTP routes live under `/api/library/books/:bookId/companion[/observe|/messages]` with existing identity/origin guards. Mixed turns use `kind:'companion',origin:'ai',text:null,answer.summary`; user turns retain original format. Generator factory `createCompanionGenerator(options)` returns message/silence; reuse configurable budgeted chat runtime with empty tools and separate system prompt.

- [x] Write service tests for default off, canonical observed context, no notes/question writes, fake/future IDs, exact source checks, silence, shared quotas, retries, disable/race and mixed-history export/readback.
- [x] Write generator tests using the existing injected harness seam for one request, empty tools, bounded payload, structured output and cancellation. Write authenticated HTTP denial/enable/observe/message/readback tests.
- [x] Run the new tests and observe intended failures; implement domain storage/admission, the generator and routes until PASS.
- [x] Run new tests plus `tests/reader-chat.test.mjs`, `tests/chat-runtime.test.mjs`, `tests/library-chat-http.test.mjs`; expect all PASS. Commit.

## Task 3: Squirrel bubble, controls and IM continuity

**Files:** create `app/reader-companion.mjs`, `app/reader-companion.css`; modify `app/reader-conversation.mjs`, `app/library-chat.mjs`, `app/library-chat-state.mjs`, `app/index.html`, `tests/reader-conversation.test.mjs`, `tests/library-chat.test.mjs`; add focused UI tests where the existing DOM harness supports them.

**Interfaces:** reader adapter mounts companion with current owner/book/reader/api and chat controls. Existing chat exposes launcher/header mount points, open({messageId,passageId}), refresh and lifecycle notifications. Companion controller observes actual DOM passage visibility, sends throttled observations, handles safe presentation and consent updates. Mixed AI entries never create pending user state or draft recovery. Reader-only controls do not add companion to the library surface.

- [x] Write failing behavior tests for AI-only entries, draft-preserving message targeting, adapter guards and cancellation hooks.
- [x] Implement controls and bubble using existing colors/type/squirrel. Validate HTML safe text, accessible controls, keyboard focus, reduced motion, 320px sizing and mobile keyboard behavior.
- [x] Run state/service/chat/adapter tests to PASS. Commit.

### Task 3 motion extension (user steering, 2026-10-16)

Add `app/squirrel-motion.mjs` using the existing body/eyes/head/tail and native Web Animations. Ambient blink/breath/tail stays local; thinking follows real jobs; message and pointer reactions are bounded. Hidden, unfocused and reduced-motion states cancel native animations and timers. Verify lifecycle with `tests/squirrel-motion.test.mjs` and live browser frame sampling.

## Task 4: Verification, release and delivery

**Files:** update `release-files.json`, relevant `_briefs/` trigger boundaries, `README.md`; create `docs/verification/2026-10-16-squirrel-companion.md`.

- [x] Register runtime assets/modules/tests in the existing release contract. Run full `npm test`, build and `verify:deploy`; fix relevant failures with a regression test.
- [x] Start a separate isolated local server and perform real browser flows for enabling, actual waiting/observation, ignoring, opening IM, continuing with a draft and disabling. Check blocked/hidden/mobile behavior. Keep fixture mechanisms and real model quality evidence distinct.
- [x] Run a small bounded real-model check if credentials/runtime are available without exposing them. Record any remaining gate explicitly.
- [x] Dispatch one independent whole-branch reviewer using requesting-code-review; fix material findings with regression checks. Do not merge with unresolved blocking checks.
- [ ] Sync main, rerun required checks, push this branch, create and attach PR, wait for CI then normal merge under existing user authorization. Verify remote merge and automatic deployment/source identity and representative production routes.
