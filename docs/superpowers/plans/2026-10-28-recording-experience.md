# Recording-led Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Resolve the recorded reading interruptions and improve the real trial without changing the established paper reader.

**Architecture:** Keep `reader.js` as the paragraph-selection owner, `reading-toolbar.mjs` as the global-tray owner and `library-chat.mjs` as the quote renderer. Use their existing navigation and event boundaries. Homepage work retains its current source examples and localizations.

**Tech Stack:** Native HTML/CSS/JavaScript modules, Node 22, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-recording-experience-design.md`

## Global Constraints

- 44px minimum action targets; 320/390/768/1440px responsive checks.
- Preserve the book-first paper reader, private data, native selected text and four interface languages.
- No new model calls, account writes, dependencies, framework or storage migration.
- Existing progress must still resume accurately. Historical text remains a snapshot.
- Raw recording frames remain local. Public docs contain only sanitized observations.

## Review Focus

- Touch/keyboard selection may legitimately scroll the page while extending the quote; preserve it.
- Browser layout restoration emits scroll too; do not close tools when no reading intent occurred.
- More-menu scrolling belongs to the menu, including a near-bottom toolbar.
- Same-book quote navigation must preserve an unsent draft and not grant wider access.
- A 320px Japanese toolbar must work independently of audio styling.

### Task 1: Paragraph tool lifecycle

**Files:** `app/reader.js`, `app/styles.css`, `tools/verify-recording-experience.mjs`; affected `tests/toolbar-placement.test.mjs`, `tests/reading-toolbar.test.mjs`.

**Interfaces:** Existing `dismissTools({preserveSelection})`, `choosePassage(id)`, `reader:selection`, `reader:selection-end` and global toolbar change. No new persistence API.

- [x] Add a real-browser reproduction for scroll dismissal, selection preservation, menu scroll, narrow targets and keyboard focus return; run on the unchanged code and retain failures.
- [x] Correct dismissal at the input/event boundary, keep layout-only restoration, wrap in base CSS and exclude controls from selection.
- [x] Re-run the reproduction, existing placement/toolbar/flow tests and screenshot the actual narrow and wide results.

### Task 2: Source return and tool handoff

**Files:** `app/library-chat.mjs`, `app/reader-tools.mjs` or existing `reader:tools` integration, `tests/library-chat-ui.test.mjs`, browser verifier.

**Interfaces:** Reuse `sourceLink(id, passageId, bookId)` and `onNavigateToPassage(bookId, passageId)`; preserve navigation modifier keys and current draft.

- [x] Add a failing saved-quote source-return test with an unsent draft, and a failing global-tools/paragraph-tools exclusivity check.
- [x] Add the source link to the historical quote and connect the existing global-toolbar event to paragraph dismissal.
- [x] Verify same-book source position, mobile close and focus, draft preservation, unchanged quote snapshot and no automatic model requests.

### Task 3: Trial and adjacent behavior

**Files:** `app/home.html`, localized home pages, `app/home-sample.css`, `app/home-sample.mjs` if required, existing home tests; verification record.

**Interfaces:** Existing sample read links, source sample, `mountHomeSample` language controls and reader resume contract.

- [x] Inspect current trial/link/locale fixtures and render the homepage at 390/1440px; implement the smallest concrete hierarchy change for the selected direction.
- [x] Verify first visit versus saved resume, audio manual departure/return and pause/close, missing translation and narrow-player clearance; document passing existing behavior instead of manufacturing a change.
- [x] Re-run relevant home/audio/navigation tests; generate copy outputs only from this worktree. Review Chinese prose with the current tone whitelist and retain pre/post evidence locally.

### Task 4: Delivery

- [x] Review the complete diff independently and fix justified findings. Final full-suite/build receipts are recorded in the verification document.
- [ ] Commit only this task, push a `codex/` branch, attach the PR, wait for current-head CI, sync main and merge normally.
- [ ] Wait for Production at the merge source and verify the repaired flow; update the checklist with real evidence and report remaining platform limits.

### User-directed Task 3 expansion: Ambi-inspired homepage

- [x] Replace the two-column hero with a centered statement and restrained, unequal reading imagery; preserve real actions and use existing assets.
- [x] Move the actual sample to the reading story and retain its language controls and source target; author all added copy in four languages.
- [x] Add continuation and ownership narrative without fake saved data, model answers or metrics.
- [x] Isolate the new stylesheet to authored home routes; preserve the library document and reduced-motion behavior.
- [x] Inspect rendered 390/1440px, 320px Japanese, English, Traditional Chinese, night and no-JS layouts; rerun source/draft behavior, copy checks and release gates.
