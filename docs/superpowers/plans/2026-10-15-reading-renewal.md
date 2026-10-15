# Page by Page Reading Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user selected the brand and authorized autonomous overnight refinement in the current chat; keep the existing inline execution method and obtain one independent whole-branch review.

**Goal:** Help a person continue one book day by day with a truthful reading calendar, retained understanding, and a coherent, immersive Page by Page interface.

**Architecture:** Extend the existing per-owner book records, atomic local files and hosted CAS documents. Domain activity logic is independent of DOM; a small reader clock/outbox feeds the same service used by calendar, exports and authorized Agent reads. Preserve auth, stable anchors and all existing content.

**Tech Stack:** Existing Node >=22.13.0, native HTML/CSS/JavaScript modules, node:test, Supabase document store, Vercel; builtin image generation for project assets. No framework migration.

**Spec:** `docs/superpowers/specs/2026-10-15-reading-renewal-design.md`

## Global Constraints

- Brand: 循页 / PAGE BY PAGE. Keep domain, book IDs, backup kind, storage keys and existing provider identity compatible.
- Deadline: Asia/Singapore 2026-10-15 09:00; stop new edits at that time and pause heartbeat 8.
- Record schemaVersion=3; old 1/2 importable. Real source reader_focus; legacy design_preview_focus_timer never reclassified.
- Session segments <=120, elapsed span <=24h, sequence monotonic; checkpoint every 30s and on lifecycle transitions.
- Pending snapshots <=20 per owner/book; exact id/sequence acknowledgement, no cross-account replay.
- Daily goal integer 5-120 minutes, default15. Completed chapters/books only from explicit user milestones.
- Calendar YYYY-MM and IANA timeZone; split midnight, deduplicate overlapping daily time; detail <=20 rows.
- Homepage dials 7/4/3, dashboard5/3/5, prose3/2/4; 390/768/1440px, reduced motion, themes, readable content and 44px controls.
- No private samples, credentials or internal docs to public/deploy mirrors; no model generation, purchases, notifications or permission expansion.

## Review Focus

- Checkpoint finishes out of order after a newer final snapshot; preserve final status, interval total and newer outbox entry. Task1/3 pin this.
- Midnight, leap February and DST offsets; activity must stay on the actual reader-local date with no double-counted time. Task1 pins this.
- Switching owner while calendar data or an activity write is in flight; clear old UI and never replay to new owner. Task3/4 pin this.
- A valid old backup mixed with new session/milestone records; validation before mutation, preserve old data and exact anchors on clean restore. Task1/2 pin this.
- Chapter jump, selected text and note panel inside focused reading; retain source anchor and avoid accidental completion or content transmission. Task6 actual browser pins this.

### Task 1: Activity domain, truthful totals and backup contract

**Files:** Create `server/reading-activity.mjs`, `tests/reading-activity.test.mjs`; modify `app/library-backup.mjs` and its existing library tests as needed.

**Interfaces:** Produce `normalizeReadingSession(input,book,now)`, `mergeReadingSession(previous,next)`, `normalizeReadingMilestone(input,book,now)`, `readingJourney(book,records)`, `buildReadingCalendar(entries,{month,timeZone})`; entries are `{book,records}`. Duration derives from normalized segment intervals. Backup validation consumes exactly these persisted fields and allows schema1/2/3.

- [x] Write tests for real segments, overlapping intervals, invalid/future/overlong times, bad anchors, stale sequence and immutable start conflict, chapter/book explicit events, calendar midnight/leap/DST and legacy-source exclusion, old/new backup rejection boundaries.
- [x] Run `node --test tests/reading-activity.test.mjs`; Expected: new domain behavior missing, correct semantic failures.
- [x] Implement specified pure domain interfaces and backup compatibility without rewriting legacy history.
- [x] Run same test command; Expected: all new cases pass; run existing library backup cases after touching that validator.
- [x] Commit domain and contract.

### Task 2: Durable owner-scoped activity service and API

**Files:** Modify `server/library-service.mjs`, `server/portal.mjs`; create `tests/library-reading.test.mjs`; extend `tests/portal.test.mjs` and `tests/mcp.test.mjs` only for relevant boundaries.

**Interfaces:** Consume Task1; produce `saveReadingSession(user,bookId,input)`, `recordReadingMilestone(user,bookId,input)`, `setReadingGoal(user,bookId,{minutes})`, `readingActivity(user,{month,timeZone})`. List includes journey summary; records/exports retain all new fields. HTTP GET `/api/library/activity`; per-book POST `reading-sessions`, `reading-milestones`, `reading-goal`; existing Agent activity stays read-only and scoped.

- [x] Write failing tests for persistence through a recreated service, concurrent writes, idempotent duplicates and stale snapshots, owner isolation, read-only Agent access, goal/status changes and fresh-instance backup restore.
- [x] Run `node --test tests/library-reading.test.mjs tests/portal.test.mjs tests/mcp.test.mjs`; Expected: new service/routes unavailable while old boundaries remain exercised.
- [x] Implement via existing atomic mutation/CAS; add no new storage credentials or broad permissions. Restore sessions with sequence-aware merge and milestones by stable id.
- [x] Run same test command; Expected: pass and restored calendar matches original.
- [x] Commit service/API.

### Task 3: Frontstage reading clock and durable retry outbox

**Files:** Create `app/reading-clock.mjs`, `app/reading-outbox.mjs`, `tests/reading-clock.test.mjs`, `tests/reading-outbox.test.mjs`.

**Interfaces:** Produce `createReadingClock({now})` with start/context, pause/resume, visibility/focus transition and snapshot; snapshots carry Task1 input. Produce `createReadingOutbox({load,save,send})` with enqueue/flush/size and exact sequence acknowledgment; callers supply owner/book-scoped storage.

