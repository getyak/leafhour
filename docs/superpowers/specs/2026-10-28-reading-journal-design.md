# Reading journal and unified reading tools

Date: 2026-10-28. The user explicitly delegated design decisions and implementation, without confirmation. This is an implementation specification, not evidence of completion.

## Intent

Make time with books visible and revisitable, give personal notes a home across books, and restore quiet to the reading surface. Retain Leafhour’s existing paper, typography, colors and account boundaries.

## Approaches and decisions

Considered an achievement dashboard, a chronological reading journal, and separate widgets. Select the journal: a month of actual days, a restrained duration hierarchy, and source-linked details. Avoid badges, fabricated streaks, mastery claims and competitive rewards. The monthly footprint is visible on the shelf; its detail dialog remains available.

Notes use an independent library section/modal with search and book/type filters, full user-authored text, date and return-to-passage links. Reuse existing comments/questions/highlights and their edit/export services. Do not introduce a second source of truth or include generated answers as personal writing. “All notes” means across accessible books, not merely the current book. No private notes enter model context.

Reading tools become one explicit floating entry. It exposes useful grouped actions: contents, appearance, notes, reading conversation and listening; advanced timing/manual entries belong below a secondary disclosure. Reuse the same buttons/controllers and keep selection tools contextual. Opening a tool closes/hands off the hub; Escape and focus return remain predictable. No hover-only essential controls.

## Visual system

Use current interface tokens, local book serif and interface sans. Ink and green identify reading/selection, surface and hairlines organize sections. One large duration or date anchors a panel; no repeated statistic cards. Seven equal calendar columns; selected date has a shape/border as well as color. Notes are readable rows with whitespace and original source metadata, not masonry cards. Mobile reflows rather than scaling desktop.

## Functional constraints

Time uses existing merged foreground/focus/manual source intervals and local calendar timezone; show source breakdown in details. Background time and agent access remain excluded. No data migrations, paid generations or pushes. Shared images are local, deterministic outputs with an explicit preview, disclose selected day/duration/book selection and never silently include note text or questions. Keep source title strings unmodified. All new copy has four locale values. Owner change clears pending requests and rendered personal data. Loading, empty, error/retry and deleted/unavailable source states must be explicit.

## Benchmarks and acceptance rubric

Benchmarks are reference behaviors, not claims of product equivalence: Apple Books reading goals and sharing (https://support.apple.com/en-ie/guide/iphone/iph6013e96f4/ios), Readwise highlights/notes (https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes), W3C target size (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) and focus appearance (https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance).

Each of the three deliverables is graded out of 100: task completeness 30, clarity/visual hierarchy 25, interaction/accessibility 20, data accuracy/privacy 15, responsive/recovery 10. Target at least 98 for each, but report observed scores honestly. Any data leak, fabricated time, lost saved note, keyboard trap, broken primary action, or narrow-screen overflow blocks acceptance regardless of score. Aesthetic scoring is an internal judgment, not user-research evidence.

Calendar: seven columns, month/day understood, a day opens actual reading and notes, source return works, no fake accomplishments, share image matches preview.
Notes: cross-book retrieval, search/filter, user/generated distinction, dates and source return, safe edit/export where existing services allow, no stale identity results.
Tools: one primary floating tool entry, commonly used actions at most two actions away, secondary controls progressively disclosed, no hidden focused element, selection and page turning unaffected.

## Verification

Behavior tests for aggregation/filters/privacy/race conditions, existing regression suite, release-policy/build/copy checks. Real browser journeys at 1440, 768, 390 and 320 CSS pixels, keyboard/Escape, reduce-motion, light/dark, empty/error/owner change. Record actual screenshots and limitations separately. Commit only this task, open public PR, wait for current CI, merge normally, wait for production and verify same commit at leafhour.com. Do not create preview deployments.
