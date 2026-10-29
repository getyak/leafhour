# GET-273: quiet touch input in the formal Web reader

This is an increment in the actual reader (`app/reader.js`), based on public main `500b6706e949eb7e3b91d57a942d72a98066d0b7`. The historical design prototype in PR #209 remains unchanged. **GET-273 is not fully accepted by this source change.**

## Behavior

Previously, a normal touch click on the formal reading text called `choosePassage`, selected the whole paragraph and opened its tools. Touch input now leaves passage activation to the browser's text selection. Native `selectionchange` still captures selected text and handle adjustments; a touch `pointerup` no longer recaptures the quote that existed before a tap or scroll. No native gesture is cancelled or replaced with a JavaScript long-press timer.

The input owner also covers older MouseEvent compatibility clicks and WebKit's observed touch pointer ID 0 followed by a mouse-typed click with ID 1. A genuine subsequent mouse pointerdown restores mouse passage activation. Enter activation remains available. Reading instructions were updated in English, Simplified/Traditional Chinese and Japanese.

The formal chapter renderer already has no persistent paragraph selection-dot control. This change does not remove saved annotation summaries or saved highlights. It leaves the existing Web action menu and native UIKit menu intact; it does not implement or certify the prototype's exact three-action composition or automatic initial sentence/paragraph expansion.

## Checks

- Six focused regressions execute the actual production event handlers. The original touch-click tests failed before the change; independent review found the WebKit compatibility case, which also failed before its fix. The six tests then passed. The combined text-input, toolbar and quiet-chrome run passed 52 tests.
- Independent review of the final input change found no unresolved P0/P1/P2.
- Existing Chromium 156.0.8078.4 / Playwright 1.62.1: 390px and 320px touch contexts plus 1280px mouse context, reduced motion, public-domain Alice and an isolated local server. Browser plugin unavailable; reused the installed Playwright runtime. All API writes and external requests were blocked before dispatch. No real account, model call or runtime book upload was used.
- The real touchscreen tap reproduced the old menu in the baseline. Both changed mobile contexts kept it hidden after tap and touch scroll. Real mouse click and Enter still opened tools. Page identity, meaningful body, no framework overlay, no page errors and toolbar viewport bounds passed.
- Controlled Selection API probes traversed the actual capture/render pipeline, preserved exact quoted text at 24 and 60 UTF-16 units, and kept the menu within the viewport. They are **not** evidence of a physical selection-handle gesture.
- Chromium touch-emulated long press did not produce a native selection. That result is retained, not converted into a long-press pass.
- Product-copy inventory export, pinned Vale 3.24.0/textlint lint, planted canaries and `npm run build:vercel` passed. The first lint attempt lacked the frozen historical source object; fetching its exact commit repaired the local prerequisite.

The initial serial host suite completed with **4,283 pass, 13 fail, 16 skipped (4,312 tests)** using the pre-existing shared dependency link. It is not reported as green. Failures were:

| File | Failed cases |
| --- | --- |
| `billing-yearly-postgres.test.mjs` | isolated Postgres executes yearly grants and serializes monthly/yearly cross-process signup |
| `observability.test.mjs` | safe outgoing bytes contain only enums and a server HMAC identity; vendor failure does not reject acceptance or block the independent sink; raw errors never enter a fault and expected 4xx/cancellation are suppressed; Sentry burst is bounded to four simultaneous isolated clients; system faults are Sentry-only with no identity, consent record, raw data or request metadata; anonymous system faults still report when account identity secret is misconfigured; anonymous system fault transport has a separate bounded rate; trusted stable domain receipts deduplicate without exporting their private receipt key |
| `pdf-hosted-package.test.mjs` | the function package renders PDF glyphs without system fonts and from a different runtime directory |
| `reader-runtime.test.mjs` | the isolated hosted runtime initializes its actual SDK, profile, plugins and native bindings without a model request; rebuilding removes stale runtime files while keeping files beside the generated directory; an explicitly allowed Vercel dependency-only cache can be rebuilt without a restored manifest |

The local dependency tree lacked `@sentry/node`; tracing a linked `node_modules` also produced an invalid root entry for the package-copy tests. A task-owned lockfile installation supplied the missing dependencies. Its slow optional LibreOffice download was stopped, and the existing local `@deepseek-ai/libreoffice-kit-darwin-arm64` 0.1.5 cache (the same lockfile version) was reused. With an actual task-owned dependency directory, the three affected files above (`observability`, `pdf-hosted-package`, `reader-runtime`) reran with **32 pass, 0 fail, 1 skipped**. No native PostgreSQL engine was found; the annual database test remains a local prerequisite gap, rather than a green check.

First PR CI stopped at the copy-inventory reproducibility check: the compatibility guard added during review shifted generated source mappings by three lines after the earlier export. The final inventory was regenerated. Exact later PR CI and publication receipts belong to the primary PR/Linear follow-up, rather than being inferred from either earlier run.

## Remaining acceptance

The current native text reader uses selectable UITextView and its system edit-menu delegate; it was inspected, not modified or rerun here. `dev-ios-session run -- xcrun devicectl list devices` returned **No devices found**. The pre-existing booted simulator was left running.

Physical iPhone/Safari long press, copy and system handles, sentence/paragraph initial selection, exact action composition, hardware keyboard and VoiceOver remain open. Source, simulator, Web browser, TestFlight, production deployment and physical-device acceptance are separate states. Keep GET-273 In Progress; `need human` refers specifically to access to a connected iPhone for the remaining platform acceptance. This task does not retry Apple login, register another app, change accounts, upload a build or invite testers.

Full local logs, the browser driver, report and screenshots are retained under `/Users/cubxxw/.codex/visualizations/2026/10/29/01a18734-b865-7b51-9d1d-9873c004108b/get-273/`. PR CI, merge, deployment source and same-revision online acceptance must be read back separately.
