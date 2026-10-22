# Monthly reading subscription and Creem

Leafhour's only new hosted purchase is a US$5 monthly subscription delivering 100 reading points after each successful monthly payment. One-time top-ups were retired on October 22, 2026; existing orders, delivered points and refund/reconciliation facts are retained. New verified accounts receive 10 trial points once. Purchased points accumulate without expiry. Subscribers may stop future renewals in Creem's authenticated customer portal without losing delivered points. There is no automatic top-up or unlimited AI entitlement. A new single-passage dual translation costs 1 point; an explicit reading conversation or selected-text annotation costs 4 points. One point is 1,000,000 integer units. Money is stored as integer currency minor units. Products use USD with tax shown separately at checkout.

Reading saved text, notes, layout changes, revisiting results and export stay free. Billing is off by default. Self-hosting does not require Creem; the operator supplies its own model service. Automatic companion messages and other automatic generation use separate sponsored budgets and never borrow purchased points. Existing model, concurrency and bounded-context limits still apply.

## Offer and benefits

The subscription covers metered AI assistance: book-focused reading questions and selected-text explanations cost 4 points, and a new single-passage translation with independent literal/interpretive Chinese versions costs 1 point. It does not promise unlimited generation, whole-book translation, other target languages, OCR or audio allowances. Interface languages are English, Simplified Chinese, Traditional Chinese and Japanese. Reading, notes, saved results, layout controls, export and self-hosting remain free; language support is not an exclusive paid entitlement.

The public catalog exposes only `reading_monthly_100`. New one-time checkout is rejected before a supplier request or order mutation. Public historical order views do not expose a resumable payment URL for retired products; their stored checkout facts remain intact for reconciliation. Historical payment, refund, dispute and reconciliation records continue to use their original immutable owner/product/order bindings; removing old sale configuration must not invalidate their fulfillment. No existing financial rows are deleted or relabeled.

## Configuration and activation

Use server environment variables or deployment Secrets. Never put credentials in browser assets, documents or version control.

| Variable | Purpose |
| --- | --- |
| `READER_BILLING_ENABLED` | Exact `true` enables commercial admission. Default is disabled. |
| `CREEM_MODE` | `test` or `live`; never share products, event IDs or ledger rows across modes. |
| `CREEM_API_KEY` | Server-only API key for the selected environment. |
| `CREEM_WEBHOOK_SECRET` | Server-only secret for raw-byte HMAC verification. |
| `CREEM_PRODUCT_READING_MONTHLY_100` | The US$5 / 100-point monthly product, `recurring` and `every-month`. The sole new-purchase offer. |
| `CREEM_REVIEW_DISCOUNT_IDS` | Optional comma-separated approved 100% review-discount IDs. Free review orders are tracked separately from real sales. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Dedicated relational store through the service-only PostgREST RPC. |
| `READER_BILLING_SCHEMA_VERIFIED` | Set to exact `true` for live operation only after the SQL prerequisite below has been independently executed and reviewed. This flag itself is not verification evidence. |
| `READER_BILLING_ADMIN_USER_IDS` | Comma-separated trusted Auth user IDs permitted to read operator summaries. Emails are not authorization IDs. |
| `READER_BILLING_TRIAL_BUDGET_POINTS` | Nonnegative integer total trial-campaign budget, in points. The runtime defaults to 0, including live mode. |
| `READER_PUBLIC_ORIGIN` | Trusted browser origin and purchase-return origin, normally `https://leafhour.com`. |

A verified account receives 10 trial points automatically when opening billing or submitting its first authorized AI quote, using the idempotent trial POST/command and fresh server-side email verification. Account GET never grants points. Already claimed trials are never replenished. An exhausted campaign does not prevent spending purchased points. The trial campaign has a database-wide, environment-specific atomic budget. The activation proposal is 10,000 total trial points (at most 1,000 accounts); set a different explicit finite budget if needed. A zero budget rejects new grants.

When commercial billing is requested but its configuration or durable store is unavailable, financial mutations and paid generation fail closed. Saved reading and export remain available. The catalog reports the unavailable state, and the account purchase control remains disabled. A local persistent JSON reference is suitable for isolated test mode only and is never accepted for live accounting.

### Operator setup sequence

