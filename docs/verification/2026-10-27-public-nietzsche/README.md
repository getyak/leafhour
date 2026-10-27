# Shared Nietzsche catalog additions · 2026-10-27

The requested editions belong to the shared public catalog. Anonymous readers and independent accounts discover the same two public IDs; personal translations, notes and progress remain account scoped. All source material for this change comes from the two public Gutenberg HTML artifacts. No account export is included.

| Public ID | Translation | Selected author text |
| --- | --- | --- |
| `gutenberg-beyond-good-and-evil` | Helen Zimmern (prose), L. A. Magnus (poem), Gutenberg #4363 | Author preface, nine chapters containing all 296 numbered aphorisms, final poem |
| `gutenberg-zarathustra` | Thomas Common, Gutenberg #1998 | All four parts, Prologue and eighty numbered discourses |

Zarathustra excludes the source volume’s editorial introduction and Ludovici commentary. Both edition scope labels, download hashes, credits and Gutenberg notices remain in the versioned artifacts. The reading language is English; the original language is German. No Chinese translations were generated.

## Source and reproduction

- [Beyond Good and Evil source](https://www.gutenberg.org/ebooks/4363), primary HTML SHA-256 `b283c3dd34fd2e91299eefee8d123af970a3625a58bc7d605d87f68c188d2500`.
- [Thus Spake Zarathustra source](https://www.gutenberg.org/ebooks/1998), primary HTML SHA-256 `089980e295ea86e415ff1ece22d5569d56aa257695e12e96c4cb14a0550225a4`.
- Source coverage: [independent sequence audit](source-audit.json), 883,369 normalized source characters within the disclosed scope, zero unexplained differences. Source fidelity does not establish critical-edition or translation proofreading; review status remains `extracted_unreviewed`.

With these raw files named `4363.html` and `1998.html` in `SOURCE_CACHE`:

```sh
python3 tools/import-world-catalog.py "$SOURCE_CACHE" --only gutenberg-beyond-good-and-evil gutenberg-zarathustra
python3 tools/build-catalog-reading-metadata.py "$SOURCE_CACHE" --only gutenberg-beyond-good-and-evil gutenberg-zarathustra
python3 tools/audit-catalog-content.py "$SOURCE_CACHE" --only gutenberg-beyond-good-and-evil gutenberg-zarathustra --report /tmp/nietzsche-source-audit.json
node --test tests/nietzsche-catalog.test.mjs tests/world-catalog.test.mjs tests/catalog-topics.test.mjs tests/catalog-emphasis.test.mjs tests/catalog-reading-metadata.test.mjs tests/arrival-catalog.test.mjs
```

The frozen thirty-book regression rows are unchanged. New rows pin the two editions’ artifact hashes, paragraph counts, first/last anchors and source-sequence hashes. The Nietzsche acceptance test checks anonymous and two isolated account identities, both Chinese names for Beyond Good and Evil, all 296 aphorisms, retained songs and heading-styled author sentences, source attribution and absent generated translations.

## Delivery gates

Local release verification completed: 3,652 tests, 3,638 passed, 14 environment/platform skips, zero failures. The isolated reading runtime initialized without model requests; the public build, release allowlist and source-provenance checks passed. See [the complete local verification log](release-check.log.gz).

Independent review identified the poem’s separate translator credit and missing blank stanza separators in preformatted songs. Both were fixed with regressions observed failing before the fix and passing afterward; the reviewer verified all twenty original separators and reported no remaining blockers.

CI and the exact Production commit remain separate delivery gates at this source snapshot. Production acceptance checks the anonymous catalog and both public reading URLs, rather than relying on a test-account session.
