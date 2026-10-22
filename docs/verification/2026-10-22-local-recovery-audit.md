# 2026-10-22 Local recovery audit (read-only)

Audit of all locally retained Leafhour worktrees, branches and stashes for source that is
valuable and absent from current public `main`. This delivery records the audit and production provenance. It contains no runtime source or test changes.

- **Base SHA:** `d0ecf845298b8ea4d1eff513dd7f96cfea9c415d` ("fix: accept ChatGPT OAuth locale hint (GET-196) (#156)"), the frozen snapshot base for all 26 worktrees / 61 branches / 4 stashes.
- **Scope:** relevant public source and configuration, including `app/`, `server/`, `tests/`, `tools/`, `scripts/`, `deploy/`, `harness/`, `docs/`, `_briefs/`, `.github/` and root package/release/lock configuration. No `.env`, credentials, private runtime books/records or session logs were read.
- **Verdict:** **no confirmed missing valuable behavior.** `RECOVERY_CANDIDATES` is empty (justified per item below). All old worktrees/branches/stashes are retained unchanged as recovery references.

## Method and evidence tiers

This is **not** a claim that every historical line was reviewed. Two tiers:

1. **Full automated inventory (all 26 wts / 61 branches / 4 stashes / 386 dirty file instances):**
   exact git plumbing only — merge-base classification, blob identity against current `main`,
   all 61 branch heads, verified merged-PR metadata and name/status diffs.
2. **Focused semantic inspection (targeted subset):** the six branches requiring semantic
   comparison, the four stashes, and the priority dirty areas (GET-195 annotations,
   GET-201 settings, GET-192 drafts/helpers, GET-151 batches), inspected via symbol-level
   diffs against the task's final reviewed head and current `main`. An independent native
   review separately examined the same
   six branches, all four stashes and selected GET-195/201 dirty files and found **no
   confirmed P0/P1/P2 missing behavior**.

Decisive provenance and the machine-readable accounting are preserved in
[recovery evidence](2026-10-22-recovery-evidence.json): GitHub readback confirms
34 named delivery branches exactly match their merged PR heads, all corresponding merge
SHAs are in `origin/main`, and all 61 snapshot branches have an explicit classification.
Raw ahead-counts and byte differences were not treated as evidence of missing functionality.

## Worktree table (26)

Labels use task IDs / worktree names, not machine paths. Dirty counts are
`same-as-main / differs-from-main / absent-from-main` over the worktree's uncommitted file
instances. "merge-head" = the worktree HEAD is a merged PR's exact head or merge commit on
`main`; its dirty files are pre-review drafts whose reviewed versions were delivered.

