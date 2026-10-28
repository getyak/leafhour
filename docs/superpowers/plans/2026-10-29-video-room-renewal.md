# Video Room Renewal Implementation Plan

> For agentic workers: use native execution with a fresh reviewer for the finished branch. User authorized continuous execution and normal delivery.

**Goal:** Make search, personal records, calendar and shelf feel coherent and reliable while preserving the book-first reader.
**Architecture:** Refine existing native modules and CSS, without account/storage changes or new dependencies.
**Tech Stack:** Browser ES modules, CSS, Node test runner, existing local server.
**Spec:** docs/superpowers/specs/2026-10-29-video-room-renewal-design.md

## Global Constraints
- Four locales: en, zh-Hans, zh-Hant, ja. Preserve author/user text, stable IDs, source facts, provenance and sample limits.
- No paid generation, account writes, new dependencies or migrations. Isolated synthetic verification only.
- 44px targets; 320/390/768/1440 layouts; paper/night; reduced motion; keyboard and owner fences.
- Preserve unrelated primary-checkout edits. CI on branches only; Production only after normal merge.

## Review Focus
- Async notebook updates must not replace focused source links or publish another owner’s records.
- Reopen during loading must not restart every book request or retain another account’s data.
- Selected calendar dates distinguish loading, failure, genuine empty and guest states.
- Long foreign book titles and short/narrow windows retain close/search/navigation controls.
- Search localized updates retain option identity and selected keyboard destination.

## Task 1: notebook stability and persistent controls
Files: app/library-notebook-state.mjs, app/library-notebook.mjs, app/library-notebook.css, tests/library-notebook.test.mjs, server/library-service.mjs, server/portal.mjs, tests/library-notebook-page.test.mjs.
- [x] Pin reopen/update/owner behaviors with regression tests, demonstrate failure.
- [x] Implement authenticated account-bound pagination (12 books/page, 3 reads), oversized record fallback, in-flight deduplication, stable visible rows and bounded publication; sticky header and scrollable result region.
- [x] Run notebook tests and local visual/keyboard checks.

## Task 2: search hierarchy
Files: app/command-palette.mjs, app/command-palette.css, tests/command-palette.test.mjs.
- [x] Preserve combobox and IME behavior while separating result label and metadata into styled spans.
- [x] Refine header, icons, placement, selected state and short viewport overflow.
- [x] Run palette tests; verify title/author, four locales, selection, Escape, source jump and night.

## Task 3: calendar truth and shared visual treatment
Files: app/reading-dashboard.mjs, app/library-workspace.css, tests/reading-journal-dashboard.test.mjs.
- [x] Test selected-day loading/error/empty detail feedback before implementation.
- [x] Align dialog proportions and states; preserve measurement and source navigation.
- [x] Check guest, synthetic empty/populated/error month, keyboard month/day navigation and narrow height.

## Task 4: shelf and bilingual reading finish
Files: app/library-craft.css and existing parallel reading CSS owner after inspection.
- [x] Improve shelf hierarchy and long-title wrapping without data changes.
- [x] Check sample boundary, source selection and alignment; refine only visual defects visible in real screenshots.
- [x] Inspect desktop/mobile, paper/night, public catalogue, source versus translated reading.

## Task 5: delivery
- [x] Regenerate copy inventory; run affected tests, full suite and release builds.
- [x] Independent source review; fix findings and reverify.
- [ ] Commit only task files, sync main, push branch, create and attach PR.
- [ ] Wait for required CI, normal merge, verify exact deployed source and Production browser flows.
- [ ] Publish a concise Chinese audit/change list and validation limits with links.
