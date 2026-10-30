# Local work audit and paid conversation recovery

Date: 2026-10-30. Starting public main: `5e8b5435ef580ee31050203aef45aa52884bce00`.

## Audit scope and findings

The audit inspected 24 existing worktrees and 134 pre-existing local branch tips, the three saved October 25 patches, the iOS design archive and 10 stash entries. All worktrees initially had clean tracked files. The main checkout contained 93 untracked files, consisting of historical reports, patch backups and local verification artifacts. No worktree, branch, stash or raw artifact was deleted or overwritten.

Of the 134 branch tips, 117 were already covered by remote reachability, main ancestry or an exact head of a merged public PR. The remaining 17 contained local-only commit hashes. Source, test and migration comparisons found no additional independent implementation to restore:

| Retained branches (`codex/` prefix omitted) | Public recovery evidence |
| --- | --- |
| `authentication`, `quiet-reading-controls`, `continuous-reading`, `chapter-end-anchor`, `original-first` | Source and tests match the respective public PR #6, #13, #14, #15 and #16 snapshots. |
| `reading-renewal` | Source and tests match PR #12 merge `b5bf38`, including the PR #7–#12 integration. |
| `four-reading-experiences` | Source and tests match public PR #3 snapshot `677c1d6`. |
| `legacy-private-main-local`, `chinese-trial-openings` | Ancestors of the recovered reading-experiences and atmosphere-integration implementations. Twelve of these 17 retained branches contain the old private ancestor; their histories must remain local. |
| `hosted-build-check`, `library-workspace-cicd`, `reading-atmospheres-integration` | Source, tests, API, dependencies and deployment configuration match public snapshots `451f6f3`, `696e4d1` and `22cf6e6`, respectively. |
| `deploy-chinese-trial`, `hosted-reader-v020` | Source, tests, tools and documents match PR #4 snapshot `f68e91b` and PR #3 snapshot `677c1d6`, respectively. |
| `reading-agent-tools` | Implementation matches PR #39 merge `79b3025`; public verification records contain additional review evidence. |
| `review-get-160-cancel-commit` | PR #112 contains the nonce-bound cancellation cleanup, bounded retry and independent quota release. The public version adds upstream-4xx classification protection and its regression. |
| `fix/pdf-reading-performance` (full name) | Local `ae92e72` and PR #78 merge `4cce402` have the same complete Git tree. |

The obsolete single-language privacy page was replaced with four-language pages in `2f97974`. The old publication mirror workflow and tool were intentionally removed in `a15565c` / PR #17. Neither is missing work to restore. These comparisons concern source and public records; they do not prove that every historical design was implemented or repeat all online acceptance.

## Saved patches and artifacts

| Local material | Disposition |
| --- | --- |
| `quiet-reading-chat.patch` | Core recovery is GET-220 / PR #183. Desktop presentation later became a sidebar in PR #227. GET-274 / PR #258 retained it and introduced the mobile half sheet. Replaying the old overlay would undo later work. |
| `reading-hover-dismiss.patch` | GET-221 / PR #184 recovered the interaction. Current tests retain 200 ms preview / 5 s explicit timing and the later AI-sibling hover contract. The old exclusion of that sibling is superseded. |
| `system-interface-language-handoff.patch` | GET-219 / PR #182 recovered and strengthened the behavior. Explicit `system` is stored separately; legacy null values continue to delegate to the device. |
| Four October 25 plan/verification files | Added to source with dated successor notices. Their original test totals, pricing observations and blocked-session statements remain historical evidence. |
| iOS design ZIP | All 83 file bytes match the corresponding tracked `docs/design/2026-10-26-ios-half-sheet/` files. No duplicate archive is added. |
| Browser output and author research artifacts | Preserved locally. The nine untracked JavaScript/module files across three worktrees are task-specific verification scripts, rather than missing application modules. Raw browser/account evidence is not bulk-published. |

## Retained stash evidence

All ten stashes were compared read-only; none was applied, dropped or rewritten. No additional functional or security repair remained beyond the changes handled here. This does **not** mean every stashed edit was adopted:

