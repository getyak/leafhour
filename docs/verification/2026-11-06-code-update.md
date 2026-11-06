# Pending-code delivery audit — 2026-11-06

The user clarified that “update code” means auditing local work first, delivering pending source through a merged PR, then switching the current local directory to `main` and updating it from the remote. This order is now recorded in `AGENTS.md` and the user's explicitly requested preference note.

## Audit and integration

Inspected all 169 local branches and 25 worktrees, including tracked changes, untracked files, unpublished commits and PR state. Identified three current delivery units:

| Source | Existing work | Integration |
| --- | --- | --- |
| `codex/web-reader-controls-20261105` | PR #317 plus unpublished `773deacf` | Preserved current main's margin-note/guide behavior; fixed delayed authentication races. |
| `codex/three-module-runtime-20261105` | Unpublished `389a2b49` and its implementation plan | Reviewed and updated to `4314f6dd`; optional runtime foundation, with production gates retained. |
| `codex/macos-ops-20261105` | Unpublished `adec989e` | Reviewed and updated to `59c9e85f`; isolated operator tools and default-suite test entry. |

PRs #325 and #326 were created while the units were reviewed independently. Their source commits are integrated into the final #317 batch to avoid three successive production deployments. After #317 is confirmed merged, the covered PRs can be closed. No branch or worktree is deleted by this task.

Old branches without common ancestry with the public repository remain local recovery material. The unassociated historical GET-160/recommendation changes and the three saved patch artifacts were checked against current main and its verification documents; their fixes are already represented. Already-merged or intentionally closed PRs are not reopened. Untracked screenshots, browser scripts, logs and output directories are retained locally and excluded from the delivery.

## Source review

The reader changes retain main's newer half-height margin notes and GET-407 guide lifecycle. Independent review reproduced stale focus identity and close-settlement responses interrupting a reopened login/password flow. Regression tests failed before the fixes and passed afterward; final read-only review cleared the fixes. Earlier desktop-popup screenshots are historical evidence, not the current presentation.

Runtime review reproduced an old heartbeat failure aborting the next task and a delivery receipt for one domain document masking a failed write to another. Both received failing-before/passing-after regressions. Receipt recovery now verifies owner and document identity as well as receipt/result identity. The migration was exercised only in a fresh temporary PostgreSQL instance, including transaction atomicity, duplicate delivery, revocation, competing processes and authenticated-role denial.

The runtime is optional and is not enabled by this merge. The current Vercel entry is retained. General 202/SSE delivery, recovery of API-owned tool closures after restart, independent off-site log reconciliation and restore epochs, every real provider, Mac mini installation and production cutover remain acceptance gates. No production migration, system-service installation, Tailscale change, paid model request or physical-device acceptance is performed by this update.

## Verification

The reader unit passed `verify:deploy` with 4,773 tests, zero failures; the thirteen tool-dependent skips were subsequently covered by 41 passing real-tool tests, and the remaining skip was Linux-only. The runtime unit passed 4,783 tests with zero failures and one Linux-only skip, plus the real PostgreSQL checks, module build, compatible hosted build and release checks. The operations unit passed its 15 isolated tests and 25 affected release/CI tests. These unit-level results do not replace the final integrated checks or current-head CI.

The integrated runtime/reader pass then ran 107 affected tests with zero failures or skips, including real temporary PostgreSQL, followed by module build and boundary checks. The final full integrated verification and remote delivery state are recorded below when observed.

Final integrated `verify:deploy` passed on Node 22.22.0 with explicit real Vale/textlint paths: **4,813 tests, 4,812 passed, zero failed, one Linux-only skip**. It initialized the isolated 934-file reading runtime without model requests, built the hosted application, checked 751 public files, and passed the 1,563-file software allowlist and release validation. All operations tests and real temporary PostgreSQL checks were included.

Independent final integration review found no blocking issue in API/Agent/operator control compatibility, private configuration and service roles, the unchanged Vercel entry, or the release manifest. The manifest was checked against the exact union of the original main, reader and runtime software lists. These are source, isolated test and build results; remote CI, merge, local-main synchronization and production acceptance remain separately observable delivery steps.
