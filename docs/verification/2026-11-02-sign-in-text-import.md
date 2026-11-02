# Sign-in and text import verification — 2026-11-02

Scope: restore the home sign-in entry when the portal module is unavailable; make TXT/Markdown decoding consistent for UTF BOMs and common Chinese GB/CP936 bytes, including subsequent source evidence. The broader import unification proposal is in [the design document](../superpowers/specs/2026-11-02-unified-book-import.md). Its capacity and pipeline changes are not implemented by this patch.

## Reproduction and correction

- A fresh browser context with service workers blocked and `portal.js` aborted reproduced the inert home button. A real `/library?login=1` anchor now provides navigation before JavaScript readiness; the mounted handler retains modal sign-in and preserves modified link clicks.
- A synthetic library 500 response showed that login navigation also waited on the shelf. Guest login now opens after identity settles, before the optional shelf response. The entry is consumed for both signed-in and guest identities, preventing logout from reviving it.
- Before the decoder fix, the native GB fixture became unrelated UTF-16 characters; a binary fixture was accepted as a book. Web UTF-16 imports failed. The new decoder respects BOMs, requires evidence for BOM-less UTF-16, accepts common GB/CP936 compatibility mappings, and separates blank text from invalid encoding and non-text input.
- The source-evidence service now reuses the import decoder instead of forcing UTF-8. Synthetic CP936 and GB compatibility-alias originals remain byte-for-byte unchanged.

## Verification evidence

- Local `npm run verify:deploy`: 4,525 tests, 4,524 passed, one skipped; runtime, public build, release allowlist and packaged-source checks passed. A later focused run after the final login lifecycle change passed 69/69; final JavaScript build passed. GitHub CI must validate the committed head separately.
- Native core suite: 246 tests, 245 passed, one explicit skip for the opt-in private local sample. That sample was then enabled separately and passed 1/1. The complete original was imported into a temporary device-local library and its normalized paragraph digest matched an independent WHATWG GBK decoder. The stored original matched all input bytes. Temporary sample data is excluded from the repository.
- iOS Simulator target built successfully with code signing disabled. This is build verification, not a physical iPhone or TestFlight installation claim.
- Browser acceptance against an isolated local server: the unloaded-portal link navigated to `/library?login=1` and opened the dialog; a library 500 did not prevent the dialog from opening. No account login, email, model request or production data write was performed.
- Independent review identified and verified fixes for source-evidence decoding, GB alias rejection and login-entry lifetime. Final review reported no remaining P1/P2 findings.

## Limits

The supplied large text exceeds the web's existing 20 MiB source limit. This patch does not raise it or unify all upload entry points. Encoding detection with previews, shared capacity policy, chapter identity and task contracts remain proposed work. Native changes require a new app distribution before an installed phone receives them. The original user browser's exact failure condition was not observed; the unavailable-module condition was reproduced explicitly.
