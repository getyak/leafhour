# Format-aware chapter import

Scope: improve new TXT, Markdown, EPUB and PDF imports on web and native. Never silently reparse saved books or rewrite their passage IDs, notes, source bytes or progress. No models, OCR service, private sample publication, new format claims or capacity changes.

Root causes: web TXT/MD only blank-line splitting plus arbitrary 30-paragraph groups; native TXT/MD single chapter; web EPUB ignores NCX; direct PDF extraction omits bookmarks.

Approach: retain existing bounded format adapters and add format-specific structure recognition. A generic regex on already flattened text cannot recover headings sharing a paragraph with body. Replacing the complete pipeline would expand deployment and data migration scope unnecessarily.

TXT: normalize line endings; recognize short standalone Chinese chapter/volume titles (including full-width numbers), English Chapter/Part/Book plus Arabic/Roman/written numbers, and explicit prologue/epilogue labels. Reject ordinary sentences, running prose and TOC lines with page leaders. Suppress duplicate front TOC headings when later body occurrences exist, preserving all text. Preserve front matter. Never discard tail text. Single real heading allowed; no artificial source chapter names when no structure exists.

Markdown: use CommonMark 0.31.2 JavaScript reference parser on web and existing cmark on native; top-level ATX and Setext headings; preserve raw source including lists, blank lines and fenced code; code, indented code and HTML contents must not create chapter entries. .markdown alias supported consistently. Native uses existing CommonMark parser where possible.

EPUB: EPUB3 nav then EPUB2 NCX then spine. Resolve fragments safely; incomplete nav must not merge unlisted spine documents into the preceding chapter. Keep original spine order and stable anchors; respect current archive and content limits.

PDF: direct import and native-recognition path use source bookmarks where available; preserve pages and paragraph identities; malformed optional bookmarks must not prevent readable text import. Native PDF retains page-based rendering and actual outline navigation if supported by existing reader.

Verification: synthetic public-safe inputs for Chinese/English titles, TOC duplication, CR/LF, Markdown code/table/list preservation, EPUB2 and partial nav, real PDF bookmarks, duplicate upload and source evidence. Run web suite/build and native core tests plus simulator build when affected. Ship one reviewed batch via PR and normal merge after CI. Production and native distribution verified/reported separately.

References: [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), [EPUB 3.3](https://www.w3.org/TR/epub-33/), [PDF.js document API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html).

Review correction: unverified existing native text indexes cause repair to stop before publishing; retained originals and records remain intact. This prevents silent anchor migration. Public catalog projections retain the historical parser explicitly.
