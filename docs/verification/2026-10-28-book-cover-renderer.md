# Illustrated cover renderer verification

Date: 2026-10-28. Scope: shared rendering, four-language identity labels, consumer integration and self-hosted static routes. Artwork completion, final copy export, full release verification and Production acceptance belong to the parent delivery record.

## Implementation

`app/book-binding.mjs` remains a synchronous pure renderer. Its public labels and responsive image URLs come only from the checked-in exact-ID tables; a book must have public visibility to use them. Private and unknown books retain their actual metadata and original cloth binding. Caller-provided image fields are ignored. Text uses DOM text content, with no metadata HTML insertion.

`app/book-cover-ui.mjs` owns language subscriptions. Weak node references and a weak metadata registry avoid retaining removed cards. Language commits repaint connected native text nodes without replacing covers or images, fetching books/accounts, changing source text or invoking generation. The reader About enhancement loads this module and cover CSS only after its existing explicit bookplate open. The required source-title node and original edition text remain available to the reader controller. Disposing the enhancement restores its source bookplate and relinquishes the shared identity nodes.

The home shelf, library shelf, current book, library About dialog, gift composer, gift page and reader About/gift consumers share the renderer. Public title and author identities beside covers use the same table. Original book objects, stored reading positions, letters and quotations are unchanged.

`server/portal.mjs` serves only the approved image paths derived from the checked-in artwork table. Unknown filenames, unsupported sizes and encoded traversal paths do not become filesystem reads.

## Red to green evidence

- Core renderer: the new native-Japanese art, failed-image fallback, live locale repaint and node-reuse assertions first failed against the old binding. Initial result: 3 passed / 4 failed. The implementation passed all seven, then the adjacent-identity test separately failed before implementation and passed afterward.
- Actual home/gift consumers: both new public-cover assertions failed before consumer migration, then passed. Later home title/author assertions failed on the original source labels before the public identity helper was connected.
- Anonymous HTTP: the new test failed with a 404 for `book-cover-ui.mjs`, then passed after static route registration. It compares actual WebP bytes, verifies empty HEAD bodies and rejects unlisted/traversal routes.
- Reader About: its new shared-art assertion failed before the lazy enhancement was connected. A later disposal assertion failed before cleanup was implemented. Both are green.
- Reader build: eager cover CSS initially exceeded the fixed 200 KiB style budget (207,352 bytes). Moving it behind the existing lazy enhancement restored the unchanged budget. All seven reader graph/build tests passed; cover data and renderer modules remain outside initial reader JavaScript.

The related 13-file test group passed **107 / 107**, with no failures or skips. The seven reader build/graph tests passed separately. The parent task will run the full suite after all artwork, release entries and copy inventory are complete.

Related test command:

```sh
node --test tests/book-binding.test.mjs tests/book-cover-ui.test.mjs tests/book-cover-http.test.mjs tests/book-cover-about.test.mjs tests/ui-locale-portal.test.mjs tests/ui-locale-book-gift.test.mjs tests/ui-locale-a-remaining.test.mjs tests/reading-journal-dashboard.test.mjs tests/ui-locale-book-actions.test.mjs tests/gift-compose-ui.test.mjs tests/reader-book-actions.test.mjs tests/ui-locale-reader-foundation.test.mjs tests/ui-locale-lazy-ui.test.mjs
node --test tests/reader-web-build.test.mjs
```

## Real browser typography fixture

The isolated fixture renders all 64 public editions in four locales at 128 px shelf width and 136 px current-book width, using the actual renderer, native font stacks and application styles. It uses no account data or model requests.

```sh
LEAFHOUR_COVER_PROOF_PORT=4778 node tools/book-cover-layout-fixture.mjs
```

Open `http://127.0.0.1:4778/`. The original inspection server was on port 4777. Measurements came from the real browser DOM after font readiness; screenshot inspection covered the first shelf rows. This is a renderer fixture, not Production acceptance. Artwork export was still incomplete during this check, so missing illustration files are not counted as validated artwork.

The first pass found long English headers occupying up to 57.24% of the cover. Smaller long-title type and bounded credit/subtitle regions reduced the largest occupied region to 43.60%; none of the 512 measured label groups overflowed a cover. All title text remains visible. Long author credits can occupy two lines; complete credits remain selectable in the DOM and available in their title attributes and nearby metadata.

| Width | Locale | Editions | Largest occupied height | Clamped credits | Smallest title |
| --- | --- | ---: | ---: | ---: | ---: |
| 128 px | en | 64 | 43.60% | 13 | 9.984 px |
| 128 px | zh-Hans | 64 | 41.36% | 1 | 14.72 px |
| 128 px | zh-Hant | 64 | 41.36% | 1 | 14.72 px |
| 128 px | ja | 64 | 41.35% | 3 | 11.136 px |
| 136 px | en | 64 | 43.60% | 13 | 10.608 px |
| 136 px | zh-Hans | 64 | 41.37% | 1 | 15.64 px |
| 136 px | zh-Hant | 64 | 41.37% | 1 | 15.64 px |
| 136 px | ja | 64 | 41.34% | 3 | 11.832 px |

The browser computed the Japanese stack as `Hiragino Mincho ProN`, `Yu Mincho`, `YuMincho`, `Noto Serif JP`, `IPAexMincho`, `serif`, ahead of any Simplified Chinese font. The approved Walden, Flatland and Meditations examples were visually inspected at the actual thumbnail size. This does not establish Safari, screen-reader, physical-phone or final Production behavior.
