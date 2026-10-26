# GET-261 verification

The reader keeps its existing closed-by-default Ask AI entry and floating desktop workspace. Answers expose a single evidence entry; references and process counts appear after expansion. Current passage details live in More. Failed lookups, failed questions, draft translation labels, source links, scope and price information remain available at their existing decision points. Folding a long answer retains its qualification and evidence entry.

Narrow chat uses 76% of the visual viewport so part of the book remains visible. Compact visual viewports keep the full available height for the existing close/composer controls. Desktop paragraphs do not shift or resize. Existing width preferences and compatibility storage keys remain authoritative.

## Local evidence

- A new DOM regression failed on the baseline because the single evidence entry was absent. The affected suite passed 256 tests; the final chat UI suite passed 67 after adding the long-answer qualification regression. No failures or skips in either run.
- Fixed Vale 3.24.0, installed textlint and planted copy canaries pass. Existing copy warnings and debt remain in their reports. The copy inventory is regenerated from actual sources.
- The public package build and public-content checks pass with the original 320 KiB JS / 200 KiB CSS budgets. Duplicate reader chat CSS rules were removed rather than changing a budget.
- `tools/verify-chat-evidence.mjs` passes 11 packaged Chromium cases: all four locales at 1440×900 / 390×844, plus 768×1024, 390×420 and 320×740. Native disclosures, nested Escape/focus, source return, explicit missing translation, failed-question editing, load error/retry, close/reopen/reload drafts, paragraph geometry and horizontal overflow are checked. Phone cases use reduced motion and touch-capable contexts. The report records synthetic API fixtures and blocked page mutations.

The screenshots contain only public-domain Alice and named synthetic chat text. Production source, real-account readback, independent review, current-head CI and merge are separate delivery receipts; local checks alone do not establish them. No physical keyboard/OS IME or screen-reader speech acceptance is claimed.

## Independent review fixes

The independent reviewer `/root/get261_review` inspected `2f6b9ee82734eec418048ba607e01dce96189e49` and ran 78 UI/workspace tests. There were no P0/P1 and two P2 findings: the mobile menu still used the full viewport after the sheet became shorter, and Escape preferred Settings over a focused sibling Current passage disclosure.

The menu now has a conservative limit based on the shortened sheet, including compact viewports. Escape selects the nearest visible open disclosure containing keyboard focus before using its existing fallback. A new sibling-focus test fails before this fix and passes afterwards. The final affected UI/workspace/conversation run passes 97 tests, and all 11 packaged browser cases pass with current passage, settings and data scope expanded together, Export scrolled into view, and focused sibling Escape checked. The original copy/build budgets still pass. Final reviewer closure is recorded separately against the resulting commit.
