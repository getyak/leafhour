# GET-281 implementation plan

> Execute inline with superpowers:executing-plans; request one independent review before delivery.

**Goal:** make the reader, companion sheet and sleeping controls follow the book-first direction.

**Architecture:** existing native CSS and JavaScript owners; no new runtime dependency or state owner.

**Spec:** `docs/superpowers/specs/2026-10-28-get-281-impeccable-design.md`, root `PRODUCT.md` and `DESIGN.md`.

## Constraints and review focus

Preserve source text, account isolation, bounded generation, text selection, reading anchors and locale ownership. Watch keyboard return to a sleeping entry, unread entry visibility, long menus in a half sheet, short visual viewports, and desktop-to-mobile modality changes.

## Tasks

- [x] Install the official project-scoped Cursor skill, record versions and run init/document using repository product evidence. Read quieter, distill, critique and polish instructions.
- [x] Add `tools/verify-reader-impeccable.mjs` with rendered assertions for sleeping shell and half-sheet geometry; observe baseline failures.
- [x] Refine `app/reader-quiet.css`, `app/reader-chat-workspace.css` and semantic source rule in `app/styles.css`. Reuse all existing interaction owners.
- [x] Run the rendered matrix and existing toolbar, immersion, chat, location, pagination and selection checks; inspect screenshots. Run the official detector on source and real sleeping/tools/chat pages; no ignore rules.
- [ ] Run full tests, build/release checks and review. Record evidence and limits in `docs/verification/2026-10-28-get-281-impeccable.md`. Submit only this branch's changes; wait for CI, merge, verify production.
