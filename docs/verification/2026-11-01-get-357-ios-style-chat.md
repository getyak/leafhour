# GET-357 — iOS reading styles, Settings, Chat and sharing

Task: [GET-357](https://linear.app/getyak/issue/GET-357/refine-ios-reading-styles-settings-sharing-and-chat). Base: public `getyak/leafhour` main `beeba7d`. Work is isolated on `codex/get-357-ios-style-chat`.

## Result

- Reading style presents an actual text preview, five paper choices and three typography presets. Font size and optional spacing remain adjustable. Presets retain translation, navigation and listening preferences. Paper colors agree across the page, animation snapshot and preview; original PDF pages retain their source appearance.
- Root tabs separate Library, Chat and Settings. Settings puts account and reading style first, then personal records, synchronization and offline/data information. Reader content/translation and page-turn details move into separate screens, each retaining a direct return to reading.
- Global native Chat selects any owned cloud-shelf book without downloading it or writing reading position. The reader and selected-text entry points reuse this conversation view. Visible context preserves original/translation attribution, stays fixed during an unfinished question or uncertain request, and changes only through an explicit action. Questions and unresolved conversation requests persist per owner/book, with the same retry identity. Refresh failure retains existing messages.
- Excerpt sharing offers paper, ink and night palettes, a framed preview and a reachable image action. Complete quotation text, measured multi-page layout, attribution, native sharing and eligible QR links remain intact. Text and link export remain separate.

## Local verification

All native commands use the shared `dev-ios-session` guard, isolated `org.leafhour.get352.testing` bundle and existing Primary iPhone simulator. Fixture books and answers are explicitly synthetic. No real user account, paid model or live personal library was used.

- Core: first new reading-style tests failed for the absent API, then the full Core suite passed 238 tests. Final expanded suite: **239 tests passed, 0 failures**, including owner/book draft isolation.
- Native application: full suite passed 230 tests, with one existing skip because the actual public-artwork fixture was not supplied. This is not artwork acceptance. After the final context persistence fixes, the 35 affected Chat, preference and card tests passed.
- Primary UI: new global settings persistence, excerpt styles and maximum accessibility text tests passed; existing selected-text native sharing and night/large-type reading tests passed. The first Chat test failed because the harness looked for the context button as `Other`; it was corrected to the actual native `Button`, then passed including cold launch.
- Legacy UI regression: full-height Chat/keyboard and explicit synthetic submission passed. Content/page-turn tests exposed a missing direct “continue reading” action in newly pushed settings. Both destinations now reuse the existing flush-and-dismiss continuation modifier; this was a product fix, not an unchanged retry. After that fix, **both tests passed** (107.6 seconds), covering persisted input/animation choices and translation modes.
- Compact-device run: **not run**. `dev-ios-session` refused because Primary iPhone was already active and was not owned by this task. No shared device was shut down. Maximum accessibility text was verified on Primary iPhone.
- Host iOS contracts: 100 tests passed, 0 failed.
- Independent read-only review: confirmed context, draft recovery and selection-range issues were fixed and covered. Final review reported no confirmed P0/P1/P2 blocker, including the two settings continuation destinations. `git diff --check` passed.

### Simulator screens

These are unedited screenshots captured from the test app, not design mockups. Any book text or answer shown is the labeled synthetic fixture.

| Reading style | Chat | Share |
| --- | --- | --- |
| [Sage theme](2026-11-01-get-357/screenshots/GET357-reading-style-sage.png) | [Draft](2026-11-01-get-357/screenshots/GET357-global-chat-draft.png) | [Night card](2026-11-01-get-357/screenshots/GET357-night-share-card.png) |
| [Night theme](2026-11-01-get-357/screenshots/GET357-reading-style-night.png) | [Cold restoration](2026-11-01-get-357/screenshots/GET357-global-chat-restored.png) | [White card](2026-11-01-get-357/screenshots/GET357-white-share-card.png) |
| [Maximum accessibility text](2026-11-01-get-357/screenshots/GET357-accessibility-reading-style.png) | | |

## Delivery and acceptance boundary

Local receipts were retained under the registered task artifact path `/private/tmp/ai-test-leafhour-ios-design.ZKNzAb`: `core-final.log`, `native-final.xcresult`, `verification.xcresult`, `continuation.xcresult` and `host-tests.log`.

PR, CI, merge and Apple processing are recorded when observed. Simulator results do not establish physical-device installation, full VoiceOver, a real paid-model response or retained user data through a TestFlight update. No preview deployment is requested.
