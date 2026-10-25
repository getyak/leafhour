# GET-231 independent review receipt

Reviewer: independent Codex agent `/root/get231_review`.

Reviewed checkout: `/Users/cubxxw/ops/symphony/runtime/workspaces/GET-231`, public `getyak/leafhour`, branch `codex/get-231-b2`. Baseline and current local HEAD: `0329f9c26fee75dc5bb05257908a6729ea1738e3`.

Binding checked at `2026-10-25T22:40:07+00:00` (2026-10-26 in Asia/Shanghai). This receipt binds working-tree bytes, including the new account module, tests and verification tool. It does not identify a released commit.

## Decision and exact source binding

**No unresolved P0, P1 or P2 findings remain in the reviewed scope.** The reviewer made no implementation edits, started no browser, build or Pi process, and made no GitHub or Linear writes. This receipt is the reviewer's only authored repository artifact.

All **26 actual files** match [source-fingerprints.json](source-fingerprints.json). The public manifest is byte-identical to `.symphony/source-fingerprints.json`; its SHA-256 is:

```text
b6be7d77f89f469b536bf6faa5d8875f427413bbfe03e0b7a8e891910c9a19ea
```

The manifest was checked again immediately before writing this receipt. An earlier write attempt correctly stopped when the close-button CSS changed after the prior fingerprint snapshot; no stale receipt was written.

## Findings and closure

| Finding or boundary | Closure evidence |
| --- | --- |
| Late account import replaced newer popover/focus intent | The callback closes the old book popover before loading and rejects changed focus, inert chrome, or any open dialog/owned popover after loading. Actual callback tests use a gated import for popover/focus/inert cases. |
| No-scene settings still prompted playback | Both Atmosphere and settings hide inactive playback/status controls; actual storage notices remain visible. Tests execute the actual render/label functions and cover both paths. |
| Owner-checked logout required a healthy provider | Owner validation now occurs inside local/hosted session revocation. An actual portal plus in-memory hosted-auth fixture returned 409 with the session-change header, no cookie clearing and no revocation for a different owner. A correct owner returned 200, cleared the cookie and revoked locally despite provider failures, with zero `/user` calls. Remote logout retains local scope and best-effort behavior. |
| Thought retained automatic IDs beside real pages | Printed/PDF labels now accept only the page. Four-language checks retain page 12 and exclude `B2` and `§`; original prose, section IDs and metadata remain intact. |
| Short viewport/audio/notice layout covered account controls | Audio-specific height rules preserve top navigation clearance. The account entry moved to navigation; the translation-notice rule remains independent. The reviewer read the primary agent's `audio-layout-green/report.json`: audio, notice and combined synthetic layouts all report true native nine-point account hit results. These are local synthetic layout receipts, not real audio-provider or Production acceptance. |
| Moving account entry removed the return-link touch width | Both navigation and interaction-craft selectors use `:first-of-type`, preserving the applicable 44px override and minimum-width guard. |
| Keyboard chapter marking dropped focus | The actual mark action uses the existing focus helper, restores only an eligible same-chapter trigger, and respects newer focus intent. Actual-function gated transport tests cover restoration and no focus theft. |
| Pending mark focus subscription survived session disposal | Session-owned `markFocusOwners` registers each tracker. Completion stops/restores then removes it; disposal synchronously stops and clears all pending trackers. Actual mark/dispose functions plus the real helper prove zero focus listeners and zero owners before the network gate is released, and still zero afterward. |
| Account Tab traversal and close control | Autofocus and dialog-local Tab/Shift+Tab traverse visible enabled owned controls; Ctrl/Meta/Alt and composition remain untouched. Unmount removes the loop listener. The latest close-button CSS uses `flex:none` and `white-space:nowrap`, allowing the heading to wrap while preserving the close action. Source review found no new ownership or lazy-loading issue. |
| Contrast and close-button measurement blind spots | Contrast now uses the button's computed backing color with ancestor alpha composition, rather than the paper token. The close-height probe now includes the existing minimum height using `max(minHeight, lineHeight + verticalPadding) + 1`, avoiding rejection of a legal 44px single-line target. Latest native browser results for this final CSS/tool change require the primary agent's separate receipt. |

`sceneNode` only creates an element and assigns its class. Gallery tests execute the real helper and image state/retry code. Mobile artwork and image heights agree at 68px. No new progress writer, scroll-lock workaround, fabricated selection, or competing tools coordinator was introduced.

## Independent verification

Earlier in this isolated review, the following command passed **53 tests, 0 failed** after the pending-focus ownership fix:

```sh
node --test --test-reporter=dot tests/reader-cleanup.test.mjs tests/reader-account.test.mjs tests/reader-atmosphere-labels.test.mjs tests/atmosphere.test.mjs tests/reading-mark-actions.test.mjs tests/action-focus.test.mjs
```

This final binding pass did not rerun that suite or the full project suite. It passed verification-tool syntax checking, the **4 existing reader-verification-evidence unit tests**, static case/filter evaluation, repeated 26-file SHA-256 comparisons and `git diff --check`.

## Verification-tool audit and limits

- Optional `LEAFHOUR_PUBLIC_BUILD` replay replaces local `/read` with built `read.html` and serves exact hashed reader JS/CSS from that build. Other external/lazy modules and API routes still use the current local source server. The tool records built JS/CSS and the lazy account request; this is built-entry replay against a local backend, not a hosted-deployment test.
- The real case/filter expressions yield **24 ordinary, 8 scene, 1 smoke or 3 boundary cases per engine**. To stay below 30 synthetic logins, ordinary and scene batches must run separately for each engine. An unfiltered dual-engine invocation is not such a bounded batch, and this receipt does not claim it completed.
- Relevant animation waits exclude infinite effects. Thought assertions wait for the existing smooth scroll to remain stable for 120ms, with a 3s limit. Native dragging establishes selection; Range geometry only locates the drag target. Typed excerpts are compared exactly, and any native selection still retained by the browser must remain unchanged. The tool does not install a fabricated selection.
- Console comparison requires matching engine/version and compares path plus message text, normalizing only the variable local HTTP port. The inspected main baseline identifies `0329f9c26fee75dc5bb05257908a6729ea1738e3`, Chromium `153.0.8010.12` and WebKit `26.6`. Known CSP/audio-preference 503 debt remains explicit. Comparison detects new message/path pairs, not changed repetition counts or line numbers. Injected-failure boundary runs are distinct from ordinary console checks.
- Request classification rejects model routes and permits only the explicit milestone among reading-record writes; existing progress and presence are separate categories. This is not a claim of zero network/progress activity.
- The local unload probe counts selected account/gallery listeners by source ownership. It is not whole-application leak proof or a real browser teardown. The gated session-disposal test separately covers the temporary document focus listener. The inspected same-version main baseline also retains one interval, which is not attributed to the new account/gallery components.

## Delivery boundaries

This receipt approves the exact source snapshot above only. Final browser matrices, complete engineering/copy/build gates, current-head CI, commit/PR merge, Vercel Production and same-revision live acceptance require separate primary-agent receipts. No unfinished run is marked passed here. Synthetic identities, isolated local records and public-domain Alice do not establish real-account or Production acceptance.
