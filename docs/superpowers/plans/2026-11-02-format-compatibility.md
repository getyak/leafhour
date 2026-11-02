# Format-aware import implementation plan

> **For agentic workers:** Use superpowers:executing-plans, with independent native work under dispatching-parallel-agents.

**Goal:** Imported books expose reliable format-derived chapters without losing source content.
**Architecture:** Existing import services retain authority and byte storage. Format adapters produce source blocks/cuts; saved books remain unchanged.
**Tech Stack:** Node, CommonMark 0.31.2, PDF.js, xmldom, Swift Foundation, existing cmark and PDFKit.
**Spec:** ../specs/2026-11-02-format-compatibility.md

## Global constraints

No source byte edits, automatic migrations, paid models, capacity changes, or new format claims. Preserve unrelated work. One reviewed delivery batch.

## Review focus

Front TOCs duplicated in body; code masquerading as headings; incomplete EPUB navigation; PDF bookmark destinations as integer or reference; long files with source evidence and stable identities.

### Task 1: Web TXT/Markdown structure

- [x] Add failing integration tests in tests/text-structure.test.mjs through extractDocument/makeBook, including source evidence.
- [x] Implement server/text-structure.mjs; integrate format-aware blocks in server/document-import.mjs. Keep Markdown raw text and chapter boundaries. Add .markdown alias at all upload validation boundaries.
- [x] Run text/library/import tests; verify no omitted or duplicated paragraphs and deterministic IDs.

### Task 2: Structured containers

- [x] Add EPUB2 NCX and incomplete navigation regression tests in tests/epub-import.test.mjs, real PDF outline tests in tests/pdf-native.test.mjs.
- [x] Implement EPUB2 fallback and uncovered spine starts; share document outline extraction between direct PDF import and recognition path.
- [x] Run EPUB/PDF/library tests and source/restore regressions.

### Task 3: Native

- [x] Add real local-import regression tests for TXT/Markdown chapters, protected code blocks and source preservation.
- [x] Implement format-aware native chapter creation with deterministic passage IDs; preserve retained Markdown mapping and old saved indexes. Improve EPUB navigation only if compatible with existing native source paths.
- [x] Run swift test and simulator build, documenting distribution separately.

### Task 4: Delivery

- [x] Run complete appropriate suites and packaged web build, inspect actual reader behavior against isolated synthetic library.
- [x] Request independent code review; fix important findings and rerun affected checks.
- [ ] Record exact results; commit task files, synchronize main, push once, open PR, wait CI, merge normally and verify deployment source.
