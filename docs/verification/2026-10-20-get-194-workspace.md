# GET-194 Batch A implementation checkpoint

This is a local implementation checkpoint, **not issue completion or Production acceptance**. The [plan](../plans/2026-10-20-get-194-reading-workspace.md) and [before screenshots](2026-10-20-get-194-baseline/README.md) define the comparison. Selected quotations remain Batch B and are not yet exposed as a dead control.

The reader now has a direct AI entry beside secondary timing tools. Scope and full cloud/context disclosure live in More, together with the companion preference; the composer retains meaningful status, stop/retry and character limits. The same physical dialog becomes a resizable desktop workspace or a full visible-viewport phone surface. Its isolated layout controller receives localized labels from the existing owner, owns inert/focus/resize cleanup, and preserves anchors without invalidating a newer chapter navigation. Notes and chat use explicit close/focus ports; the existing note/question draft stores and request IDs remain intact. New module/CSS entries were added to the actual release allowlist, without increasing caps or changing graph permissions.

Initial test-first evidence includes the missing module, then observable failures for absent separator/containment/anchor restoration; new chat lifecycle and scope-placement tests failed before the corresponding changes. Subsequent regressions reproduced an unfinished pointer capture, a queued restore overtaking chapter navigation, and an injected AI trigger retaining the old interface language; each was repaired and rerun. The existing layout-specific disclosure assertion was updated to the new More location while retaining full disclosure, accessible status and truthful scope behavior. Existing fullscreen-failure coverage caught the need to keep timing-tool focus return separate from the companion anchor.

Local verification on the candidate product sources:

- 216 tests passed, 0 failed/skipped: reader-chat-workspace, reader-conversation, reading-toolbar, reader-tools, reader-companion (UI/HTTP/state), library-chat (state/UI/HTTP), reader-navigation, UI-locale reader foundation/async/label cache/native choice, reading-view, reading-preferences and library-reading-preferences. Command: `node --test --test-concurrency=2 --test-reporter=spec` followed by those 18 `tests/<name>.test.mjs` files.
- `node tools/build-vercel.mjs` passed with existing graph and entry-size guards.
- `node tools/check-public-build.mjs dist` passed: 345 files, 11 registered media assets, no private content directories.
- `git diff --check` passed.

These checks do not prove actual rendered layout, physical keyboard/touch or assistive-technology behavior, real-account authentication, product model output, full-suite CI, merged code or a deployed release. Independent code review and compiled Chromium acceptance follow this checkpoint; final GET-194 delivery still requires Batch B, current-head CI, normal merge and exact Production acceptance.
