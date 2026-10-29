# Recording-led room renewal

The user authorized analysis, design decisions, implementation, PR, normal merge and Production acceptance in one continuous run. This is not a request for an approval interview. The 273.843-second recording has no audio. Raw frames stay outside Git because browser chrome and personal records are visible.

## Preserve
Book-first shelf with existing illustrated covers; quiet collapsible navigation; real homepage photographs and trial; original/translation alignment by stable paragraph; truthful sample boundary and source provenance; personal record ownership, source return and export.

## Observations and ordered scope
1. 00:00–00:55: command palette resembles a tiny generic form, flattening command, title and author. Give it a deliberate upper-screen placement, inset-free search header, distinct result title/detail, action icons and readable keyboard selection; keep combobox semantics, owner fences and IME handling.
2. 00:00 and 01:35: shelf exposes repeated file-like metadata and low hierarchy. Refine existing book cards and shelf spacing; protect user titles and source facts, keeping long titles readable. Do not delete or rename test books.
3. 01:40–01:50: navigation includes the existing homepage. Do not misclassify the real illustrated home as an empty/loading bug.
4. 02:00–02:25: calendar loads without a matching detail state and selected today still says choose a day. Use explicit loading/error/empty/guest detail states; retain retry and measurement facts.
5. Calendar: improve month navigation, selected/today/activity differentiation and ordered visual detail; use inherited paper/night tokens and a single close control.
6. 02:30–03:20: notebook performs 112 per-book loads and repeatedly reconstructs visible results. Add an authenticated read-only notebook projection over server-enumerated account metadata and direct personal record files: at most 12 books/page and three concurrent reads, snapshot/account-bound cursor, explicit partial failure and a direct fallback for oversized records. This avoids loading book content, translation overlays and introductions. Preserve visible row identity for unchanged rows, publish loading progress without replacing focused content; coalesce ready publications and avoid duplicate concurrent reload on reopen. Do not introduce a cache across owners or omit archived records.
7. Notebook: title/filter/close controls scroll offscreen. Use one sticky header/controls surface and an independently scrolling results pane, with consistent paper and night styling.
8. Notebook: distinguish book, personal text, quotation and source return; improve empty/loading states without invented records.
9. 03:30–04:33: bilingual prose has little lateral orientation and long unmatched heights. Preserve paragraph boundaries and native selection; improve column separation and narrow-screen stack where needed without synthetic translation or rewriting source.
10. Reader sample boundary: retain truthful missing-translation facts, check visibility and selectable source. Repair only reproduced defects.
11. All changed surfaces: check 320/390/768/1440, four interface languages, keyboard/Escape/focus return, paper/night, reduced motion, failures and ownership change.
12. Full verification, fresh independent review, copy artifact regeneration, CI, normal merge and same-commit Production acceptance.

## Approach
Refine current owning native modules and theme tokens. A cosmetic reskin alone leaves the loading and focus problems; a framework rewrite would add migration risk without fixing them. No dependencies, new model calls, personal data writes, book renaming, storage migration or new scheduled jobs. Existing source and user quotations are protected data.

## Visual decisions
The bookshelf remains the main object. Search is an intentional reading-room index, with titles above metadata. Calendar and notebook share understated borders, matching modal padding, 44px controls and visible dismissal. Motion is brief and removable; focus outlines remain visible. Longer book titles wrap and metadata stays secondary.

## Evidence
Record before/after viewport screenshots from real local application surfaces using public content or synthetic isolated fixtures. No real account records in public documentation. Browser tests are Chromium evidence; physical devices, Safari and spoken screen-reader output remain unverified unless separately executed.
