# Thirty shared English editions

The default library contains 30 readable books: the existing Alice, Meditations and Walden editions plus 27 English reading editions. This is the shared public catalog consumed by the website and MCP domain service. It is versioned with the application, not inserted into an account’s private `reader_documents` or the retired single-book `reader_books` archive. Personal progress, translations, annotations and reading history continue to use account storage.

`catalog/manifest.json` identifies each exact edition, language, translator, subjects, chapter count and source boundary samples. `catalog/world/*.json` stores the complete main text of each selected edition in source chapter order, along with download URLs, SHA-256 checksums and separate license/credit notices. Publisher preliminaries and repeated contents are omitted from the reading view. Illustrations are not included. Text is structurally extracted, not claimed to be visually proofread.

The original three source files, hashes, passage IDs and Chinese trial translations remain unchanged. Newly added passages have stable IDs derived from their pinned artifact hash and sequence; there are no generated Chinese translations or model calls. Changing a published artifact requires an explicit version/anchor migration.

## Editions requiring a scope label

- **Meditations:** retain Meric Casaubon, the existing edition, to preserve readers’ anchors. George Long has not silently replaced it.
- **Don Quixote:** John Ormsby; both volumes, 52 + 74 chapters.
- **A Room of One’s Own:** Project Gutenberg Australia 0200791, the 1929 work, six chapters. This replaces the proposed Canadian 1931-edition download source.
- **The Death of Ivan Ilych:** CCEL XML, Louise and Aylmer Maude, all twelve story chapters; exclude the CCEL staff summary and generated indexes.
- **The Arabian Nights Entertainments:** Andrew Lang’s selection/adaptation, not the complete Arabic collection.
- **The Rubaiyat:** FitzGerald’s first and fifth editions are separate sections; an English reworking, not a literal Persian edition.
- **The Song Celestial:** Edwin Arnold’s verse rendering, including its translator notes and explicitly acknowledged omissions; not a Sanskrit critical edition.
- **The Dhammapada:** all 423 numbered verses in the supplied Müller reading text; its source omits the original introduction, notes and index.
- **The Awakening:** includes the source volume’s selected short stories, with their own titles.
- **Brazilian Tales:** six stories plus Goldberg’s separately labeled introduction.
- **The Underdogs:** Munguía translation, main story without the Carleton Beals introduction or Orozco illustrations.
- **Candide:** Modern Library 1918 English edition; the translator is unnamed in that edition. Do not attribute it to Smollett.

Underlying texts and translations have source-specific public-domain assessments. Project Gutenberg’s notices describe US status, not a universal license determination. Software AGPL-3.0 does not relicense these books; retain each artifact’s notices on redistribution.

## Reproduce and verify

The import is offline and deterministic. Cache the exact `downloadUrl` for each artifact as `PG_ID.html`, `room.html`, or `ivan.xml`. Install development-only Python packages `beautifulsoup4` and `lxml`, then run:

```
python3 tools/import-world-catalog.py /path/to/source-cache
node --test tests/world-catalog.test.mjs tests/catalog.test.mjs
npm run verify:deploy
```

The first command verifies all raw download hashes and compares regenerated chapter artifacts byte for byte. `--write` explicitly replaces derived artifacts; never run that against a published edition without considering anchors. Source changes are refused until the edition is deliberately reviewed. Production smoke checks all 30 IDs and fetches every book to verify its first/last anchors and body chapter count, in addition to the existing auth boundaries.

## Verification record · 2026-10-17

Local deployment verification: 747 tests, 746 passed, 1 existing platform-dependent skip, zero failures; isolated reading runtime and public release build passed. Deterministic reproduction matched all 27 pinned downloads. The 30-book export restored into a clean instance. A real browser displayed all 30 books, searched Woolf to find the matching book, opened Frankenstein’s first chapter and jumped through its contents to chapter 24. Verse rendering preserves source newlines. Largest full-book JSON response measured about 2.91 MB; no model request or real account write was used. Production acceptance is performed after merging and is separately reported.
