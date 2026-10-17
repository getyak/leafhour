# GET-149: source ingestion and explicit proofreading revisions

**Goal:** Import private PDF/EPUB sources with honest extraction/review status, traceable chapter/paragraph anchors and reversible proofreading without losing personal records.
**Architecture:** Preserve existing immutable book/version objects. A proofreading or re-extraction operation publishes an explicitly named private revision as a separate book, linked to its parent. Stable passage IDs are retained for explicit same-passage corrections and uniquely exact text matches; newly split/merged paragraphs receive revision-derived IDs. Old books, original bytes, translations, chat quotes and reading history stay available unchanged. New revision notes migrate only on unique exact source text; uncertain notes are first-class private pending anchors, never embedded in the book content exposed to agents. Repeated publication is idempotent. Original PDF evidence is the actual immutable original SHA + PDF page, viewable as a PDF image; printed page is a separate explicit label. EPUB anchors are spine href + element ID/order, not fabricated PDF pages.
**Tech Stack:** Node 22 ESM, existing JSON/Supabase domain service, fflate 0.8.3, pdfjs-dist locked 6.4.299, @xmldom/xmldom pinned 0.9.12, existing browser UI.
**Spec:** GET-149; _briefs/content-contract.md; _briefs/private-library-architecture.md; _briefs/data-ownership.md.

## Global Constraints
- Source files, private sample texts and credentials never enter Git. No automatic translation/OCR/model calls or extra paid service. Cloud OCR continues to use existing explicit consent and durable runner.
- Unreviewed content stays extracted_unreviewed. A visual attestation is explicit, per paragraph, and requires an available original locator; changing text clears prior attestation. No automatic full-book reviewed status.
- Preserve strict restore and AI quote/version validation. No in-place mutation of a cited source version; no silent fabricated citation migration. Existing historical edition remains available, visibly linked to revised edition.
- Current API owner/origin guards, size budgets and retry fences remain. Only current issue and corresponding PR external writes.
- New content is not advertised on shelf until source book and migrated/pending notes are durably saved. Failure retains prior version; deterministic retry completes partially saved revision without overwriting newer target notes. Original notes added concurrently remain in original edition.

## Fixed acceptance table
| ID | Scenario and expected result | Verification / failure condition |
|---|---|---|
| A1 | PDF/EPUB original bytes + SHA retained; received/extracting/review-required/readable/failed are distinct; readable does not mean visually checked | Real upload, failure/retry, source download hash; fail on false reviewed status or discarded original |
| A2 | EPUB follows container→OPF→spine; nav labels/fragment chapter boundaries; missing nav falls back to explicitly labelled spine divisions; no PDF page invention | Generated real archives with reversed filenames, nested paths, fragments, nonlinear items, missing nav; reject corruption/encryption/unsupported resources explicitly |
| A3 | Untrusted archives/XML cannot cause external access, traversal, script execution or unbounded inflation | Negative ZIP/XML/path/DOCTYPE tests with explicit count/bytes/text limits; plain-text DOM output only |
| A4 | Actual private sample keeps exact original hash, edition 1986/ISBN, 7 chapters/101 sections/579 paragraphs, PDF10 vs printed3, 156 prior corrections and unreviewed status | Read-only actual historical package preflight before PR; bounded actual source page rendering; fail if inferred image files are claimed verified |
| A5 | Proofreading records before/after/reason, source SHA + actual PDF page (or EPUB href), separate printed page, review state; original version unchanged | Domain and rendered UI edit; reject stale source/version, missing evidence, invalid pages, public/other-owner target; no notes in book/agent payload |
| A6 | Re-extraction/correction preserves private comments; unique exact text migrates, ambiguity/deletion/modification becomes pending; explicit user target resolution is durable | Changed/split/duplicate text, edited notes, concurrent addition, idempotent retry, independent service restart; old original and AI citation history byte-for-byte preserved |
| A7 | Pending + resolved anchor receipts and both editions survive strict backup/clean restore; no discarded unknown data | Real historical read-only migration preflight plus synthetic end-to-end restore, malformed input rejected before writes; existing chat validators remain strict |
| A8 | Duplicate upload returns existing; missing TOC, native PDF, scanned consent/cancel/retry and parse errors retain clear recovery | Integration tests using existing runner; no automatic supplier/model retry introduced |
| A9 | Desktop/tablet/mobile source review UI has visible status/evidence, labels, keyboard focus/cancel, escaped text and owner-change fencing | Actual rendering at 390/768/1440; keyboard and cancellation; screenshots; fail on overflow, implicit attestation or wrong-owner response |
| A10 | Whole suite/build/release checks, fresh independent Codex review and exact-head PR gates; merged production revision/actual workflows accepted before Done | Save tests/diff/review/CI/live SHA/private receipts; any unmet requirement remains incomplete |

