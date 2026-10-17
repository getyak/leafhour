# GET-142 private reading room: design acceptance and handoff

Date: 2026-10-17. Examined source: `3851459ca0ce66a7ab93450ae4d6889f55f42b1e` in public `getyak/leafhour`. This is acceptance of the original design handoff, not a claim that the historical preview is the current hosted application or that a technical reviewer supplied a new human visual approval.

## Direction and authority

The 2026-10-11 [reader design](../../_briefs/reader-demo.md) is a dated proposal. Its explicit requirements remain useful: source/translation/parallel views, independent literal/interpretive translations, paragraph-level correspondence, selectable text, optional attributed notes, and a private route back to one's own comments and questions.

The [product brief](../../_briefs/product-brief.md) records the user's two reading goals: language learning may start from the source; deep reading may start from a familiar preferred language. It also separates the reading goal, language and translation variant, asks for a personal reading room and portable records, and treats AI output as a candidate rather than proof of understanding.

Later recorded decisions supersede the old assumption that implementation has not started. [AGENTS.md](../../AGENTS.md) records explicit 2026-10-12 authorization to implement the four reading stories and bounded official DSH echo. The [four-story contract](../../_briefs/four-reading-experiences-implementation.md) and [brand launch verification](2026-10-16-leafhour-launch.md) describe their respective actual scope and later release evidence. The 2026-10-16 Leafhour branding and reading-Agent/companion authorizations have their own boundaries; none approves all translation drafts or expands this design task into paid generation or notifications.

This record therefore preserves three distinct categories:

- **Explicit user direction:** the requirements and dated implementation authorizations recorded above.
- **Observed design behavior:** the isolated historical preview checks below, including the old Marginalia/旁读 name and prototype-only controls.
- **Current product implementation:** exact dated runtime/release records, separately verified under their own tasks. A proposal for React/SQLite is not grounds to replace the later documented Node/JSON implementation.

There is no invented quote saying the user approved every pixel. The current delegated delivery continues the recorded direction and reports the demonstrated behavior and limitations precisely.

## Flow and fixed acceptance results

The flow under test was: existing `_briefs/preview.html` → read/switch/inspect/comment → preserve the same source passage and distinguish prototype behavior from real service effects.

The acceptance table was frozen in [the execution plan](../superpowers/plans/2026-10-17-get-142-design-acceptance.md) before browser testing. The existing preview HTML and its three implementation scripts were copied byte-for-byte into an isolated loopback fixture server. No product or preview runtime code was modified for these results.

| Surface or condition | Observed result | Handoff |
| --- | --- | --- |
| My library | Shows the one explicitly labelled four-paragraph sample and a continue-reading entry; no fabricated shelf | The old sample is a prototype, not an inventory of the real hosted library |
| Reader | Source, translation and parallel controls work; four stable passage IDs remain paired | View and translation variant are independent; an English paragraph override remained English after switching the other Chinese passages to literal |
| Learning goal | Selecting language learning switches to the source view and retains the chosen literal variant | A reading goal changes the default view, not the source text or translation ownership |
| Select text | Drag-selecting Chinese prose preserved Chinese mode and the exact paragraph text | Selection is not a paragraph-flip command |
| Terms and annotations | Opening a term preserves the paragraph; visible content says editorial supplement | Close with Enter returns focus to the original term button; explicit paragraph flip is keyboard accessible |
| My records, empty | Explains that there are no personal records and directs back to the text | An empty state is not a fabricated AI answer or an empty cloud-account claim |
| Personal comment and question | Synthetic user text, including literal `<em>` markers, is displayed safely as text; comment is private user wording and question is unresolved | Both retain the source passage anchor. No HTML element was created from the user text |
| Close personal record | Escape hides the panel and returns focus to that passage's comment opener | Preserve this behavior when rendering or moving the panel at different widths |
| Invalid import | An incompatible synthetic JSON record package is visibly rejected | The existing one synthetic comment and one question remain unchanged; no successful-import claim |
| Missing translation | A separate synthetic reading package displays “本段译文尚未完成。” | The explicit original-text control works with Enter and reveals the intact synthetic source; no invented translation |
| Data and Agent | File selection, local record export, share preview, separately scoped grant preferences and daily preference are explicitly labelled prototype-only | These controls do not establish parsing, cloud storage, an installed MCP host, a real schedule or a sent notification |

## Responsive and keyboard contract

Actual browser viewports were **390×1000, 768×1000 and 1440×1000**. For both parallel reading and the personal-record panel, document widths equalled viewport widths: **390, 768 and 1440**. Each of the four parallel units contained the same passage ID with English and Chinese renderings. At narrow widths, paired content stacks in reading order and the personal panel moves below the passage; the source, translation and personal controls remain available without horizontal document scrolling.

Primary reading controls use real buttons/selects. An explicit flip button works with Enter; closing editorial notes restores the term opener, and Escape closes personal records and restores the corresponding comment button. Selection and term clicks do not flip the prose. Source identity must survive view/variant changes; layout movement is not a reason to substitute a scroll percentage for a passage anchor.

These are browser viewport checks, not real-device, screen-reader, OS-level text selection, or comprehensive accessibility certification. They do not establish full-book position persistence or production account isolation, which belong to their runtime tasks.

## Prototype, content and service boundaries

The historical preview intentionally uses a labelled four-paragraph sample. Its translation and editorial wording remain design drafts; the source review labels apply only to that sample. They do not certify a full book, all OCR, all translations, or a user's understanding.

Personal preview comments/questions use browser-local prototype storage. The test used only a synthetic comment and question at a fresh loopback origin. No default or other real account was logged in or read; no actual book was uploaded; no model, email, MCP host or notification operation was initiated. The missing-translation package was synthetic test input through the real preview loader, not an edit to application state or a fake model response.

Both preview console observations contained no captured error/warning entries. Optional private full-book assets were absent from the baseline, and the labelled sample remained usable; this does not authorize adding private reading content to the public repository. Main service acceptance is separate: see [the actual launch record](2026-10-16-leafhour-launch.md), [reading-room verification](../reading-room-verification.md), and the current task-specific runtime records. Their own untested or provider-review limits remain intact.

## Evidence and delivery

Sanitized screenshots, accessibility snapshots, DOM width/passage/focus observations, file hashes and synthetic import results are retained in this task's local evidence directory outside the production release. `preview-evidence-manifest.json` binds them to the examined source. No credentials, private-library fingerprints, full copyrighted book, private user record or runtime evidence directory is added to this public documentation change.

Local checks, independent review, PR head checks, merge and applicable existing release receipts are recorded separately as they complete. This document does not by itself mark downstream GET-143–GET-155 complete or silently waive their acceptance criteria.
