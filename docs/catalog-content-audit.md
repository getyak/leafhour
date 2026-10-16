# Catalog content audit · 2026-10-17

All 30 published reading editions pass the independent source-sequence audit: 10,087,269 normalized source characters, no unexplained missing, repeated, reordered or unmatched reading text. The [per-book report](catalog-content-audit.json) records exact source URLs and SHA-256 hashes, disclosed reading scopes and explicitly excluded decorative gaps.

## Corrections

- Restore explicit primary-source line breaks in 161 passages, including embedded poems in Erewhon, A Room of One’s Own and The Home and the World, and flattened verse in the legacy Alice and Walden editions. This uses primary HTML rather than guessing from TXT hard wrapping.
- Restore 26 standalone source labels in Tao Te Ching and Equiano, including volume, verse and final footnote boundaries.
- Correct Arabian Nights attribution: Lang selected and edited; the source credits unnamed Fairy Books contributors translating via Galland’s French.
- Retain full Gutenberg notices and producer credits for the original three books; add Col Choat’s electronic-edition credit for A Room of One’s Own.
- Disclose exact edition scope in About this book, including omitted author/translator prefaces, glossary material, source abridgements and the distinction between a work’s first publication date and a verified print edition.

Original source artifacts, original strings, paragraph IDs, content versions and existing translation files remain unchanged. Layout and notices live in a separate version/hash-validated metadata file. All 30 books restore into an isolated clean instance with their source layout preserved. No paid model call or real account data write is involved.

## Method and limits

The audit does not call the import builder. It walks primary HTML/XML text independently, verifies raw download hashes, then matches each served paragraph and restored label in source order. Any unexplained gap or unmatched target fails the run. Legacy books are compared against their full Gutenberg TXT body after wrapper removal. Chapter boundaries and numbered verse coverage also have separate existing regression checks.

This verifies fidelity inside the explicitly disclosed reading scope. It does not establish that historic translations are ideal, correct underlying source typographical/OCR errors, reproduce illustrations, or restore omitted preliminaries. Each book retains its source notices and edition description.

## Verification

The new regression reproduced the lost-line-break bug before the fix, then passed initial painting with zero highlights, overlapping marks crossing line breaks, exact quote offsets and highlight removal. Real browser verification showed the eight-line Erewhon verse after initial highlight painting, selected across two lines and produced the exact expected local excerpt preview. The preview used an isolated local server with authentication and model generation disabled.

Full local deployment verification passes: 753 tests, 752 passed, one existing platform skip, zero failures; isolated reader runtime initialization, public build and release snapshot checks all pass. The metadata reproduces byte for byte from the pinned source cache. Run the reproduction commands in [world-catalog.md](world-catalog.md). Production acceptance is performed after merging and recorded separately.
