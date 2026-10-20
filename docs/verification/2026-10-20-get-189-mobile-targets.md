# GET-189 mobile targets

## Baseline and design

Base: `8c4dd18b8c7e6a04de74c12246306f4772a4dc7e` (public main). A real Production Chromium audit at 390×844 found 10 targets below 32px on home, 6 on MCP and 6 on privacy. The library All state button was 15.109375px wide and 44px high. There was no horizontal page overflow.

The existing typography, paper/night colours and action hierarchy stay in place. At the existing ≤760px breakpoint, language links, FAQ/support-document links and the support header command button occupy at least 44×44px in normal layout. Library reading-state buttons also receive a 44px minimum width; the search-clear button receives a 44×44px minimum. The command trigger keeps the existing 7px text/keycap spacing. There are no pseudo-element hitbox overlays over adjacent prose. Desktop layout is unchanged. Larger link lines are intentional spacing for tapping, rather than larger text or additional interface labels.

## Verification status

- Existing component foundation, HTTP surface, home navigation and library filter tests: **49/49 passed**, zero skips.
- Actual local server: **16 page/locale combinations, 588 targets; zero targets below 44px and zero horizontal page overflow**. Expanded search revealed an additional 30×42px clear button; that was fixed and the search/filter/login surfaces passed native checks.
- Native lower-right-edge clicks successively selected English, Simplified Chinese, Traditional Chinese and Japanese. Menu, populated search, filter popover and login-dialog layouts passed. Nine actual screenshots were visually inspected; final MCP command open/Escape/focus return and system paper/night checks passed.
- Independent agent review passed the initial CSS, the search-clear correction and the final 7px spacing correction, with no confirmed P0/P1/P2 remaining. Independent test batches: 42/42 and 26/26; the last spacing-only review did not repeat tests. The parent reran the 49 relevant tests on the final CSS: 49/49, zero skips.
- [Native receipts and screenshots](2026-10-20-get-189-native/README.md) distinguish the 44px source snapshot from the final header-spacing-only snapshot. Final CSS SHA-256: `e4541a16ecec82d88015653e93d2d0e87603bda426bb619d02c82a874d6ba445`; cumulative product-diff SHA-256: `ca18f4c2b12259ed120a50f5d6a21bbcc3c4a07235076a64c3fbd06a0ae9cdb9`.
- PR [136](https://github.com/getyak/leafhour/pull/136) merged as `ec70349f2da421d532153bb3a9ac532b31d67a4f`; current-head CI passed 2385/2385 with zero skips, main CI and exact-commit Production passed. The first live matrix was **not accepted**: six language-load recovery controls were 38.47×44px; some home/library rows were sampled before their real cards settled. Zero targets below 32px did not satisfy the required 44px target.

## Recovery follow-up

The shared mobile language-error notice now uses the existing paper/ink, border and shadow tokens in a compact wrapping card, 16px from the viewport sides and above the bottom light control and safe area. Its Retry and Reload actions both have a 44×44px minimum. Explicit hidden-state CSS retains the runtime’s existing visibility contract; no focus, locale state, request, retry budget or desktop layout logic changes.

Native fault injection also found that the former unstyled page-bottom Reload action was intercepted by the light control. That failed attempt is retained as diagnostic evidence and is not a passing recovery receipt. The follow-up must pass real pointer Retry and exhausted-budget Reload without forced clicks.

Post-merge acceptance waits for a successful real library API response, verifies the home’s three public book IDs and every library card across native incremental batches, then checks effective locale, fonts, target sizes and overflow. A recovery through native Retry is recorded explicitly; loading placeholders cannot qualify as the settled matrix. Follow-up review, CI, merge and exact-commit Production acceptance are pending.

The checks use Chromium viewport emulation and real native pointer/keyboard controls; they do not claim a physical phone, VoiceOver or user-study result. No product model service is called. Source documents and link destinations are retained literally.

The recovery follow-up passed 39/39 existing component/HTTP/locale-transaction tests (zero skips), plus the independent reviewer’s 21/21 foundation/typography tests. Independent review of product diff `283cf62861e37cd59d9d1437938e8f91014d931cd386b0a5b1dfc09901dc0428` found no remaining confirmed P0/P1/P2. Real local Retry→exhausted Reload→successful reload and separate Retry→successful fixed variant both passed; screenshots and measurements are linked above. This does not close the pending full CI and Production gates.

The corrected **local** matrix passed all 16 page/locale combinations with **872 visible enabled targets**, every target at least 44×44px and no horizontal overflow. All four library pages rendered all 30 books, matched against each successful actual API response; home rendered the three matching public books. Every row finished with the requested effective locale and loaded fonts. This larger count includes the complete incremental shelf rather than the earlier partial shelf. See `local-settled-targets.json`; Production remains a separate gate.
