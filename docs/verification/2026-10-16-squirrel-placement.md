# Squirrel placement and default companion

User-requested changes: allow dragging the existing squirrel; companion defaults on with a retained close choice; remove the persistent status pill. The close control stays in the existing conversation. The initial warm-up, five-minute foreground interval, observed-material checks, account boundaries and quotas continue to apply.

`npm run verify:deploy` on Node 22.22.0 passed: 740 passed, zero failed or cancelled, one platform skip. Official isolated runtime initialization (928 files, 9.0 MB), hosted build (158 files, nine media assets), and software release allowlist (349 files) passed. No new product dependency was introduced.

Regression tests first failed, then passed for default-on migration, retained explicit closes across content versions, pointer drag versus tap, cancellation, keyboard movement, saved relative placement, visual viewport clamping and bubble positioning. Independent read-only review found a pinch-zoom width overflow. Applying visual-viewport maxWidth before measurement resolved it; the reviewer confirmed the fix and approved merge.

An initial full run cancelled seven existing chat-runtime tests: their 100 ms lease could expire before the HTTP tool handler entered, leaving the test's started promise unresolved. The original file passed all 20 cases alone. The three close/abort/expiry cases now use a controlled Date/setTimeout clock and advance expiry only after handler admission. Production runtime code and all original budget/dispatch assertions remain unchanged. Independent review and the final full run passed.

Real Chromium interaction used an isolated local account/store and the existing explicit fixture generator. A new book was enabled without clicking an enable control, and there was no persistent pill. Desktop drag moved the launcher from (1208,650) to (141,147), did not open IM, and restored exactly after reload. Tapping still opened chat and exposed its close control.

An actual foreground reading session produced a fixture bubble: with the squirrel at (16,13), the bubble appeared below it at (16,69). Dragging the squirrel to (926,527) moved the bubble above it to (684,427.81), without opening chat. Clicking the bubble opened the existing IM and preserved its unfinished draft.

Chromium's native touch input moved the squirrel to (36,276) while reader scroll remained at 2400 px and chat stayed closed. At 2x page scale, the actual visual viewport was 195 px wide; a controlled visible layout fixture measured a 171 px bubble spanning x=12..183, and its close button remained clickable. At 320 px, document width remained 320 px. Alt+Left moved the launcher by 16 px without navigating the book. Closing companion and reloading retained the off state.

Touch and pinch checks are browser emulation, not physical phone acceptance. This change did not modify or re-run provider quality evaluation. Hosted delivery receipts are tracked in [PR 51](https://github.com/getyak/leafhour/pull/51), its checks and the main Production workflow; deployment verification requires the exact source commit and the new position module.
