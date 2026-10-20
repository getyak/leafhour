# GET-189 native evidence

These are actual local-server Chromium screenshots, not Production or physical-phone captures. Source base is public main `8c4dd18`; only `app/interaction-craft.css` changed. Each PNG is bound to its actual CSS SHA in sha256.json. The seven non-header images use the 44px link/search fix; the two MCP header images show the final added 7px label/keycap gap (the paper header replaces its earlier capture). The final gap affects that header button only.

`production-baseline.json` records the previous actual public site. `local-target-audit.json` covers four page families in all four locales (588 targets); `local-interactions.json` covers real pointer clicks near the lower-right edge of each language link and real menu, search, filter and login surfaces. `local-spacing.json` verifies the final served CSS bytes, command palette native open/Escape/focus return, and emulated system paper/night. All model-generating POST requests were blocked. The isolated local service has authentication providers disabled; its login image is a layout check, not a real-account sign-in claim.

Earlier pilot scripts stalled on a CSS separator in accessible link names and a hidden legacy header button; the accepted scripts target the actual hreflang links and the supported login entry route. A first blanket animation wait also included a scroll timeline; the accepted capture waits only finite document-timeline motion. These failed attempts are retained privately and do not count as passed checks.

Current-head CI, merge and exact Production acceptance remain separate delivery gates.
