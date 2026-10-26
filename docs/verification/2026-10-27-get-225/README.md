# GET-225 primary reader overlay contract

The existing reader tools owner now coordinates Settings, Tools, Atmosphere, Chat and the command palette before the next surface opens. A handoff closes the previous view through its existing owner, releases chat's mobile scroll/inert ownership and keeps conversation drafts, retry state and background jobs. Annotation reading content remains under the GET-223 layout contract. This change does not redesign Settings, change chat generation or alter the tools conceal timer.

Palette loading is fenced against a newer primary surface. The palette's own synchronous handoff seals its request before show/focus/render, so a failure still rolls back and offers retry. A delayed close event cannot take focus from a newer Chat/Tools surface, and an old tools instance cannot dismiss a replacement reader's dialog. Palette still closes an owned Audio dialog through the established dialog lifecycle.

## Reproduction and verification

- The actual packaged baseline at 1280×800 failed the Tools → Settings assertion with both surfaces open. See `red-report.json`, `before-tools-settings.png` and the preserved red log. The initial unbundled development probe timed out before readiness; it is not used as product acceptance evidence.
- Final packaged Chromium matrix: **4/4 passed**, with EN 1280×800, zh-Hans 390×844 night, zh-Hant 320×740 night and JA 800×390. The verifier exercises actual keyboard and pointer input, plus explicit component activations to check handoffs when native modal containment correctly blocks header controls.
- Checks include Starting view and Interface language pointer hit testing; Sound and Data bottom controls; native Settings focus containment; Settings/Atmosphere/Palette in both directions; Audio → Palette → Tools; Palette → Chat after delayed native close; Chat's three owned disclosure layers; unsent draft retention; controlled Chat GET 503/retry; scrim click versus inside-origin drag; and restoration of the initial inert/scroll state. Full-width mobile Settings uses Escape because there is no exposed scrim.
- The existing GET-223 annotation browser verifier passed **4/4** for annotation text reachability, draft, reparent/focus, narrow Chat coexistence, error/retry and source return. No annotation layout source was changed.
- Final affected host tests: **152 passed, 0 failed**. The full host run recorded **3508 passed, 5 failed, 3 skipped**. One failure and two skips require unavailable native PostgreSQL. Four PDF/runtime failures came from the reused dependency directory being a symbolic link, outside the runtime tracer's allowed root. Replacing only this task's link with an APFS clone fixed all four: the isolated recovery subset finished **10 passed, 0 failed, 1 existing macOS platform skip**. These local results do not substitute for the mandatory Linux CI with native PostgreSQL.
- Public build passed: 521 files, 11 registered media assets, no private content directories. The reader JS is 327338/327680 bytes; its existing budget is unchanged. Fixed Vale 3.24.0 and pinned textlint pass after fetching the required frozen copy-debt object. Product-copy IDs, kinds and values are unchanged; regenerated inventory only tracks source fingerprints and positions.

The reusable [browser verifier](../../../tools/verify-reader-overlays.mjs) requires an explicit artifact directory, `LEAFHOUR_PLAYWRIGHT_MODULE`, an installed `LEAFHOUR_CHROMIUM_EXECUTABLE`, and `LEAFHOUR_VERIFY_DIST` pointing to the actual packaged reader. It creates and closes its own local server/browser. Its page routes block API writes, including progress and companion observation. Synthetic local login is isolated from real accounts. No model request, purchase or iOS Simulator is used.

Browser automation does not establish physical-device keyboard, OS IME, Safari or spoken screen-reader acceptance. Public Alice and synthetic Chat availability/errors establish geometry and recovery, not real provider output.

## Review and release gates

Independent native reviewer `/root/get225_review` found three P2 issues: the owned Audio modal surviving a Palette handoff, stale Palette close focus, and failure recovery losing ownership after its own handoff. All were fixed with reproducing regressions and independently rechecked. No unresolved P0/P1/P2 remains. Final review binding is retained on the canonical PR.

This record describes local verification. Exact PR head CI, merge, Production revision/assets, read-only real-account acceptance and Linear Done readback remain separate delivery receipts. The issue must stay In Progress until those release gates pass. Credentials, sessions and private account data are never saved in this directory.
