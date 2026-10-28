# Homepage scroll-driven motion

Base: `6b6ff0c`. The user explicitly requested the downward-scroll visual experience seen on [Ambi](https://www.ambi.ai/en). The previous clear homepage returned before its motion owner mounted. This change restores that missing part of the direction rather than repeating the static layout refinement.

## Result

Native paused Web Animations are sought from actual scroll geometry, coalesced through one requestAnimationFrame. Unequal photograph travel establishes depth in the hero. A real sample can stay in a held column while explanatory text advances; this is enabled only if the card and header fit the viewport. Existing title lines move into focus, while the continuation photograph opens from a crop and settles. Reverse scrolling follows the same geometry. No scroll interception, autoplay loop, new library, new source copy, model call, storage or account permission.

Buttons, source quotations, translations and factual disclosures are not motion targets. Heading text nodes are wrapped for the effect, then restored when disabled; no duplicate accessible text is introduced. The source order remains heading/explanation before the real specimen. Medium-width and mobile photographs remain visible in normal motion mode. A narrow Japanese title gets enough room to avoid its orphaned ending. Legacy timed hero entrances no longer hide the actual actions.

The owner cancels for reduced motion and lifecycle suspension; static/no-JS documents remain readable. Viewport-height changes (including browser bars) coalesce without rebuilding all effects. Source errors replacing the home dispose the owner. The private library strips the existing motion entry and never enables the scene layout. Its existing source and language recovery boundaries are retained.

## Evidence

Six initial behavior checks failed before implementation. The final eight scroll-owner tests pass, covering viewport progress, reversal, one-frame coalescing/no idle loop, card fit, reduced motion, hidden/replaced roots, height-only resizing and page restoration. Affected home, component-foundation and typography checks pass; the exact final commands/results are captured in the PR checks.

Real browser observation used normal motion, not reduced-motion screenshots as motion proof. At scrollY 1102 and 1210 the sample stayed at y104 while its explanation moved from y−92.40625 to y−200.40625. Hero photo transforms changed during native wheel scrolling and returned to their initial matrix at the top. The continuation crop changed from `inset(5.94824% 7.93099% round 28.28px)` to `inset(1.17054% 1.56072% round 7.97478px)` as it entered.

Inspected 1280×720, 700×1000, 390×844, 320×700 Japanese, 1440×900 English and Traditional Chinese/night. The held specimen's actual Spanish control worked. Reduced motion removed line wrappers and kept quote/heading/href text intact. No-JS retained readable content and visible actions. A forced catalogue failure removed the motion owner, retained the visible recovery prompt and left no wrappers. The private shell had hidden home, no motion owner and no motion entry/home-story stylesheet.

Fresh independent review found no actionable Critical, Important or Minor issues and independently reran all eight owner tests. A suspected lifecycle collapse was investigated in isolated Chromium: bottom-page geometry and the held card returned exactly after controlled pagehide/pageshow events, so no speculative fix was added.

[Browser observations](2026-10-28-home-scroll-motion/browser.json), [held reading scene](2026-10-28-home-scroll-motion/reading-held.jpg), [opening crop](2026-10-28-home-scroll-motion/continuity-enter.jpg), [Japanese mobile](2026-10-28-home-scroll-motion/mobile-japanese.jpg), [night](2026-10-28-home-scroll-motion/night-held.jpg).

Limits: actual back/forward-cache navigation, physical iOS browser-bar motion, Safari, screen-reader speech and performance profiling remain unverified. These are scoped browser/behavior checks, not an accessibility certification or reader study. Current-head CI, merge and exact Production source acceptance remain delivery gates.

Implementation references: [Animation.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime), [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [W3C reduced motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html).
