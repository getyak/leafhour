# Reading Subscriptions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the coordinated tasks. Independent units may use superpowers:dispatching-parallel-agents. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved 10-point trial plus US$5/100-point top-up and monthly renewal with truthful operational readiness.

**Architecture:** Reuse the existing credit ledger and one order per paid cycle. Add subscription references and transaction deduplication, authenticated portal management, localized customer flows and non-secret operational diagnostics.

**Tech Stack:** Node.js ES modules, existing browser modules, PostgreSQL/Supabase RPC, Creem REST/webhooks, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-21-reading-subscriptions-design.md`.

## Global Constraints

- 10 trial points once; US$5/100 points per top-up or successful monthly payment; no expiry or unlimited AI promise.
- Reading, notes, cached results and export remain free. Automatic companion generation remains sponsored.
- Keep test/live isolated and all money/points integer based. No secrets in output or Git.
- Preserve unrelated homepage work and original public Git history. Only main deploys Production.

## Review Focus

- Checkout and paid notification race: exactly one initial 100-point grant.
- Duplicate and out-of-order paid/state events: no extra grant or state regression.
- Concurrent monthly checkout with different intents: one account cannot subscribe twice.
- Customer portal access: no browser-supplied customer identity or cross-account access.
- Trial campaign exhausted or already claimed: never mint additional trial or block existing purchased funds.

### Task 1: Atomic subscription storage

**Files:** `server/billing-memory-store.mjs`, `deploy/billing-store.mjs`, new additive Supabase migration, `tests/billing-subscriptions-store.test.mjs`, SQL fixtures.

**Interfaces:** Commands `bindSubscription`, `lookupSubscription`, `subscriptions`, `subscriptionState`, `subscriptionPaid`, `expireCheckout`; agree exact payloads with the domain implementer before edits. Existing ledger order/lot/refund contracts remain unchanged.

- [x] Add failing tests for first/repeated/renewal payments, ownership conflicts, different checkout intents and state ordering.
- [x] Implement identical transaction semantics in memory and SQL; schema version 2 only after additive migration.
- [x] Run reference-store and adapter tests; isolated native SQL execution attempted and blocked by shared memory (not verified).

### Task 2: Supplier and billing domain

**Files:** `server/creem.mjs`, `server/billing-product.mjs`, `server/billing-service.mjs`, optional focused subscription module, domain/client tests.

**Interfaces:** `productIds`, selected-product retrieval/checkout, subscription and transaction retrieval, safe portal generation; service `subscriptions({ownerId})`, `portal({ownerId,subscriptionId})`; monthly catalog key `reading_monthly_100`.

- [x] Pin actual Creem response shapes and financial verification in failing tests.
- [x] Add selected-product validation, initial binding, paid-cycle fulfillment and lifecycle updates using Task 1 commands.
- [x] Test actual-paid-only grants, initial dual-event dedupe, failed renewal, independent product readiness, ownership and safe portal URLs.

### Task 3: Reader and legal UI

**Files:** `app/billing.mjs`, `app/billing.html`, `app/billing.css`, `app/commerce-pages.mjs`, four privacy notices and focused UI tests.

**Interfaces:** Monthly catalog product; subscriptions GET; owner-bound portal POST. Existing credit-client HTTP 402 flow continues linking to billing.

- [ ] Add failing UI tests for automatic trial, both products, automatic renewal disclosure, remaining points and subscription management.
- [x] Implement four locales with existing visual/layout and async-account guards; retain active/pending checkout idempotency.
- [x] Verify private shells/noindex, legal copy and build/bundle limits with automated checks. Responsive browser acceptance remains unverified.

### Task 4: Configuration, trial admission and delivery

**Files:** `server/billing-routes.mjs`, runtime/config files, `.env.example`, `docs/billing.md`, verification record, operational diagnostic tool/tests if needed.

- [x] Add owner-safe subscription/portal routes and verified once-only trial admission before the first priced action; test exhausted budget with purchased funds.
- [ ] Inspect linked provider/deployment configuration; configure accessible missing approved products/settings without printing secrets or charging money.
- [x] Run focused tests and required builds/release checks, independent review, update real evidence and known blockers (native SQL/full suite not green).
- [ ] Copy only task files into the existing isolated branch, commit, push/PR/CI/merge and Production acceptance when available.

Implementation notes: expired known checkouts gained guarded resume/reconciliation; explicit supplier nulls and documented ID prefixes are supported. Existing local `.env` received only missing billing defaults/empty placeholders, with old values preserved and live billing off. Provider keys/products, hosted SQL, remote write access and real payment acceptance remain incomplete. See `docs/verification-reading-subscriptions.md`.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](../../verification/2026-10-22-local-git-recovery.md).
