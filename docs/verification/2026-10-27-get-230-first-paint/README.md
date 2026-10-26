# GET-230 first-paint follow-up

Canonical task PR: [#195](https://github.com/getyak/leafhour/pull/195). This follow-up closes a real postmerge acceptance gap in [GET-230](https://linear.app/getyak/issue/GET-230); it does not replace that primary PR or reopen another issue. Baseline: public main `d43c9aea0706a74bc6d923bcddff1ff21031f4ec`.

The first implementation removed the illustration/quotation dependency and supplied static skeleton markup. Its functional Production checks passed, but actual first paint was still too late. A separate navigation trace recorded response end at 2099.9 ms, reader CSS response end at 14579.6 ms, the imported CJK font-face declarations ending at 16605.7 ms, and first contentful paint at **16668 ms**. The skeleton was still waiting for the render-blocking stylesheet. See [baseline-production-timing.json](baseline-production-timing.json); these are measured observations, not a latency guarantee.

The hosted HTML now contains a small, static, network-independent skeleton style and preloads the complete stylesheet. A browser owner creates a print-only stylesheet with listeners attached before requesting it. It enables the reading layout only after the stylesheet and its CSS imports load. Font binaries continue through the existing reading/font/anchor path. The critical style applies only before this handoff; it uses system fonts and no image, font-face or import resource. The initial library exit works while CSS, JavaScript, authentication and book data are pending.

Stylesheet error or a 30-second client deadline leaves an honest, short error with explicit reopen and the library exit. Its labels follow the single shared locale runtime, including a late language catalogue. Successful handoff refreshes registered return links after locale readiness. Timers, locale subscriptions and recovery listeners are released when ownership ends. Existing account checks, body responses, reader anchors, drafts and billing/model boundaries are unchanged.

The self-hosted CSP adds only the exact SHA-256 source for this one trusted style on reader documents. Other pages retain their existing policy. Vercel retains its pre-existing headers: adding an unrelated new CSP would have changed historical inline-style behavior, and is unnecessary to preserve its current inline-style permission. No `unsafe-inline` or script permission is added.

## Verification

Final host suite: **3495 passed, 0 failed, 1 existing platform skip** (3496 tests). Native PostgreSQL checks ran with the existing verified official image mounted read-only; test concurrency was limited to two. Targeted review checks passed, and the final packaged browser matrix passed **4/4** in Chromium 153 at EN/1280, zh-Hans/390, zh-Hant/320 and JA/390, including reduced motion. First contentful paint was **48–92 ms while full CSS and JavaScript remained deliberately pending**; see [browser.json](browser.json). These local observations are not a Production latency guarantee.

Reader JS is **323193 bytes** (cap 327680), CSS **204548 bytes** (cap 204800); budgets are unchanged. Runtime trace, public build, release allowlist/provenance, fixed Vale 3.24.0 and textlint passed. Repeated copy exports were identical; existing warnings/debt remain visible and no suppression or new debt was added.

[Desktop before CSS](en-skeleton-before-css.png) · [320px before CSS](zh-Hant-skeleton-before-css.png)

 The replay explicitly holds full CSS and JavaScript until after a visible first paint, then verifies book loading, image independence, saved state, real error/retry and four-language stylesheet-failure recovery. Synthetic delays and HTTP 503 are transport fixtures; successful book data comes from the real isolated domain service. There were no unexpected page errors; each deliberately injected stylesheet failure records one expected `Reader styles unavailable` module rejection, followed by a successful real CSS reopen. No model generation, real account business mutation, iOS test or global resource cleanup is used.

Independent review closed two P2 findings: standalone stylesheet failure initially retained English, and a fast stylesheet could hand off an English return URL before a saved Japanese catalogue arrived. Both have production-owner regressions, including the actual reader handoff loop. The reviewer independently ran 22 affected tests and reported no unresolved P0/P1/P2. It did not run another browser or full suite.

Production CI, exact-SHA release and real default-account browser results remain separate from this local evidence and are recorded on the canonical task PR and follow-up PR after merge. Real-account screenshots and session data remain private local artifacts.
