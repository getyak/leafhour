# Leafhour Credits and Creem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native integration; independent storage, metering and presentation work uses superpowers:dispatching-parallel-agents. Steps use checkbox syntax.

**Goal:** Implement the approved one-time credit purchase, verified fulfillment, successful-service consumption, account statements, financial/usage reporting and localized public policies.

**Architecture:** Billing domain validates identities, immutable quotes and purchase intents. A command store supplies identical transactional semantics to an isolated local reference and a Postgres RPC; production requires durable Postgres. Existing reading services retain ownership and bounded generation; a metering context records supplier attempts independently of customer credits.

**Tech Stack:** Node ESM 22.13+, node:test, existing Supabase REST/Auth, Postgres transactional RPC, native crypto HMAC, existing static HTML/CSS/JS.

**Spec:** ../specs/2026-10-21-creem-credit-billing-design.md (user approved implementation on 2026-10-21).

## Global Constraints

- US$5 / 100 reading points; 1 point single-passage dual translation; 4 points conversation/annotation; 10 trial points once per verified account.
- Integer microcredits, 1 point = 1,000,000; money in currency minor units.
- Billing off by default; self-hosted reading/export remain free. Production cannot use local/memory accounting.
- Automatic companion never spends purchased credits. No real model calls, purchases or refunds merely to test.
- Preserve all unrelated work, especially existing home-navigation changes. No private data or secrets in Git.
- Existing explicit bounded contexts and model/request quotas remain authoritative.
- Test/live ledger and product IDs never mix; webhook signature uses raw bytes.

## Review Focus

- Refund arriving before payment must not resurrect credits (Task 1/2).
- A crash after saving results must not replay the supplier call (Task 4).
- Existing Agent authorization must not acquire spending permission (Task 4).
- Missing supplier usage must stay unknown, including failed/nested attempts (Task 3).
- Account switching during purchase/result polling must discard foreign state (Task 5).

## Interface contract

Store: `createBillingMemoryStore({dataDir?,clock?})` and `createBillingPostgresStore({env,fetcher?})` return `{durable, command(action,payload)}`.

All command payloads include `mode:'test'|'live'`; account operations include trusted server `ownerId`. The SQL adapter calls `reader_billing_command(command_name text, command_payload jsonb)`. Use these commands/shapes:

- `account({ownerId})` → `{availableUnits,reservedUnits,grantedUnits,consumedUnits,trialGranted,frozen}`.
- `trial({ownerId,grantId,units,now})` → account; grant once, only server-verified identity.
- `quote({ownerId,id,action,units,scopeHash,scope,priceVersion,expiresAt,now})` → saved quote.
- `reserve({ownerId,quoteId,operationId,idempotencyKey,scopeHash,now})` → operation with id, status, units, action, scopeHash, source scope, reservationToken.
- `operation({ownerId,operationId})` → operation or null.
- `running({ownerId,operationId,reservationToken,now})` → operation.
- `result({ownerId,operationId,reservationToken,receipt,now})` → operation; receipt is small owner/source-bound immutable completion reference, never raw reading content.
- `settle({ownerId,operationId,reservationToken,now})` → operation; atomic hold→consume, idempotent.
- `release({ownerId,operationId,reservationToken,reason,now})` → operation; terminal failure/cancel before settlement only.
- `reverse({ownerId,operationId,reason,now})` → operation; unique settled consumption reversal.
- `order({ownerId,id,intentKey,productKey,productId,amount,currency,units,now})` → local order; intent idempotent.
- `checkout({ownerId,orderId,checkoutId,checkoutUrl,now})` → order; bind immutable supplier checkout.
- `getOrder({ownerId,orderId})` → order or null.
- `payment({ownerId,orderId,eventId,eventHash,checkoutId,providerOrderId,productId,amount,currency,paidAmount,taxAmount,discountAmount,units,now})` → order; atomic event/order dedupe + lot grant.
- `refund({ownerId,orderId,eventId,eventHash,refundId,refundAmount,cumulativeRefundAmount,paidAmount,now})` → order; cumulative integer refund adjustment, frozen exposure if already spent, no negative available balance.
- `dispute({ownerId,orderId,eventId,eventHash,now})` → order; freezes paid generation without deleting reading data.
- `entries({ownerId,limit?,cursor?})` → `{entries,nextCursor}`; strict maximum 100.
- `orders({ownerId,limit?,cursor?})` → `{orders,nextCursor}`.
- `providerCall({ownerId,id,operationId?,feature,funding,provider,model,status,usage?,costMicrousd?,costStatus,startedAt,finishedAt?})` → minimal receipt, idempotent by attempt ID.
- `summary({from,to})` → `{accounts,orders,paidOrders,paidUsers,salesByCurrency,refundsByCurrency,grantedUnits,consumedUnits,reservedUnits,calls,knownCostMicrousd,unknownCostCalls,...}` with no private text.
- `recover({ownerId,now})` → bounded operations needing publication/release; never dispatch models; active reservations not blindly released.

Store failures: Error with safe `status` (400/402/403/404/409/503), `code`; adapter maps SQL business codes to same public statuses.

Domain: `createBillingService({store,creem,enabled=false,mode='test',publicOrigin,adminIds=[],clock})`; provides catalog, account, entries, orders, checkout, order, quote, run, webhook, summary. Root integrates exact signatures once backend implementation returns.

