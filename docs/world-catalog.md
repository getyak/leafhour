# Thirty-two shared English editions

The default library contains 32 readable books: the original thirty editions plus Nietzsche’s Beyond Good and Evil and Thus Spake Zarathustra. This is the shared public catalog consumed by the website and MCP domain service. It is versioned with the application, not inserted into an account’s private `reader_documents` or the retired single-book `reader_books` archive. Personal progress, translations, annotations and reading history continue to use account storage.

`catalog/manifest.json` identifies each edition, language, translator, subjects, chapter count and source boundary samples. `catalog/world/*.json` stores the selected reading text in source chapter order, with download URLs, SHA-256 checksums and separate license/credit notices. The per-book `scopeNote`, visible in About this book, identifies omissions: some editions exclude author or translator prefaces, glossaries or editorial material as well as publisher preliminaries and illustrations. This is a reading selection, not a claim that every source volume is reproduced cover to cover.

The original three source files, hashes, passage IDs and Chinese trial translations remain unchanged. Newly added passages have stable IDs derived from their pinned artifact hash and sequence; there are no generated Chinese translations or model calls. Changing a published artifact requires an explicit version/anchor migration.

## Editions requiring a scope label

- **Meditations:** retain the existing Meric Casaubon-derived electronic edition and readers’ anchors. The Gutenberg text itself omits translator notes, brackets and alternative readings; it is not an untouched facsimile of the 1634 printing.
- **Don Quixote:** John Ormsby; both volumes, 52 + 74 chapters.
- **A Room of One’s Own:** Project Gutenberg Australia 0200791, six chapters, produced by Col Choat. The work was first published in 1929; the electronic header does not establish one print edition.
- **The Death of Ivan Ilych:** CCEL XML, Louise and Aylmer Maude, all twelve story chapters; exclude the CCEL staff summary and generated indexes.
- **The Arabian Nights Entertainments:** selected and edited by Andrew Lang; unnamed Fairy Books contributors translated via Galland’s French. Lang is not credited as the translator. This is not the complete Arabic collection.
- **The Rubaiyat:** FitzGerald’s first and fifth editions are separate sections; an English reworking, not a literal Persian edition.
- **The Song Celestial:** Edwin Arnold’s verse rendering, including its translator notes and explicitly acknowledged omissions; not a Sanskrit critical edition.
- **The Dhammapada:** all 423 numbered verses in the supplied Müller reading text; its source omits the original introduction, notes and index.
- **The Awakening:** includes the source volume’s selected short stories, with their own titles.
- **Brazilian Tales:** six stories plus Goldberg’s separately labeled introduction.
- **The Underdogs:** Munguía translation, main story without the Carleton Beals introduction or Orozco illustrations.
- **Candide:** Modern Library 1918 English edition; the translator is unnamed in that edition. Do not attribute it to Smollett.
- **Beyond Good and Evil:** Helen Zimmern translated the prose; L. A. Magnus translated the concluding poem FROM THE HEIGHTS. Includes the author preface and all 296 aphorisms in nine chapters. The Chinese shelf title includes both 超越善恶 and 善恶的彼岸. The German original language and English reading language are recorded separately; no Chinese translation is supplied.
- **Thus Spake Zarathustra:** Thomas Common; all four parts, including the Prologue and eighty numbered discourses. This reading selection excludes Elisabeth Förster-Nietzsche’s introduction and Anthony M. Ludovici’s appended commentary. Preserve original section numbers and verse line breaks; notices remain available separately.

Underlying texts and translations have source-specific public-domain assessments. Project Gutenberg’s notices describe US status, not a universal license determination. Software AGPL-3.0 does not relicense these books; retain each artifact’s notices on redistribution.

## Reproduce and verify

The import is offline and deterministic. Cache the exact `downloadUrl` for each artifact as `PG_ID.html`, `room.html`, or `ivan.xml`. Install development-only Python packages `beautifulsoup4` and `lxml`, then run:

```
python3 tools/import-world-catalog.py /path/to/source-cache
python3 tools/build-catalog-reading-metadata.py /path/to/source-cache
python3 tools/audit-catalog-content.py /path/to/source-cache --report /tmp/catalog-audit.json
node --test tests/world-catalog.test.mjs tests/catalog.test.mjs tests/catalog-reading-metadata.test.mjs tests/reader-highlights-lineation.test.mjs
npm run verify:deploy
```

The first command verifies all raw download hashes and compares regenerated chapter artifacts byte for byte. `--write` explicitly replaces derived artifacts; never run that against a published edition without considering anchors. Source changes are refused until the edition is deliberately reviewed. Production smoke checks every manifest ID and fetches every book to verify its first/last anchors and body chapter count, in addition to the existing auth boundaries.

The two Nietzsche sources can be reproduced independently when only `4363.html` and `1998.html` are cached. Pass `--only gutenberg-beyond-good-and-evil gutenberg-zarathustra` to each of the three Python tools above. The reading-metadata compiler preserves all unselected entries. The source audit’s reported total then covers exactly the selected books; it does not claim that unselected sources were re-audited. See the [2026-10-27 addition record](verification/2026-10-27-public-nietzsche/README.md).

The metadata compiler additionally needs the exact primary HTML for the original three books, named `11.html`, `2680.html` and `205.html`. Their layout-source hashes are recorded in `catalog/reading-metadata.json`. This sidecar restores explicit source line breaks and standalone labels without changing original strings or paragraph IDs; the loader rejects stale versions, changed paragraph hashes and invalid offsets. Highlight rendering preserves these breaks without inserting quote characters. The original three books also retain their full Gutenberg credits and notices in exports.

## Verification record · 2026-10-17

Local deployment verification: 747 tests, 746 passed, 1 existing platform-dependent skip, zero failures; isolated reading runtime and public release build passed. Deterministic reproduction matched all 27 pinned downloads. The 30-book export restored into a clean instance. A real browser displayed all 30 books, searched Woolf to find the matching book, opened Frankenstein’s first chapter and jumped through its contents to chapter 24. Verse rendering preserves source newlines. Largest full-book JSON response measured about 2.91 MB; no model request or real account write was used. Production acceptance is performed after merging and is separately reported.

The subsequent [content audit](catalog-content-audit.md) compares the full selected reading text independently of the importer. All 30 books pass, covering 10,087,269 normalized source characters. Its [machine-readable report](catalog-content-audit.json) records every source hash, scope and excluded decorative gap. This establishes source fidelity within the disclosed scope; historical translations and source typographical errors have not received critical-edition proofreading.
