# Public language menu implementation plan

Goal: Make the globe reliable before the library bootstrap finishes, and reveal language choices on deliberate hover without moving focus or blocking the page.

Architecture: Keep one shared home-navigation controller and its existing localized anchors. Mount it through the lightweight public-page entry on authored home pages; later portal mounting reuses that controller. Use a non-modal anchored dialog, cancellable 100 ms hover intent and 220 ms leave grace. Click pins a hover-open panel; Escape, outside press and focus departure dismiss it.

Design: Desktop shows the existing four language endonyms and settings. Compact screens retain navigation destinations. Animate only the panel's 6 px reveal, opacity and subtle row highlight. Never delay a language navigation for an exit effect. Respect reduced motion; do not animate the whole page. Existing authored language anchors preserve same-document destinations.

Constraints: No account writes, model requests, dependency additions, private-data access or unrelated worktree changes. Normal browser anchor semantics remain available, including modifier clicks. The user has authorized implementation, review, PR, merge and production verification.

Review focus: Cold bootstrap failure; pointer travel across the panel gap; touch-generated pointer events; keyboard focus continuity and dismissal; rapid close/reopen and disposal of pending timers; current language check and viewport bounds.

- [x] Add failing behavior tests for hover, click pinning, keyboard/outside dismissal, early mounting and single ownership.
- [x] Implement shared lifecycle and anchored motion; preserve old auth, locale and navigation contracts.
- [x] Verify unit suite, production build, Chromium and available WebKit browser flows at desktop/mobile sizes; record actual limits.
- [ ] Review, submit PR, wait for CI, merge normally, then verify the matching production deployment.
