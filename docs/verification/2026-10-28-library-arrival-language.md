# Library arrival language

The library welcome excerpt previously displayed its bundled Chinese draft and Chinese attribution even at `/library?ui=en`. Only its surrounding interface labels followed the selected language.

The library now selects an existing presentation locally: English and Japanese interfaces display the verbatim English source once, with Lewis Carroll, the original title, Chapter I, and the localized source-excerpt label. Simplified Chinese keeps the existing draft and its English comparison. Traditional Chinese uses the same draft in Traditional script. Translation status remains explicit wherever a translation is displayed.

This exception applies only to the authored library welcome. Requested book excerpts, saved translations, source identities, and private content remain literal. A language switch neither requests content nor restarts the loading lifecycle.

## Verification

- Regression tests failed on the previous implementation: English displayed the Chinese draft, and Chinese presentation did not identify its script.
- The focused arrival, public-source identity, and dashboard locale suite passed all 22 tests after the change.
- Actual library HTML and modules passed 10 browser cases: 1440px and 390px, each switching through English, Simplified Chinese, Traditional Chinese, Japanese, and back to English. English arrival text contained no Han characters, showed the exact original once, and used English attribution. No horizontal page overflow occurred.
- The browser check deliberately held authentication transport to keep the arrival visible. This was a local loading-state fixture, with no account data access or model requests; it does not establish production authentication or loading performance.
- Desktop and mobile English screenshots were visually inspected. Runtime evidence is in the task's `output/playwright/arrival-language/` directory.

Production deployment and acceptance are tracked separately from these local checks in the pull request and delivery result.
