# Local PDF engine

These browser-only software assets load on explicit PDF export. They make no
network calls; selected book text stays in the browser.

- `pdf-lib.mjs`: unchanged `pdf-lib@1.17.1/dist/pdf-lib.esm.min.js`, MIT; notice in `pdf-lib-LICENSE.txt`. SHA-256 `72c052d97b4d5d9fa6cdbdcb7ad709f03d4ddb1122390cb3afeba4d88651d969`.
- `pdf-fontkit.mjs`: `@pdf-lib/fontkit@1.1.1/dist/fontkit.es.js` bundled with its `pako@1.0.11` dependency using esbuild 0.28.2 (`bundle`, `format: esm`, `platform: browser`, `minify`, `legalComments: eof`). Both upstream packages declare MIT; the package authorship/declaration, full standard MIT terms, complete upstream fontkit README/license link and pako licence are retained in `pdf-fontkit-NOTICE.txt`. SHA-256 `f22933b6a58752ab8a345ee8295eda49390727176f34d8b585e33c5b21d94490`.

For regeneration, install these exact npm package versions into an isolated
maintainer directory, copy the pdf-lib distribution file, and bundle fontkit's
ES distribution with the options above. Retain notices and update these hashes.
No package install or third-party CDN is needed in a reader's browser.

The two exact vendor module paths are excluded from product copy extraction:
they contain third-party parser/font strings, not authored Leafhour UI copy.
Authored export controls remain in the ordinary four-language catalogues and
are checked by the normal copy export/lint pipeline.
