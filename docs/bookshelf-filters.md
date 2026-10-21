# Bookshelf filters

The bookshelf keeps a single status row, title/author search, and one filter popover. On phones, search and the filter button occupy the next row. The popover contains subject, source, reading language, and reading format. The public homepage shares its language and format controls, applied only to public books. Choices apply immediately; removable chips and a clear action explain the active selection.

Any active filter or nonempty search hides the large continue-reading card. The current book participates in the resulting shelf exactly once. Clearing restores the featured card and the saved shelf order. Filtering and searching run locally after the existing account-scoped library request; they do not call a model or write reading activity. Reordering still uses the full shelf order, including books outside the current result.

## Meaning of the fields

- Finished follows the explicit finished-book mark. Reading requires a saved reading position, a real reading session, or a completed chapter. The domain's default `reading` journey alone does not mean the book has been started.
- Original language stays in `sourceLanguage`. Reading language matches that original or an actually saved translation; translated titles and sample labels alone never count. Older private indexes derive missing language from their own saved book without rewriting account files. Unrecognized values fall back to `unknown`.
- Subjects are curated in the shared catalog. Uploaded books without subject metadata remain available under all subjects. The interface does not invent a subject for them.
- Filter state is temporary and resets with account changes. Available language choices include the current account's original and saved translation languages. Chinese and English shortcuts remain selectable with no matches.


## Reading language and format (GET-199, 2026-10-21)

The language and format choices intersect:

| Format | Language matches |
| --- | --- |
| All | Original or saved translation |
| Original | Only the original |
| Translation available | Only saved translation languages |
| Bilingual | Original or translation, with aligned saved translation passages |

Listings add `translationLanguages`, `supportsParallel`, `translatedParagraphs`, and `translationCoverage` (`none`, `partial`, `complete`). They are derived from real nonempty original/translation pairs. Stale account overlays and translations tied to another source version are ignored. The existing translation contract provides Chinese literal/interpretive variants; changing interface language never creates another translation language. A few translated passages can support bilingual reading without claiming the rest of the book is translated. Both filter panels disclose that limit, and existing Chinese sample links retain their passage counts.

The account's saved `preferredLanguage: zh` initializes an otherwise unfiltered entry. `source` means the original, not English, so it does not invent a language filter. Explicit URL views and choices made while identity loads take precedence. Clearing a chip or all filters is respected through same-owner refreshes. Real owner changes clear the view and all account-derived translation metadata, including when the first library request failed. No preference, reading activity, or model request is written by filtering.

The library URL and safe login return accept `form=original|translated|bilingual` alongside `language`; invalid/duplicate form parameters normalize to all. The public homepage keeps temporary local filter state. Zero results offer another language/all formats and a clear action.

### Metadata maintenance

Public catalog maintainers can correct `sourceLanguage` in `catalog/manifest.json`, using a language tag such as `en`, `zh`, or `fr`, then verify the edition and rebuild. Private legacy entries without that field are derived read-only from their account's saved book; the current importer recognizes Chinese/Latin text, so this inference is not a general language detector. If no language can be established, keep `unknown` rather than naming a guessed language.

For self-hosted administrative backfill, back up the account storage first and correct only the affected entry's `sourceLanguage` in its existing account-owned book index; use the current storage backend and the authenticated owner's directory/key. Do not move the book or rewrite text, anchors, translations, or reading records. Listings normalize that explicit tag on their next read. Translation availability fields are derived and must not be manually advertised. This task adds no admin UI or bulk migration and changes no live account data.

Local verification and screenshots: [GET-199 acceptance record](verification/2026-10-21-get-199.md).

## Historical verification on 2026-10-16

`npm run verify:deploy` passed: 746 tests, 745 passed, one skipped, zero failed; isolated packaged reader initialization, hosted build, public asset checks, and release allowlist checks passed. The packaged runtime made no model requests.

Real browser acceptance used the application server and domain services with an isolated temporary local library: the three shared samples plus two temporary Chinese/English text documents. No persistent cloud account or real uploaded books were changed.

Observed in the browser:

- Reading and finished status returned the correct single book; selecting all restored the featured card and saved manual order.
- Subject and source combined as an intersection. A combination without matches displayed a clear action that restored the shelf.
- Author search found Walden and hid the featured card. Clearing search restored it.
- Chinese original language matched the Chinese upload, excluding the English books with Chinese samples.
- Native select changes retained their selected values. Escape and Done closed the popover and restored focus to its trigger.
- At 390 pixels wide the controls occupied two quiet rows and the popover stayed in view. At 320 pixels there was no horizontal overflow. Mobile navigation's search shortcut closed navigation and focused search. The collapsed desktop shortcut also focused the main search field.
- Signing out cleared search, active filters, and private language choices; only the three shared books remained in the visible shelf. No browser errors or warnings were captured during these checks.

Production verification is recorded by the PR checks and the existing Production workflow after merge. These local checks do not claim production acceptance.
