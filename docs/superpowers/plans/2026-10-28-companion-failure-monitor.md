# Companion failure diagnostics implementation plan

> **For agentic workers:** Use superpowers:executing-plans, TDD and an independent whole-branch review. The user approved implementation and delivery of the audited priorities on 2026-10-28.

**Goal:** Observe unexpected persisted companion failures even when the request returns HTTP 200.

**Architecture:** The companion domain emits a closed operational outcome after a failed result is saved. The existing observability boundary owns consent, identity hashing, limits, QA exclusion, deduplication and vendor transport. A callback failure cannot affect the companion result.

**Tech Stack:** Existing Node ESM domain services, Node tests, Sentry and PostHog integration.

**Spec:** `docs/observability.md` and the approved online audit. No reading context, notes, book identifiers, provider messages or raw exceptions leave the integration.

## Global constraints

- Analytics and diagnostics remain separately opt-in; local/self-hosted forwarding remains off by default.
- Keep the closed event/property schema. Reserve companion outcomes for server callers.
- Preserve companion eligibility, five-minute spacing, cancellation, source bounds and user-visible status behavior.
- Do not report silence, success, ordinary admission limits, source invalidation or revoked/cancelled work as faults.
- Emit after persistence. Use a random run identifier for internal deduplication; never export private receipt identifiers.
- Preserve the reader startup budget and all unrelated work.
- Production deployment follows data-safety priorities; Capir is PR-only while its resident Mac is offline, as requested by the user.

## Review focus

- Late generation after consent/authorization revocation must not publish or report a cancelled result.
- A malformed generated message is an unexpected result failure, distinct from invalid user input.
- A failed observability callback must not block or reject a persisted domain outcome.
- Duplicate requests must neither re-run a model nor count the same failed attempt twice.
- Browser ingestion must not forge the new server event; QA events remain synthetic and privacy sentinels remain absent.

## Task 1 Domain and route failure outcomes

Files: `server/reader-companion.mjs`, `server/reader-chat.mjs`, `server/portal.mjs`, `tests/reader-companion-observability.test.mjs`.

Interface: optional `onOutcome(owner, event, context)` on the companion service, wired through `onCompanionOutcome` on the chat service. `generate` accepts the request's trusted `operationId` alongside authorization. Callback owner is `{id}`, event is fixed `companion_failed` metadata, context contains only the random operation/run receipt.

- [ ] Add and run failing regressions for persisted generation failure, malformed result, duplicate receipt, expected admission limit, cancellation, source change and observer rejection.
- [ ] Add the smallest post-persistence outcome hook, classify only fixed error categories, and wire the existing first-party domain observer.
- [ ] Verify the actual HTTP 200 failed-result path, request operation correlation and unchanged companion behavior.

## Task 2 Contract, transport, dashboards and delivery

Files: `app/observability-contract.mjs`, `server/observability.mjs`, `tools/configure-observability.mjs`, focused tests, `docs/observability.md` and verification evidence.

- [ ] Add closed `companion_failed` and `companion` values; reject browser-forged events and retain owner/consent/deduplication limits.
- [ ] Include companion faults in both fault trends, preserving production/synthetic filters and the two reading dashboards.
- [ ] Run focused tests, required integrated tests/build, source/privacy checks and independent review.
- [ ] Commit owned files, push a normal PR, wait for checks, merge and verify the deployed source.
- [ ] Verify a sanitized synthetic server outcome reaches both receivers from an isolated fixture. Report the fixture's execution location honestly; do not deliberately break production model generation to manufacture a fault.

## Scope boundary

This change does not reconstruct old failures or build a new durable audit queue for a process killed before an outcome can be saved. Existing platform diagnostics and bounded best-effort transport retain their documented scope.
