# Library bookmark and imported covers

The library now shows a compact bookmark above the complete shelf for the latest unfinished book with a saved passage. It links to the stable passage, displays its saved chapter, and keeps shelf ordering and filtering intact. Metadata-only loading cannot claim a current book. Account transitions clear the bookmark synchronously; repeated hydration rebuilds it. First hydration at the top does not scroll the bookmark away.

Private EPUB books reuse embedded EPUB 3 `cover-image` or EPUB 2 `meta name="cover"` PNG/JPEG artwork. Private PDFs reuse the first page through the existing PDF.js renderer. Extraction happens on first image access, so previously imported originals work without reimport. Missing/unsupported artwork retains literal typography. No cover lookup or model request is added.

Derived WebP images are bounded to 640×960 and 1 MiB. ZIP/CRC/path checks are shared with EPUB import; raster byte and dimension checks precede native decoding. SVG and remote sources are not decoded. Originals and source passages are unchanged. Owner-scoped index metadata authorizes every cache read without loading full book text, translations or introductions. The route uses session authentication, `private, no-store`, and `nosniff`; cache files stay in the owning account's private directory.

Validation completed before PR:
- Real EPUB 2/3 and PDF fixtures verified artwork, source-byte preservation, fallback, repeated access, metadata-only cache reads and cross-account denial.
- Real HTTP checks verified authenticated WebP responses, anonymous rejection, owner mismatch rejection and cache headers.
- Chromium checked English, simplified/traditional Chinese and Japanese, desktop 1440px and phone 390px: saved-passage links, refresh, first-hydration scroll, keyboard navigation and account clearing; no page errors or horizontal overflow. Synthetic imported material was used locally.
- Independent review found and resolved metadata hydration clearing, miniature fallback typography and redundant full-book thumbnail reads. No remaining blocking finding.
- Runtime, hosted build, public-output inspection, release allowlist and the real pinned copy linters passed. Existing documented copy debt remains visible.
- Initial full local runs exposed Node 24/26 reporter differences in an existing annual-billing test, plus new-style checks and isolated DOM fixture wiring. Those styles/fixtures were corrected and the relevant tests passed with checksum-verified official Node 22.23.3, matching the production version. A final full verification is in progress.

Physical iPhone, Safari and screen-reader speech remain unverified. CI, merge, deployed source revision and production browser acceptance are recorded separately after they complete.
