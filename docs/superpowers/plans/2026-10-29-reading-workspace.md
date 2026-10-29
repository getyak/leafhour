# Reading Workspace Implementation Plan

> For agentic workers: use subagent-driven-development for the backend task and native implementation for the frontend, with independent scoped and whole-branch review. User approved continuous execution and normal delivery.

**Goal:** Ship all eight approved workspace goals plus daily/per-book/overall recorded reading time.
**Architecture:** Existing native portal shell, lazy workspace module, owner-bound domain service and bounded selected-note DSH analysis. Keep current reader, external MCP grants and personal note provenance.
**Tech Stack:** ES modules, Node domain services, existing JSON/Supabase store abstraction and official DSH runtime. No new dependencies.
**Spec:** docs/superpowers/specs/2026-10-29-reading-workspace-design.md

## Global Constraints
- Four locales en, zh-Hans, zh-Hant, ja; shared theme/focus tokens and 44px actions; source/user words preserved.
- Current authenticated owner only; new note analysis requires consent and exact saved note selection; <=24 notes, <=24576 bytes, one request, no tools/network. Existing Agent permissions do not expand.
- Recorded daily, per-book and overall time use segment unions and existing source policies. Archived included; no synthetic activity or comprehension scores.
- No automatic model calls on open; bounded sponsored generation with provider metering, not a new unpriced user debit.
- Preserve primary checkout's unrelated changes. Public getyak/leafhour main only; required checks before normal merge; no Preview deployment.

## Review Focus
- Same-owner view reload and owner transitions must not broaden selected notes, drafts, filters or analysis scope.
- Overlapping time must not become duplicate overall duration; calendar dates and totals use the requested timezone.
- AI citations must reference selected unchanged saved records, and an aborted/stale generation may not publish or adopt.
- Editing, understanding followups, adopted suggestions and original author/user words retain separate origin and restoration behavior.
- All new app modules/assets must be public-allowlisted and deferred outside the fixed initial reader/portal budgets.

### Task 1: Domain services, reading summary and bounded analysis
Files: server/reading-workspace-service.mjs, server/reading-summary.mjs, harness/notebook-generator.mjs, limited server/library-service.mjs; tests/reading-workspace-service.test.mjs and tests/reading-summary.test.mjs.
Interfaces: exact HTTP-facing service signatures and shapes in spec.
- [ ] Add failing fixtures for time union and account-bound notebook mutation/analysis/portability.
- [ ] Implement recorded totals and selected-month stories without fetching source text unnecessarily.
- [ ] Implement state, topics, followups, candidates, adoption, portable restore and scoped bounded generator.
- [ ] Run focused tests; provide root integration notes; independent review and fixes.

### Task 2: Independent pages and complete UI
Files: app/reading-workspace.mjs, app/reading-workspace.css, app/reading-workspace-state.mjs, app/portal.js, app/home.html, server/portal-document.mjs, server/portal.mjs, ui catalogs.
- [ ] Lazy mount workspaces and route/sidebar/history/auth return, first paint and owner clearing.
- [ ] Calendar month/day content and daily/month/book/all-time time presentation.
- [ ] Notebook detail, editing/drafts/undo, questions/followups, topics and source return.
- [ ] Scope picker, explicit analysis actions, evidence candidates, adoption/rejection and export/import.
- [ ] Four locales, keyboard, phone/desktop and paper/night; meaningful UI-state regressions.

### Task 3: Integration, review and delivery
- [ ] Server endpoints and no-store/owner guards; generation injection, abort/authorize plumbing; release allowlist/asset maps.
- [ ] Synthetic complete-flow and real default-account read-only production acceptance; no cloud test garbage.
- [ ] Copy export/lint/canaries, complete tests/build/release checks; independent adversarial review and repairs.
- [ ] Sync main, commit task files, push, create/attach PR, required CI, normal merge.
- [ ] Follow own deployed commit (or verified descendant with unchanged web files), verify source and actual UI/account flow; distinguish merge/deploy/acceptance.
