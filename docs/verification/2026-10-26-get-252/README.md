# GET-252 — Quiet Reading

Scope: [GET-252](https://linear.app/getyak/issue/GET-252), based on public `getyak/leafhour` at `c5f9e96081152b5c9cf3194f603d632e2f53a9e9`.

## Finding and change

The built baseline already centered the text and concealed the header. Its persistent “Ask AI” action still competed with the measured location pill. On a narrow screen the transparent pill and underlying text overlapped visually. Opening settings presented typeface and reading-language choices together; the measured initial English panel was 1019px tall.

The existing Agent entry now appears with the tools or with a meaningful unread companion message. The same entry, companion anchor, drafts and chat remain mounted. Closing chat reveals that entry before returning focus. Its pointer and keyboard holds now belong to the existing tools coordinator; its existing concealment restores focus to the persistent pill. No second timer, overlay owner or model trigger was added.

The location pill has an opaque paper surface and a 44px minimum target. Its real chapter/scroll/page measurement, long-title disclosure, and higher-priority Unsaved caption remain unchanged. The native fullscreen exit stays visible and retains F/Escape behavior.

Font size, paper and page layout stay available in settings. Typeface/fine typography and reading-view/translation controls use native disclosures; all IDs, values, native-select fallbacks, source facts and existing recovery actions remain. The page-navigation explanation is available on request and through its existing accessible description. Opening settings conceals the background tools card without changing its state or focus-return owner. No UI language string, private-note access, billing authorization, export contract or stored reading preference was changed.

## Verification

- The new chat focus regression failed before the implementation. The affected suite passes **95/95**. It covers the original five-second focus failure, the pointer-preview crossing, idle focus recovery and keyboard holds.
- Full host suite: **3486 passed, 0 failed, 1 existing platform skip, 3487 total**. Native PostgreSQL ledger fixtures executed using the existing read-only Postgres.app 16.15 binaries; no shared database or mount was modified. The existing modified-pinned-Linux-Node-license test is skipped on macOS.
- Fixed Vale 3.24.0, pinned textlint and copy canaries pass. The initial lint attempt lacked the CI-pinned frozen Git object; fetching that exact object repaired the environment. No debt or budget was raised. Copy exports were regenerated for moved source lines.
- Pricing, isolated runtime build/initialization, public build, release policy and release contents pass. Runtime initialization reports zero model requests and closed/reaped child processes. Reader JS is **327604 / 327680 bytes**, CSS **204353 / 204800**. Duplicate overridden chat CSS was consolidated while preserving final effective values.
- [Browser report](browser.json): actual built `dist` assets, Chromium 153, EN/zh-Hans/zh-Hant/JA × 1280×800/paper and 390×800/night, plus 320px/200% text and 800×390 landscape. It checks default quiet state, 44px opaque entry, real pointer/keyboard holds, Agent empty/open/close/focus, disclosures, independent view choices, source disclosure, real page counts/turning, reload, optional-module failure with native-select fallback, 503/retry recovery, empty-content unknown progress, long titles and real document F/Escape. An isolated local-auth fixture verifies draft close/reload/restore, then clears its draft and revokes/readbacks its session. Browser API mutations are rejected before dispatch; only isolated fixture authentication is explicitly seeded through the local API client.
- [Location report](location.json): the unchanged GET-226 verifier passes the four Chromium size/theme cases against this exact package, including measured start/middle/end, reflow, long-title disclosure, contrast ≥4.5:1, page/spread counts, 44px exit and visible Unsaved state.
- The initial English settings panel measures **776px**, down from 1019px (**23.8%**). Screenshots use public-domain Alice at the same dimensions; state fixtures are identified in the reports. A verifier initially checked page-turn completion too early and injected a failure at the unscoped API path; it now waits for the real page label and targets the actual scoped reading route. These were verifier errors, not recorded product passes.

The local browser owner and public-domain book are synthetic acceptance data. This does not establish production-account persistence, physical touch-device behavior, Safari, VoiceOver speech, macOS green-button fullscreen, human language review or a loading-performance improvement. GET-226/GET-236 and other issues are not completed by this change.

## Delivery boundary

PR, latest-head CI, merge, same-commit Production and real-account online acceptance are separate receipts. At implementation time, Production still serves the baseline `c5f9e96`. Vercel readback confirms the existing deployment READY and its exact source; a successful GET API rate-limit header is not proof of remaining deployment-creation quota. No preview, empty commit or quota-test deployment is created.

## Saved-annotation follow-up

PR #193 merged as `34e155b688bc7cc01fef75ca07516181cb18cfca`; its PR/main CI, Production workflow and exact deployed source passed. Real default-account checks then passed their initial automated assertions, but visual inspection caught a missing state: saved AI summaries still occupied both margins. That acceptance was marked incomplete and GET-252 stayed In Progress. Private account text and screenshots are retained only in this issue's private operational evidence, not this public directory.

The follow-up changes only the existing annotation visibility initialization. When a book opens in focused reading without a local visibility choice, saved summaries and annotation styling start tucked away behind the existing tools toggle. The non-focused default is unchanged. Explicit `true`/`false` choices remain authoritative; initialization does not write preferences. Explicit opening/recovery still reveals the same annotations through their existing controller. No record, highlight, draft, request, sheet or model-generation behavior is rewritten.

The new regression fails on the previous implementation and checks focused/non-focused defaults, both explicit choices, no initialization write, explicit reveal and preserved load-error feedback. Independent follow-up review found no P0/P1/P2 and ran 38 relevant tests. The browser verifier now seeds synthetic saved annotations in both 1280px and 390px local-auth cases; it checks the tucked default, existing tools toggle, actual stored-card opening (including touchscreen input on narrow screens), explicit choice across reload, and a 503/retry path. Real-account acceptance additionally requires saved annotation summaries to exist while remaining concealed by default, and checks the separately served annotation module's bytes as well as the main JS/CSS.

The final follow-up host run passes **3487 tests, 0 failures, 1 existing platform skip (3488 total)**, with native database fixtures executed. An earlier run lost access to the borrowed PostgreSQL path and consequently had one required-engine failure and two additional skips. The fix was environmental: copy the retained official image once into this task's registered artifact, match its SHA-256 to the official release digest, verify its application signature, mount it read-only, then repeat the suite. No test was skipped to bypass that failure. The final ten-case package matrix, copy lint, public build and release checks pass; the main JS/CSS sizes are unchanged.
