# Public Beta Channel Implementation Plan
> **For agentic workers:** Use superpowers:executing-plans inline, with a fresh final reviewer.

**Goal:** Publish a truthful, polished four-language beta entry with direct Web trial, verified public TestFlight installation and email feedback.
**Architecture:** One public channel module, one authored page renderer, scoped styles and a native direct-email link. Local routing and static packaging render identical pages. Existing public navigation, theme and locale behavior remain shared.
**Tech Stack:** Native ES modules, server-rendered HTML, CSS, node:test.
**Spec:** docs/superpowers/specs/2026-11-07-public-beta-design.md

## Global Constraints
User approved direct execution/publication. Preserve unrelated work. No application gate, new service, tracking or private reading data. Verify actual external installation availability, never infer from Apple upload. Honor the current sole production publisher; no manual second chain.

## Review Focus
- Missing/invalid/credential-bearing install links cannot become install actions.
- The feedback area has one direct public email action and no input fields.
- The visible support address remains manually copyable without JavaScript or a mail handler.
- Locale destinations, no-JS actions, mobile menu, theme and focus remain usable.
- Local and hosted aliases, metadata and asset dependencies agree.

### Task 1: Public channel and page
Files: app/beta-channel.mjs, app/beta-page.mjs, app/beta.css, tests/beta-channel.test.mjs.
- [x] Write tests for trusted public links, all locale page actions, the absence of form collection and unavailable installation.
- [x] Run and observe failure because the beta entry is absent.
- [x] Implement page and one user-controlled native email action.
- [x] Run focused tests and record results.

### Task 2: Public integration and acceptance
Files: app/public-navigation.mjs, app/home.html, app/home-locale.mjs, tools/build-vercel.mjs, server/portal.mjs, app/sitemap.xml, tests/beta-routes.test.mjs, existing affected contracts.
- [x] Test local HTTP and hosted flat/index aliases, first-paint navigation and literal localized links.
- [x] Observe missing-route/build failure, implement route/packaging/navigation.
- [x] Run affected checks, full hosted verification, copy checks and independent review.
- [x] Verify desktop/mobile/light/dark/keyboard/no-JS fallbacks in the browser; retain screenshots privately.
- [ ] Commit, push once, PR, wait required CI, merge normally and follow sole production publisher. Verify the exact live source, beta page and external link.
