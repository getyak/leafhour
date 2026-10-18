# GET-176/177/179/187 filter/URL/shared-choice batch — verification record

Date: 2026-10-18 (initial round + consolidated native-review repair round).
Worker: delegated coding worker, isolated frozen worktree at public main
`aad2789e11758d460bbb6548bab56babc80e57ff`. Spec:
[filter/URL/shared-choice batch](../superpowers/specs/2026-10-18-get-168-url-choice.md).

Scope of this worker: code + synthetic tests only. No browser automation, no
credentials/real accounts/private books, no product model/translation/provider
calls, no commits, pushes, PRs, deploys or Linear writes. Native Chrome QA,
independent review, fresh-main integration and delivery are parent-owned.
Synthetic tests below are NOT browser/touch/AT acceptance.

## Commands actually run (registered TMPDIR, concurrency 2)

Every invocation used
`TMPDIR=/private/tmp/ai-test-get-168-url-choice.6em2Vj/unit` and
`node --test --test-concurrency=2`. Exact final results:

1. Repair-round checkpoint set (fresh, final):

```
node --test --test-concurrency=2 tests/choice-control.test.mjs \
  tests/library-view-state.test.mjs tests/catalog-topics.test.mjs \
  tests/library-filters.test.mjs tests/library-workspace.test.mjs \
  tests/owner-scope.test.mjs tests/auth-policy.test.mjs \
  tests/reader-return.test.mjs tests/reader-settings.test.mjs
→ # tests 97 / pass 97 / fail 0
```

2. Same set plus the client-portal suite (fresh, final):

```
node --test --test-concurrency=2 …tests above… tests/portal.test.mjs
→ # tests 106 / pass 106 / fail 0
```

Per-file counts in those runs: choice-control 17, library-view-state 23,
catalog-topics 2, library-filters 11, library-workspace 8, owner-scope 8,
auth-policy 16, reader-return 8, reader-settings 4, portal 9.

3. Release policy and whitespace check (fresh, final):

```
node tools/release-policy.mjs
→ Release allowlist checked: 587 software files; private history and data excluded.
git diff --check
→ clean (exit 0)
```

4. Reader static build gate (fresh, final) — FAILS on the pre-existing bundle
   budget, see "Remaining genuine limits" below:

```
node --test --test-concurrency=2 tests/reader-web-build.test.mjs
→ # tests 3 / pass 1 / fail 2
→ error: 'Reader bundle exceeds public asset budget: reader 333551'
```

`tests/reader-web-build.test.mjs` gained only bundle-input assertions (the new
`choice-control.mjs`/`choice-control.css` and `reader-settings.mjs` ship in the
reader bundle); every original size-budget assertion is untouched and the
duplicate 320KB gate in `tools/build-reader-web.mjs` (outside scope) was not
modified. The bundler's budget check throws before those wiring assertions can
run, so they validate once the parent resolves limit 1 below.

5. Adjacent suites touched by shared-module changes (fresh, final):

```
node --test --test-concurrency=2 tests/oauth.test.mjs tests/auth-dialog.test.mjs \
  tests/library-personal-http.test.mjs tests/environment-config.test.mjs
→ # tests 42 / pass 42 / fail 0
```

## What the tests exercise (actual modules, not source strings)

- `tests/choice-control.test.mjs` (17): real event dispatch against the actual
  primitive — one-change-event and same-value-no-change, explicit-sync-only
  option/value mirroring, threshold remount, search vs committed value,
  disabled-skip navigation, Escape revert, Tab freedom, IME composition
  lifecycle (partial never filters/commits, cancelled composition never becomes
  a query), pointer-press row stability, keyed chip focus survival across sync,
  remount focus restoration, stale active-descendant reconciliation with aria
  reset, closed-popup hiding at every close point, failed-mount cleanup with
  usable named native fallback.
- `tests/library-view-state.test.mjs` (23): codec validation (enums, query cap,
  language syntax, overlay precedence, unknown/invalid handling, history.state
  field retention), reducer, bounded return codec, auth-return precedence, and
  the lifecycle adapter against a real history stack: hydration, refresh-like
  re-hydrate, debounce replace vs flush-then-push, back/forward without
  recursive pushes, stale-timer cancellation with real URL/emit assertions,
  modal-ownership preservation through tab/overlay replacement and view
  changes, filter owning no entry, direct-URL close removing keys+marker,
  owner-epoch tagging and pop clearing, foreign entries/state untouched,
  session-ready handoff from the current snapshot, adoptReturn without
  push/back, IME query commit rules.
- `tests/library-filters.test.mjs` (11): shelf filtering semantics, source/
  topic/language/search intersection, Chinese-trial ≠ Chinese original, fixture
  metadata non-rewrite, synthetic Chinese-fiction fixture (disposable) with the
  shipped catalog truthfully empty for fiction+Chinese, summary chips for
  query/status/source/topic/language with per-chip clear, sensible focus
  (closed chooser → trigger), clear-all, fiction in summary/URL/read state,
  zh/en shortcuts, primitive mounting + explicit sync.
