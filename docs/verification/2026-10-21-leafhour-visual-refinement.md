# Leafhour visual refinement — verification

User-approved direction: soft white, graphite, pine green and small apricot accents. Scope: public home and personal-library shell, preserving reading/data/authentication behavior and the reader's independent appearance preferences.

## Six refinement passes

1. **Palette and contrast:** one home-only stylesheet owns light/dark surfaces and text roles; remove paper texture, ornamental rules and optical overlays. Palette tests require body contrast >=7:1 and supporting labels/actions >=4.5:1 against the tested surfaces. Related initial checks: 21 passed.
2. **Public page:** move the existing attributed bilingual sample into the hero, use one direct sample-reading CTA, reduce navigation and align typography/spacing. Preserve authored locale routes and actual sample/draft attribution. One HTTP test was blocked by local `listen EPERM`; other assertions in that run passed.
3. **Library:** consistent sidebar, search/filter controls, resume panel, flat book covers with existing binding identity, visible reading links and common dialog surfaces. Related checks: 100 passed.
4. **Interaction:** common fine-pointer hover, press, focus, disabled and selected states; keep hit areas stationary while only decorative cover children move; expose touch actions. Related checks: 80 passed.
5. **Motion:** shorten progressive entry from 780ms to 420ms and reduce travel; clear home opts out of optical pointer/scroll listeners without writing the old preference. Support reduced motion, reduced transparency and forced colors. Related checks: 25 passed.
6. **Responsive inspection and fixes:** browser inspection at 320, 390, 768 and 1440 CSS pixels, light appearance, and dark mobile settings. No horizontal page overflow in the measured views. Restored the mobile account button hidden by a legacy `.small` rule. Verify visible keyboard focus and the real settings button opening its dialog within a 390px viewport.

## Independent review

Fresh static review found two issues, both addressed:

- Footer appearance menu could open below the viewport: added flip/clamp, a scrollable height limit and two failing-then-passing regression tests.
- A sidebar scrollport clipped collapsed labels: restrict the scrollport to the expanded sidebar, preserving the original visible overflow for collapsed hints.
- Removed the inactive hero illustration and optical-layer markup so the hidden high-priority image no longer competes with visible content.

No other concrete blocker was reported in mobile account visibility, modal/menu layering, dark appearance, reduced motion or forced colors. The independent review itself did not run browser checks.

## Final local evidence

```text
node --test tests/leafhour-surfaces.test.mjs tests/site-appearance.test.mjs tests/home-atmosphere.test.mjs tests/home-motion.test.mjs tests/home-navigation.test.mjs tests/portal-document.test.mjs tests/library-profile-shell.test.mjs tests/library-view-state.test.mjs tests/library-room.test.mjs tests/library-filters.test.mjs tests/auth-dialog.test.mjs tests/choice-control.test.mjs tests/action-focus.test.mjs tests/shelf-order.test.mjs tests/web-interaction-craft.test.mjs
209 passed, 0 failed

npm run build:vercel
exit 0

node tools/check-public-build.mjs dist
365 public files, 11 registered media assets; no private content directories

git diff --check
exit 0
```

The per-pass totals overlap; they are not additional unique tests.

## Verification boundaries and delivery

Browser inspection used the real public/guest production DOM with the local stylesheet injected and the intended hero/theme placement mirrored in that tab. It is visual and existing-interaction evidence, **not evidence that this source commit was deployed**. No real account data or new model output was required. No real-device iOS tactile/haptic behavior was claimed.

The local command sandbox denies TCP listening and Git networking. Full HTTP/runtime/CI validation must run in the normal CI environment before merge. Hosted build and the related non-HTTP tests above succeeded.

Native worktree tools were unavailable; an isolated checkout mirrored the current public main runtime for development. The original checkout's unrelated pending billing, translation and navigation edits were preserved during integration. The standalone patch contains only this task's paths. GitHub branch creation did not complete: two connector write attempts remained pending and were interrupted. There is no confirmed PR, merge or production release for this change yet.

This report records concrete changes and checks, not a numeric aesthetic score or a claim that every possible state has been exhaustively tested.

## Integrated working-copy verification

After preserving the existing simplified public home and unrelated pending work, the current project passed the same related test selection: **195 passed, 0 failed**. The count differs because the current checkout has a different existing test baseline. `npm run build:vercel` and `node tools/check-public-build.mjs dist` also succeeded; this working copy contains 397 public files and 11 registered media assets. No production deployment is implied.


## 2026-10-22 delivery continuation

- Rechecked public main at `ba9eef7f605572dc8eb3dd51b86ad03be1c4cc65` (PR #158). Its changes do not overlap the twelve visual-refinement files.
- Prepared twelve isolated files against public main in the ignored local delivery directory; the retained dirty workspace was not uploaded. Patch application and staged whitespace checks passed.
- Created the public working branch `codex/leafhour-visual-refinement` from the current main through the signed-in GitHub web interface. No visual-refinement commit has been uploaded yet.
- GitHub connector writes returned HTTP 403 `Resource not accessible by integration`. The local GitHub CLI credential is invalid and shell networking cannot reach its configured proxy.
- Browser upload reached the native file input but the Chrome extension requires its separate “Allow access to file URLs” permission. This broader permission has not been enabled without action-time confirmation.
- No PR, merge, or production deployment of this visual change has occurred. Prior local tests and build evidence above remain local verification, not production acceptance.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](2026-10-22-local-git-recovery.md).
