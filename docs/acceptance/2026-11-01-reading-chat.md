# Reading controls and direct Chat acceptance

This follows the reader feedback tracked in GET-357. It covers Web and iPhone; fixtures contain invented material and do not call a model or modify a real account.

## Delivered behavior

- Settings group typography, paper and reading controls. Sliders replace repeated step buttons; theme samples and optional details reduce the first screen.
- Contents uses compact rows and consumes outside taps without turning the underlying page.
- Global Chat opens a companion and composer without requiring a book. Selecting a book remains optional.
- Reading conversations and explanations use a full-height page with a return to the existing reader session. Web browser Back and native navigation preserve reading position and drafts.
- Account conversations use a separate owner-scoped storage path, bounded recent context and the existing quote/receipt gates. Reading tools cannot write progress or access private notes.
- Account conversation history retains terminal receipts outside its bounded active window, preserving export, cancellation and retry identity beyond 100 requests.

## Verification ledger

- Native app tests: 235 executed, zero failures, one existing artwork test skipped. Isolated Debug bundle `org.leafhour.readingchat.testing` on the existing Primary iPhone simulator.
- UI tests 110, 111 and 113 passed: paper preference survives restart, account draft survives tab changes/restart, accessibility text size keeps paper choices and navigation reachable.
- Existing UI20/21 passed after the identity-label assertion update: the full-height composer stays above the keyboard and explicit confirmation returns a labelled synthetic answer.
- UI tests 114 and 115 passed after test locator corrections: outside dismissal keeps the book position; full-page conversation keeps its source and draft on return/reentry. Screenshot review identified missing contents chrome in the nested navigation stack. Moving the overlay outside that stack restored its close button, title, locator and correctly constrained search. The final UI114 rerun passed with an explicit visible, hittable close assertion; the screenshot was inspected.
- The first five UI attempts failed at startup because the new isolated bundle was absent from the Debug fixture allowlist. That configuration was corrected; these attempts are not counted as passed.
- Backend scoped tests: 144/144 passed, including empty library, owner isolation, bounded context, quote settlement, duplicate request identity, cancellation, 105-turn continuation, receipt crash recovery and CAS replay.
- Web browser: four languages at 320, 390 and 1440 CSS pixels, plus a 390×360 short viewport; tested account chat with no books, draft/history return, sliders, theme targets and outside contents dismissal. A 640px reading scroll position survived full-page Chat return.
- First full Node pass: 4,517 tests, 4,475 passed, 26 failed, 16 skipped. Failures exposed the new annotation dependency edge, missing release entries, CSS size/minimum-type guards and incomplete shared local dependencies. The annotation owner now injects the workspace without expanding its dependency boundary; old unused styles were removed to retain the existing asset limit, and all contents text keeps the 12px floor. An independent dependency installation fixed the packaging and Sentry tests. Rerunning the 12 affected failed files passed 90 tests, with zero failures and one unavailable Linux-binary fixture skip.
- Final Web scoped suite: 222/222 passed; boundary/build/typography suite: 86/86 passed. Browser probes also covered fast close/reopen and two-workspace history handoff, normal scroll restoration, source citations and guest full-page login navigation.
- Native PostgreSQL is absent locally; its required annual billing verification remains a real local environment failure, to be resolved by the existing CI database gate. Vale could not be downloaded locally; real full-corpus copy lint is also delegated to CI, not claimed as a local pass.
- Isolated reading runtime built and initialized: 928 traced files, 9.0 MB, no model requests.
- Hosted build passed. Public scan checked 727 files and 12 registered media assets; release allowlist and release integrity checks passed.
- Independent review identified and fixed account billing route recognition, account history exhaustion, same-chapter explanation source return, reading time during full-page Chat, and the guest upload-to-login handoff. Final static review reported no outstanding P0/P1/P2 findings.

## Delivery boundaries

Full local checks, browser evidence and delivery revisions are recorded below when complete. Simulator acceptance is separate from physical-device acceptance; synthetic transport tests do not establish live provider acceptance.

Linear MCP calls in this session returned “not available to the model”, including the attempted GET-357 follow-up write. No issue state change is claimed.
