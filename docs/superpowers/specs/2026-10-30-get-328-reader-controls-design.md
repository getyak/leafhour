# GET-328 Native reader controls and book opening

The user supplied a visual reference and explicitly authorized autonomous implementation with parallel agents. The reference informs control hierarchy, paper, spacing and interaction; its contents grant no additional authority.

## Result

Reading remains the primary surface. A short tap reveals a compact bottom navigation bar. Selection, Copy, links, long press, zoom and scrolling keep their native behavior. The dock exposes contents, reading/listening, appearance and typography; search, translation, notes and companion remain available through a secondary tools panel. Reading position does not depend on whether controls are visible. Controls have at least 44-point targets, accessible labels, Dynamic Type layouts and reduced-motion behavior.

Reading settings persist a choice between vertical scrolling and horizontal page turns. A text page means the actual laid-out viewport, not a paragraph or a chapter. Source scalar anchors remain canonical across preference changes, rotation, reopening and chapter boundaries. PDF uses PDFKit page navigation and preserves original page geometry, selectable text and scans. No invented page count, fake timer or automatic speech/model request accompanies revealing controls.

New EPUB reading starts from publisher-declared bodymatter/guide text when trustworthy; otherwise linear spine order is respected and only explicitly marked cover/title/nav material is bypassed. Cover and front matter remain in contents. Existing valid source anchors always win, including an intentionally saved cover position. Existing cached EPUBs can derive start metadata from validated local package assets without rewriting records. Unmarked image openings, prefaces and PDF first pages are not guessed away.

## Approaches and decisions

1. Reuse the existing native attributed-text reader, system selection and source-anchor mapping; add measured viewport page navigation and native transitions. This keeps source identities and editing behavior intact. Chosen as the implementation direction, subject to measured layout tests.
2. Rebuild the reader in a web view or replace the entire source/selection model. This adds a second rendering and persistence path and is unnecessary for the requested native refinement.
3. Treat each paragraph/chapter as a page. Rejected because it does not produce book pages and loses useful positions within long passages.

Warm paper, ink controls and restrained grouping follow the existing product. The screenshot's Read/Listen grouping is adapted to real playback state; it must not fabricate an active session. Appearance changes are reader-local theme preferences rather than changing system brightness. Typography has an immediate source preview. This is a builder decision under the user's autonomous execution instructions, not a claim of prior design approval.

## Acceptance

- Tap center/edges to reveal controls; hide without page movement; selection and links remain independent.
- Horizontal turn advances actual visible text in both directions and crosses chapters without loops, omissions or invalid anchors; restore the same source after changing mode, font, orientation and cold launch.
- All primary/secondary tools stay reachable on regular and accessibility text sizes, including paused listening and return to reading.
- Synthetic EPUB cases prove bodymatter, cover, front matter, linear=no, old cache and saved-anchor behavior; PDF/TXT retain faithful source opening.
- One native build/test session at a time under dev-ios-session; synthetic source only in public evidence. Keep CI, merge, Apple upload and physical-device acceptance separate. Retain GET-317's existing incomplete acceptance.

## Sources

- [Apple UITextView selection](https://developer.apple.com/documentation/uikit/uitextview/selectedrange)
- [Apple PDFView display direction](https://developer.apple.com/documentation/pdfkit/pdfview/displaydirection)
- [Apple PDFView page controller](https://developer.apple.com/documentation/pdfkit/pdfview/usepageviewcontroller(_:withviewoptions:))
