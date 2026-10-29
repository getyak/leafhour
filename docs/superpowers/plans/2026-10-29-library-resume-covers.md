# Reading bookmark and original covers implementation plan

**Goal:** Restore one reliable continue entry and reuse uploaded book artwork.
**Architecture:** Keep the shelf and owner lifecycle. Add a small bookmark renderer; serve derived covers through the existing authenticated book route and private storage.
**Tech stack:** Native JavaScript/CSS, PDF.js, fflate/XML, existing Canvas.
**Spec:** ../specs/2026-10-29-library-resume-covers-design.md

## Constraints and review focus
- Saved passage is required; finished/pending books do not become the current book.
- No stale account content, external cover requests, executable markup, altered originals or new model calls.
- Failed images retain readable titles. Four locales and 390/768/1440px must remain usable.
- Cache reads still check authorization; errors must not poison future retries.

## Tasks
- [x] Add regression tests for latest valid continuation and private image fallback; observe failures.
- [x] Implement compact bookmark in the library render/clear lifecycle with existing translated labels.
- [x] Add real EPUB/PDF cover tests and owner-isolation HTTP checks; observe failures.
- [x] Implement bounded extraction, private cached cover service and shared image rendering.
- [ ] Run focused/full tests, copy checks and hosted build; inspect browser screenshots and keyboard navigation.
- [ ] Review, synchronize main, create PR, wait for CI, merge and verify the same production revision.
