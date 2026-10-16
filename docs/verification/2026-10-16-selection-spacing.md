# Selected passage spacing

2026-10-16. A local visual refinement of the existing passage selection. The reference showed prose crowded by its selection boundary and floating toolbar.

The selection now extends 24px beyond the text on desktop and 14px on narrow screens, with 12px/10px of vertical space and a softer 12px corner. It uses a faint theme-derived edge and wash. The annotation anchor retains the same spacing with slightly stronger emphasis. The toolbar has a lighter shadow and sits 24px from a whole passage; an actual text selection keeps its existing 10px placement gap. Text width and line wrapping do not change when selected.

## Verification

- `npm run verify:deploy`: 670 tests, 669 passed, one Linux-only test skipped on macOS, zero failures. Runtime initialization, hosted build, public asset checks and release checks passed.
- Real Chromium interaction with the public Alice sample on an isolated local server. No credentials, private account data or model requests were used. Temporary test storage stayed outside the repository.
- The long passage containing “Dinah my dear!” was checked at 390, 768 and 1440px. Selecting it preserved its text width and height. The whole-passage toolbar stayed 24px above the prose. At 390px the outer selection boundary remained between x=8 and x=382, without horizontal overflow.
- A 320px night/parallel viewport also kept the selection between x=8 and x=312, without overflow. Night mode, parallel reading and opening/closing the annotation panel retained the selection spacing.
- Keyboard focus remained visible. Enter selected a focused passage and moved focus into its toolbar. A real mouse drag selected “Alice was beginning” and opened the excerpt actions.
- Diff review checked stylesheet precedence, the annotation anchor override, keyboard focus and the separate whole-passage/excerpt placement paths. `git diff --check` passed.

## Screenshots

- [Before, desktop](../../output/playwright/selection-space-before-desktop.png)
- [After, desktop](../../output/playwright/selection-space-after-desktop.png)
- [After, mobile](../../output/playwright/selection-space-after-mobile.png)
- Long passage: [390px](../../output/playwright/selection-space-long-390.png), [768px](../../output/playwright/selection-space-long-768.png), [1440px](../../output/playwright/selection-space-long-1440.png)
- [Night parallel reading](../../output/playwright/selection-space-night-parallel.png)

These are browser viewport checks, not physical iPhone/Safari verification. Production acceptance is recorded separately after deployment.
