# Credit billing verification — 2026-10-21

Subscription continuation and current evidence: [reading subscriptions verification](verification-reading-subscriptions.md). The results below retain the original prepaid implementation's verification snapshot.

The local implementation is complete. Live billing remains off by default. This record does not establish production readiness or merchant approval.

## Executed evidence

| Level | Actual result |
| --- | --- |
| Latest feature and relevant regression selection | 283 tests: 282 passed, 0 failed, 1 PostgreSQL execution skip. Covers billing domain, raw webhook, real reading-domain handlers, browser intent/retry logic, cancellation, source ownership, metering, statements, localization, build boundaries and release imports. |
| Full suite, final source snapshot | Node 26.10.0, concurrency 4: 2,863 tests; 2,697 passed, 164 failed, 2 skipped, 0 cancelled. This is not a passing full suite. |
| Baseline comparison | Initial run had 173 failures. The final failed titles shared the baseline except three test-file native crashes. Direct tests against archived base commit `4ff8360a5d9d418d5a470c0096d9539e8f2dc3fe` reproduced native crashes for gift-quote and UI auth-return without this feature. |
| Isolated reading runtime build | Built and initialized 928 files, 9.0 MB, no model request. |
| Hosted static build | Passed; existing 320 KiB reader JS and 200 KiB CSS caps retained. Spending consent and original-file download helpers load on explicit gestures. |
| Public output and source-provenance checks | Passed: 396 public files, 11 registered media assets; no private content directories. |
| Software release allowlist | Passed: 803 software files. |
| Whitespace/error check | `git diff --check` passed. |
| Independent code review | All reported Critical/Important findings addressed and focused regressions rerun. No unresolved findings in the reviewed scope. |

The final feature selection included `tests/billing*.test.mjs`, `credit-client`, provider metering/pricing, gift quote metering, bounded batch billing, reader credit routing, locale async-reader, chat UI, profile shell, annotation UI, component/typography, portal-document, translation safety, annotation boundaries, reader-web build and release tests.

Full-suite failure blocks included 146 socket/permission errors, 11 existing assertion failures, 4 other existing wrapper failures and 3 native Node crashes. Failed HTTP tests cannot listen on loopback (`listen EPERM`). Several runtime/CLI assertions depend on those denied listeners. Node 26 also aborts in `node::InternalCallbackScope::Close` with an `execution_async_id` assertion; two such failures reproduce on the original base source. The installed Node 22 executable could not start because its `libsimdjson.30.dylib` dependency is missing. Neither limitation was bypassed or repaired by changing the user's system.

## Database and external validation still required

The SQL adapter and source contracts execute, but actual PostgreSQL migration/concurrency execution is **unverified**. PostgreSQL 14.15 `initdb` could not allocate shared memory (`shmget EPERM`), including Unix-only configuration. The executable SQL fixture is deliberately skipped rather than reported as passed. Live mode requires a durable Postgres store and an explicit schema-verification flag after real isolated validation.

All payment and provider tests use isolated fixtures. No real Supabase migration, persistent account activity, model call, Creem sandbox purchase, cash refund or production payment was performed. Hosted raw-byte delivery, actual supplier usage and real fulfillment still require their respective acceptance runs. Browser automation disconnected during responsive layout checks, so no 390/768/1440 browser acceptance or screenshots are claimed.

## Behavioral checks

- Supplier product metadata is checked before checkout: configured environment/ID, US$5, USD, active, exclusive tax and official `onetime` type. Wrong products cannot create a checkout.
- HMAC covers the exact bounded original bytes before JSON parsing, browser Origin or session checks. Sparse notifications obtain authoritative supplier facts; evolving reconciliation snapshots have distinct identities.
- Quote/operation/hold, paid grants, trial grants and supplier attempts are independently idempotent. Test/live data stays separate. Refund/dispute tombstones prevent delayed paid facts from reviving rights.
- Durable reading results bind owner, source version, passage and operation. Completion recovers without model replay. Failure/cancellation releases points; spent-then-refunded consumption reversals preserve ledger consistency without minting refunded rights.
- Browser retries persist the original quote and idempotency pair without source text; translation intent IDs survive reload. Trusted terminal and definitely unstarted receipts permit a new explicit attempt. Unknown transport outcomes retain their original identity.
- Stop during quote preparation prevents later dispatch. Account changes, abort signals, stale versions, invalid results and disconnected annotation requests cannot authorize new paid work.
- Usage gaps remain null/unknown. Reports separate trial, purchase/review, feature and funding sources, and state that payment fees are unknown. No exact-profit claim is made.
- Reading, notes, layout, saved results and export remain free. Sponsored automatic reading prompts never consume purchased points. Existing external Agent read/write grants do not acquire spending authority.

## Delivery and merchant status

The shared checkout's Git metadata is read-only. Native worktree creation failed, and remote branch creation through the GitHub connector returned 403 (`Resource not accessible by integration`). A task-only local checkout at `/tmp/leafhour-credit-billing-review`, branch `feat/credit-billing`, preserves the original public base without unrelated homepage changes. The same 283-test feature selection (282 pass, 1 explicit SQL skip), hosted build and public/release checks also passed from that isolated checkout. No push, PR, merge or Production deployment is claimed.

English business/product review drafts and current activation requirements are in `docs/billing.md`. Creem's current policy includes additional verification for generative AI and restrictions on companion chatbots. The actual book-focused workflow still needs merchant classification and approval. The visible support email has not been tested for delivery in this session.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](verification/2026-10-22-local-git-recovery.md).
