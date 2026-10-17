# GET-142 design acceptance and handoff

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Obtain an independent Codex review before PR delivery.

**Goal:** Reconcile the original private-reading-room design with recorded user decisions and observable preview behavior, without rebuilding shipped functionality or claiming that preview checks establish production acceptance.

**Architecture:** Keep the dated 2026-10-11 design as historical intent. Add a current, source-linked acceptance/handoff record separating explicit user requirements, later authorized direction, observed prototype behavior, and implemented product evidence. Make only demonstrated, necessary prototype fixes if acceptance exposes a defect; retain the original fixed criteria.

**Tech stack:** Existing static HTML/JavaScript design preview; source documentation; the existing built-in CUA browser for actual interaction, without starting a second browser stack.

**Spec:** Linear GET-142 and `_briefs/reader-demo.md`; current authority in `AGENTS.md`, `_briefs/product-brief.md`, and dated launch/experience records.

## Global constraints

- Worktree starts at public `getyak/leafhour` main `3851459ca0ce66a7ab93450ae4d6889f55f42b1e`.
- This issue is design acceptance and boundary documentation. Do not initiate full-book translation, paid models, a new deployment target, real notifications, or read/write another person's library.
- Existing source text, two translation drafts, editorial notes, user comments and AI candidates remain distinct. Prototype local storage is not production persistence.
- Use isolated loopback preview origins and synthetic personal comments/files only. Do not put uploaded books, credentials, user records, or copyrighted full books into Git.
- The current chat is attached to the unrelated Lighthouse repository; the native worktree tool cannot target another repository. An isolated public-source clone and Git worktree provide the equivalent latest-main baseline without touching the user's primary checkout.
- Record existing production facts only against their exact sources; a documentation merge is not proof of runtime behavior and does not authorize bypassing current PR checks.

## Design choice

Rebuilding the old React/SQLite proposal would conflict with the explicitly recorded later Node/JSON implementation and duplicate shipped work. Simply marking the old checklist done would omit responsive/keyboard/state proof. Choose a bounded source reconciliation plus real prototype interaction matrix and a handoff to the existing runtime. Historical user direction is recorded with dates and precise scope; no agent test is described as a new human visual approval.

## Frozen acceptance table — before implementation and UI tests

| ID / scenario | Expected result | Verification | Failure condition |
| --- | --- | --- | --- |
| D1 Recorded decisions | Separate explicit original requirements, later authorized direction and unconfirmed detail; four surfaces and independent goal/view/variant are mapped | Exact source paths and quotes/dates, checked against issue | Invented human approval, missing surface, stale proposal presented as current implementation |
| D2 Reading and source attribution | Preview renders source/translation/parallel, literal/interpretive separately; same passage identity and editorial attribution survive switches | Actual visible controls, DOM and screenshots | Wrong passage, coupled variant/view, authored text confused with editor or user |
| D3 Selection and keyboard | Selecting text or activating term/annotation controls does not flip the paragraph; explicit flip works by keyboard; close returns focus to opener | CUA selection/key actions and read-only DOM focus/state | Selection flips language, unreachable primary operation, lost close focus |
| D4 Personal records and privacy | Synthetic comment/question has user attribution and source anchor; empty records are clear; prototype-only persistence and export/grant limits are explicit | Local isolated preview UI and source handoff | Fake cloud save/AI execution/notification, cross-origin personal data, user words attributed to AI |
| D5 Missing and failure states | Untranslated content retains readable source with honest state; invalid record import rejected visibly; import failure leaves existing synthetic records intact | Separate synthetic package and invalid file through real loader/chooser; actual render/readback | Fake translation/success, data loss, silent error, inaccessible source |
| D6 Responsive rendering | At 390, 768, 1440px, reading/parallel/personal controls remain usable with no horizontal page overflow | Exact viewport override, screenshot, document/client widths, visible controls | Clipped/overlapping primary content or horizontal overflow |
| D7 Boundary and resource proof | Historical preview/sample checks, production evidence and remaining capability limits are distinct; no paid or notification call; task artifacts/preview server cleaned | Source links, local receipts, console observations, exact cleanup | Preview represented as full service/full translation, secrets/data committed, orphan task process |
| D8 Delivery | Independent review has no unresolved P0/P1; latest PR head checks pass; merge readback and applicable existing release verification recorded before Done | Reviewer record, current-head CI, PR/issue readback | Self-review only, old-head green, premature issue closure |

## Review focus

- Historical design approval must not be inferred from a screenshot or an LLM judgement.
- Optional missing private-book assets must not become fatal preview errors or a reason to publish the private book.
- Closing notes after a rerender must return focus to the current valid opener.
- A missing translation must not erase or relabel the original source.
- Documentation and local preview persistence must not overclaim cloud data ownership, paid execution, or the state of downstream issues.

## Tasks

### 1. Freeze and inspect

- [x] Read original issue, comments/attachments, current repository instructions and all required briefs.
- [x] Record this fixed table before implementation or UI testing.
- [x] Capture the current preview behavior and identify source-linked decision changes.

### 2. Complete the handoff

**Files:** create `docs/verification/2026-10-17-get-142-design-handoff.md`; link it from `_briefs/reader-demo.md`. Modify preview sources only for a reproduced in-scope defect and record the exact test.

- [x] Verify D1–D6 and D7 boundary/resource-scope observations using the existing preview and isolated synthetic fixtures. D7 artifact/server cleanup remains part of delivery closure.
- [x] Document observed results, exact source revision, responsive/keyboard behavior, empty/failure/untranslated states and remaining boundaries.
- [x] Run relevant source/tests or documentation integrity checks and inspect the complete diff.

### 3. Review and land

- [ ] Independent Codex reviewer checks original issue, frozen matrix, full diff and evidence; resolve confirmed P0/P1 and re-review changed code.
- [ ] Commit/push/create linked PR, attach it, verify all latest-head CI/gates, then merge normally.
- [ ] Verify merge and all applicable existing main/release checks, read issue state, record evidence and close only if all acceptance is met.
- [ ] Clean exact task artifacts and owned preview server, release own delivery lock, then select the next executable existing issue.

## Progress

2026-10-17: Claimed GET-142 from unassigned In Review; assigned to the connected current user and read back In Progress. No existing open Leafhour PR. Hourly automation deleted; work continues serially in this chat. Separate-account task scope question is pending but does not block this unassigned issue.

2026-10-17: D1–D6 observed in the isolated real browser preview; D7 boundary/resource-scope observations recorded, with artifact/server cleanup still pending delivery closure. No runtime changes; no red/green code test was introduced for this documentation-only correction. Release/public-build tests (9/9) and syntax checks passed. Screenshot/DOM/focus evidence is retained outside Git and the runtime; D8 remains pending.