- [x] Write failing tests: untouched page records nothing, explicit start visible only, hidden/blur pause, return/resume behavior, monotonic sequence, midnight intervals, duplicate enqueue, delayed success retaining newer snapshot, failures survive reconstruction, queue capacity20 and owner-separated stores.
- [x] Run `node --test tests/reading-clock.test.mjs tests/reading-outbox.test.mjs`; Expected: new state machines unavailable.
- [x] Implement bounded state machines with injected time and no DOM dependency.
- [x] Run same test command; Expected: all cases pass, clock/outbox snapshots match Task1 contract.
- [x] Commit client domain.

### Task 4: Reading dashboard and calendar

**Files:** Create `app/reading-calendar.mjs`, `app/reading-dashboard.mjs` and related pure presentation tests if needed; modify `app/home.html`, `app/portal.js`, `app/portal.css`, route asset maps.

**Interfaces:** Consume Task2's actual activity/journey, owner-guarded existing api, books/session. Calendar generates real month grid and day detail; dashboard exposes one current-book resume, chosen monthly day, duration/notes separated, goal and finish/reopen controls.

- [x] Pin month grid, date selection, stale response sequence and empty/error data with meaningful pure tests; verify missing new API/asset routes with HTTP test where appropriate.
- [x] Run relevant calendar/portal tests; Expected: new behavior missing.
- [x] Implement progressively revealed day detail and explicit user milestone controls; clear private activity in `clearPrivateUI`, preserve auth/upload/Agent/backup IDs. Do not populate fictional activity.
- [x] Run relevant tests and real local page interactions: empty calendar, actual test reading session/day, change month/date, book return, refresh, owner switch.
- [x] Commit dashboard/calendar, record actual browser boundary.

### Task 5: Brand and editorial homepage

**Files:** Modify `app/home.html`, `app/portal.css`, visible titles in `app/portal.js`, `app/privacy.html`; create `app/brand-assets/` files and source notes; add asset routing as needed.

**Interfaces:** New typography/color/radius tokens are reusable by dashboard/auth. Existing /library, /read and anchors how/ownership remain valid. No rename of machine identity or provider callback.

- [x] Save actual before views; audit current composition, text hierarchy, obsolete hero and repeated decoration.
- [x] Generate and inspect custom reading-environment art with builtin imagegen, copy final assets into project; optimize delivery formats through a permitted tool/workflow and preserve originals.
- [x] Implement “每天读一点，读完一本想读的书” composition, real book preview/CTA, truthful calendar/understanding value and privacy/data control; match confirmed brand. Only use delivered capabilities in homepage claims.
- [x] Verify actual desktop/narrow theme and reduced-motion states, visible action, contrast, image fallback, no overflow, correct links. Pure visual edits do not need mirror-the-markup unit tests.
- [x] Commit assets/homepage and provenance; no private research copied.

### Task 6: Immersive reading, retained reflection and explicit completion

**Files:** Create `app/reading-session.js` and optional dedicated CSS; modify `app/index.html`, `app/reader.js`, `app/styles.css`, serving maps. Create/extend focused tests only for new behavior requiring automated pinning.

**Interfaces:** Consume Task1/2/3; connect existing `window.marginaliaReader` anchor/book bridge and readerFetch, plus existing notes/questions. Start, pause, resume, finish and chapter-read are explicit controls. Optional reflection/question save independently and retain drafts on failure.

- [x] Write failures for any additional non-DOM state/contract; run them before implementation.
- [x] Connect clock/outbox to actual lifecycle, 30-second checkpoints and keepalive exit. Server roundtrip uses current owner identity; no silent guest migration. Leave visit/progress independent from completion.
- [x] Add contextual deep-read guide and optional ending sheet; source-aware text selection, chapter jumps and focus preserve anchor. Open reading has no automatic model calls.
- [x] Run relevant tests plus actual local loop start/pause/hide/resume, chapter read/reopen, finish with own words, refresh, calendar/date and source return, export and clean restore. Validate old reading modes/translation/notes and login flow. Boundary: the IAB cannot prove ordinary OS/tab-background transitions; pure hidden/focus cases and a real stopped-script interval were verified instead, with physical-device behavior explicitly unclaimed.
- [x] Commit reader loop and evidence.

### Task 7: Independent review, controlled publishing and continued refinement

**Files:** Relevant docs/readme and private verification ledger; mirrors contain only approved source/assets.

**Interfaces:** Whole branch against cc6414a. Review all Focus cases; use current authentication implementation unchanged except shared visual tokens/name.

- [x] Run full `npm test`, `npm run build:vercel`, `git diff --check`; Expected: all pass, no private assets added.
- [x] Build review package; dispatch one fresh whole-branch reviewer per executing-plans skill. Reproduce material findings with failing tests, fix, run appropriate suite; record rulings, no blind review loop.
- [ ] Publish reviewable private/public/deploy PRs only in existing repositories, attach each, verify CI and exact heads, merge authorized changes and verify Vercel production health/real new flow; keep deployment protection and callbacks.
- [x] Reconcile Notion product/source records minimally and read back, preserve credentials; keep user-uploaded research private. Copy/art source notes remain truthful.
- [ ] Until09:00, improve concrete remaining reading/friction/visual issues against real evidence and record each validated change. At09:00 stop new edits, pause heartbeat8, final outcome with actual boundaries; do not manufacture continuous work or improvements.

Closeout snapshot: implementation and product publishing are complete. Private archive PR8 is merged only after this snapshot’s CI passes; the final deadline action is confirmed by local/verification/reading-renewal/closeout-result.json, not by a pre-filled checkbox.