1. Use the existing linked Leafhour Vercel project and Supabase project. Retain unrelated variables and data. Set Creem credentials in protected server variables, never in chat, source files or browser JavaScript. Use `CREEM_MODE=test` for sandbox acceptance first.
2. Run `node tools/configure-billing.mjs --check` in that protected environment. This inventories required variable names and verifies any configured products without supplier writes. It does not attest schema, webhook delivery, real payment or Production acceptance. The local development `.env` is separate from Vercel's variables; absent local credentials do not establish that hosted credentials are missing.
3. Create/select only the monthly product with the exact settings above. `node tools/configure-billing.mjs --create-products` creates only the missing approved monthly product with stable idempotency keys and prints their non-secret IDs. It validates every existing product before any create and does not overwrite existing products, persist credentials, enable billing or charge customers. Set the returned ID in `CREEM_PRODUCT_READING_MONTHLY_100`. Retired one-time configuration is neither required nor created. A partial provider outage is retried with the same idempotency keys.
4. Apply and validate the two migrations below in order. Configure the endpoint `https://leafhour.com/api/webhooks/creem` with the same environment's secret and supported events. The official Creem dashboard exposes webhook settings; ensure the endpoint points to the released application that includes both billing migrations and subscription handlers.
5. Set `READER_PUBLIC_ORIGIN=https://leafhour.com` and an explicit finite `READER_BILLING_TRIAL_BUDGET_POINTS` (proposed 10000). Set `READER_BILLING_ADMIN_USER_IDS` only from real Supabase Auth IDs. For persistent acceptance data, resolve the designated `test@cubxxw.com` account from current Auth; never use a guessed ID.
6. Complete sandbox checkout, initial and repeated notifications, monthly renewal, cancellation/portal, insufficient points and refund/dispute acceptance. Verify `/api/billing/catalog` reports each intended product available; check `/billing` and authorized `/admin/billing`. A browser success redirect alone must never mint points.
7. After real isolated SQL validation and provider acceptance, set `READER_BILLING_SCHEMA_VERIFIED=true` and `READER_BILLING_ENABLED=true` with the matching live credentials/product IDs. Publish through main's Production workflow and accept the same released commit. Do not copy sandbox credits or events to live. A real cash purchase/refund is a separate explicit financial action, not something the configuration helper performs.

As of this continuation on 2026-10-21, the user reports completing provider verification. This session has no current local Creem/Supabase billing credentials, cannot reach the Vercel configuration API through the configured proxy, and GitHub branch creation still returns integration HTTP 403. No hosted settings, database schema or live payment state have therefore been changed here. This is an access/configuration distinction, not a request to repeat merchant verification.

## SQL prerequisite: isolated validation before hosted migration

Apply `supabase/migrations/202610210001_credit_billing.sql` and then `supabase/migrations/202610210002_reading_subscriptions.sql`. The first creates the credit ledger; the additive second migration adds owner-bound subscriptions, unique transaction/period identities and an RPC wrapper around the original financial implementation. They do not migrate book content or modify reading records. Existing ledger lots and cash/refund facts are preserved.

Do not apply it to a real hosted database merely because adapter tests pass. First run the executable SQL fixture against a disposable PostgreSQL instance and review the resulting evidence:

```sh
LEAFHOUR_TEST_PG_BIN=/path/to/postgres/bin node --test tests/billing-postgres.test.mjs
LEAFHOUR_TEST_PG_BIN=/path/to/postgres/bin node --test tests/billing-subscriptions-postgres.test.mjs
```

The test initializes a fresh temporary cluster, uses Unix sockets with TCP listening disabled, creates isolated `anon`, `authenticated` and `service_role` roles, applies the migration, executes `tests/fixtures/billing-postgres.sql`, and races two reservation processes against one balance. It never reads database connection variables or connects to an existing database. A skipped integration test means SQL execution has **not** been verified.

Historical result: in the 2026-10-21 implementation environment, PostgreSQL 14.15 `initdb` failed before server startup: `could not create shared memory segment: Operation not permitted`, at `shmget(..., size=56, ...)`. A Unix-only server could not start because initialization did not complete. The migration and SQL fixture were **not executed** in that sandbox. No real migration, customer data, purchase or refund was used to test this feature. That historical sandbox result is superseded by the isolated execution below; it never established hosted migration readiness.

On October 22, 2026, both fixture suites executed successfully in disposable PostgreSQL 14.15 clusters, including concurrent credit reservations and monthly signup. The test helpers now discover native tools through `pg_config`, and CI requires those tools before financial tests. The hosted database has not been migrated. See [local recovery verification](verification/2026-10-22-local-git-recovery.md).

After successful isolated runs, review both migrations and apply them through the operator's normal database migration process. The service role must retain its intended RLS bypass capability. Anonymous and authenticated roles cannot read financial tables or execute the RPC or helpers. The public RPC is `reader_billing_command(command_name text, command_payload jsonb)`; only the service role may call it. The second migration reports schema version 2. Live monthly configuration rejects schema version 1. Readiness confirms the deployed interface, while operator evidence confirms its validation.

## Checkout, notifications and reconciliation

The sole active sale product must use `recurring` / `every-month`, no trial period, no variable pricing and no metered extras. Product validation accepts Creem's documented explicit null for no trial. Its ordinary paid invoice may explicitly report `refunded_amount:null`; only a verified `paid` invoice interprets that as no refund. Missing fields, missing tax/discount facts and null refund amounts on refunded/disputed invoices remain unverified.

