# GET-273 formal Web reader: touch selection supplement

Issue: https://linear.app/getyak/issue/GET-273

Base: public `getyak/leafhour` main `76b788db56d3bc8269482b968175c609b7ea3eea`. Isolated branch `codex/get-273-selection-actions`. This supplements PR #266; it does not turn that earlier partial delivery into full iOS acceptance.

## Implemented behavior

A stationary touch hold authorizes normalization only after the browser has created a native range. Its first range expands to a sentence, with paragraph fallback if sentence segmentation is unavailable. Native endpoint handle edits then retain their exact range, including across passages. Fresh holds with an old retained selection and identical-word reselection after collapse are distinguished from handle editing. Scroll/cancel/expiry and unchanged range events cannot reopen stale tools. No native touch default is prevented, and no paragraph dot is added.

The anchored touch toolbar has exactly Explain this sentence, View original, and Write a note. Explain opens the real companion conversation with the typed quote and a short unsent prompt, retaining an existing draft. It does not submit. Note uses the existing scoped draft composer. Original inspection validates the current quote and opens a read-only dialog; translated selections show explicitly labeled full original passage context, with no invented original character alignment. It preserves prose, snapshot and reading position. Public original emphasis and private literal Markdown retain their existing rules. Desktop and keyboard tools remain available.

The independent native input module is served through an exact static reader.js import boundary and both HTTP asset maps. The 320 KiB JS and 200 KiB CSS bundle limits were retained: measured final built assets are 326,917 and 204,791 bytes. Module source is separately limited to 8 KiB by the build regression test.

## Verification

- Selected host regression run: **186 passed, 0 failed, 0 skipped**. Includes native touch intent and mounted range ownership, original dialog/provenance, real reader input handlers, conversation and unsent drafts, note recovery/editing, share/source emphasis, reader placement/quiet chrome, server/portal asset routes and actual Web build.
- `node tools/build-vercel.mjs`: passed.
- `node tools/release-policy.mjs`: passed, 1,605 allowlisted software files; no private data/history in release.
- Copy export regenerated the checked-in inventories. Pinned Vale 3.24.0 and pinned textlint `copy-lint`: passed, **0 new T1 errors**; 371 documented debt items and 2,290 retained warnings remain visible. Copy canaries passed.
- `git diff --check`: passed.
- Independent read-only review found no remaining concrete P0/P1 or merge blocker. Review findings on source callback ownership, retained-range gestures and accidentally removed mobile CSS were fixed and checked. No device tests were run by the reviewer.

Built-reader browser command (Playwright supplied by the host):

```sh
LEAFHOUR_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tools/verify-reader-touch-selection.mjs /path/to/task-artifact/browser
```

Chromium 156.0.8078.80, isolated temporary profile, mocked identity/data APIs and a synthetic book with a valid reading-cache manifest. No account was created and no provider or production data was accessed. Real browser Selection/Range is used with synthetic touch provenance. All **17 checks** passed with zero page/HTTP/console errors:

1. Ordinary touch tap remains quiet.
2. Scroll intent rejects late selection capture.
3. First held range expands to a sentence and shows exactly three actions.
4. Later handle-style range adjustment stays exact.
5. Retained native text cannot reopen tools during scroll.
6. Fresh hold elsewhere expands despite an old retained range.
7. Identical-word reselection after collapse starts a fresh selection.
8. Original inspection preserves exact slice, prose, snapshot and scroll.
9. Cross-passage adjustment preserves both stable IDs.
10. Note action restores its draft.
11. Explain attaches a quote and unsent prompt without submitting.
12. Explain retains an existing unsent question.
13. Note draft survives reload.
14. Translated selection shows labeled whole original context.
15. 320px toolbar stays inside the viewport; screenshots also checked at 390px.
16. Desktop mouse selection retains exact text and legacy tools at 1280px.
17. Keyboard passage activation still hands focus to the toolbar.

Earlier probes are not counted as passes: the fresh worktree initially lacked fflate; browser probes exposed the missing static-module route and then incomplete synthetic API/cache-manifest fixtures; initial builds exceeded the fixed bundle budgets. Dependencies, asset maps, fixture contracts and implementation/style reuse were corrected. The final complete browser matrix passed; retries alone are not the fix.

## Remaining acceptance

Actual trusted iOS Safari long press, system copy UI, physical selection handles, touch scrolling/edge autoscroll, VoiceOver and physical device continuity remain unverified. The shared Primary iPhone was reserved by another task and was not used. Host and Chromium checks do not establish these outcomes.

The controller reported Production paused with HTTP 402. No manual deployment or release configuration change was made. PR CI, merge, post-merge CI, deployed revision and rendered Production acceptance must be read independently. GET-273 stays In Progress with its existing need human label until the original platform/Production acceptance is completed; this PR must not auto-close it.
