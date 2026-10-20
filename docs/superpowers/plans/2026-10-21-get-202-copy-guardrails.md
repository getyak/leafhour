# GET-202 Copy Inventory and Guardrails Implementation Plan

> Public copy of the delivery plan for [GET-202](https://linear.app/getyak/issue/GET-202). Frozen accepted source: `43187d0ecaa63aa6575700677744c7cf4b3d099e`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user's direct-execution preference already authorizes this implementation; no additional approval checkpoint. Pi implements locally without recursively delegating or committing. Parent owns independent review and delivery.

**Goal:** Make visible product copy auditable and prevent newly introduced serious wording violations through actual Vale/textlint, without claiming existing global copy debt has been fixed.

**Architecture:** One source inventory retains catalogue values, consumers, static text and uncertain literal candidates. Exported text and a stable line-to-item map feed pinned upstream CLIs. Exact existing-debt records remain distinct from justified contextual exceptions; newly introduced T1 alerts fail CI.

**Tech Stack:** Node >=22.13, existing Acorn, Vale3.24.0, textlint15.8.0, JA technical-writing12.0.2, prh6.1.1.

**Spec:** [GET-202](https://linear.app/getyak/issue/GET-202) in Linear. This plan implements foundation batch A only; reader disclosure/affordance and the full per-item four-language rewrite are batch B and remain unfinished.

## Global Constraints

- Frozen accepted merged source: 43187d0ecaa63aa6575700677744c7cf4b3d099e; public repository getyak/leafhour, AGPL-3.0.
- Four languages: en, zh-Hans, zh-Hant, ja. Rescan current catalogues, do not reuse pre-GET201 counts.
- No product/source/book/quote/path/number/legal-fact rewrites in this batch; no model/OCR/cloud-account operations.
- No changes to existing daily/restore/account/reader trust boundaries, no Preview deployment.
- Regex/AST candidate discovery is not proof of unused text, actual visibility, human review or complete coverage.
- Preserve all unresolved classifications explicitly; no automatic namespace-wide retain/exemption masquerading as review.
- Every exception binds exact item, locale, rule, value SHA256 and a concrete reason. Existing debt is separately named and counted, never called a justified exception.
- Use real Vale/textlint; missing tool/config/parser, unexpected exit or malformed results fail closed. T1 fails, T2/T3 remain visible.
- Local dependency setup is isolated. Do not run npm install/ci against shared node_modules or change the primary checkout.

## Review Focus

1. Dynamic/computed references and duplicate IDs: never label them unused or silently overwrite rows.
2. Quoted/path/HTML-like strings and multiline text: extraction/export must not lose words or map alerts to another item.
3. A baseline/waiver that accidentally covers a changed value, another locale or another rule: must fail its exact binding.
4. CLI warning severity: the parent preset setting does not propagate; nested JA rule severity must be proven by actual CLI exits.
5. Empty corpus, missing CLI, unsupported locale, malformed output or tool crash: cannot be a passing lint run.

## Task 1: source-backed inventory and exports

**Files:** scripts/copy-inventory.mjs, scripts/export-copy.mjs, tests/copy-inventory.test.mjs, docs/copy/copy-inventory.{json,csv}.

**Interfaces:** `collectCopy({root})` returns schemaVersion/source binding, four catalogue values per stable key, exact source locations, consumer references and unresolved candidates. `exportCopy({inventory,outDir})` writes deterministic per-locale plain text plus a manifest mapping every emitted line range to stable item ID/locale/value hash. CLI accepts explicit root/output directories. No import-time writes.

- [ ] Write failing tests for four-locale key mismatch, a dynamic prefix, two DOM literal candidates on different lines, aria/title/placeholder/alt HTML attributes, multiline/HTML-like/protected source text, duplicate IDs and an empty corpus. Assert source references and unknown review state, not a guessed human decision.
- [ ] Run `node --test --test-concurrency=1 tests/copy-inventory.test.mjs` and retain the meaningful red result.
- [ ] Implement extraction and CSV quoting without executing arbitrary HTML/JS files; importing the trusted catalogue data is allowed. Infer context hints with confidence/source evidence, but keep final surface/trigger/classification unknown until individually reviewed. Preserve current values exactly.
- [ ] Export all catalogue copy and explicitly reviewed static UI literals; preserve uncertain hardcoded candidates separately so coverage gaps cannot disappear. Produce counts for catalogues, reviewed/unreviewed items, candidates, dynamic consumers and excluded protected source text.
- [ ] Rerun tests; generate the actual current inventory and deterministic export, checking a second run is byte-identical.

## Task 2: actual lint tools, exact debt and narrow exceptions

**Files:** .vale.ini, .vale/styles/Leafhour/*.yml, .textlintrc.json, .textlint/*.yml, tools/copy-lint.mjs, tools/copy-lint-debt.json, tools/copy-lint-allowances.json, tests/copy-lint.test.mjs, package.json/package-lock.json.

**Interfaces:** `lintCopy({root,manifest,valeBin,textlintBin,baseline,allowances})` runs explicit argv without shell, returns raw alerts, existingDebt, appliedExceptions, warnings, newErrors and toolStatus. CLI exits1 for new unexcepted T1/tool/config/inventory failures,0 for warning-only or unchanged documented debt. It never regenerates baseline/allowances in CI.

- [ ] Write failing semantic tests for new T1, warning-only, exact old debt, changed value/locale/rule, stale exception, malformed/empty tool result and missing tool. Each planted negative must exercise the real CLI in the integration canary, not only a fake subprocess response.
- [ ] Configure EN/ZH/Hant Vale error rules and warning rules from the issue, preserving contextual exceptions. JA uses the actual preset with explicit nested per-rule warning levels and prh T1 errors. Do not disable the entire preset or treat every technical page as exempt.
- [ ] Pin the exact Node devDependency versions and deterministic lockfile using package-lock-only if needed; verify no local shared dependency target changes. Root production dependencies stay unchanged.
- [ ] Capture existing catalogue debt against the frozen pre-rewrite baseline with exact value hashes and explicit unreviewed labels. New/changed T1 cannot self-whitelist by being added to the baseline: validate its bound value existed at the frozen source revision using git object reads and catalogue/source-item reconstruction. Keep this initial baseline distinct from a manually justified allowance. Explain baseline maintenance/reduction without an automatic refresh escape hatch.
- [ ] Execute actual upstream canaries: EN and ZH T1 exit1; JA prh T1 exit1; warning-only exits0 with alert retained; clean input exits0; narrow justified exception and a changed-value negative; protected quote/path unchanged. Record actual versions, exits and coverage.

## Task 3: deterministic CI installation and writing documentation

**Files:** tools/copy-install-vale.mjs, .github/workflows/copy.yml, docs/writing.md, docs/verification/2026-10-21-get-202-copy-foundation.md, release-files.json, .gitignore as needed.

**Interfaces:** installer accepts explicit destination, pinned platform/architecture and upstream checksum, verifies archive before extracting only the executable. `node tools/copy-lint.mjs` uses explicit tools/manifest and reports nonempty raw counts. Copy workflow runs for relevant JS/HTML/catalogue/config/script changes and main; no paid AI, secrets, Preview or third-party installer action.

- [ ] Test unsupported platform, checksum mismatch and extraction traversal rejection before successful pinned install. Reuse parent's verified Mac executable locally; CI downloads the pinned official Linux64 archive.
- [ ] Add a dedicated job with checkout/setup-node/npm ci, deterministic export, actual lint and real positive/negative canaries. Fetch the frozen baseline object without accepting arbitrary PR instructions or invoking shell from source text. Warnings/debt stay visible in logs/artifacts; no successful empty result.
- [ ] Write reader-centred guidelines, A–F rubric, source/context evidence requirements, multilingual meaning parity, truthful error wording (transport failure does not prove unsaved), protected facts and narrow exception/debt procedures. State full copy audit/rewrite, contextual screenshots, reader consent/affordance and human tests remain unfinished.
- [ ] Update the public allowlist for new software/docs only. Generated lint intermediates stay ignored; published inventory contains existing public copy only, no user/runtime data. Confirm lint devDependencies are excluded from the function trace.

## Task 4: integrated verification and checkpoint

- [ ] Run new copy tests and existing locale key checks serially; run actual lint/canaries, deterministic regeneration, release policy, small hosted build/public scan and diff check. No full local parallel suite, Docker or browser; parent owns actual browser/production and remote full CI.
- [ ] Self-review spec coverage: list exact completed foundation requirements and deferred batch B requirements, with counts for unreviewed/unknown rows and debt. Fix confirmed P0/P1 before `ready_for_review`.
- [ ] Keep source uncommitted for parent integration. Return concise summary, changed-file list, actual command exits, tool versions and any remaining gaps; never call GET-202 complete.

## Integration decisions after the implementation checkpoint

The isolated worker first implemented a standalone copy.yml within its frozen scope. The parent integrated those steps into the existing ci.yml and removed the standalone workflow: Production verification listens to CI completion, and the full test driver must explicitly forward the two tool paths through its environment allowlist. No provider credentials are forwarded. Actual clean-CI trace validation and same-commit deployment acceptance remain required. This change controls verification and our merge gate; it does not claim to delay Vercel Git deployment startup.

Independent component review produced eight bounded fixes, including source-byte binding and an explicit empty reviewed-static-literal input. The parent CI delta additionally closed three independently reproduced P2 findings. Original plan checkboxes are planning history; actual completed commands and pending acceptance are recorded in the verification document. Global rewrite and reader changes remain batch B.
