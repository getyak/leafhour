# Reading credits with optional monthly renewal

The user approved **top-ups plus a monthly subscription** on 2026-10-21: one verified-account grant of 10 points, US$5 for a 100-point top-up, or US$5 per month for 100 points per successful payment. This extends the existing prepaid-credit implementation. The user requests implementation and configuration in this session.

## Reader experience

New verified accounts receive their once-only trial automatically when opening billing or explicitly requesting their first priced AI action. Account GET stays read-only. The existing trial POST remains idempotent and email verification remains server-authoritative. A finite campaign budget remains required; the activation proposal is 10,000 points total (up to 1,000 new accounts), with an explicit operator override. Exhausted campaign funds do not block spending already purchased points.

When available points cannot cover a quoted action, return HTTP 402 before invoking a model and provide the existing billing link. Display top-up and subscription side by side. The monthly choice clearly states automatic renewal, applicable tax at checkout, 100 points per successful payment, no unlimited usage, and cancellation through the authenticated Creem customer portal. Purchased points accumulate without expiry; cancellation stops future renewal without removing already delivered points. Reading, notes, cached results and export remain free.

## Payment and subscription authority

Use separate Creem products: `CREEM_PRODUCT_READING_100` (`onetime`) and `CREEM_PRODUCT_READING_MONTHLY_100` (`recurring`, `every-month`). Verify each selected product's ID, environment, active status, price 500 USD cents and exclusive tax before checkout. Product availability is reported independently; missing monthly configuration must not disable an otherwise valid top-up.

Only raw signed webhook bytes and server-authenticated supplier reads can update billing state. `checkout.completed` binds the subscription, customer and initial local order. `subscription.paid` records each actual paid transaction once. The initial checkout and its paid notification share the same transaction identity and cannot both grant 100 points. Retry out-of-order notifications; never bind by email. Verify transaction identity, subscription/customer/order binding, environment, amount/currency, tax/discount facts and positive billing-period bounds. Missing financial facts do not become zero.

Every paid cycle becomes one ordinary owner-bound financial order/lot, preserving existing refund, dispute, reservation and settlement behavior. Keep the lot source `purchase` for compatibility; distinguish monthly sales using the order product key and subscription/transaction references. Subscription state changes alone never grant points. Failed payment, pause, cancellation or expiry do not grant a new cycle. A late state webhook must not regress a newer supplier snapshot. Existing subscription or pending/ambiguous monthly checkout prevents a second concurrent monthly subscription for the same account/environment. Only a supplier-confirmed cancelled subscription may be replaced. An expired subscription retains the lock because Creem can still retry payment and reactivate it; see the [official lifecycle contract](https://docs.creem.io/code/webhooks#subscriptionexpired). An existing pending checkout exposes a resume link and owner-bound reconciliation. Only an authenticated supplier snapshot proving the exact unpaid/unbound checkout expired can unlock a new intent; pending, processing or ambiguous outcomes retain the lock.

## Storage and interfaces

Add an additive migration after `202610210001_credit_billing.sql`, plus matching reference-store commands: `bindSubscription`, `lookupSubscription`, `subscriptions`, `subscriptionState`, `subscriptionPaid`, `expireCheckout`. All financial mutations remain atomic and environment scoped, with service-only RPC access. Subscription/transaction IDs cannot be reassigned to another account. The PostgreSQL schema readiness version becomes 2 when this migration is applied.

Creem client exposes `productIds`, `retrieveProduct({productId})`, `retrieveSubscription({subscriptionId})`, `retrieveTransaction({transactionId})`, and `createPortal({customerId})`. Existing one-time client behavior remains compatible. Customer portal URLs use a separate strict HTTPS Creem-host allowlist and never accept an arbitrary redirect.

Billing service exposes `subscriptions({ownerId})` and `portal({ownerId,subscriptionId})`. HTTP routes are `GET /api/billing/subscriptions` and `POST /api/billing/portal` with exact `{subscriptionId}` fields, session ownership, owner-header and trusted-origin checks. Portal customer IDs are resolved server-side from an owner-bound subscription, never supplied by the browser. Catalog monthly key is `reading_monthly_100`, with amount 500, currency USD, points 100 and billing period `every-month`.

## Activation and evidence

Inspect existing Vercel/Supabase/Creem configuration without printing secrets. Reuse the linked `leafhour` project only. Do not overwrite unrelated variables, existing products, or user data. Create missing products only with the approved pricing, stable idempotency and clear names; never charge a card or create an actual customer subscription as part of configuration. Schema execution and real external acceptance must be recorded truthfully. Merchant verification reported by the user is separate from access credentials and deployment validation. Keep live billing closed until durable schema and both selected payment paths are verified.

Run focused domain/client/routes/UI tests, executable SQL where permitted, build and public/release checks, then independent review. Preserve unrelated homepage edits. Deliver through the existing task branch and normal CI/PR/merge policy if credentials and network permit; no preview deployment.
