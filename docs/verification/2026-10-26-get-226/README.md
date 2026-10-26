# GET-226 — Reader identity and honest location

Baseline: `c529ddae882aeae4ec1d70400eccfc00e77ccd18`, public `getyak/leafhour`. Scope: [GET-226](https://linear.app/getyak/issue/GET-226).

## Finding and implementation

The current reader's `1 / 12` was a chapter ordinal, not scroll progress. Its focused layout concealed the header, leaving no persistent scroll position. The historical private screenshots 03, 25 and 27 were read locally and remain private. Screenshot 28 is referenced in the issue but absent from its current attachments and the parent resources; it was not inspected. Current-main rendering was reproduced independently with the public-domain Alice reader at the same desktop size.

Baseline paper-theme text measured 4.787:1, already above WCAG AA's 4.5:1 minimum. The historical visual complaint must not be described as proof that every current default color failed AA. Book/chapter identity now uses the existing ink color, and the header explicitly has an opaque paper background, without its old gradient edge. Theme and atmosphere paper colors remain authoritative.

A small display-only enhancement reads the existing current book/chapter and rendered chapter rectangle. Scroll percentage describes the current chapter's traversable viewport range, never the whole book. A fully visible short chapter is 100%; empty, unloaded or unmeasurable content has no invented percentage. Chapters, automatic fragments and named front/back matter retain distinct labels. Loaded adjacent chapters do not change the current chapter's denominator.

The existing reading pill keeps chapter identity and scroll position visible in focused/fullscreen reading. In page mode it keeps chapter identity while the existing page-turner retains actual single-page/spread counts; the header uses a compact form of that same measured label with its full accessible name. No second page count, reading write, schema change or private-data fetch was introduced.

The header's book and chapter controls keep their full accessible names. Existing Book info and Contents expose the full titles through mouse, keyboard and touch activation; native title text is supplementary. Narrow identity controls stack, without reflowing the body during reveal. On narrow paginated screens, space is reserved inside the leaf for page controls. ID-scoped rules deliberately survive the later-loaded `reader-paper.css`.

Pointer approach to the top delegates reveal to the existing tools coordinator. The existing pill remains the keyboard and touch entry. Timer, pointer/keyboard/gesture/dialog holds, dismissal, F/Escape, fullscreen state and exit ownership stay with their existing controllers. The enhancement cancels its frame/listeners/observers on teardown, checks late module arrival against reader disposal and keeps the existing BFCache lifecycle. It never changes a passage anchor or draft.

## Verification

The new geometry regressions failed before implementation. A real HTTP regression separately caught the missing executable asset route (404), then passed with the route registered. A deferred-import regression failed before the reader-disposal guard was added. Existing chapter-navigation coverage now checks that a chapter ordinal does not replace measured position. Unit fixtures are distinct from browser geometry and native fullscreen evidence.

The actual public build is exercised by [tools/verify-reader-location.mjs](../../../tools/verify-reader-location.mjs), without source fallback. The final [browser report](browser.json) covers Chromium 153 and WebKit 26.6, desktop 1280×800, 390/320 narrow widths and 800×390 landscape, paper/night, reduced motion, 200% text, synthetic long CJK/English/Emoji titles, measured start/middle/end, font reflow, keyboard hold, page turns, actual document fullscreen, visible 44px exit, pointer hit testing, anchor retention and page errors. All eight cases passed. Every non-GET API request is blocked before backend dispatch; no paid model/translation/share or durable reading write is used.

Contrast uses the browser's computed colors, normalized through a canvas color parser (including WebKit `color(srgb ...)`), and alpha-composes ancestor backgrounds before applying WCAG relative luminance. The verifier sets the real appearance state and reads the actual theme back, so font adjustment cannot silently reset a supposedly night-theme test. Requirements and method follow [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html). Synthetic 200% text snapshots all original font sizes before doubling them, avoiding repeated inheritance scaling.

Independent review caught a long named front/back-matter pill without a height limit. A real regression reproduced it, then verified the bounded two-column fix and unobstructed page controls; see [review.md](review.md).

The first narrow replay found the enlarged pill intercepting page navigation; the first fix was overwritten by lazy paper CSS. The final package uses reserved space and stronger scoped selectors. An early verifier assumed the old native settings select remained visible after enhancement; it now activates the rendered page-layout chip. The initial WebKit color parser incorrectly treated normalized sRGB components as 0–255 and was replaced. These failed attempts are retained separately from final acceptance.

Driver WebKit is not physical Safari. Human VoiceOver, physical-device interaction, human native-language review and macOS green-button window fullscreen are not claimed. The inherited GET-227 cold-CSS first-frame P2 remains outside this change. The final local complete host suite passed 3485 tests with zero failures and one existing macOS platform skip. Fixed Vale 3.24.0, textlint, byte-repeatable copy exports, copy canaries, runtime, public build, asset budgets and release policy/contents passed. The final JS is 327547/327680 bytes and CSS is 204608/204800 bytes; neither cap was raised.

The inherited fullscreen verifier passed both engine smoke cases. A separate owned headed Chromium replay sent F and Escape through macOS System Events, observed native fullscreenElement HTML then null, verified the visible exit and restored the prior foreground process. See [native.json](native.json). The OS-input replay does not establish green-button macOS window fullscreen.

Independent review, PR, exact production revision and real-account online acceptance remain separate receipts.
