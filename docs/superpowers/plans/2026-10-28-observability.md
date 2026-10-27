# Leafhour observability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** Deliver private-content-free Sentry diagnostics and PostHog first/return reading analysis with actual production dashboards and Notion configuration references.

**Architecture:** First-party browser events, account consent, server allowlists, isolated sinks. Keep reader functionality independent of telemetry delivery.

**Tech Stack:** Existing Node ESM/plain browser modules, @sentry/node, PostHog HTTP ingestion/API, Vercel/Supabase.

**Spec:** ../specs/2026-10-28-observability-design.md

## Global Constraints

- Analytics off by default; no replay or private content; local default off.
- Preserve unrelated original-checkout changes; only this worktree contributes to this PR.
- No management keys in repository, logs or Notion. User authorizes DSN/project ingestion key in Notion.
- Domain data and auth remain shared with the existing application; no new owner identities.

## Review Focus

- Consent revocation while a batch is waiting must stop delivery.
- Untrusted errors/URLs/extra fields cannot become third-party content.
- Delayed personal-record restoration must not be reported as a successful resume early.
- Telemetry failure and vendor outages must not change reader results or latency critically.
- Account switching, QA identity and retries must not cross identity or duplicate counts.

### Task 1: Server and event boundary

Files: create app/observability-contract.mjs, server/observability.mjs, tests/observability.test.mjs; modify server/portal.mjs, server/server.mjs, api/[...path].js and package dependency.

- [ ] Write and run failing tests for secret-sentinel removal, default/explicit consent, revocation, owner separation, exclusion, limits, event dedup and independently failing sinks.
- [ ] Implement the spec's exact shared validator/service and integrate authenticated routes plus captured operational errors without raw content.
- [ ] Run focused tests until green and record real results.

### Task 2: Browser signals and settings

Files: create app/observability.mjs, app/observability-settings.mjs and focused tests; modify reader entry/API and library settings plus four UI catalogues.

- [ ] Write and run failing tests for no events before consent, strict field allowlisting, event timing, stop/reset on identity change, and network failure isolation.
- [ ] Add unobtrusive settings switches using existing settings controls. Do not add notices or controls inside the reading text.
- [ ] Emit requested/visible/active and actual resume outcomes; capture only safe error category/metadata. No DOM/text/error-message export.
- [ ] Run focused tests and obtain actual browser evidence.

### Task 3: Vendor and deployment setup

Files: .env.example, tools/configure-observability.mjs, docs/observability.md, build/asset manifests where needed.

- [ ] Reuse/create service projects through authorized browser accounts, preferring Google login. Keep tokens private.
- [ ] Create/read back three named dashboards, environment/release filters, and disabled replay configuration.
- [ ] Configure protected Vercel production values; update Notion existing service/project records with confirmed addresses and integration keys.
- [ ] Keep reproducible management tooling credential-free and include no simulated production user history.

### Task 4: Review, merge, production acceptance

- [ ] Regenerate copy inventory, run focused plus complete project checks/build and inspect outgoing data in a real browser.
- [ ] Independent whole-branch review, resolve important findings, sync main and reverify changed behavior.
- [ ] Commit only task files, push branch, create/attach PR, wait for current CI and normal merge.
- [ ] Verify matching Vercel Production commit, smoke app and actual vendor receipt, update verification record and Notion final status.

## Execution ledger

- 2026-10-28: original checkout is dirty; native managed worktree created from public origin/main. Browser setup and Notion lookup do not touch reader runtime data.
- Ruling: use independent server/browser workers under dispatching-parallel-agents with disjoint file ownership; integrate and review in the parent. Approved user scope already specifies implementation and release, so no repeated design approval.

- Ruling: full integration exposed an unused locale-owner permission and the fixed reader startup budget. Removed the unnecessary permission; privacy-date regression updated to the actual October28 notice. Observability is being moved behind an exact literal lazy boundary after usable paint; the existing320KiB budget stays unchanged.
- Vendor setup: Sentry leafhour4512329406545920 and PostHog dedicated project691966 created; replay=false and autocapture disabled read back. Three dashboards/six query insights created and read back. Encrypted production-only env set; actual Auth test account resolved and excluded. User-authorized ingestion keys/addresses saved to Notion; management secrets remain private.
- Review: independent reviewer found fast-resume, horizontally paginated visibility, trusted page controls, and async ingestion/chat fault gaps. All received focused regressions/fixes before release.