Metering: `withProviderMeter(context,fn)` using AsyncLocalStorage; context includes ownerId, operationId, feature, funding, record callback. `recordProviderCall(facts)` records only safe supplier facts. `usage` uses disjoint inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens; unknown is null, never zero-filled.

## Tasks

### Task 1: Domain, isolated transactional reference and Creem adapter

Files: new server/billing-service.mjs, server/billing-memory-store.mjs, server/creem.mjs, tests/billing-service.test.mjs, tests/billing-creem.test.mjs.
- [x] Write behavior tests for duplicate payment, insufficient/concurrent funds, stale quote, failure release, cancellation/settlement, repeated intent, foreign owner and refund-before-payment.
- [x] Run node --test tests/billing-service.test.mjs tests/billing-creem.test.mjs, verify missing functionality.
- [x] Implement command reference, strict service inputs, safe checkout URL, raw HMAC and verified fulfillment; source-bound completion and idempotency.
- [x] Run targeted tests, review for ambient production access and arbitrary trust of metadata.
- [ ] Commit only owned files when Git mutation is available.

### Task 2: Relational Postgres store

Files: new deploy/billing-store.mjs, supabase/migrations/202610210001_credit_billing.sql, tests/billing-postgres.test.mjs.
- [x] Write adapter and migration contract tests, including SQL row lock, RLS, service-only execute, unique events/orders, refund-before-payment and atomic reserve.
- [x] Run tests to observe missing adapter/migration.
- [x] Implement RPC commands matching the shared contract with dedicated relational tables and immutable entries.
- [x] Run actual isolated SQL integration if a local engine is available; otherwise explicitly record unverified SQL execution and keep live billing unavailable until readiness validation.
- [ ] Commit only owned files when possible.

### Task 3: Supplier metering and current price guards

Files: new server/provider-metering.mjs, server/provider-pricing.mjs; modify harness/chat-generator.mjs, server/translation.mjs, server/reader-chat-generator.mjs and server/reading-agent-search.mjs; related tests.
- [x] Write tests for disjoint cached tokens, missing usage, failed attempt, nested search and recorder failure.
- [x] Verify failures before implementation.
- [x] Implement safe context receipts, current USD peak cost guards, complete/partial coverage, fail-closed budget admission and no raw text logging.
- [x] Preserve all existing CNY budget compatibility when billing disabled; report known stale-reference behavior rather than silently change unrelated model permissions.
- [x] Run new and existing generator/translation tests.

### Task 4: Domain routes and generation lifecycle integration

Files: server/portal.mjs, server/library-service.mjs, server/reader-chat.mjs, server/reader-annotations.mjs, api/[...path].js, new raw webhook entry; Vercel/release manifests.
- [x] Write direct-handler tests (no listening socket required) for auth/Origin/owner headers, live-disabled readiness, webhook bytes and Agent spend refusal.
- [x] Run tests to observe failures.
- [x] Inject billing at real generation boundaries; cache returns free; persist completion reference before settlement; recovery uses existing output without replay.
- [x] Register protected billing/admin routes and public catalog; raw webhook bypasses browser CSRF but always verifies signature.
- [x] Exercise existing reading/annotation/translation regressions and cancellation interleavings.

### Task 5: Localized public pages, account statements and operator dashboard

Files: new app/billing*.mjs/css/html and app/commerce-pages.mjs; tests/billing-ui.test.mjs. Root registers assets, links and static build output.
- [x] Write tests for public four-language URLs/content, disabled/test messaging, account switches, escaping, unknown costs and accessible views.
- [x] Verify missing functionality then implement real API-backed screens with empty/error/loading states.
- [x] Provide localized pricing/terms/refunds and relevant Privacy additions, quiet account link, purchase return polling; no fabricated sales or demo analytics.
- [ ] Check 390/768/1440px where browser/runtime access permits.

### Task 6: Verification and delivery

Files: .env.example, docs/billing.md, docs/verification/2026-10-21-credit-billing.md, release-files.json; spec status.
- [x] Verify references and no credentials/private content.
- [x] Run new tests, full npm test, hosted build and release checks; list sandbox baseline failures separately.
- [x] Independent code review; fix actionable findings and rerun relevant checks.
- [ ] Create branch, commit task changes, push and PR when permissions/network allow; CI-only PR checks, Production after merge.
- [x] Document exact readiness: local reference, adapter fixtures, executed SQL, real Creem sandbox, real model usage and production payments separately.


## Actual handoff status

Core implementation, bounded supplier metering, browser spend confirmation, durable quote/intent retry references, protected reporting, localized public policies and build packaging are implemented. Source contract and adapter tests do not establish PostgreSQL execution. Live billing stays off by default and additionally requires READER_BILLING_SCHEMA_VERIFIED=true after real isolated SQL validation.

Browser automation disconnected during layout checks, so the 390/768/1440 review remains unverified. No real model, Creem sandbox purchase, cash refund or production acceptance was performed. Git metadata is read-only here; the GitHub connector rejected remote branch creation with403. No PR, merge or production deployment is claimed. Exact commands and results are recorded in docs/verification-credit-billing.md.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](../../verification/2026-10-22-local-git-recovery.md).
