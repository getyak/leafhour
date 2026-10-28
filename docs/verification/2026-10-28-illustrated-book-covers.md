# Illustrated multilingual covers — acceptance record

Date: 2026-10-28. Repository: getyak/leafhour. User direction: approved four printmaking samples, then requested all online public books and Japanese users. Current implementation is based on main 3c4c70cc6062b9de4246add0279779eee0d16998, preserving the books-first library update.

## Scope and assets

All 64 public edition IDs match the anonymous Production catalog captured before generation and catalog/manifest.json. Four approved originals are reused; 60 additional artworks were generated with the built-in image_gen tool, one call per distinct artwork, with zero failed results. Original PNGs are preserved locally and optimized public assets are checked in. No private account books or reading records were read or modified.

There are 128 WebP variants, 320 × 480 and 640 × 960, totaling 10,405,854 bytes. The complete catalog/book-cover-artwork.json records dimensions, variant bytes, original/final SHA-256 values, method and approved-sample reuse. All four final16-book artwork contact sheets were visually inspected. The images contain no generated lettering; native text is separate.

Exact prompt sets and approved prompts are retained in docs/design/2026-10-28-book-covers/. Production does not generate images or send book content to a model.

## Localization and identities

64 editions have 256 explicit records in en, zh-Hans, zh-Hant and ja. Japanese naming references and every actual selected source are documented in book-cover-localization.md. Cover language does not change the reading text. Translator/editor and uncertain-author roles, Chinese originals, companion works and volume numbers remain explicit. Duplicate short titles gain their existing edition subtitle in adjacent identities/selectors; the cover's main short title stays unchanged.

Independent metadata review found two minor corrections, both fixed: J20 now links a concrete Japanese Arabian Nights item, and Rubaiyat labels specify FitzGerald's first and fifth versions. No native Japanese editorial certification is claimed.

## Behavioral review

Independent code review reproduced a private authorless-upload filename disappearing after a language commit. The display-boundary fix and four-language real-factory regression passed. Subsequent review found no remaining blocking issue after main synchronization and the final identity/badge/menu changes. Targeted groups passed 20, 31, 35 and independently 38 checks at their respective current stages; these counts are not additive.

Missing/failed images preserve readable native titles. Book/account/source objects are not rewritten. Image paths are exact-ID, same-origin allowlisted assets; unknown/private books keep their original cloth binding. Local HTTP tests cover actual WebP bytes, HEAD and unlisted/traversal rejection. The reader cover module/CSS stays behind its existing About/gift lazy boundary and fixed startup budgets.

## Real browser evidence

The integrated local application was tested in Chromium, including 1440 × 1000 desktop and 390 × 844 phone-sized viewports. This is viewport emulation, not physical iPhone/Safari or screen-reader acceptance.

- Japanese shelf expanded to all 64 cards; 64 images loaded, zero missing covers or horizontal overflow. Final adjacent names are 64 distinct identities, including all separate volumes.
- Chinese and Japanese desktop/mobile screenshots are stored beside this record; English and traditional-Chinese routes were also checked against committed language, native title, adjacent title, overflow and failed-image state.
- A real settings-language commit from Japanese to simplified Chinese preserved the physical cover, image and title node while updating native text.
- Controlled local image blocking hid failed image elements while keeping the title visible and the cover usable.
- Mobile overflow-menu target is 44 × 44 with zero intersection against the native cover title; actual opening and Escape closing passed.
- Real public-reader About opened Walden as 森の生活, loaded its art, preserved the required source-title node and did not overflow.

browser-local.json stores measured results. The isolated full typography fixture additionally measured 512 label groups (64 editions × 4 languages × 128/136 px): no label-group overflow; maximum occupied cover height 43.60%. Long credits may clamp visually, with complete text retained in DOM/title attributes and source details.

The raw local source reader emitted 22 inline-style CSP console violations at unchanged index.html/reader-atmosphere.js locations. Its cover still loaded. This record does not claim a clean console or certify unrelated source-reader styling; compiled Production evidence is separate.

## Verification and delivery status

Real pinned Vale 3.24.0/textlint copy lint passed; existing documented copy debt and warnings remain visible. Copy export was regenerated without expanding review decisions or weakening lint rules.

An initial full local run under bundled Node 24 reported 3,988 tests: 3,986 passed, one existing reporter-format assertion failed, one platform skip. Its exact failing assertion passed under the official isolated Node 22.22.0 binary after verifying the upstream archive SHA-256. No application test was weakened. Final full Node 22 verification passed: 3,993 tests, 3,992 passed, zero failures and one pre-existing platform skip. The isolated runtime, hosted build, public-build checks, software release allowlist and release verification also passed.

- Complete asset and four-language metadata validation: passed.
- Final local full tests/build/release checks: passed.
- PR / target-branch CI / merge: pending.
- Exact-commit Production assets and browser acceptance: pending.

This is the pre-merge source record. The pull request records final deployment and hosted verification; generation and local screenshots do not establish release.
