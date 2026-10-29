# Public language menu — 2026-10-29

## Behavior and cause

The globe previously opened the complete modal navigation and depended on `portal.js` to attach its click handler. On the deployed `/en` page, aborting that library bootstrap reproduced an inert globe. A fully loaded page still opened normally; no claim is made that every reported click failed for the same cause.

The authored home now loads the existing lightweight `public-page.mjs` entry independently. Its shared controller is idempotent, so later portal mounting does not toggle twice. The hosted bundler retains the same navigation module across entries.

Desktop prioritizes the four existing language links, their current-language check, and language settings. Compact screens retain navigation. Language anchors preserve their actual destination on home, pricing, privacy and Agent pages. Switching follows the normal link immediately.

## Interaction decisions

- Mouse hover: 100 ms intent before a 6 px / 160 ms panel reveal; hovering never moves keyboard focus or makes the page inert.
- Departure: 220 ms grace across the 8 px trigger/panel gap. Entering the panel cancels dismissal. Clicking pins the surface.
- Keyboard: Enter/Space and arrow activation focus a language choice; Tab remains free. Escape returns to the trigger. Outside pointer/focus dismissal does not steal focus.
- Motion: short opacity/transform transitions and row feedback; no full-page animation or navigation delay. Reduced motion disables transitions. Closing panels stop accepting pointer input immediately.
- Lifecycle: pending intent is cancelled on close/disposal. Both menu and shared dialog logic ignore a stale queued close after reopening.

## Verification

The original failing behavior was reproduced on production with `/portal.js` intentionally aborted. Unit tests were observed failing before the corresponding changes. An independent review found the Enter→Tab focus regression and a pre-existing queued-close ARIA race; both have targeted regression coverage and were fixed.

Focused suite: `node --test tests/home-navigation.test.mjs tests/web-interaction-craft.test.mjs tests/support-navigation.test.mjs tests/component-foundation.test.mjs` — 66 passed, 0 failed.

Browser command: `LEAFHOUR_PLAYWRIGHT_MODULE=<installed playwright-core/index.mjs> node tools/verify-language-menu-browser.mjs docs/verification/2026-10-29-language-menu`.

Both Chromium and WebKit passed all six flow groups (12 total), with zero unexpected page errors. Only the two intentionally aborted `/portal.js` requests failed. Browser results and screenshots are adjacent. Acceptance covers cold bootstrap failure, hover/focus preservation, gap travel, pinning, Enter/Tab/Escape, rapid reopen ARIA, four language routes, 320/390/768/1024 widths, 44 px targets, reduced motion, emulated touch, pricing, privacy and Agent pages. The intentionally aborted bootstrap may emit a WebKit module-load error; it is recorded separately from unexpected errors.

Physical iPhone, Safari application UI and screen-reader speech remain unverified. Browser WebKit coverage is not physical Safari acceptance. No account sign-in, model call or private library writes are part of this task.

## Release

`npm run verify:deploy` passed in the restricted environment used by the release verifier: 4,251 tests passed, 14 skipped, zero failures; isolated runtime construction, hosted build, public asset checks, release allowlist and provenance checks passed. The worktree uses its own installed dependencies. Early exploratory runs using a symlinked dependency tree were interrupted and superseded by this complete clean run.

Remote CI, merge and matching-commit production acceptance are separate gates; see the final PR release status for their outcome.
