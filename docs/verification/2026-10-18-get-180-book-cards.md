# GET-180 — shelf card verification

2026-10-18, based on main `2f4fc0d5323e35295127759deb855d8f913cdae1`.
[Design](../superpowers/specs/2026-10-18-get-180-book-cards.md).
Only three production files change: the library `bookCard` renderer and its two
existing stylesheets. Landing cards, original book files, IDs, translations,
owner data and model/provider behavior are unchanged.

## Actual checks

```text
node --check app/portal.js
git diff --check
node --test --test-concurrency=2 tests/library-personal.test.mjs \
  tests/shelf-order.test.mjs tests/library-workspace.test.mjs \
  tests/library-filters.test.mjs tests/catalog-sample.test.mjs tests/portal.test.mjs
44/44 pass, 0 failures/skips; registered temporary directory
node tools/build-vercel.mjs
node tools/check-public-build.mjs
321 public files, 11 registered media assets
node tools/release-policy.mjs
683 allowed software files
node tools/verify-release.mjs
All commands exited 0.
```

The 44-test run preceded the final two-rule compact current-menu CSS repair;
its affected layout/menu was then retested natively. It changes no application
logic. No new CSS-string tests were added for this reversible layout change.
Current-head full CI, independent final code/visual review, merge and production
verification remain separate delivery gates recorded on the PR/Linear issue.

## Native observations

macOS Chrome Guest, native CUA gestures, anonymous disposable local library
with the real public catalog. No browser JS interaction driver, credentials,
private books, model calls or cloud account mutations. A read-only local
observer measured actual rendered geometry and values; screenshots retain
browser chrome and have not been retouched.

| Check | Observed result |
| --- | --- |
| Desktop first row, 1200px | All four read-control rectangles start at y=619.39 CSS px; idle action opacity 0 |
| Keyboard Tab from local search to first title | Complete native title anchor receives focus; its action opacity becomes 1; neighboring cards remain 0 |
| Longest public author, Machado | One visual author line; full author remains in AX, DOM/title and the actual book-information dialog |
| Night, 1200px | Same y=619.39 row alignment; readable text and original cover colors retained |
| Compact 390×844, light/night | First two CTA rectangles start at y=645.89; actions visible; menu buttons 44×44; document width exactly390 |
| Real short/long titles | Search `弗` returns Frankenstein + Douglass; title boxes 44/54.375px, both CTA tops y=696.859375; complete accessible titles retained |
| Native title link | Douglass title opens `/read?book=gutenberg-douglass`; Back restores query results |
| Single Chinese trial link | Alice opens the existing Chinese sample; Back reveals the actual guest resume/current-book view |
| Card menu | Book information and ordering actions remain independently accessible; no card-level fake click or nested interactive element |
| Compact current-book menu | Existing negative offset clipped it at the right edge. Final fix: observed rectangle x320–364, y283.5–327.5, 44×44, wholly inside its heading and390px viewport; menu opens successfully |

The idle default contains no read-button clutter, while trial metadata stays
discoverable. A shared 8% hairline at .875 opacity gives the shelf a quiet 7%
contour without a separate token palette. Full text remains selectable; title
clamping/author ellipsis is visual, not destructive string truncation.

Core card captures were taken before the final adjacent current-menu offset
repair; the fixed current-book and final long-title captures follow it. That
repair does not alter shelf card selectors. The older clipped current-menu
capture is preserved privately as regression evidence and is not presented as
a successful result.

Original native captures:

- [Desktop idle](assets/get180/desktop-idle.png)
- [Desktop keyboard focus](assets/get180/desktop-keyboard.png)
- [Longest author](assets/get180/desktop-long-author.png)
- [Desktop night](assets/get180/desktop-night.png)
- [390px light](assets/get180/mobile-light.png)
- [390px night](assets/get180/mobile-night.png)
- [Real long/short title pair](assets/get180/mobile-long-title.png)
- [Fixed current-book menu](assets/get180/mobile-current-book-fixed.png)

## Limits

These are desktop Chrome/responsive observations, not physical touch, actual
hybrid-device or AT sessions. The media predicates include `any-pointer:coarse`
so a fine primary pointer does not hide controls from a coarse secondary one;
that is a code-reviewed rule, not a claim of actual hybrid hardware testing.
Existing native keyboard ordering also has deterministic shelf-order tests;
this batch did not run a physical touch drag. DevTools showed existing
password-form accessibility advice; no all-console-clean claim is made.

No original review-author score or new-user perception study is invented.
The genuine reading trial and editorial feedback tasks remain independent.
