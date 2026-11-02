# Format compatibility verification — 2026-11-02

Integration baseline: `4de2d7fae2ebd4169d81af9c6f38841468008d75` (quiet reading changes); generated copy inventory conflict resolved by exporting the combined source. Native source ranges and renderer integration rechecked.

Scope: new TXT/Markdown chapter recognition on web and native; web EPUB2/EPUB3 navigation and PDF bookmarks; chapter labels/counts; retained-source evidence. No existing book is automatically reparsed and no private source is included here. Design and implementation plan are in `docs/superpowers/specs/2026-11-02-format-compatibility.md` and the matching plan.

## Behavior

- TXT recognizes bounded Chinese chapter/volume markers, full-width numbers, spaced/decorated markers, English Arabic/Roman/written chapter numbers, and explicit opening/closing sections. Front matter and duplicated front TOC text remain in the source; duplicate TOC entries do not replace body boundaries. Running prose and page-leader entries are excluded conservatively.
- Web Markdown uses pinned CommonMark 0.31.2 reference AST, native uses existing cmark. Only top-level nonempty headings form chapters; ATX/Setext, multiline titles, fenced/indented code, nested lists/quotes, HTML and literal inline source are covered. Raw text remains the source; directory labels are bounded. `.md` and `.markdown` pass picker, deferred job and extraction boundaries.
- Web EPUB prefers usable EPUB3 nav, then EPUB2 NCX, then spine. Relative fragments and nested NCX entries preserve reading order; partial navigation retains unlisted document starts. Existing archive, entity, traversal, encryption and size rejection stay in place.
- Direct web PDF import now shares its outline resolver with the native-text extraction service. Integer, reference and named destinations are supported; unresolved optional bookmarks do not block readable text. Blank-page bookmarks coalesce at the next readable paragraph. No OCR or paid model was invoked.
- Imported source chapters no longer appear as appendices or count as zero chapters. Bundled public catalog passage IDs/translation overlays retain their explicit historical projection. Historical-projection tests now request that old parser mode explicitly.
- Source evidence uses decoded LF-normalized offsets for newly parsed text, avoiding accidental first-occurrence lookup for repeated passages. Original file bytes stay unchanged. Native duplicate imports retain their saved index; repair refuses an unverified existing TXT/Markdown index before writing anything, preserving originals and private state instead of silently creating new anchors.

## Evidence

- Final Node 22.23.4 `npm run verify:deploy`: 4,553 tests, 4,539 passed, 14 explicitly skipped, 0 failures; runtime/build/public/release checks passed. Skipped optional checks are not claimed as verified.

- Final affected web integration: 63/63 passed, including the long-title regression, catalog compatibility, deferred uploads and dependency evidence. Independent format checks: 32/32 passed.
- Independent review: no remaining P1/P2 findings after fixes. CommonMark's [official 652 examples](https://spec.commonmark.org/0.31.2/spec.json) were checked against expected top-level nonempty headings: zero count differences; original offsets and non-whitespace content conservation also matched. A synthetic 10,001-chapter Markdown input retained its tail (about 72ms in the review process; this is a local observation, not a production performance guarantee).
- Native final `swift test --package-path apps/ios/LeafhourCore`: 279 tests, 1 explicit optional private-sample skip, 0 failures. Generic iOS Simulator build: `BUILD SUCCEEDED`. Review reproduced and closed old-index repair, prose-title and source-range issues.
- Browser acceptance: isolated local server with synthetic content and identity, no production data or model access. Contents showed front matter, Chinese/full-width chapter titles and epilogue; clicking the second chapter updated the title/current position and displayed its corresponding source paragraph. The existing contents visual style was retained.
- Packaged runtime, hosted web build, public build and release allowlist checks passed. Real pinned Vale/textlint copy lint passed with documented existing debt retained.
- New parser and transitive dependency licenses are included in the frozen 821-package inventory; its technical evidence check passed. This is not a new legal approval.

## Limits

TXT chapter detection is heuristic; sources with no explicit markers retain the existing fallback. Source encoding and file capacity policy are unchanged. Existing imported books retain their old structure until a separate safe reparse/migration flow is implemented; reuploading identical bytes keeps the existing saved book. Corrupt native text indexes require recovery rather than silent reindexing.

Native EPUB remains organized by spine XHTML files and native PDF by pages; this change does not claim native NCX/bookmark contents projection. Native code is build-tested, not distributed to installed devices or verified on physical hardware. Web PR, CI, merge and production status are recorded by their actual GitHub checks and delivery report separately.
