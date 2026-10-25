# GET-218 independent review

Reviewed on 2026-10-25 against public baseline `dca8eab7ebb231ffea521a0b7c212416923c0ccf`, including the final uncommitted feedback-dock, cancellation, localization and bundle-size refinements.

## Conclusion

No unresolved P0, P1 or P2 findings remain in the reviewed implementation. This is a code-review conclusion, not a claim that CI, Production deployment or online acceptance has completed.

The reviewer did not start a browser, service, simulator, paid model or delegated worker. Source edits remained with the implementing agent; this report is the reviewer's only file change.

## Findings resolved during review

| Severity | Trigger and finding | Resolution verified |
| --- | --- | --- |
| P2 | Saving the first translation updated the reader's book but left source details saying that no translations were saved. | `reader-translation.js` recomputes disclosure after the reader synchronously adopts the successful translation event. The host regression covers no-translations to saved metadata without another book-ready event. |
| P2 | Public-sample translations mixed with newly generated variants could display only the known sample credits and CC0 license, silently omitting missing metadata. | Disclosure retains recorded values, models and explicit `uncredited`/`unlicensed` counts. Partial missing metadata is covered by `translation-disclosure.test.mjs`. |
| P2 | The shortened sample descriptor was not the key consumed by book details; the actual key still asserted that all later passages were untranslated. | `reader.b1.sampleNotice` and its legacy fallback now provide the short coverage summary in all four locales. |
| P2 | A real failure on p1 followed by cancelled consent on p2 replaced the single `lastOutcome` with cancellation, hiding the unresolved background failure. | Pre-submit cancellation retains its passage-local message but does not overwrite `lastOutcome`. The regression covers failure, another passage's cancellation, cleared selection and returning to the failed passage. Cancellation alone creates no background failure. |
| P2 | Reformatting the funding notice detached and reattached its focused recovery link, losing keyboard focus during locale changes. | Focus is captured before relocation/repaint and restored with `preventScroll` after the link is reattached. The test fixture now clears focus when a focused subtree is removed, so this regression fails on the old implementation. |

The two final boundary regressions were independently reproduced with read-only synthetic fixtures before repair. The implementing agent's scoped old-implementation run failed both tests; the corrected implementation passes them.

## High-risk checks

| # | Check | Result |
| --- | --- | --- |
| 1 | English sample disclosure | Count, AI draft status, absence of human review and license retained. |
| 2 | Simplified Chinese sample disclosure | Same facts retained. |
| 3 | Traditional Chinese sample disclosure | Same facts retained. |
| 4 | Japanese sample disclosure | Same facts retained; no native-speaker review claimed. |
| 5 | Books with no saved translations | No attribution of nonexistent translations to AI. |
| 6 | Reviewed/draft/unknown counts | Derived from actual nonempty saved variants. |
| 7 | Personal overrides of public samples | Actual metadata replaces blanket sample attribution. |
| 8 | Partially missing credits or licenses | Missing counts remain explicit alongside known values. |
| 9 | Model records | Only existing records displayed; no inferred model attribution. |
| 10 | Newly saved results | Disclosure refreshes without another reader-ready event. |
| 11 | Sending scope in four locales | Current passage and one neighbor on either side, excluding private notes, remain beside the action. |
| 12 | Paid action labels | Shared point labels remain localized. |
| 13 | Unknown paid outcomes | Durable request identity remains available for retry. |
| 14 | Remount after unknown outcome | Quote/idempotency pair retained by the shared credit helper. |
| 15 | Owner and source-version boundaries | Request identities remain isolated. |
| 16 | Unavailable identity storage | No paid request starts without recoverable identity. |
| 17 | Running work | Remains visible without promising a future save. |
| 18 | Selection changes | Background status stays in the viewport dock; late results do not reveal another selection. |
| 19 | Incomplete response | Remains unconfirmed and is not presented as success. |
| 20 | Success timeout | Only confirmed success expires after six seconds; later failures survive the old timer. |
| 21 | Cancellation after actual failure | Cancellation does not clear earlier unresolved work. |
| 22 | Version transition and disposal | Epoch/abort fences continue to reject late completions; source book-ID guard remains before the simplified change check. |
| 23 | Locale changes with drafts | Input, focus, selection, scroll and submitted request body remain stable in host tests. |
| 24 | Source review and downloads | Available in original/translation/parallel modes; filenames, nodes and pending downloads survive locale changes. |
| 25 | Funding recovery | Link remains inside the visible notice, updates its locale URL and restores its keyboard focus. |
| 26 | Neutral translation action | All four locales say to view translations without classifying reviewed translations as drafts. |
| 27 | Settings and empty/onboarding wording | Missing translations, Simplified Chinese availability, explicit generation and optional/skip choices remain distinguishable. |
| 28 | Accessibility and dock CSS | Status role and action description association retained; inactive tools remain inert/hidden. Pointer events are restored on dock children, and the tools panel is positioned above the feedback dock. Visual viewport overlap is a browser acceptance item, not proven by this static check. |
| 29 | Metadata aggregation optimization | Deduplicated recorded values and missing counts retain their previous semantics. |
| 30 | Bundle refinements | Anchored ID regexes are equivalent to the former fixed lists; source-ID comparison removal is protected by the earlier guard. The original 320 KiB JS/200 KiB CSS assertions are unchanged. |

