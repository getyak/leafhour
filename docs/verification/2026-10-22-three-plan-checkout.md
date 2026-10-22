# Three plans and in-page checkout — 2026-10-22

The price page now presents three comparable cards: free reading, US$5/month with 100 points per successfully paid month, and US$50/year with 1,200 points upfront per successfully paid year. Annual saves US$10 against twelve monthly payments. Reading, notes, saved results, export and the four interface languages remain free. New translations still target Chinese. Detailed usage/renewal conditions are collapsed below the cards.

Paid choices open authentication and the official Creem card checkout on the same page. The existing billing page remains available for account history and subscription management, and no longer contains purchase cards. Its existing monthly/yearly pending orders also resume in an overlay. Provider completion closes the overlay and cancels its redirect; only a fresh owner-bound server confirmation with `paymentVerified=true` can continue to the reading room.

## Financial and identity checks

- Monthly and annual share an atomic pending-order/nonterminal-subscription lock. Annual uses saved order amount, currency, point quantity, product and billing period throughout fulfillment, renewal, refund and dispute processing.
- Monthly supports schema v2; annual requires the new additive v3 migration. Original migrations and historical rows remain intact. Frozen accounts cannot begin checkout, with an additional atomic guard in the v3 store.
- Real protected-client regressions cover identity changes during subscription reads, account reads, checkout creation and reconciliation, plus login recovery that encounters another account. Each clears the old choice and closes its overlay; no stale response can navigate or charge a different owner.
- Browser callback IDs and redirect URLs never grant points. Pending or temporarily unverified confirmation stays on the price page with a confirmation action. Retired one-time orders cannot resume payment.
- Local HTTP and Vercel permissions admit the official embed script and provider frames only on pricing/billing pages. Other routes retain their existing script/style restrictions. Actual HTTP checks also confirm all new client assets are served with the correct bytes and MIME type.

## Verification

- Full local test/build run: 3,207 tests, 3,206 passed, one platform-only skip, zero failures. Runtime initialized 928 files without model calls; hosted build checked 409 public files and 11 media assets; release allowlist checked 877 software files.
- Final return-confirmation, copy and responsive refinements: 61 affected tests passed. All 21 checkout-flow regressions pass. Subscription API-shape refinements: 64 focused tests passed without skips.
- Actual disposable PostgreSQL runs cover the existing fixtures before and after v3, unchanged historical order/entry snapshots, yearly grants/refunds and a two-process monthly-versus-yearly signup race. These initial checks did not migrate a hosted database.
- Pinned Vale/textlint checks, canonical copy export and real-CLI negative canaries passed. An earlier interrupted broad run reported the existing introduction discard-timeout test under concurrent load; the isolated rerun and the completed full run both passed it.
- Real browser checks: three cards at 1280 px; English at 320 px, Chinese and Japanese at 390 px, and English at 768 px have no horizontal overflow. The three tablet actions align at the same vertical position. Mobile navigation includes Agent access, Pricing and GitHub; selecting the current price route closes it.

## Actual provider sandbox acceptance

Creem test products were created with the fixed monthly/yearly specifications using the existing protected test key. Production products, merchant settings, production customer records, Supabase data and real-money payments were untouched. No credentials were persisted. The sandbox created synthetic checkout, customer and subscription records for this acceptance. Application authentication and storage were isolated temporary fixtures; this was not a production account payment.

A browser selected annual, authenticated in-place, opened the real Creem embedded form with the US$50 yearly amount, and entered the provider's publicly documented test card. The provider explicitly identified the checkout as a test with no card charge. The overlay closed on completion while the merchant page remained open.

This uncovered two real contract differences that synthetic examples had missed: current sandbox checkout URLs use `/test/checkout/`, and paid transaction responses omit `discount_amount`. The URL validator now accepts the documented current routes alongside historical `/payment/` links. Missing discount is derived only from explicit safe principal, tax and paid amounts; missing amounts, explicit null, nonzero discount, underpayment and overpayment remain rejected. No missing financial value is assumed to be zero.

After these fixes, the same test transaction was reconciled through the authenticated browser return flow. Exactly 1,200 points were delivered once and the browser continued directly to `/library?ui=zh-Hans`. No second payment was created for this recovery. [Sanitized result](2026-10-22-three-plan-checkout/sandbox-summary.json), [embedded card form](2026-10-22-three-plan-checkout/embedded-card-test.png), [return to library](2026-10-22-three-plan-checkout/sandbox-return-library.png).

This proves the local source and actual sandbox interaction. Production payment activation and hosted schema readiness remain distinct gates. Same-commit CI, automatic Production publication and live acceptance are recorded on the pull request after they finish.

## Production preparation and build correction

After the user authorized production configuration, the three committed financial migrations were applied to the linked production database in one transaction. Other pending migrations were excluded. The billing readiness RPC reports `schemaVersion: 3`, `ready: true`, and `durable: true`; anonymous and authenticated browser roles cannot execute it, while `service_role` can. The account, order and ledger tables each contain zero rows after preparation. Production charging remains disabled until the merchant can process live payments and its live credentials, products and webhook are configured.

The first Production build of PR #162 failed because the annual SQL test unconditionally required native PostgreSQL, which Vercel does not install. Its required GitHub CI run had executed the native fixtures successfully. The correction permits an explicit missing-engine skip only during the test stage of `verify:hosted` on Vercel. Normal verification still fails without PostgreSQL, and an installed engine still executes the annual fixture in either context. Executable regressions verify both missing-engine outcomes and that this marker cannot be inherited from an arbitrary parent environment or reach runtime builders. GitHub CI retains its native-engine prerequisite.

Visual evidence: [desktop](2026-10-22-three-plan-checkout/pricing-desktop.png), [Chinese mobile](2026-10-22-three-plan-checkout/pricing-mobile.png), [English 320 px](2026-10-22-three-plan-checkout/pricing-en-320.png).
