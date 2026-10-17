# GET-149 source ingestion verification

Status: implementation and local acceptance verified; current-head PR CI, normal merge and production acceptance remain required before closing GET-149.

## Result and design

Private EPUB ingestion follows container, OPF spine and navigation fragments, preserving immutable original bytes and SHA-256. Bounded ZIP/XML rejects traversal, encryption, unsupported content, duplicate identities, external paths and entities. Missing navigation uses labelled spine divisions. No automatic OCR, translation or model calls were added.

Source review publishes a separate private revision. Original books, translations, reading time and AI quotations remain on their original edition. Comments/questions migrate only on a unique exact-text anchor; uncertain positions remain private pending records until explicitly resolved. Migration receipts fence retries. Book and records are durable before the revision is advertised. Strict backup/restore retains pending and resolved receipts.

PDF evidence is a bounded PNG from the authenticated hash-verified original, with page/image hashes. The browser validates and decodes it before enabling the explicit visual checkbox. Editing text, printed labels or PDF location invalidates confirmation. Printed labels remain distinct from PDF pages. PDF.js wasm/fonts and canvas native assets are included; production parity remains an acceptance gate.

## Local evidence

- Full project: 157 test files, 1118 pass, zero failures, one existing platform skip. Five subsequent reader/hosted/public-build/release stages returned exit 0. An exact source snapshot with physical dependencies avoids the file tracer excluding an external shared node_modules symlink; source and locked versions were retained.
- Final CSS-only change wraps long source hashes. Hosted build and public/release checks were rerun after it.
- Actual private historical source: original SHA/bytes verified; 1986 edition/ISBN, 7 chapters, 101 sections, 579 paragraphs and 156 earlier corrections preserved. PDF pages 10/11 visually inspected as printed pages 3/4. This does not attest all paragraphs or earlier corrections as visually checked.
- Isolated historical preflight: original source, notes and AI quotations unchanged; split revision has 580 paragraphs, one migrated and one pending note. Both editions and originals survived clean ZIP restore and an idempotent repeat. No production book was changed by this preflight.
- Native Chrome at 390/768/1440: stacked and dual-column layouts viewed; hash overflow fixed. Actual PDF image and escaped EPUB source displayed. Keyboard cancel/publish, explicit pending-note resolution and focus restoration passed. Check then edit clears visual attestation. Isolated fixture authentication does not replace production login acceptance.

## Independent review

Independent Codex reviewer `/root/get149_review` inspected the complete diff/new files against the original issue and frozen acceptance table. Two P1 findings were reproduced with failing tests: stale visual attestation after edits and numeric EPUB element IDs colliding with ordinal identities. Disjoint tagged identities and explicit input invalidation fix both. Re-review ran 16 relevant tests and extra PDF-input/focus probes; no unresolved P0/P1 remains. Reviewed code manifest: `d22a36b44b991f8b9e96af51a8e8e0b0c632a15f0dc50bd3dcbb41db11ffd5c2` (33 files before this evidence document).

Private originals, content, cookies, credentials and screenshots stay outside Git. These sanitized structural receipts do not replace exact-head CI, merged deployment receipt/live SHA or production business acceptance.
