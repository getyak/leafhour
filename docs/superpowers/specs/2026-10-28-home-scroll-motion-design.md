# Scroll-driven homepage motion

The user reports that the Ambi-inspired homepage lacks its key experience: the visual changes while scrolling. This corrects the missing part of the previously selected direction. The current clear hero returns early from `mountHomeMotion`, leaving the live design static. The current browser reference at https://www.ambi.ai/en visibly uses unequal image travel, progressive text focus and held media while the narrative advances.

## Chosen implementation

Use native Web Animations API effects, paused and sought by scroll position, plus CSS sticky positioning. This keeps one frame of work per scroll/resize batch, supports reversal and restored positions, and avoids a new animation dependency or scroll hijacking. CSS-only view timelines are a viable alternative but would need a separate compatibility fallback; a large animation library adds no necessary capability to these three scenes.

- Hero: its two noninteractive photographs move at different rates, with restrained scale/rotation. The heading moves slightly as the scene leaves. Actual links keep their own geometry.
- Reading scene: a real sample remains stationary in a sticky column only if it fits the current viewport; existing headings progressively come into focus as their lines enter. The decorative reading photograph moves behind the paper. Original/translation text, labels and action controls remain readable and selectable.
- Continuation: the existing room image opens from a crop into a fuller frame while its image gently settles. Section headings share the focus progression.
- Medium and mobile: effects are visible at the in-app browser's approximately 700px width as well as 390px. Reduce travel on narrow screens and disable sticking when the card or viewport is too short. Keep DOM/keyboard order from the prior semantic-order repair.

All motion is controlled by native scroll position; no wheel/touch cancellation, autoplay loop, model call, storage change, new copy or data access. Missing animation APIs, reduced motion and a hidden private homepage retain the static document. Cancel on reduced-motion/pagehide/hidden state, restore on pageshow from actual geometry, and stop work after disposal or initial-language error replaces the homepage. Focused sections show their heading clearly.

## Verification

Prove that scroll changes actual effect time/transform, reverse scroll restores it, idle queues no animation frames, reduced motion cancels and restores text, and the private shell mounts no motion. Inspect top/middle/end in 1440/700/390/320px, night, four locales and short viewports. Check real buttons, text selection, no overflow, DOM order and no-JS/static fallback. Do not use reduced-motion screenshots as evidence of the requested motion. Complete review, current-head CI, normal merge and matching Production acceptance.

Sources: [Animation.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime), [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [W3C reduced motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html). These supply implementation/accessibility criteria, not a full conformance claim.