| # | worktree | HEAD | committed state | dirty (same/diff/absent) | classification & evidence | decision |
|---|----------|------|-----------------|--------------------------|---------------------------|----------|
| 0 | primary checkout (`main`) | `d0ecf845` | = base | 0 | clean at base | nothing to recover |
| 1 | codex-wt/get192-audio-boundary | `035e2a9a` | semantic-6 (GET192 helper) | 0 | snapshot-based helper; independent review + audio modules byte-identical to main | retain |
| 2 | codex-wt/get192-audio-ui | `53be756b` | semantic-6 (GET192 helper) | 0 | as above; audio-UI labels consolidated in PR133 | retain |
| 3 | codex-wt/get192-lazy-ui | `64e37380` | semantic-6 (GET192 helper) | 0 | as above; lazy-UI locale work merged via PR133/134 | retain |
| 4 | codex-wt/get192-reader-integration | `3b96a291` | semantic-6 (GET192 helper) | 0 | ending/epoch/listener ownership fences present in main | retain |
| 5 | codex-wt/leafhour-linear-delivery | `ac93c1e5` (detached) | = PR150 **merge commit** on main ("GET-202: establish reproducible copy inventory and lint guardrails (#150)") | 0 | plain main history, no unique content | nothing to recover |
| 6 | codex-wt/leafhour-platform-acceptance | `b14cd76b` | = PR131 head (`codex/get-173-ci-grant-expiry`) | 0 | delivered | nothing to recover |
| 7 | task/20261018-095058-8f920a32 | `4f673760` | = PR117 head (alias of `codex/get-151-batch-delivery`) | 0 | delivered | nothing to recover |
| 8 | task/20261018-110853-40d1d95a | `e472df4b` | ancestor of PR120 head | 12 (2/10/0) | GET-155 pre-review draft. `server/daily-reading.mjs` draft has 0 fence/sequence/deadline markers vs 5 in main's version (PR120 review fix "fence timed-out presence handlers with sequence and deadlines"); `tests/daily-reading*.test.mjs` drafts predate reviewed suites in main | retain (draft would roll back hardening) |
| 9 | task/20261018-125617-416b54d8 | `c1f13f6b` (= PR120 merge) | ancestor of main | 53 (5/48/0) | GET-167 typography draft; many blobs byte-identical to PR122 head (`cd2e3585`), remainder superseded by reviewed CSS (incl. PR123 token unification) | retain |
| 10 | task/20261018-140957-856be674 | `b542cbec` (= PR122 merge) | ancestor of main | 53 (8/45/0) | GET-169 components draft; `app/interface-tokens.css` etc. delivered via PR123 head `b21ed1b2` | retain |
| 11 | task/20261018-163249-86492937 | `d8d211ba` (= PR123 merge) | ancestor of main | 18 (6/12/0) | GET-186/190 reader draft; delivered as PR124 head `d7ca51e5` ("preserve fresh entry and original emphasis") | retain |
| 12 | task/20261018-183727-2777929a | `aad2789e` (= PR124 merge) | ancestor of main | 33 (8/25/0) | GET-168 URL-choice draft; reviewed as PR126 head `a67629f3` (choice semantics + filter views) | retain |
| 13 | task/20261018-213903-3c5c086a | `eae0e975` (= PR125 merge) | ancestor of main | 9 (0/9/0) | GET-173 Android draft; delivered as PR128 head `c318de25` (popover/CDP/font-observer tools in main) | retain |
| 14 | task/20261019-005839-79522bf1 | `9e5777e3` (= PR127 merge) | ancestor of main | 43 (4/39/0) | GET-178/184 command-palette draft; delivered as PR130 head `1d70f8f5` | retain |
| 15 | task/20261019-043715-4322feea | `8912b1f1` | ancestor of PR128 head | 28 (1/27/0) | Android-acceptance draft incl. `tests/platform-android.test.mjs`, `tools/lib/platform-cdp.mjs`, and `platform-font-observer.mjs`; reviewed versions remain in main | retain |
| 16 | task/20261019-095634-7c97b6ca | `48495f0e` | ancestor of main | 20 (5/15/0) | GET-188 home-navigation draft; delivered as PR132 head `f480566b` (blobs byte-identical to it) | retain |
| 17 | task/20261019-133507-d9d6fe9a | `27027f7a` | ancestor of PR133 head (GET-192 contract doc commit) | 42 (8/34/0) | GET-192-A ui-locale draft; catalogs/codec/controls delivered via PR133 head `511364b4`; draft catalog keys are strict subsets of main's (see below) | retain |
| 18 | task/20261019-210611-1774a4f1 | `8238989c` | semantic-6 (private integrated snapshot "not delivery") | 24 (3/13/8) | 8 untracked `.scratch-*.mjs` one-off fix scripts absent from main (no tests/docs, throwaway); remaining drafts superseded by PR133/134 | retain; do not port |
| 19 | task/20261020-054701-8785ff2f | `304a4362` | ancestor of main | 0 | clean | nothing to recover |
| 20 | task/20261020-063038-24b590b3 | `d091b37c` | ancestor of main | 0 | clean | nothing to recover |
| 21 | task/20261020-104623-0fc236d3 | `cae3f61f` (= PR137 merge) | ancestor of main | 2 (0/2/0) | **priority:** untracked `app/reader-annotation-records.mjs` + test are an older draft of PR139 material (same blob also committed on task-branch 114752); draft **regresses** PR139's historical-reference fix (evidence below) | retain; reject draft |
| 22 | task/20261020-114752-3cd4f458 | `ee51ad1f` | ancestor of PR139 head | 10 (0/10/0) | GET-195 annotation foundation drafts (`server/reader-annotation-tools.mjs`, `reader-annotations.mjs`); reviewed versions delivered as PR139 head `4bb9d820`; main adds constraints absent from drafts (below) | retain |
| 23 | task/20261020-134623-aed26061 | `0a2a332d` | ancestor of PR139 head | 12 (4/8/0) | GET-195 annotation generation drafts; `tests/reader-annotations-external.test.mjs` byte-identical to main & PR139; `tests/reader-annotations-mcp.test.mjs` draft is a strict subset of main's (1 line fewer) | retain |
| 24 | task/20261020-170159-789f4ff5 | `8b317c87` (= PR140 merge) | ancestor of main | 0 | clean | nothing to recover |
| 25 | task/20261020-230842-d14628f7 | `3ca0c017` | ancestor of PR149 head | 27 (2/24/1) | GET-201 settings drafts; `app/settings-appearance.mjs` byte-identical to main; `settings-controls.mjs` draft is a subset of main's reviewed module; 1 absent file = superseded draft test (below) | retain |