## Deletion checks

| # | Removed output | Decision support retained |
| --- | --- | --- |
| 1 | Manual-entry brand eyebrow | Manual-entry title, fields and time-accounting explanation. |
| 2 | Reading-guide brand eyebrow | Guide title, steps and cited source. |
| 3 | Draft-list eyebrow | Draft/unconfirmed state, source anchors and explicit save actions. |
| 4 | After-reading decorative sentence | Ending title and separate save receipts. |
| 5 | Routine narrow-screen layout hint | Arrangement controls and live preview. |
| 6 | Empty translation-guidance details/summary | Explicit source details and sending scope beside the action. |
| 7 | Routine sample notice in chapter chrome | Short coverage in book details and provenance in explicit details. |
| 8 | Routine on-demand chapter explanation | Context boundary after passage selection. |
| 9 | Routine saved-translation chapter notice | View-translations action and actual metadata. |
| 10 | Routine Chinese-book explanation | Selected Chinese-original action state. |
| 11 | Routine service-unavailable chapter explanation | Selected-passage unavailable status. |
| 12 | Duplicate Chinese-passage explanation | Chinese-original button state. |
| 13 | Unused translation-guidance CSS | Shared source-review and task-feedback styles remain. |
| 14 | Unrendered default-notice construction/import | Background outcomes and selected-passage decisions remain in the state machine. |

## Evidence and limits

- The reviewer independently ran `translation-state.test.mjs`, `ui-locale-reader-async.test.mjs` and `translation-disclosure.test.mjs` after the boundary repairs: **32 passed, 0 failed**. Earlier independent review ran six relevant home/navigation/settings/state/translation host files: **60 passed, 0 failed**. These counts describe different scoped runs and are not added together.
- The reviewer inspected the implementing agent's final local log `.symphony/review-final-tests.log`: **37 passed, 0 failed, 0 skipped**, including all five `reader-web-build.test.mjs` tests. This supersedes the earlier budget-failing run. The log is local execution evidence, not a public CI result.
- The fixed bundle-budget test, lint implementation and allowances are byte-identical to the baseline. The exact-list to anchored-regex refinements do not weaken the asset gate or introduce new message matches.
- The reviewer independently verified exactly **12** retired debt bindings were removed, with **328** unchanged bindings retained, no additions or rebound values, and every retired matched phrase absent from its reviewed replacement. Rule and allowance files were not changed.
- The implementing agent reports current real lint totals of 2345 raw findings, 0 new T1, 373 retained debt hits, 1972 warnings and 0 stale bindings. The reviewer did not independently rerun the external lint engines in this final pass.
- Four-locale key/placeholder parity was checked during the earlier review; the final neutral view-translations values were inspected directly. No nontechnical user research or native-speaker validation is claimed.
- `git diff --check` passed. Browser screenshots, mobile overlap/zoom/keyboard acceptance, CI, same-commit Production and online acceptance remain separate evidence owned by the primary delivery workflow.
