# GET-227 command palette

Scope: [GET-227](https://linear.app/getyak/issue/GET-227), isolated `codex/get-227-k` checkout of public `getyak/leafhour`. Main and HTTPS `/release.json` both identified `d8a1863556bc4bb7d4786cb306015917efacc81c` before implementation. The native Linear workspace/team/issue, complete description, relations and the attached “23 ⌘K” resource were read directly. Screenshot 24 is named in the description but was not present as an attached resource. No related issue or parent epic is changed.

The actual Production reproduction retained `Alice` as the input value and already displayed loading in a separate paragraph. That correct separation is retained. The demonstrated defects were the absence of current-book hits, rejection of Ctrl+K over Settings, singular `1 results`, repeated active-label announcements, and later keyboard/IME/error boundaries exposed by regressions.

## Behavior and boundaries

- Search ranks real current-book passage hits before commands and catalogue books. It uses the reader's already authorized loaded original text, stable passage IDs and real chapter titles. Chinese originals, case folding and NFKC matching are supported; excerpts preserve exact graphemes. Hidden translations, annotations and private notes are excluded. Unloaded body text is explicitly identified as outside the searched range. Selecting a chapter title uses its real first passage and the existing bounded chapter loader; no whole-book fetch, model, paid index or new endpoint is introduced.
- Selecting a passage uses the existing `goToPassage`/chapter-navigation owner, with its stale-navigation validation. The actual paragraph receives focus and a temporary visible location highlight. Existing logical selection and unsent Thought drafts are retained. Search introduces no progress, reading-activity or model writer.
- Ctrl+K/Cmd+K takes focus through the existing tools, chat, popover and native-dialog owners, including from an editable field in an open reader surface. The shared interaction coordinator retains outside dismissal. Escape uses native dialog cancellation; Tab remains within the two interactive controls in Chromium and WebKit. Slash and other page shortcuts retain their previous policies.
- Counts live in the status line with correct singular/plural copy in all four catalogues. Arrow/Home/End moves the same active option into view without rebuilding results or repeating the active label. Catalogue errors retain current-book hits; retry remains visible. Reader load failures use the actual load-error state and existing reopen action, including failure after metadata has loaded.
- A scoped reader-error observer and reader/locale/session subscriptions are released on disposal. Highlight timers are cleared. There is no second overlay registry or additional interaction-craft import.

## Regression and review

Tests were observed failing before each confirmed fix: search/order and navigation, count grammar/status noise, reader overlay handoff, narrow End visibility, retry staying open, IME Escape, both reader-load error stages, hidden translation hits, and decomposed Unicode excerpt offsets. Existing correct input/status separation is recorded as a baseline behavior rather than a fabricated failure.

Independent reviewer `/root/get227_review` reported no unresolved P0/P1/P2. Its independent command-palette run passed **46/46**; read-only probes also checked row identity/scroll, owner/session invalidation, stale jump validation, observer/watch release and normalized excerpt content. The review binds the exact source hashes in [source-fingerprints.json](source-fingerprints.json).

## Local evidence

The real-browser local matrix uses the real app server, isolated synthetic identities and public-domain Alice. It is separate from Production acceptance. Chromium 153.0.8010.12 and WebKit 26.6 cover English/1280/paper, simplified Chinese/390/night, traditional Chinese/320/paper and Japanese/320/night. Desktop uses keyboard navigation; narrow cases also activate real browser touch events. All eight cases passed search/jump plus Settings, Tools, Account and Atmosphere handoff, Tab containment and Escape/focus return.

Both engines additionally passed editable Thought handoff, unsent Thought and chat draft retention, logical source selection retention through jump, release of the mobile chat scroll lock, injected catalogue failure/retry/no-result, and injected reader failure with the real reopen action. A verifier initially asserted no-results before the catalogue retry had settled; the corrected verifier waits for the actual completed state. No application logic was changed to satisfy that early assertion.

The first complete serial suite found missing native PostgreSQL binaries: one failure and two database skips were preserved. The existing official Postgres.app cache was SHA256-verified and mounted read-only; a subsequent full suite passed 3460 tests with zero failures and one existing macOS platform skip. Final frozen product-source verification passed **3461 tests, 0 failures, 1 existing platform skip** (3462 total, 171.86s). Copy export, pinned Vale/textlint lint, canaries, pricing, runtime initialization, public build, resource checks, release policy and release contents all passed. The fixed startup budgets remain unchanged: actual reader JS **327678/327680 bytes**, CSS **203062/204800 bytes**. No iOS simulator, Docker stack, Pi/MiMo call, model generation or Preview deployment is part of this task.

The public [browser verifier](../../../tools/verify-command-palette-browser.mjs) requires an explicit registered artifact directory and existing `LEAFHOUR_PLAYWRIGHT_MODULE`, `LEAFHOUR_CHROMIUM_EXECUTABLE`, `LEAFHOUR_WEBKIT_EXECUTABLE`. Its corrected raw matrix passed 8/8 and actual packaged replay (`LEAFHOUR_VERIFY_DIST`) passed 4/4 with no source fallback. Empty-build and missing-entry fixtures both fail before launching a browser. Themes are changed through the real appearance API and asserted after navigation/handoff. Its independent review closed three verification defects (missing-build fallback, DOM-only theme selection, cleanup rejection); all product fingerprints remain unchanged.

The final two-engine boundary replay also retains a real mouse-selected excerpt across open/cancel, in addition to unsent Thought/chat drafts. Mouse/keyboard/touch are automated browser events; physical mobile devices, OS IME candidate windows and spoken VoiceOver output are not asserted. The same-version main/current lifecycle comparison matches after disposal, including main's existing one interval and two observers; the existing CSP diagnostic remains and no new unique diagnostic was observed.

Complete terminal evidence is stored as deterministic gzip files in `logs/`. [log-receipts.json](log-receipts.json) records compressed and original byte hashes and verified decompression; no output lines were removed or edited. `engineering.json` links the retained compressed logs and also preserves the original run paths.

## Delivery state

Implementation and independent review are complete. Current-head CI, normal merge, same-commit Production, actual online acceptance and Linear Done are separate gates and are not asserted by this document's local evidence.