- `tests/catalog-topics.test.mjs` (2): whole-30 frozen regression — ids, source
  files and SHA-256 (== contentVersion), original/source languages, curated
  topic sets with fiction only on the 17 novels/stories, paragraph counts and
  first/last stable IDs unchanged.
- `tests/library-workspace.test.mjs` (8): existing shelf/workspace behavior plus
  settings-opener capture and focus-return safety (dialog child can never take
  the return focus; hidden/disconnected/inert/focusless targets rejected).
- `tests/owner-scope.test.mjs` (8): existing fences plus the input→owner-switch
  interleaving (stale response rejected, pending timer cancelled, previous
  owner query never returns to the URL, no push/back).
- `tests/auth-policy.test.mjs` (16): existing hosted-auth behavior plus OAuth
  success/cancel/expiry returns keeping validated `q/topic/overlay` and dropping
  unknown keys; safeAuthReturn keeps upload compat and rejects external paths.
- `tests/reader-return.test.mjs` (8): reader/gift whitelists retained; shared
  library return codec cannot approve reader citations, gift pages or external
  targets.
- `tests/reader-settings.test.mjs` (4): nine Aa selects upgraded, drawer-outside
  timer select untouched, explicit sync only, exactly-one change semantics.

## Repair-round defects addressed (consolidated review)

P1 overlay history ownership (marker survives tab/overlay replacement and view
changes; close consumes only the valid current app entry; non-owned close strips
marker; filter owns no entry) · P1 stale initial pendingOverlay (session-ready
handoff reads the current snapshot once) · P1 safe auth next (client
`authReturnTarget` precedence incl. cancelled/expired OAuth retry; adoption runs
after identity settles and opens its overlay) · P2 owner epoch tagging + pop
clearing · P2 shared bounded query normalization + composition-gated search
commit + `maxlength` + summary normalization + rewritten stale-timer assertions ·
P2 settings opener capture/return safety · P1 choice popup hidden when closed ·
P2 choice pointer/blur row stability · P2 keyed chips focus survival · P2 choice
IME final-query semantics and closed Home/End native behavior · P2 choice sync
active-descendant reconciliation · P2 native fallback naming (linked labels
restored) + partial-chrome cleanup · GET-187 settings secondary text ≥13px
(incl. the settings dialog heading paragraph).

## Remaining genuine limits (not claimed as done)

1. **Reader bundle budget (blocker, needs a parent scope decision).**
   `tools/build-reader-web.mjs` caps the reader JS bundle at 320KB
   (327,680 bytes). The frozen baseline bundle is **327,370 bytes — 310 bytes of
   headroom**. The parent-mandated shared choice primitive plus its reader
   wiring minifies to ≈6.2KB (choice-control ≈5.8KB + reader-settings wiring
   ≈0.4KB), so the final bundle is **333,551 bytes (5,871 over)**. This is not
   fixable inside scope: even a zero-byte primitive would leave the bundle
   333,551−5,810=327,741, still 61 bytes over, because the mandated
   reader-settings wiring alone exceeds the margin. `tools/build-reader-web.mjs`
   is outside this task's scope and the budget is also asserted in
   `tests/reader-web-build.test.mjs`, which I will not weaken. Parent options:
   (a) raise the budget in `tools/build-reader-web.mjs` + the test to a real
   value (e.g. 340KB) with the parent's own justification; (b) make
   `choice-control.mjs` a permitted lazy public reader module (requires the
   `publicModules` plugin in `tools/build-reader-web.mjs`); (c) trim unrelated
   out-of-scope bundle inputs (largest: `app/reader-audio.js` ≈44KB,
   `app/library-chat.mjs` ≈32KB, `app/reading-session.js` ≈27KB,
   `app/experiences.js` ≈25KB). Consequence today: `tests/reader-web-build.test.mjs`
   has 2 failures with the exact error above; all other suites pass.
2. **Client portal lifecycle wiring** (refresh-then-adopt ordering,
   `takeSessionOverlay` consumption, overlay open/close hooks) is verified
   through the adapter/controller helpers above, not by booting `portal.js`
   itself; the monolithic DOM bootstrap is only reachable in a browser.
3. **Native QA is parent-owned and outstanding:** 1200/390 filter keyboard,
   the real 3-click Chinese-fiction sequence, Notion comparison, URL
   search+filter+settings reload+Back, all Aa modes and native fallback, touch
   and AT passes. Synthetic tests are not substitutes.
4. **Settings secondary text and 44px range/switch targets** are authored in CSS
   (`app/styles.css`, `app/reader-settings.css`); contrast/measurements need the
   parent's visual pass.
5. Password-login adopt ordering and OAuth retry client flows were fixed in
   `app/portal.js` but only their pure/adapter parts carry automated tests
   (points 1–2 above).