## Task 1: bounded EPUB ingestion
**Files:** server/epub-import.mjs (new), server/document-import.mjs, app/upload-state.mjs, app/document-source.mjs, app/home.html, localized upload/help strings, tests/epub-import.test.mjs, package.json/package-lock.json.
**Interfaces:** extractEpub(bytes) → extracted.pages[].{page:null,href,title,blocks[]}; blocks have stable IDs/source locator. makeBook preserves EPUB source locators and spine/nav chapters; originalInfo/download allows epub.
1. Write actual ZIP fixtures through existing zipStore; test spine/nav/metadata/anchors/unsafe input via extractDocument, watch unsupported-EPUB RED.
2. Pin official xmldom dependency and implement bounded ZIP central-directory preflight + incremental unzip; reject duplicates/traversal/encryption/DTD entities; strict XML DOM with no external loads. Parse package/spine/nav, extract safe plain text blocks; no raw XHTML injection.
3. Extend existing upload/read source descriptions and source filename mapping; test original-byte hash/dedup/owner isolation.
4. Run Node --test tests/epub-import.test.mjs tests/document-source.test.mjs tests/upload-state.test.mjs and relevant existing ingestion tests. Expected: all pass.

## Task 2: immutable proofreading and re-extraction
**Files:** server/source-revisions.mjs, app/source-revisions.mjs (pure validation/migration), server/library-service.mjs, app/library-backup.mjs, tests/source-revisions.test.mjs, tests/source-revision-restore.test.mjs.
**Interfaces:** library.sourceReview(user,id); library.createSourceRevision(user,id,input); library.resolveSourceAnchor(user,id,input); records.pendingAnchors optional extension with strict validation and merge semantics. No private note snapshots in book content.
1. Write RED tests using real temporary library service: original unchanged, exact/ambiguous matches, source evidence/stale preconditions, notes and chat remain exportable, duplicate calls/restart/failure recovery and owner isolation.
2. Implement bounded domain builder and deterministic publication; actual original hash availability required; changes and revision receipt stored on source metadata, source review separate from read availability. Re-extract through current native extractDocument; scan failures retain original and existing OCR recovery path, no invisible paid retry.
3. Strictly validate pending anchors and preserve them across restore merge; explicit resolution attaches a copied user record with a receipt; old record remains unchanged.
4. Run focused revision/backup/chat tests. Expected: original and target strict backups pass, malicious and conflicting inputs fail without overwriting.

## Task 3: review UI and actual-source evidence
**Files:** app/source-review.mjs/.css/.html, server/portal.mjs, app/reader.js/index.html, app/library-book-actions.mjs, tools/build-vercel.mjs if required; tests/source-review-routes.test.mjs/UI tests.
**Interfaces:** owner-scoped GET review; POST revise/reextract/resolve; authenticated original range APIs reused; PDF native browser viewer renders the SHA-checked original page, EPUB source shown safely as text; entry points reader/source and library book actions.
1. Write RED HTTP/UI tests for authenticated routes, origin/owner guards, stale requests, escaped source, pending resolution and cancellation.
2. Implement responsive source review with paragraph selector, independent PDF/printed page, source original display, explicit correction reason, immutable revision publication, pending anchors/old-edition link and no auto-attestation.
3. Obtain default test account source read-only and render actual sample known page through PDF skill; preserve private evidence only outside Git. Run complete actual historical preflight in isolated local instance; no real user book modifications.
4. Actual browser verify 390/768/1440 and keyboard, upload synthetic PDF/EPUB + revision/pending restore. Expected A1–A9 pass.

## Task 4: verify, review, land and actual production acceptance
**Files:** docs/verification/2026-10-17-get149-source-ingestion.md, final implementation plan evidence; private receipts outside Git.
1. Guard audit/resources, full project suite, hosted/release build and meaningful integration checks. Expected exit0; record skipped checks honestly.
2. Independent Codex sub-agent reviews original issue, fixed acceptance table, complete base→HEAD diff, actual historical preflight and tests. Fix confirmed P0/P1 with RED→GREEN, reviewer rechecks closed per user workflow.
3. Commit/push, associated PR + attach_artifact; all latest-head applicable CI/CD and branch gates pass; normal merge and readback. No bypass.
4. Actual existing production deploy receipt/live SHA, guarded synthetic PDF/EPUB source edit + pending note + complete restore and source image, preserve real existing books; read issue after merge, retain In Progress until all acceptance verified; Done/readback only then. Cleanup only own rebuildable artifacts after permanent evidence retained. Continue next authorized issue.

## Review Focus
ZIP central directory vs streamed local headers/size bombs; XML entity/external resource parsing; namespace/href/percent escape handling; nav fragments vs spine order; forged visual attestations; book content leaking pending personal notes to agent readers; immutable old chat quotes; partial publication exposing incomplete notes; concurrent source-note/target-note changes; strict schema roundtrip and idempotency; no claimed actual source image verification from a string pathname; hosted trace/new asset parity and current-head CI.

## Sources consulted before implementation
- W3C EPUB 3.3 Recommendation 13 Jan 2026: https://www.w3.org/TR/epub-33/ (container, spine, EPUB navigation).
- Pinned DOM parser API: https://raw.githubusercontent.com/xmldom/xmldom/0.9.12/lib/dom-parser.js ; onError callback, no deprecated errorHandler object.
- Current official registry pinned metadata and integrity saved in private issue evidence.
