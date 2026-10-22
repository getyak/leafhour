# Leafhour visual refinement implementation plan

**Goal:** Apply the approved soft-white, graphite, pine-green and small apricot palette to the public home and personal library, with six documented refinement passes.

**Architecture:** One home-only surface stylesheet owns the final palette, geometry and state vocabulary. Existing domain services, localization, identifiers, reading preferences and authentication retain ownership of behavior. The reader keeps its independent themes.

**Scope:** Existing home, library, their menus, dialogs, loading and empty states. No model calls, paid jobs, data migration or new product features.

## Passes

- [x] 1. Unify light/dark palette and typography, remove paper textures and visual noise. Measure prose, secondary text and action contrast.
- [x] 2. Refine public page composition, navigation, sample, books and FAQ. Keep one primary trial entry and existing locale paths.
- [x] 3. Refine library sidebar, shelf, resume panel, filters, empty/loading states and common modal surfaces.
- [x] 4. Review fine-pointer hover, active press, keyboard focus, disabled, selected, destructive and touch states; preserve book drag affordances.
- [x] 5. Shorten entrance motion; remove decorative optical motion from this skin, preserve scroll ownership, support reduced motion and forced colors.
- [x] 6. Inspect 320/390/768/1440 widths, both appearances, localized labels and overlays; fix findings, run regression/build checks and independent review.

## Verification and delivery

Run palette contrast and asset packaging tests, relevant existing UI suites, build and release checks. Inspect actual browser renders when available. Record environmental limitations separately from passing checks. Commit only the visual changes; create a PR from public main, wait for CI and merge under repository authorization, then verify the production commit.

## Isolation

The original checkout contains other sessions' incomplete billing, translation and navigation work. A separate checkout is used. Native worktree tooling failed; the source is synchronized from the public main comparison through the GitHub connector because sandbox Git networking is unavailable. No private data or old private history is published.


## 2026-10-22 recovery continuation

The earlier environment/delivery limitations above are historical. The local source was integrated on current public main, independently reviewed and corrected. Native SQL and concurrency checks now execute, fixed build budgets are retained, and actual local browser checks cover the public home/menu and disabled billing. Hosted schema, payment fulfillment and billing activation remain separate gates. See [current recovery evidence](../../verification/2026-10-22-local-git-recovery.md).
