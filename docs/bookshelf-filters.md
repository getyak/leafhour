# Bookshelf filters

The bookshelf keeps a single status row, title/author search, and one filter popover. On phones, search and the filter button occupy the next row. The popover contains subject, source, and original language. Choices apply immediately; removable chips and a clear action explain the active selection.

Any active filter or nonempty search hides the large continue-reading card. The current book participates in the resulting shelf exactly once. Clearing restores the featured card and the saved shelf order. Filtering and searching run locally after the existing account-scoped library request; they do not call a model or write reading activity. Reordering still uses the full shelf order, including books outside the current result.

## Meaning of the fields

- Finished follows the explicit finished-book mark. Reading requires a saved reading position, a real reading session, or a completed chapter. The domain's default `reading` journey alone does not mean the book has been started.
- Original language comes from the book, independently of Chinese samples or translations. Older private indexes derive missing language from their own saved book without rewriting account files.
- Subjects are curated in the shared catalog. Uploaded books without subject metadata remain available under all subjects. The interface does not invent a subject for them.
- Filter state is temporary and resets with account changes. Available language choices come from the current account's visible shelf.

## Verification on 2026-10-16

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
