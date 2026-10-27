# Reading journal implementation plan

> Use superpowers:executing-plans and focused parallel agents for independent modules; integrate and verify in order.

**Goal:** Reading footprint on the shelf, a cross-book notebook, and one quiet reading tools entry.
**Architecture:** Reuse current domain services and personal records. Focused browser modules render account-scoped data; existing controllers keep ownership of actual reading actions.
**Tech Stack:** Native JavaScript modules, CSS tokens, Node tests and current browser harness.
**Spec:** docs/superpowers/specs/2026-10-28-reading-journal-design.md

## Global Constraints

No private runtime data in Git. No paid generations. Four locales. Preserve existing IDs, time semantics, account guards, source text, and unrelated main checkout changes. No previews.

## Review Focus

Owner switches during load; mixed books/types in notebook; timezone/day boundaries and duplicate reading intervals; narrow-screen long titles; keyboard focus during nested overlays.

## Task 1: Shelf reading journal

Files: app/reading-dashboard.mjs, new app/reading-journal*.mjs/css, tests/reading-journal*.test.mjs.
Interface: mountReadingDashboard existing hooks; any new keys delivered in a sidecar locale additions file for integration.
- [x] Add failing meaningful behavioral tests for journal/share data.
- [x] Implement visible month footprint, selectable days and source-linked details.
- [x] Add explicit local share preview and deterministic image download.
- [x] Run focused tests and report actual limitations.

## Task 2: Cross-book notebook

Files: new app/library-notebook.mjs/css and tests/library-notebook.test.mjs. Portal integration owned by controller.
Interface: mountLibraryNotebook({api,getSession,getOwner,getBooks,openAuth,onClose}); returns open(),clear(),dispose(),updateLabels(). All notes across books using existing authenticated record endpoints, only user writing/highlights.
- [x] Add failing tests for filtering, sorting, search and stale-owner results.
- [x] Implement modal notebook and source-return/edit/export through existing services.
- [x] Deliver locale additions separately; run focused tests.

## Task 3: Unified reading tools

Files: app/index.html, app/reading-toolbar.mjs, app/reader-immersion.mjs and focused CSS/controller modules/tests.
Interface: retain existing IDs and action controllers; integration may append a stylesheet to static assets.
- [x] Add failing tests for changed hub/focus behavior.
- [x] Consolidate actions and progressively disclose secondary timing controls.
- [x] Verify focus, Escape, contextual selection, conversation handoff and mobile.

## Task 4: Integration and release

Files: app/portal.js, library-view-state.mjs, authored home HTML variants, locale catalogues, static route/build lists, verification docs.
- [x] Wire notebook navigation/history/account clearing; styles and locales.
- [ ] Run full tests, build, release and copy checks.
- [x] Real browser checks/screenshots for all three at four sizes; review and repair.
- [x] Record scores with evidence, never infer 98 from test count.
- [ ] Commit, push, create/attach PR, wait CI, sync main, merge, verify production commit and flows.
