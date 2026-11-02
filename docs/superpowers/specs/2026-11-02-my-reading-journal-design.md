# My Reading journal

The user approved the generated reading-handbook layout on 2026-11-02 and requested more tactile interaction and small moments of delight. Implement in the existing native iOS app; retain the web workspace and existing data services.

## Experience

- Replace the third Settings tab with 我的阅读, using `book.pages` and an explicit text label. Preserve Library and Chat. The avatar opens the existing settings in a dismissible sheet.
- The journal uses the existing adaptive paper and ink colors, serif headings, generous whitespace and fine rules. Its three sections are 概览, 日历, 笔记. No generated placeholder records enter the product.
- Overview shows the last seven actual calendar days, including month boundaries, as book-spine time bars. Tapping a spine opens that day's books, time and notes. Calendar supports month navigation and day selection; notes support search, attribution, pagination and return to a verified source anchor.
- The account journal and device journal are separate selectable scopes. This avoids adding overlapping cloud totals to local copies or silently omitting device-only work. Device data always comes from the active OfflineLibrary, including saved drafts. Unknown draft dates remain undated.
- Settings retain account, reading style, synchronization, saved summaries and data capabilities. Reading appearance remains available within the reader.

## Motion and accessibility

- Once on arrival, book spines rise in a short stagger (under 600 ms total). A pressed spine gently compresses; its selected indicator slides. Section underline follows selection; day detail uses a native navigation transition. Buttons have restrained spring feedback and selection haptics.
- No perpetual animations, randomized achievements or model calls. Reduce Motion removes offsets, scale and stagger; all controls work with VoiceOver and accessibility text sizes. Every meaningful target is at least 44 pt. Content and quotes stay selectable.

## Data and recovery

Use the existing reading-summary/notebook endpoints and owner-scoped caches. Monthly responses are validated before display. Initial failure is distinct from an empty journal; refresh failure retains the last snapshot, pagination cursor, query and selection. Cancelled or stale requests cannot cross accounts/scopes/months.

Local days split and union actual reading intervals using the viewer's calendar/time zone, including DST and midnight. Do not infer reading from notes or page opens. Cloud day totals are already overlap-merged by the service. Missing dates/anchors remain unknown, and changed source versions cannot jump to a guessed passage.

## Delivery

One issue GET-358, separate commits for data, interface and validation, one PR. Run focused Core/app/UI tests, review independently, pass applicable exact-commit CI and merge normally. Follow the existing TestFlight release; Apple processing, install availability and physical-device acceptance remain distinct.

## Approaches

Chosen: a first-class personal reading journal with settings under the avatar, following the user-approved image. Keeping records inside Settings retains the discovery problem; a generic profile dashboard gives account management too much emphasis. No new backend storage or alternate design system is needed.
