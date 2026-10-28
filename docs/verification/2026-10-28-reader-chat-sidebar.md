# Reader conversation sidebar verification

Request: open the reading conversation beside the book and give its entry a stable, quiet home.

At 1100px and wider the conversation occupies a full-height right sidebar. The book, header and reading toolbar reserve its measured width. The existing 320–640px preference and keyboard/pointer separator remain available. At narrower widths the existing modal drawer keeps its inert, focus and scroll containment.

The conversation entry stays beside the reading-tools button, including after the optional reading hub loads and focus mode hides the top header. A conversation icon and open-state tint identify it. The two actions share one toolbar surface. Clicking the desktop book leaves the conversation open; Escape, close and the entry itself can dismiss it. A newer reading or navigation intent defeats a queued layout-anchor restoration.

## Evidence

- Focused Node tests: 78 passed, covering workspace sizing, restoration, mobile containment, conversation adapter, tool coordinator and reading hub. The updated sidebar and hub expectations were observed failing before implementation.
- Browser verifier: `tools/verify-reader-chat-sidebar.mjs`. Uses isolated temporary records and a synthetic local account, with no provider calls or production account writes.
- Responsive matrix: 1440×900 Simplified Chinese, 1200×700 English, 1100×700 Japanese, 768×1024 Traditional Chinese, 390×844 Simplified Chinese. Checks the visible collapsed entry, panel bounds, reserved book space, keyboard width changes, anchor restoration, desktop book interaction, close/focus return and mobile scroll release.
- Additional checks cover paginated reading, desktop-to-phone-to-desktop layout changes and Escape from the book.
- Independent code review identified the optional hub's reparenting and Escape ordering; both were corrected. No further confirmed correctness finding remained.
- Local full-suite execution was interrupted; it is not recorded as a complete passing suite. The PR CI is required before merge.

Build, copy lint, CI, merge and matching production release results are recorded below once observed.

## Limits

Chromium verification does not prove Safari, physical mobile keyboard or screen-reader behavior. The local conversation service is intentionally unavailable in this layout fixture; this work does not validate provider output or change model/data authorization.

Observed before PR creation: the final focused run passed 78/78; copy export and the pinned Vale/textlint copy lint passed. The first local runtime build timed out during the existing DSH initialization; a retry and the PR build remain required.
