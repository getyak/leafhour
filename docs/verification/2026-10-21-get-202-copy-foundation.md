# GET-202 copy guardrails foundation — verification record

Date: 2026-10-21 (updated after the independent pre-review repair batch). Scope: foundation batch A of [GET-202](https://linear.app/getyak/issue/GET-202) — an auditable copy inventory and real lint guardrails. This is **not** the copy rewrite: no catalogue value was changed, no item was reviewed, and GET-202 stays open. Frozen accepted source: `43187d0ecaa63aa6575700677744c7cf4b3d099e` (GET-201 merged). Plan: `docs/superpowers/plans/2026-10-21-get-202-copy-guardrails.md`. Standard: `docs/writing.md`. Independent pre-review: `independent-preflight-review.md` (SHA256 `dcb19a1374ad1d4c22a8960067c2e93454e127696cdd8942fad331151e98615d`), evidence in `preflight-independent-evidence/` (read-only; never edited).

## What exists now

| Area | Files |
| -- | -- |
| Inventory + export | `scripts/copy-inventory.mjs`, `scripts/export-copy.mjs`, `docs/copy/copy-inventory.{json,csv}`, `docs/copy/copy-candidates.csv`, `docs/copy/copy-reviewed.json`, generated `build/copy/{en,zh-Hans,zh-Hant,ja}.txt` + `manifest.json` (+ untracked `export-receipt.json`) |
| Lint guardrails | `.vale.ini`, `.vale/styles/Leafhour/{DevSpeak,ToneT1Zh,ToneT1En,ToneT2Zh,ToneT2En,TonePunctuation}.yml`, `.textlintrc.json`, `.textlint/prh.yml`, `tools/copy-lint.mjs`, `tools/copy-lint-debt.json`, `tools/copy-lint-allowances.json` |
| Real-CLI canaries | `tools/copy-canaries.mjs` (11 cases through the pinned CLIs) |
| Deterministic install | `tools/copy-install-vale.mjs`, `tools/copy-tooling/{package.json,package-lock.json}`, `.github/workflows/ci.yml` |
| Tests | `tests/copy-inventory.test.mjs` (17), `tests/copy-lint.test.mjs` (19), `tests/copy-install.test.mjs` (7) |
| Docs | `docs/writing.md`, `docs/copy/README.md`, this file |

## Repair batch after the independent pre-review (initial cases fixed; additional boundaries below)

Each fix was written RED first against the reviewer's exact failure mode, then implemented. Focused suites after the batch: `tests/copy-inventory.test.mjs` 17/17, `tests/copy-lint.test.mjs` 19/19, `tests/copy-install.test.mjs` 7/7, all with the actual pinned CLIs (0 skipped in tool-equipped runs).

| Finding | Fix | Regression |
| -- | -- | -- |
| F202-A1 candidate identity collision | HTML attribute/text candidates now carry real offset-derived `line:column` and unique `candidate:<file>:<line>:<column>` ids; one scan claims each source offset once without merging different nodes; `collectCopy` fails on any duplicate identity. Also tightened the `identifier` protection heuristic so plain UI labels (e.g. "Close") stay reviewable while keys/paths/URLs/quotes stay protected source | `same-line HTML nodes keep distinct stable identities without merging`, `plain UI labels stay reviewable while keys, paths, URLs and quotes stay protected source`, repo-wide uniqueness assertion |
| F202-A2 declared hash trusted over actual bytes | `verifyLineMap` recomputes each item's exact bytes (no trim; multiline and trailing-empty-line semantics preserved) from its line range and compares SHA256 with the manifest before any debt/exception match; on mismatch nothing may match debt or allowances and the run fails as an inventory failure. `exportCopy` refuses any inventory whose value does not match its declared SHA256 | `changed export bytes with an old manifest fail as inventory, never as documented debt` (reviewer's negative, real CLI), `export refuses an inventory whose declared value hash is wrong` |
| F202-A3 alert binding lost file identity | Alerts bind by normalized requested file + locale + exact line range (`alertFile` retained on every alert); unrequested/duplicate file results, overlapping mappings and malformed locations are rejected | `a second locale-matching file cannot borrow the first item exception` (reviewer's `second/en.txt` negative, real CLI) |
| F202-A4 structured-but-empty tool results fail open | Exit/status consistency enforced (Vale exit 1 needs error alerts, exit 0 forbids them; textlint likewise); textlint must return exactly one structured result per requested file (missing/duplicate/unrequested fail, `messages: []` valid); severities validated against explicit enums; malformed lines rejected. Fault cases use deliberately injected fake subprocesses and are named as such | `structured but empty tool results fail closed`, `textlint must report every requested file exactly once with a valid severity` |
| F202-A5 prh T1 severity downgradeable | `checkTextlintConfig` requires `rules.prh.severity` to be absent (actual error default) or exactly `error`; `warning`/`info`/`off` fail configuration validation even with intact `rulePaths`; nested JA technical-writing rules stay warnings as intended | `the JA prh T1 severity cannot be downgraded by configuration`, `a downgraded prh configuration fails even when the real JA corpus still has T1`, canary `ja-prh-severity-downgrade-blocked` (real textlint shows the downgraded config hides the planted T1 at exit 0 while validation blocks it) |
| F202-A6 inventory bound to HEAD | Tracked artifacts bind every scanned input file by path + SHA256 plus a combined `inputDigest`; no commit id appears in them. The executing commit is written only to untracked `build/copy/export-receipt.json`, and the docs state the scan never claims to represent any commit | `the generated inventory binds input bytes, not the current commit` (synthetic git empty-commit → byte-identical inventory; real input edit → changed identity) |
| F202-A7 installer CLI mapped non-darwin hosts to linux | CLI default is the actual `process.platform`; unsupported hosts are rejected before any archive/network access | `the CLI rejects an unsupported host platform before touching the archive` (faked `win32` host, deliberately absent `--archive`) |
| F202-A8 reviewed static-literal export missing | `docs/copy/copy-reviewed.json` (source-bound, empty in batch A) plus `validateReviewedLiterals`: exact candidate id + original value SHA256 + locale + surface + trigger + concrete rationale + `state: reviewed`; stale/unknown/duplicate/incomplete decisions and protected source material fail. Adjudicated literals are appended to their own locale corpus/manifest as `kind: static-literal`; unknown candidates never enter the corpus | `export appends only explicitly reviewed static literals to their own locale corpus`, `stale, unknown, duplicate and incomplete review decisions fail closed`, `only explicitly reviewed static literals join the lint corpus` |

## Verified locally after the repair batch (exact commands and exits)

Pinned tools: `vale version 3.24.0` (official `vale-cli/vale` v3.24.0; macOS arm64 archive SHA256 `87b513f2…51e44`, Linux64 checksum pinned `867534dd…6c8b214`), `textlint v15.8.0` with `textlint-rule-preset-ja-technical-writing@12.0.2` and `textlint-rule-prh@6.1.1`, resolved via `LEAFHOUR_VALE_BIN` / `LEAFHOUR_TEXTLINT_BIN`.

| # | Command | Exit | Result |
| -- | -- | -- | -- |
| 1 | `node --test --test-concurrency=1 tests/copy-inventory.test.mjs tests/copy-lint.test.mjs` | 0 | 36/36 pass with the real CLIs, 0 skipped |
| 1b | `node --test --test-concurrency=1 tests/copy-install.test.mjs` | 0 | 7/7 pass |
| 2 | `node scripts/export-copy.mjs --root . --out build/copy` | 0 | 2067 keys / 8268 locale values / 3726 unreviewed candidates (90 protected source, 3726 unique identities) / 2610 unresolved dynamic references; 2078 lines per locale; 0 reviewed static literals |
| 3 | `node tools/copy-lint.mjs --manifest build/copy/manifest.json` | 0 | raw alerts 2276 (vale 866, textlint 1410); T1 new errors 0; documented debt 394; justified exceptions 0; warnings retained 1882; stale bindings 0/0 |
| 4 | `node tools/copy-canaries.mjs` | 0 | 11/11 cases pass (incl. the prh-downgrade negative); rules exercised: `Leafhour.DevSpeak`, `Leafhour.ToneT2En`, `Leafhour.ToneT2Zh`, `ja-technical-writing/ja-no-mixed-period`, `ja-technical-writing/no-exclamation-question-mark`, `prh` |
| 5 | `node tools/release-policy.mjs` | 0 | 794 software files; private history and data excluded |
| 6 | `node tools/build-vercel.mjs` | 0 | hosted library/reader build |
| 7 | `node tools/check-public-build.mjs dist` | 0 | 361 files, 11 registered media assets; no private content directories |
| 8 | `git diff --check` | 0 | clean |

Supporting evidence in the same session:

- Deterministic regeneration: two consecutive export runs produce byte-identical tracked artifacts (SHA256 `5df340bbe612f7fe395aff55f16cea2098424537a9a82449c5aea71e74bebb59`); the synthetic-git test proves an unrelated commit cannot change the inventory, and a real input edit does.
- Existing locale key checks: `node --test --test-concurrency=1 tests/ui-locale*.test.mjs` → 270/270 pass (run before the repair batch; the batch touched no locale code).
- Release import-coverage and public-build tests: `node --test tests/release.test.mjs tests/public-build.test.mjs` → 14/14 pass.
- Without installed lint CLIs the same copy suites run as 32 pass / 11 explicitly skipped (each skip names `lint CLIs unavailable … the real-CLI planted negatives run in tools/copy-canaries.mjs and in the copy CI job`) / 0 fail. **A skipped case is not a real-CLI pass**; the real-CLI evidence above comes from tool-equipped runs and the canary suite.
- Real upstream archive install: checksum verified before extraction, only `vale` extracted (55367186 bytes), `vale --version` → `vale version 3.24.0`. Isolated `npm ci --ignore-scripts` against `tools/copy-tooling/` installs the pinned textlint tree (379 packages) and reproduces the expected prh error / preset warning severities.
- Nested JA severity proven against the real CLI: preset-level `severity` does not propagate; all 23 preset rules are configured individually at explicit warning severity, prh is locked at error, and `tools/copy-lint.mjs` fails closed on any missing/unknown/retuned rule or downgraded prh severity.

## Guardrail semantics actually enforced

- **T1 (error)** fails the run: `Leafhour.DevSpeak` (EN + zh-Hans + zh-Hant), `Leafhour.ToneT1Zh` / `Leafhour.ToneT1En`, `prh` (JA, severity locked to error).
- **T2/T3 (warning)** stay visible and never fail: `Leafhour.ToneT2Zh`, `Leafhour.ToneT2En`, `Leafhour.TonePunctuation`, 23 preset rules. A warning-only run exits 0 with every warning retained in the log and `build/copy/lint-report.json`.
- **Existing debt** (`tools/copy-lint-debt.json`): 348 bindings (394 raw T1 alerts; EN 54 / zh-Hans 130 / zh-Hant 126 / ja 38), each `existing-debt`/`unreviewed`, bound to item + locale + rule + value SHA256 and re-validated against the frozen revision via git object reads every run. Newly worded T1 cannot add itself to the baseline; stale bindings fail until manually pruned; no regeneration command exists.
- **Justified exceptions** (`tools/copy-lint-allowances.json`): 0 (nothing reviewed). The mechanism binds exact item + locale + rule + value hash + concrete reason; changed values/other locales/other files lose the binding and fail.
- **Fail-closed**: missing/non-executable tool, missing config, unknown/missing preset rules, prh severity downgrade, empty corpus, unsupported locale, unverified content bytes, unmapped/ambiguous alert locations, missing/duplicate/unrequested tool results, inconsistent exit/alert pairs, invalid severities — all produce failures, never quiet success.

## Coverage and deferred counts (truthful)

- Catalogue rows reviewed individually: **0** of 2067. All rows `unreviewed` with `classification/surface/trigger = unknown`.
- Literal candidates: **3726** unreviewed (`unknown`, 3726 unique identities), of which 90 labelled protected source (keys/identifiers, pathnames, URLs, quotations) — rewrite-guarded, not lint-exempt.
- Explicitly reviewed static literals: **0**. The corpus covers catalogue copy only; global HTML coverage is not complete and no candidate is known-unknown-coverage-proof.
- Dynamic references: **2610** recorded unresolved — never reported as unused.
- Deferred to batch B: per-item A–F classification and four-language rewrite; reader affordance/disclosure work; before/after screenshots; five-second and read-aloud tests with non-technical readers; native ZH/EN/JA review including Hant consistency; frequency-dependent T2 judgements; native review of provisional prh suggestions.

## Completed here vs still pending (do not conflate)

Completed in this local worktree: implementation, focused tests with real pinned CLIs, real-CLI canaries, deterministic regeneration, release allowlist policy, and the small hosted build/public scan above.

Still pending and **not** claimed here:

- **Function-trace acceptance**: the local `tools/build-reader-runtime.mjs` run is blocked by the incomplete primary shared `node_modules` (`@deepseek-ai/dsh-sdk-client/lib/index.js` missing — pre-existing shared-tree state, untouched by this change). A static import inspection of the traced entry graph is **not** actual function-trace acceptance; the parent added a trace-manifest exclusion assertion after `verify:deploy` in the integrated CI and that clean-CI run is the real gate. Until it runs, this is an open item.
- **Clean-CI execution** remains pending. The final implementation uses the existing `ci.yml`; no standalone Copy workflow is shipped. All copy steps precede `verify:deploy`, and its test stage receives only the two explicit tool paths. Generated files must be tracked and current, including absence of untracked copy outputs. The trace check rejects invalid path values as well as lint dependencies. The Production verification workflow requires CI success at the same commit; this does not control Vercel Git deployment startup.
- **Deployment / production acceptance**: no deploy, Preview, Production or live acceptance is claimed; GitHub has no branch protection/rulesets by readback, so our gate is the actual failing check output and the merge gate, not assumed server enforcement.

## Known limitations recorded honestly

- Debt bindings freeze (item, locale, rule, value hash) but not rule contents: a change to `.vale/styles/*` or `.textlint/prh.yml` can shift which old values alert and therefore needs a manual debt re-review in the same change (`docs/copy/README.md`).
- Vale rules match case-insensitively (`ignorecase: true`) so case variants of banned words are caught.
- Warning rules can fire across locales (e.g. `Leafhour.TonePunctuation` on an English value containing `…`) — kept as neutral labelled warnings.
- The `identifier` protection heuristic is shape-based (code-like keys/tokens); it is evidence for rewrite protection, not proof that a string is not user-visible.

## Scope note for the parent

The pinned textlint toolchain lives in `tools/copy-tooling/` (in-scope `tools/copy-*`) with its own lockfile instead of root devDependencies: adding root dependencies would invalidate the frozen dependency-license evidence (`docs/dependency-licenses.json` bound to the lockfile SHA256, `packageCount 799` frozen in `tests/dependency-licenses.test.mjs`), whose maintenance files are outside this contract's scope and encode human license review. Root production dependencies and the root lockfile are byte-unchanged. Moving the toolchain to root devDependencies later is mechanical and requires that license review in the same change.

## Parent CI integration review

The separate workflow was replaced by steps in the existing CI job. An independent review found three P2 issues in the first integration: filtered tool paths, untracked generated outputs missed by git diff, and null runtime path values accepted. All three were independently re-tested and closed. The permanent `tests/copy-ci-environment.test.mjs` first failed against the original driver, then passed after the bounded environment change. The independent calibration exercised16 shell/Git cases and six synthetic child stages, including the existing VERCEL runtime exception. These are integration calibrations, not a real function trace or remote-CI result. Review report SHA256: `45afebb127aff2809da25643564a9a77214f35cc0fcd23a8db9db729838f8c7c`.

Only `LEAFHOUR_VALE_BIN` and `LEAFHOUR_TEXTLINT_BIN` are forwarded to the test stage. Provider credentials and unrelated environment values remain filtered, and runtime builders do not receive the tool paths. CI records the actual runtime manifest after the clean build; local static inspection is not substituted for that result.

## Integrated local checkpoint

The integrated candidate passes45 focused tests with the real pinned CLIs and zero skips (18 inventory,19 lint,7 installer,1 deployment-environment test). This adds a lossless CSV representation fix: source values with edge whitespace are quoted instead of trimming them. The complete independently parsed CSV rows (2068 catalogue rows including header,3727 candidate rows including header) equal the worker checkpoint field for field, and inventory JSON bytes are unchanged. The new edge-whitespace test first failed, then passed. Generated CSV quoting does not change product strings or create exemptions from checks.

A first parent archive allowlist extension included the plan/verification documents and was rejected by the existing policy. Those two paths were removed from the standalone archive allowlist; the documents remain reviewed public Git source. The release policy was retained unchanged and its794-file check passed. No private data is added to the archive.

## Additional independent boundary findings

The first frozen integrated candidate received Spec FAIL / Quality FAIL with four confirmed P2 findings (no P0/P1), despite its45 passing tests. The immutable report has SHA256 `9124506ee76e5e35efdf0fc17cc1b5375568a6beee9884ff78e6aa9bb512e9eb`. It found attribute-value coordinates pointing into an attribute name, overlapping lexical file aliases passing the line map, an altered reviewed static value exported with a stale declared hash, and a missing review file silently reducing static coverage. The downstream linter already rejected that stale static hash; the finding concerns the exporter contract, not a demonstrated production bypass.

Four new permanent regression tests first failed against that frozen candidate. The repair locates attribute values from their opening quote, groups line maps by normalized absolute file path within each locale, hashes static candidate bytes before any export write, and requires an explicit existing review registry in the CLI. Both single/double quotes, valid reviewed-static and exact-exception positive controls, explicitly empty review configurations, and missing default/explicit/argument failures are covered. Missing-tool/malformed-output canaries are deliberate failure injections; normal semantic canaries use the actual pinned CLIs. The original FAIL evidence is retained; independent closure and remote CI/release acceptance are separate gates.

After these repairs the full focused suite passed49/49 with zero skips (21 inventory,20 lint,7 installer,1 deployment-environment test), using the actual pinned CLIs. Regeneration retains2067 keys,8268 locale values,3726 unknown literal candidates and zero actual reviewed static literals. Attribute coordinates and their candidate identities are regenerated where necessary; product copy bytes are unchanged.