Dirty-instance totals across the 15 dirty worktrees: **386** — 56 byte-identical to current
`main`, 321 present in `main` in a different (in every sampled case reviewed-newer) version,
**9 absent from `main`** (8 `.scratch-*.mjs`, 1 superseded draft test). A separate published-main-history hash pass found 198 of the 386 instances exactly match a historical blob and 188 do not. That establishes byte provenance, not semantic absence.

## Branch accounting (61)

Per the published recovery evidence (exact merged-head provenance establishes that committed work was delivered):

| category | count | outcome |
|----------|-------|---------|
| exact merged-PR tip | 35 | delivered; nothing unique. Includes alias pair `codex/get-151-batch-delivery` / `codex/pi-20261018-095058-8f920a32` (both `4f673760`, PR117) |
| ancestor of merged-PR tip | 8 | subsumed by the delivered tip (`get-151-translation-batches`→PR117, `pi-20261018-110853`→PR120, `pi-20261019-043715`→PR128, `pi-20261019-133507`→PR133, `pi-20261020-114752`+`pi-20261020-134623`→PR139, `pi-20261020-183125`→PR144, `pi-20261020-230842`→PR149) |
| ancestor of main | 12 (incl. `main` itself) | fully contained; several are the PR merge commits themselves (e.g. `b542cbec`=PR122 merge, `d8d211ba`=PR123 merge, `aad2789e`=PR124 merge, `eae0e975`=PR125 merge, `9e5777e3`=PR127 merge, `cae3f61f`=PR137 merge, `8b317c87`=PR140 merge) |
| needs semantic comparison | 6 | resolved — retain all, no missing behavior (below) |

The six semantic-comparison branches and their outcomes:

- `codex/get-160-cancel-publication` (`d2f97366`, sibling of merged GET-160 work PR108/PR112):
  its cancellation semantics (nonce-owned complete/discard/restore in
  `server/book-introduction-store.mjs`) are already in current main; main additionally has
  three-attempt transient-failure compensation and `finally` cleanup (from PR112 tip
  `db13ce56` "retry transient cancellation cleanup without losing quota release"). Porting
  this draft would remove newer repair behavior. **Reject.**