`checkout.completed` binds a subscription to its original owner/order/customer. The immutable checkout transaction, when supplied, and `subscription.paid` share the same transaction identity. Each successfully paid cycle creates exactly one ordinary purchase order and lot, so refunds/disputes retain the original ledger behavior. Lifecycle events never create points. A bound subscription marked `expired` still blocks another monthly signup because Creem may retry its payment; only supplier-confirmed `canceled` releases that lock. See the [official expired-event semantics](https://docs.creem.io/code/webhooks#subscriptionexpired). Signed paid notifications use their original transaction ID even when the current subscription snapshot has advanced. The browser cannot choose a customer ID for the portal; the server resolves it from the signed-in owner's subscription. The current strict portal allowlist accepts Creem's `/my-orders/` URL format; actual generated-URL acceptance remains an external validation prerequisite.

Subscribe the endpoint to `checkout.completed`, `refund.created`, `dispute.created`, `subscription.paid`, `subscription.active`, `subscription.canceled`, `subscription.scheduled_cancel`, `subscription.past_due`, `subscription.unpaid`, `subscription.expired`, `subscription.update`, `subscription.trialing` and `subscription.paused` where available. Use the same environment's signing secret. Out-of-order initial notifications wait for a binding instead of guessing from a customer's email.

Create only the monthly recurring product with the configured amount, currency and tax treatment. Use separate test/live credentials, webhook secrets and product IDs. Configure the raw notification URL as `/api/webhooks/creem`; its Vercel entry is `api/creem-webhook.js`. Notifications have a 256 KiB bound and must preserve the original bytes. The server verifies the `creem-signature` HMAC before parsing JSON.

Before allowing checkout, the server retrieves the configured Creem product and checks its environment, US$5 price, USD currency, active status, exclusive tax treatment and official `recurring` billing type and `every-month` period. Public readiness caches verified product facts for five minutes; checkout forces fresh verification. A local owner-bound intent exists before requesting checkout. An atomic checkout claim prevents another process from creating a second checkout after an ambiguous supplier timeout. Repeating a purchase intent returns the same local order. A return-page query string never grants credits. Signed notifications and authenticated supplier reconciliation must match the local owner, product, checkout/order IDs, mode, amount, discount, currency and tax breakdown. Missing financial facts remain unverified rather than becoming zero.

Payment event IDs and provider order IDs are unique within their environment. Replays do not grant a second lot. Full review discounts require explicit allowlisting and are recorded as review grants with zero cash sales. A refund that arrives before payment records a monotonic revocation; a late success can grant only the remaining rights. Cumulative partial refunds round revoked integer units upward. Refunds cancel affected active holds before reclaiming available rights. Already spent exposure freezes new paid work without making available balances negative. Disputes keep the account frozen pending operator reconciliation; this implementation provides no automatic unfreeze or automatic cash-refund endpoint.

## Successful-service consumption and recovery

The owner session, authorized source version and bounded input are resolved by the existing reading services. A server-created quote fixes the feature, unit price, scope hash and expiry. One quote authorizes one operation; a new attempt after cancellation or terminal failure needs a new quote. The same idempotency key with changed inputs is rejected.

Reservation locks the account row and allocates trial units first, followed by purchase/review lots in FIFO order. Only the worker that atomically changes `reserved` to `running` receives `executionClaimed: true`. Other workers cannot dispatch another supplier request for that operation. Fencing tokens bind the completion, settlement and cancellation to the reservation.

Save and validate the owner/source-bound result in its existing content store before recording a small completion receipt. The receipt contains references, never reading text. Settlement atomically changes held units into consumption. Publication acknowledgment removes delivered operations from recovery. Recovery inspects persisted state and saved results, never dispatches a model to recreate an already saved answer. Account billing reads run bounded recovery. There is no unattended recovery schedule in this release; operational recovery and real provider acceptance remain activation gates. Native conversation/annotation leases expire after 90 seconds; abandoned pre-dispatch holds and fenced translations can recover after 15 minutes. Failed, cancelled, source-changed, invalid or undelivered work releases its hold; supplier costs may still exist and remain recorded. A later delivery failure reverses the original settled consumption once. The ledger separately records the units actually restored to the available balance; refunded rights never reappear. Reversing undelivered work reduces its order's refund exposure and can clear a freeze caused solely by that exposure. A dispute or another order's outstanding exposure keeps the account frozen.

Old MCP read grants do not obtain spending authority. Automatic tasks do not inherit a user's purchased balance. Billing does not change the existing rules for private notes, author text, draft status or background reading time.

## APIs and pages

| Route | Boundary |
| --- | --- |
| `GET /api/billing/catalog` | Public current availability, product and prices; no account data. |
| `GET /api/billing/account`, `/entries`, `/orders` | Current server-session owner only; statement pagination is bounded to 100 rows. |
| `GET /api/billing/subscriptions` | Current owner's subscription references and status; customer identity is not returned. |
| `POST /api/billing/portal` | Exact `{subscriptionId}` body, current owner and trusted Origin; resolves customer on the server. |
| `POST /api/billing/trial` | Explicit claim, verified email and finite campaign budget. |
| `POST /api/billing/checkouts`, `/quotes` | Current owner header and exact trusted Origin; strict request fields. |
| `GET /api/billing/orders/:id?reconcile=1` | Owner-bound order lookup with supplier reconciliation where supported. |
| `GET /api/admin/billing/summary?from=...&to=...` | Explicit administrator Auth user ID; half-open UTC range, at most 366 days. |
| `POST /api/webhooks/creem` | No browser session; raw signed supplier bytes required. |

`/billing` and `/admin/billing` are private, noindex shells that load authorized data at runtime. Pricing, terms and refunds are public at `/en`, `/zh-hans`, `/zh-hant` and `/ja`; `/pricing`, `/terms` and `/refunds` alias the English documents. Static pages start with payments unavailable and request the actual runtime catalog. They never infer readiness from build-time environment variables.

## Usage and financial interpretation

Provider attempts are separate from customer points. Each dispatched attempt is durably recorded with its stable ID before the supplier request, with unknown usage until the one-time completion update. Attempt IDs deduplicate reported usage; failed, retried, nested and sponsored calls remain visible. Input, cache-read, cache-write and output counts are disjoint. Missing usage is unknown, not zero, and is never replaced with a byte-count estimate. Reports show unknown-cost calls and coverage limits; they do not claim exact profit.

Cash sale and refund facts have immutable timestamps and currency amounts. Reports use the selected half-open event-time window, not an order's original creation date or its present cumulative refund total. Net sales exclude collected tax; refunds, point grants/consumption and provider cost estimates are separate facts. Currencies are not silently added together. Provider-reported usage priced at a documented rate is a usage estimate until reconciled with an actual supplier invoice. Prepaid unused rights are not automatically recognized as accounting revenue.

Operator reports omit reading text, questions, answers and private notes. Creem receives the facts needed for checkout, not uploaded books. Leafhour stores payment references rather than full card data. Financial retention and account/reading-data deletion are handled separately as explained in the four localized privacy notices.

Verification levels remain distinct: reference-store tests, HTTP/adapter tests, executed SQL/concurrency, real Creem sandbox, real model usage, operator configuration, production deployment and actual payment fulfillment. Completing one level does not establish the next. Real payment or refund validation requires a separately authorized amount and action.

## English review form drafts and submission status

Use the actual operator name, legal status and tax residence from your own account. The text below describes the product and intended hosted offering; it does not claim that live billing has already passed verification.

**About you or your business / Business description**

Leafhour is an open-source reading application for readers who want to work closely with books and long-form texts. It combines original text, separately saved literal and interpretive Chinese translations, reading questions, selected-text explanations, and private notes. The project supports local use and self-hosting under AGPL-3.0. The official hosted service is designed to offer optional, prepaid AI processing while keeping reading, personal notes, saved results, and data export available without a subscription.

**Product and platform details**

Leafhour is a web application at https://leafhour.com. Registered readers can keep a private reading library, upload material they are entitled to process, and explicitly request paragraph translations or book-focused AI explanations. New verified accounts receive 10 trial points once, subject to campaign availability. Readers can subscribe for US$5 per month to receive 100 points after each successful monthly payment. Applicable tax is shown at checkout. Points accumulate without expiry; subscribers can cancel future renewals through the customer portal while keeping delivered points. A newly generated dual translation costs 1 point; a reading question or selected-text AI annotation costs 4 points. Processing is bounded to authorized book context. Automatic book-specific reading prompts are separately funded by the operator. The integration uses Creem-hosted checkout and server-verified fulfillment. Live payments remain disabled until database, checkout, fulfillment, and production verification are complete.

**Readiness is not approval.** The official [Creem account review checklist](https://docs.creem.io/merchant-of-record/account-reviews/account-reviews), checked October 21, 2026, requires a production-ready accessible product, visible pricing and legal pages, accurate claims, and a reachable branded support email. It lists generative AI among restricted products subject to extra verification and AI companion or relationship chatbots among prohibited products. Leafhour's automatic prompts are bounded to current and prior visible book context; describing that accurately does not establish how Creem will classify the feature. Ask Creem to assess the actual reading workflow before accepting live payments if that classification is uncertain. No review submission or provider approval has been performed here. The support address appears in the product, but its deliverability has not been tested in this implementation session.
