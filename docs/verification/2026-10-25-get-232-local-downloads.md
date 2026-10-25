# GET-232: local PDF and Markdown downloads

The issue title explicitly requests PDF and Markdown local downloads. Its description and relations were empty when read on 2026-10-25. `exxx` has no defined meaning; no additional format is claimed under that name. Existing JSON and ZIP portability remain available.

## Behavior

- A book's More actions menu and the reader's book information panel open the same export controls. The user chooses the whole book or a chapter and original, literal, interpretive, or all text layers.
- Markdown downloads contain actual UTF-8 text. PDF downloads contain a paginated PDF with embedded fonts and selectable/searchable text. Source identity, edition, scope, credits, copyright and licence notices accompany the chosen content. Translation drafts retain their status; missing translations retain the original and an explicit missing state.
- Book exports traverse book content only. Private notes, conversations, account settings and grants are excluded. Personal records retain their separate explicit selection/preview flow, now with PDF alongside JSON and Markdown.
- All PDF construction happens in the browser. Font and software assets are served from the same origin. No document upload, external conversion, model request, or subscription check is introduced.
- Existing book authorization and owner guards protect a bounded, hash-checked book transfer. Closing the dialog, switching owner or cancelling invalidates late work. Unsupported font glyphs report a failure and offer Markdown; no incomplete PDF is reported as downloaded. A status says the download was requested, since the browser/OS controls the final save.

## Verification

Local synthetic data only; no real account records were modified.

- Browser saved `导出驗證・読書-ch01.md` (UTF-8) and `导出驗證・読書-ch01.pdf` (PDF 1.7, 24,688 bytes). The selected first chapter contains English, simplified Chinese, traditional Chinese and Japanese, both distinct translations and their statuses, source/copyright and stable paragraph IDs. It excludes chapter two and private notes.
- Browser saved `Personal records.pdf` (13,089 bytes) after explicitly checking one synthetic note and previewing it. Text extraction confirmed the note is present and unselected original text is absent.
- PDF.js extracted all four language samples from the actual PDF. Poppler rendered the actual browser download for visual inspection; glyphs and layout were visible without overlap.
- English, simplified/traditional Chinese and Japanese controls were inspected. The Japanese reader export was exercised at 390 × 844; document width stayed 390, and Shift+Tab returned focus to the text-layer selector.
- Automated tests cover chapter/layer scope, missing translations, incomplete source rejection, copyright retention, paginated four-language PDF text, cancellation, retry, stale owner/closed dialog, static asset bytes and authenticated book boundaries.
- The first browser PDF attempt exposed a local static JSON serialization bug. A regression test failed on the serialized Buffer; the corrected response returned the actual font manifest and browser PDF download then succeeded.
- Direct WOFF2 subsetting with the older PDF font engine failed. Static TTF derivatives of the existing OFL fonts passed extraction and rendering. Runtime assets and reproducible generation are documented in `app/fonts/document-export/README.md` and `app/vendor/README.md`.

## Evidence and limits

Local download, screenshot, rendered-page, extraction and command evidence is retained under the task's permanent host artifact directory, separately from source. CI, merge, production deployment and production browser acceptance are separate gates and are recorded in the final delivery receipt.

The local full suite initially reported environment failures: absent native PostgreSQL and dependency tracing through a shared `node_modules` symlink. Dependencies were copied into this isolated workspace and the affected package/runtime checks were rerun. No SQL or runtime-product code was changed to bypass those checks. The dependency/runtime recheck passed 10 tests with one platform-specific skip. Native PostgreSQL remains required by GitHub CI; local absence is not a pass. No iOS simulator or paid/model service was used.

Independent review identified source-notice omission and the public-build large-file gate; corrections preserve the omitted metadata and register only the reviewed software bytes. The two vendor exceptions bind exact SHA-256 and byte lengths; modified bytes and unrelated large files remain rejected.

Final local targeted run: 99 tests passed, zero failures. Copy lint passed with documented existing debt retained; pinned Vale 3.24.0 and textlint 15.8.0 were used. Browser build, public-asset gate, release allowlist and release provenance checks passed.

The first PR platform typography run exposed a pre-existing evidence-harness lifecycle error: the root entry navigated to `/en` while Newsreader requests were withheld, and cancelled Fetch interception IDs were later resumed. The harness now retires only exact `Network.loadingFailed(canceled=true)` matches. An unrelated cancellation or unknown invalid interception still fails; product font assertions remain unchanged. A regression first reproduced `Invalid InterceptionId`, then passed after the correction. The same platform matrix must pass on the revised PR head.

A subsequent platform receipt exposed a second cold-probe timing boundary: the native-scroll before rectangle came from an unstyled document (x=8, y=1367), while the final authored layout placed the target above the viewport. The cold probe now waits for the automatic entry to reach an authored route and reuses the existing parsed-styles/stable-viewport observation before scrolling, without awaiting or releasing withheld fonts. The corresponding off-viewport regression failed before the correction, then passed. No visibility/font assertion or device matrix was removed.