| Stash commit prefix | Result |
| --- | --- |
| `a696e10844f8` | October 25 residue: 182 unadopted shortened locale values, superseded chat/hover rules and the four historical reports archived here. |
| `081cc2536470` | Cover implementation is in PR #235, later extended by #253. The stashed cover manifest is byte-identical to main. |
| `746aa2137692` | First-paint language is in #231 and visible recovery in #238; unchanged source/test comparisons and later changes account for the snapshot. |
| `460f049f5e96` | The same 182 locale values as `a696e10844f8`; old writing guidance is superseded by #210 and later translation hints. |
| `18edbb4f8642` | The same locale candidates plus four system-option labels. #182/#183/#184 recover language/chat/hover; old pricing validity must not be restored. |
| `e3068ece45ac` | Earlier, larger October 25 snapshot: 232 locale-value differences across 88 message keys, overlapping the 182 above. Other changes have #178/#182/#183/#184/#210 or later successors. |
| `b40e3943a668` | Billing recovery is in #159 and later #161/#162. Current SQL additionally protects immutable provider receipts and expired-subscription locks; restoring this snapshot would remove those protections. |
| `2eaa83dff58f` | Upload and persistent chapter work is in #146. Current code additionally stops background polling and caches immutable chapters. |
| `b91101c7430e` | PR #108 review fixes are present; several source/test files are byte-identical. Current tests additionally cover #112 cancellation protection. |
| `0d1308719d92` | Historical open-source/domain documents, superseded by current AGPL, public-repository, runtime-data and Leafhour brand records; no functional code. |

The 182 values are counted by `(locale, message key)`: English 18, Japanese 18, Simplified Chinese 73 and Traditional Chinese 73, covering 73 distinct keys. Their keys and values are identical across the October 27/30 residue snapshots; counts must not be added across stashes. The earlier 232-value snapshot overlaps them and is not an additional independent set. Main retains the original sentences rather than these shortened candidates.

The candidates are deliberately left unapplied because some remove source or permission qualifications: `book.description.ai` loses the opening-sample limitation, `reader.annotation.unconfirmed` loses the same-request check, and `giftCompose.previewNote` loses the statement that preview does not publish. Their generated copy/debt files cannot be restored independently. The stashes remain recovery material, not approved copy.

Stashes with third parents also retain untracked files; their existence was inventoried without publishing private browser output or runtime data. The two oldest stashes have first parents outside public main ancestry, so their old histories must not be pushed as a recovery shortcut.

## Reproduced defect and minimal repair

The current chat state sends `peopleWrites: true` only after explicit per-question authorization. The server credit gate already accepts and validates it, but the browser credit gate omitted the field. With billing enabled, this caused `BILLING_INVALID_INPUT` before any identity or quote request. Default conversations omit the permission and were unaffected.

The client now accepts only a boolean, preserves absent/false authority and includes the existing create/edit/delete permission in the four-language point confirmation. Confirmation reuse distinguishes people authority as well as preference authority. Existing complete-input digests continue to bind quotes and retries, so a paid retry cannot change permission or create another generation. No server write tool, price, budget or automatic generation trigger is added.

The five new tests exercise browser admission, malformed values before network access, authority-specific confirmation, four-language permission text, and the actual client-to-billing-domain quote/run/retry chain with an isolated in-memory ledger. The integration checks both false-to-true and true-to-false quote tampering, one quote, one synthetic dispatch and one settlement. No model or real account is involved.

## Verification and delivery

- Before the repair, the new test run had four expected failures: rejected permission, rejected retry setup, rejected client/domain integration and missing confirmation text.
- After the repair, both affected suites passed: **35 tests, zero failures or skips**. An independent reviewer repeated the same result.
- Existing patch-related behavior was checked separately before the repair: **232 tests, zero failures or skips** across ten suites.
- Real pinned Vale/textlint checks and all copy canaries passed; source mappings were regenerated without changing catalogue values.
- The first full deployment verification ran **4,391 tests: 4,382 passed, eight failed and one macOS platform case was skipped**. All eight failures were in `observability.test.mjs`; the local install was missing the already locked `@sentry/node` dependency. The failed run remains recorded and is not presented as a passing full suite.
- `npm ci --no-audit --no-fund` restored the existing lockfile installation without source or lockfile changes. The failed module and ten related suites then passed **259 tests, zero failures or skips**. The already passing unrelated tests were not repeated locally; current-head CI must provide a fresh clean-install full run before merge.
- First-paint and pricing checks passed. Runtime initialization passed with **928 traced files, 9.0 MB and no model requests**. The hosted build, **718 public files / 12 registered media assets**, **1,409-file release allowlist** and source-provenance checks passed after dependency restoration.
- Independent code review found no unresolved defects. It independently repeated the 35 affected tests and checked legacy confirmation keys, retained request pairs and owner switching. A historical PR attribution error in two archive notices was corrected before delivery.

Final full verification, current-head CI, merge and exact-source Production results are recorded as separate gates. This report does not claim real paid-model execution, physical iPhone acceptance or a new native release.
