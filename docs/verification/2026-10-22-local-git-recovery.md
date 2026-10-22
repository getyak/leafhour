# 2026-10-22 local Git recovery and delivery

Baseline: public `main` at `ba9eef7f605572dc8eb3dd51b86ad03be1c4cc65`.

## What was worth recovering

The primary checkout had 120 modified or untracked files (6,191,216 bytes). A complete local copy, SHA-256 manifest and tracked binary patch were captured before integration. The original checkout was left intact while a new public-main-based worktree received the source delta. Six conflicting files were reconciled with the newer preference memory, account settings, scoped OAuth MCP and localization changes rather than replacing their current versions.

The valuable work is the optional credit ledger and subscription implementation, its provider metering, localized billing/legal pages, owner-bound reader consent and recovery, a quieter public home and library skin, their tests, plans and honest verification records. The small color exploration is retained as [a design study](../design/2026-10-21-color-study.html). The eleven files under the old `output/` directories are generated screenshots, an embedded preview, an injection helper and a duplicate patch; their originals remain in the local recovery snapshot, while fresh browser evidence accompanies this delivery.

All eight pre-existing secondary worktrees were clean. The initial 88 branches plus this delivery branch were checked against 158 merged PRs. [Machine-readable branch and stash evidence](2026-10-22-local-git-recovery/history.json) records every classification:

| Branch classification | Count | Decision |
| --- | ---: | --- |
| Direct main ancestor | 27 | Already delivered |
| Exact merged PR head | 45 | Already delivered through a merge or squash |
| Old private history | 14 | Code already represented in public snapshots; never upload those ancestors |
| Public work subsumed by later PRs | 2 | Reading tools and cancellation are already in PRs 39 and 112 |
| Full tree identical to a merged result | 1 | PDF performance work is identical to PR 78's merge |

The three original stashes contain delivered upload, introduction and historical configuration work. None was applied or discarded. No missing useful historical implementation was confirmed. These conclusions use ancestry, full-tree/blob comparisons and merged-PR identity, not raw ahead counts; not every historical prose line was re-reviewed.

## Defects corrected during review

- Native SQL fixtures now grant access to the real temporary schema. Both migrations and their reservation/signup concurrency cases execute in disposable PostgreSQL clusters. Test binaries are discovered through `pg_config`, and CI requires them.
- An expired bound monthly subscription keeps its signup lock while payment can still retry. Only supplier-confirmed cancellation releases it, matching [Creem's documented lifecycle](https://docs.creem.io/code/webhooks#subscriptionexpired).
- A stable unknown-usage provider attempt is saved before dispatch. A single matching completion may enrich it; a later replay cannot rewrite owner, scope or terminal facts. A storage failure prevents dispatch.
- Confirmed non-started/released billing receipts survive both reader and library transport adapters. An expired quote can obtain a new explicit attempt without losing the question, while ambiguous transport failures retain the same ID.
- Translation and annotation distinguish cancelled consent and insufficient points, preserve existing reading state and expose a localized billing recovery path.
- Home and reader styles use shared focus/action tokens, preserve the 12px functional text floor and keep existing initial/deferred asset budgets.
- The exact Creem webhook rewrite precedes the generic API rewrite. Billing shells retain private/no-store and noindex headers.
- Existing homepage/discovery assertions now follow the approved sample-first entry while preserving authored locale and automatic-root behavior.

## Verification

The first run on the old checkout exposed seven failures rather than a shippable state. The first integrated run additionally identified the generated dependency symlink, annotation source cap and missing test helper in the release snapshot. Dependencies were installed into the isolated checkout; release closure and fixed asset budgets were retained. Final command results follow below; generated copy inventories are committed with the source so CI can reproduce them.

Browser checks used an isolated local service with no provider credentials or real accounts: Chinese home at desktop 1280px and mobile 390px, opening/closing the language menu, sample links retaining their UI locale, no horizontal mobile overflow, anonymous billing and disabled payment messaging, and public pricing disclosure. These do not establish real payment fulfillment.

- [Desktop home](2026-10-22-local-git-recovery/home-desktop.png)
- [Mobile home](2026-10-22-local-git-recovery/home-390.png)
- [Mobile language menu](2026-10-22-local-git-recovery/menu-390.png)
- [Anonymous disabled billing](2026-10-22-local-git-recovery/billing-disabled.png)

## Automated evidence

- Final Node 22 deployment verification with the real lint tool paths: **3,145 passed, 0 failed, 1 platform-only skip** out of 3,146 tests. Both native SQL/concurrency suites executed. Runtime initialization, hosted build (402 public files / 11 registered media assets), release closure (861 software files) and public provenance checks all passed.
- Current product copy: 2,114 message keys across four locales. Real pinned Vale/textlint: 0 new T1 errors, 394 documented existing debt entries and 1,923 retained warnings. These existing findings remain visible; no new allowance or debt exemption was added.
- Fresh scan of the task’s staged files: **no secrets found** (10.79 MB scanned). Staged whitespace checks and release closure passed.
- Real lint planted-negative canaries passed. No test, existing debt rule, fixed asset cap or required CI gate was weakened.

## Activation and data boundaries

Commercial billing stays disabled. This delivery does not migrate the hosted database, create products or subscriptions, charge/refund money, send model requests, change hosted secrets or write real reading data. Native SQL execution is now proven locally; Creem sandbox/real fulfillment, hosted migrations and operator activation remain separate gates. Recovery currently runs during account reads; unattended operational recovery has not been enabled or accepted.

No restricted books, private runtime data, credentials, dependency trees or old private Git ancestors are included. The original local patch and generated artifacts remain recoverable. Only GitHub CI gates the feature branch; Production is tracked after merging main.
