# Shared navigation on public support documents

Date: 2026-10-28 (Asia/Singapore)

## Cause and change

The privacy and Agent guides still shipped eight independently authored headers. Home and commerce had already adopted `public-navigation.mjs`, so the support pages omitted current destinations and kept a full language strip in the header. Privacy also placed its search launcher before the brand. This was reproduced in the public `/privacy?ui=en` response and in a Chromium browser.

Support sources now contain header and menu slots. `portalDocument` fills them with the current public navigation before JavaScript runs. The self-hosted route and hosted build use that same renderer for all four locales, including the English aliases. The authored main content, metadata and footer remain intact. A small public-only bootstrap reuses the existing menu controller; it does not load the private library or billing controller. The new bootstrap is included in the release allowlist.

The header keeps the brand first, current public destinations, reading-room access, a compact search action and the existing language menu. Narrow screens use a short reading-room label; language links remain available in the document footer as well.

## Verification

- Regression test first failed against the old support header, then passed after the change.
- Focused navigation, support-route and commerce-build suite: 37 passed, 0 failed.
- Independent review: no blocking findings; independently ran the three new regression tests and checked 320px/1024px, menu destinations, Escape focus return and console errors.
- Chromium checks covered English, simplified Chinese, traditional Chinese and Japanese support routes at 320px, 768px and 1440px; English was also checked at 390px. No horizontal page overflow was observed.
- Menu opening, close button, Escape, return of focus to the trigger, language navigation from English to simplified Chinese, and the asynchronous search palette were exercised in the actual browser.
- Main content is compared byte-for-byte with its authored source by the route regression test. Static packaging covers all eight documents and both English aliases.

Images: [desktop](2026-10-28-public-navigation/privacy-desktop.png), [mobile](2026-10-28-public-navigation/privacy-mobile.png), [menu](2026-10-28-public-navigation/menu-mobile.png), [night](2026-10-28-public-navigation/privacy-night.png).

The first local full release run was terminated with exit 143 after 616 passing subtests, before a final suite result; it is not reported as a passing full suite. The required CI gate must complete the full checks before merge. Production acceptance is recorded on the PR after the deployed source commit is verified. Safari, VoiceOver and physical-device testing were not performed for this change.

## Copy evidence maintenance

The old static review records `candidate:app/en/privacy.html:19:91` (search) and `candidate:app/en/privacy.html:19:605` (header return link) referred to the removed independent header and were retired. The unchanged content return link retains its exact value hash and was rebound to its new source location and source-file hash. The shared header's newly discovered literals remain unknown candidates; this task does not claim a new human review, a legal-notice review or a whole-site copy review. Generated copy inventories are refreshed for the current input bytes; lint allowances and debt exemptions are unchanged.

## Completed local release checks

- Real pinned copy-tool tests: 39 passed, 0 failed, 0 skipped.
- Copy export and lint: passed; warnings and existing debt remain visible. No allowances or debt exemptions were added.
- Reading runtime built and initialized: 928 files, 9.0 MB, without model requests.
- Hosted static build and public-content checks: passed (564 public files, 12 registered media assets).
- Release allowlist and asset/source-provenance checks: passed (1,196 software files).
