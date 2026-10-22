# Reading subscriptions verification — 2026-10-21

This continues the prepaid-credit work recorded in `docs/verification-credit-billing.md`. The user selected top-ups plus monthly renewal: 10 verified-account trial points once; US$5 for 100 top-up points; US$5 per month for 100 points after each successful payment. Delivered points accumulate without expiry. The user reports completing merchant verification and separately confirmed that API credentials, webhook secret and product IDs have not yet been configured.

## Executed evidence

| Check | Actual result |
| --- | --- |
| Final focused selection, Node 22.22.0 | 354 tests: 352 passed, 1 failed, 1 skipped. The sole failure is the original native PostgreSQL fixture: `initdb` cannot create a SysV shared-memory segment (`shmget`, ENOSPC/SHMMNI). The new subscription SQL execution fixture explicitly skips the same unavailable native prerequisite. Neither migration has been executed here. |
| Final full suite, Node 22.22.0, concurrency 4 | 2,954 tests: 2,778 passed, 174 failed, 2 skipped, 0 cancelled. This is **not** a passing full suite. Failures include denied loopback listeners (`listen EPERM`), downstream HTTP/runtime assertions and native database initialization. All failure names remain in the run log. |
| Trial admission and exhaustion | A fresh server-verified identity receives exactly 10 points once on its first authorized quote. Ten synthetic translations settle; the eleventh rejects with HTTP 402 before execution. Campaign exhaustion does not mint points or prevent quoting against purchased funds. |
| Independent subscription review | Documented null-value compatibility, fixed-price metadata, preflight ordering, atomic paid-cycle identity, refunds/disputes, ownership, lifecycle ordering and expiry recovery reviewed. No unresolved Critical/Important findings in the reviewed scope. SQL reviewed statically only. |
| UI account-switch regression | Review found a resumed-checkout chain could return the previous owner's URL after an intervening session adoption. A failing regression preceded the whole-operation revision-fence fix; the final UI/build selection passes 34/34. The reviewer independently reran 13 expiry/recovery/ownership tests successfully. |
| Hosted static build | Passed. Public output check: 396 files, 11 registered media assets, no private content directories. Source-provenance verification passed. |
| Release contents | Passed: 813 software files, including the subscription runtime module, migration and executable fixtures. |
| Reading runtime | Built and initialized 928 files, 9.0 MB, no model requests. |
| Whitespace and syntax | `git diff --check` and explicit syntax checks passed. |
| Task-only checkout | The same 354-test selection (352 passed, 1 native SQL failure, 1 SQL skip), static build and public/release checks were reproduced in `/tmp/leafhour-credit-billing-review` on `feat/reading-credit-subscriptions`. Only 92 task files were copied; credentials and unrelated homepage edits were excluded. |

The final focused selection was `tests/billing*.test.mjs` plus credit-client, provider metering/pricing, gift quote metering, translation-batch billing, reader credit routing, locale async-reader, chat/profile/annotation UI, component/typography, portal-document, translation safety, annotation boundaries, reader-web build and release tests.

During the full run, an existing billing remount test exposed a timing assumption: two `setImmediate` turns do not guarantee WebCrypto preparation completed before disposing a view. The test now waits on the actual preparation event with a bounded test timeout. Its financial/idempotency assertions are unchanged; the final full run passes that case. No product behavior was weakened to accommodate timing or environmental failures.

Run logs are local scratch evidence, not persistent account data: `/tmp/leafhour-subscriptions-final-focused.log`, `/tmp/leafhour-subscriptions-final-full.log`, `/tmp/leafhour-subscriptions-final-build.log`, `/tmp/leafhour-subscriptions-runtime.log`.

## External configuration and acceptance

- Prepared missing billing variable names in the existing, Git-ignored local `.env`, with file mode 0600. Existing values were preserved. Test mode, a finite proposed 10,000-point trial campaign and closed live/schema-verification flags were prepared; credentials and product IDs remain empty. The file is not part of the source delivery.
- `node tools/configure-billing.mjs --check` reports the missing protected credentials/settings without printing secrets. It does not claim remote configuration is complete. The product helper uses stable idempotency and preflights all existing products before creating any missing product; this session created no provider products.
- Actual supplier checkout, webhook delivery, generated portal URL, renewal, cancellation and refund acceptance have **not** run. Fixtures use isolated synthetic data. No real customer subscription, charge, refund, model call, hosted schema migration or persistent default-account records were created.
- Browser acceptance remains **unverified**: local HTTP listening was denied, and a headless browser call hung until interrupted. No screenshots or responsive browser acceptance are claimed.
- The linked Vercel configuration API could not be reached through the configured proxy. Native Git fetch/push encounters the unavailable local proxy; `gh` credentials are invalid. The GitHub connector can read repository metadata but branch creation still returns HTTP 403, `Resource not accessible by integration`. No settings, remote branch, PR, merge, remote CI or Production deployment has been created in this continuation.
- Remote main was observed eight commits ahead of the original public base. Delivery requires normal synchronization and renewed validation when remote access is restored; no force push or replacement of upstream work is authorized.

Known checkout IDs now support owner-bound resume and reconciliation. Only a supplier-confirmed unpaid/unbound expired checkout unlocks a new intent. A creation timeout with no stored checkout ID stays locked for operator reconciliation; the application cannot safely guess whether the provider created a checkout. Portal URLs currently support the official `/my-orders/` format and must be checked against an actual generated URL before live activation.

Design and operator instructions are in `docs/superpowers/specs/2026-10-21-reading-subscriptions-design.md`, `docs/configuration.md` and `docs/billing.md`. Local implementation, configuration readiness, merchant approval, deployment and real payment acceptance remain separate statements.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](verification/2026-10-22-local-git-recovery.md).