- `codex/get-192-audio-boundary` (`035e2a9a`), `codex/get-192-audio-ui` (`53be756b`),
  `codex/get-192-lazy-ui` (`64e37380`), `codex/get-192-reader-integration` (`3b96a291`):
  helper branches built on private integrated snapshots (`61b29a1`/`8827059`/`b2e2e6c` "no
  delivery claim"); their touched files all exist in main. Per-file checks: draft UI
  catalogue key sets are strict subsets of current keys. Importing the frozen English data
  gives 2111 keys at `d0ecf845`, versus 550 (`8238989c`), 1097 (`3b96a291`), 1623
  (`53be756b`), 1935 (`64e37380`) and 1950 (`035e2a9a`), with no draft-only keys.
  At the `035e2a9a` audio-boundary tip specifically, `reader-audio-bootstrap.mjs`,
  `reader-audio-metadata.mjs`, `reader-audio.js` and audio-boundary tests are byte-identical
  to main. Earlier helper tips contain older versions; the relevant reader
  ending/epoch/listener-ownership protections remain in main with consolidated
  `labels.prune/forget` and native locale controls. Snapshot baselines must not be ported
  wholesale and were not. **Retain as reference.**
- `codex/pi-20261019-210611-1774a4f1` (`8238989c`, "snapshot … not delivery"): partial GET-192
  handoff snapshot; committed delta reviewed above; its worktree's untracked `.scratch-*.mjs`
  are one-off scripts. **Retain, no port.**

Local-only concern `get151-translation-batches` is resolved: `codex/get-151-translation-batches`
(`d8822132`) contains planning documents and is an ancestor of merged PR117. The planned
implementation was delivered in PR117. Its core `server/translation-batch.mjs`,
`tools/translation-batch.mjs`, `tools/lib/translation-batch.mjs`, five related test files and
`docs/translation-batches.md` are byte-identical between the final PR117 head and current
main; surrounding library/portal integration has later changes. There is no confirmed
undelivered behavior to recover from the planning branch.

## Stash accounting (4)

| stash | content | outcome |
|-------|---------|---------|
| `stash@{0}` `7e69eea7` | GET-202 delivered build receipts (`build/copy/*`, 7 files) | rebuildable receipts of PR150 tooling (`scripts/export-copy.mjs`, `tools/copy-lint.mjs`, `tools/copy-canaries.mjs` all in main; `.github/workflows/ci.yml` runs copy-install-vale/export-copy/copy-lint/copy-canaries + runtime-exclusion check). Retain locally; nothing to port |
| `stash@{1}` `a61f476c` | GET-202 foundation recovery (copy lint configs, `docs/copy/*`, `scripts/*`, `tools/copy-*`, incl. `node_modules` entry and a nested tool lockfile) | tooling delivered as PR150 (`c2430dbb`). Its `.github/workflows/copy.yml` is absent from main because the gates were absorbed into stricter `ci.yml`. Current exporter/linter adds candidate hashes, required explicit review config, absolute-mapping and CSV-whitespace protections (independent review). Retain; do not port (see security note) |
| `stash@{2}` `c246ceb4` | GET-198 client (`app/account-ui-preferences.mjs`, 2 tests) | all present in main (PR144 `e41b30af`); current ownership fences (`isCurrentFor`/`restoreCurrent`, pre-microtask) supersede the stashed client. Retain |
| `stash@{3}` `09c5a5ab` | GET-198 service (`server/account-ui-preferences.mjs`, `tests/account-ui-preferences.test.mjs`, `server/portal.mjs` hunk) | service and core tests byte-identical to main; portal hunk predates later features. Retain |

## Focused semantic inspections (evidence detail)

1. **Untracked annotation records (task 20261020-104623) — rejected as a rollback.**
   `app/reader-annotation-records.mjs` (blob `2bacf28a`, also on task-branch 114752) predates
   PR139's fix `2c42629 "fix: preserve historical annotation source references"`. Main's
   `sourceRef(value,book,historical)` keeps historical references when the quote can no longer
   be proven against the current source ("Stored excerpts are historical data, not a claim of
   current source verification"), threaded through `message(...,historical)`; the draft's
   `sourceRef(value,book)` always demands proof against the supplied book and would therefore
   reject stored annotations after source/translation edits. Adopting the draft would regress
   current behavior. **Retain only.**
2. **Annotation generation/tools drafts (tasks 20261020-114752 / 134623).**
   `tests/reader-annotations-mcp.test.mjs`: main's version contains the draft minus nothing
   and plus one hardening assertion (`__proto__=ignored&__proto__=duplicate` → 400); same
   three tests, same tools (`reader_get_annotations`, `reader_add_annotation`).
   `tests/reader-annotations-external.test.mjs`: byte-identical to main and PR139 head.
   `server/reader-annotations.mjs`: main adds `preferenceAccess:false` scoping (line 266),
   idempotent highlight-alias receipts and unordered-JSONB/negative-zero normalization absent
   from the 134623 draft (independent review). `server/reader-annotation-tools.mjs` in main
   constrains reads via `READ_KEYS` and a single read-only tool. **Retain only.**
3. **Settings drafts (task 20261020-230842).** `app/settings-appearance.mjs` is byte-identical
   to main. `app/settings-controls.mjs` draft shares the full exported API
   (`settingGroup/settingRow/switchRow/mountDropzone/mountConfirm…`); main's reviewed module
   adds drop-bubbling refusal, stale-confirmation and time-editor error/disabled/IME guards
   (18 vs 11 differing lines in the focused diff; independent review concurs).
   The one file absent from main, `tests/settings-window-cascade.test.mjs`, is an approximate
   CSS parser asserting `dialog.library-settings-dialog:not([open]){display:none}` /
   `[open]{display:grid}`; current `app/library-shell.css` states exactly these as explicit
   guards (lines 18–19), so the draft test is a fragile duplicate of an invariant now encoded
   in source. **Retain only; no port.**
4. **GET-192 locale drafts/helpers.** Draft catalogue keys strict subsets of current keys
   (current main: 2111 English keys; five old tips: 550/1097/1623/1935/1950, zero draft-only). Audio module byte equality is limited to the `035e2a9a` audio-boundary tip. Ownership fences remain in main. **Retain only.**
5. **GET-151 translation batches.** See branch accounting — implementation byte-identical in
   main (PR117). **Nothing to recover.**

## Security / data impact

- No secrets, credentials, private runtime books/records or real book data were read or
  reproduced here; the report uses task IDs and project-relative paths only.
- `stash@{1}` contains a `node_modules` entry (and a nested `tools/copy-tooling/package-lock.json`);
  `stash@{2}`/`stash@{3}` also carry `node_modules` entries. Dependency trees must never be
  committed; none of this is proposed for porting.
- GET192 helper branches contain local integration snapshots; their deltas were
  inspected and none were ported, per the "no wholesale baseline port" constraint.
- All access to old worktrees/branches/stashes was read-only (git plumbing + file reads); no
  writes, commits, resets, stash changes or removals anywhere outside this document. Scratch
  analysis lived in a temporary directory only.
- This audit triggered no product model/OCR/audio operations, production data writes, email, or external service mutations; no
  tests weakened; no dependencies added.

## RECOVERY_CANDIDATES

**Empty — justified.** No current defect or missing behavior was confirmed. Every candidate
was either already delivered (exact merged-PR provenance) or would roll back newer reviewed
behavior:

| near-miss | anti-rollback reason |
|-----------|----------------------|
| untracked `app/reader-annotation-records.mjs` (task 20261020-104623) | rejects historical annotation references that main retains (PR139 `2c42629`); regression |
| `tests/settings-window-cascade.test.mjs` (task 20261020-230842) | approximate CSS parser duplicating explicit `[open]`/`:not([open])` guards now in `app/library-shell.css`; fragile re-implementation |
| 8× `.scratch-*.mjs` (task 20261019-210611) | one-off fix scripts, no tests/docs; superseded by delivered PR133/134 work |
| `codex/get-160-cancel-publication` (`d2f97366`) | its complete/discard/restore semantics already in main; main adds transient-retry compensation + `finally` cleanup the draft lacks |
| GET192 helper tips + `8238989c` snapshot | local integration baselines must be separated from feature deltas; focused checks found the relevant behavior in main |
| `get151-translation-batches` docs (`d8822132`) | planning docs only; implementation byte-identical in main via PR117 |
| GET-201/GET-195 pre-review drafts | reviewed versions delivered via PR149/PR139; main versions add hardening absent from drafts |

## Uncertainty and retention

- The 321 "differs-from-main" dirty instances were not each compared line-by-line; decisions
  rest on exact merge-head provenance, exact blob checks, focused
  symbol-level diffs above, and the independent native review of the six semantic branches,
  four stashes and selected GET-195/201 files. Residual risk: a small behavioral nuance in an
  unreviewed draft hunk. Mitigation: **all** old worktrees, branches and stashes are retained
  unchanged; nothing was deleted or overwritten, so any later concern remains recoverable.
- Line-presence percentages from an earlier rough pass are heuristic and were not used as
  decisive evidence.
- Production provenance is recorded separately in [production verification](2026-10-22-production-version.md): live page observations, actual hosted-module byte matches, and successful CI/Vercel/Production at exact `d0ecf84`. The audit worker did not repeat those live checks.

## Exact checks run (this audit)

- `git merge-base` / `git diff --name-status` / `git diff --shortstat` for all 61 branches vs
  `d0ecf845` (classification and per-file base/branch/main blob identity).
- Blob-identity map (`git ls-tree -r` over `main`, 61 branch heads, 18 delivered heads) against
  all 386 dirty/untracked file instances from the 15 source-dirty worktrees
  (hashes from the frozen inventory, `git hash-object` scheme verified on one sample).
- Focused diffs/symbol greps: `app/reader-annotation-records.mjs` (main vs `2bacf28a`),
  `tests/reader-annotations-mcp.test.mjs` (1-line diff), `app/settings-controls.mjs`
  (18/11-line diff), `tests/settings-window-cascade.test.mjs` vs `app/library-shell.css`
  guards, `server/reader-annotations.mjs` (`preferenceAccess:false`, alias receipts),
  `server/reader-annotation-tools.mjs` (`READ_KEYS`), `app/ui-catalogs/en.mjs` key-subset check
  (2111 current keys; 550/1097/1623/1935/1950 at the five old tips, no missing keys), `server/daily-reading.mjs` fence/sequence marker counts (draft 0 / main 5),
  stash target-file presence in main, copy gates in `.github/workflows/ci.yml`.
- `node --check`/tests deliberately not re-run: this batch changes no runtime source (parent
  reports current tests 25/25 passing at `d0ecf84`).
- Scope gate for this change: `test -s docs/verification/2026-10-22-local-recovery-audit.md`
  and `git diff --check`.
