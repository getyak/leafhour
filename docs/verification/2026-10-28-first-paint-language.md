# First-paint interface language

The library and reader used fixed English static HTML, then restored a query, device or account language in browser modules. The initial singleton could also start English while account adoption was still pending. A server-renderer-only fix would remain shadowed by Vercel's public HTML files.

## Result and boundaries

The canonical root, library and reader now receive localized HTML from a small entry function. Selection is one valid `ui` value, verified account preference, device hint, then browser language. UI owners await the selected catalogue; book text, translations, notes, source language and reading progress retain their existing ownership. Entry reads do not save preferences or invoke model services.

A nonsecret device hint makes the selected language available before modules run. Legacy browser-only choices navigate to a distinct owned document URL before paint and restore the canonical address, business query and fragment. A cross-site request without the Strict session cookie first receives a language-neutral document, then recovers the cookie on the same-origin alias. Auth cookies remain Strict. A failed catalogue or abandoned navigation has a native reload action instead of silently constructing English controls.

The compiled reader template is private in `.ui-entry/read.html`; canonical public HTML files are absent so the function rewrites are used. The fixed classic head script has a precise CSP hash. No `unsafe-inline` script policy is added.

## Local browser evidence

System Chrome, isolated temporary accounts and temporary books directory; no real account content or model calls. The HTTP entry/auth/preference services were real local domain services. Static JS/CSS requests were fulfilled with the identical source/build file bytes to avoid the local HTTP/1 module queue. These timings are not production performance measurements.

- Nine initial/refresh journeys: all four explicit languages, legacy Japanese device choice, account Japanese overriding English device choice, follow-system Traditional Chinese, Japanese reader and automatic account homepage entry. Non-English catalogues were delayed 1,200ms; sampled real first-contentful paints and later frames contain no wrong-language sample. [Paint receipt](2026-10-28-first-paint-language/local-paint.json).
- Distinct-document/fragment checks: legacy device `/library?sort=recent#p1` and an actual external-site click with a Strict account cookie. The external request arrived without authentication, the owned alias arrived with authentication, and the final canonical address kept its query/fragment. No wrong-language sample. [Handoff receipt](2026-10-28-first-paint-language/local-handoffs.json).
- Recovery checks: blocked cookie, blocked localStorage with valid hint, failed Japanese catalogue with native Japanese retry, manual Traditional Chinese preference saved through the real local account service and restored in a fresh browser. [Recovery receipt](2026-10-28-first-paint-language/local-recovery.json).

## Regression and release gates

Failing regression tests were observed before the codec/bootstrap/runtime implementation and before fixes to the serialized script, verified-session fence, account seed clearing and fragment document handoff. Targeted tests cover selector validation, owner changes, no preference writes, catalogue failure, CSP bytes, function packaging and public route shadowing.

Pinned Vale/textlint copy lint and canaries pass; existing documented copy debt remains visible. The reader bundle is 321,886 bytes JS and 204,762 bytes CSS, within the existing 320/200 KiB limits. The source branch includes the concurrent mainline homepage, support navigation, library arrival and reading-sidebar changes through `cc3e40f`.

Full verification, independent review, CI and production receipts are recorded below after each completes. Local evidence alone does not assert a production release.

Local `npm run verify:deploy` completed successfully: 3,943 tests passed, 14 native/platform cases skipped locally, zero failures. The 928-file isolated function runtime initialized without model requests; public build and 1,205-file release allowlist checks passed. Required native PostgreSQL and native iOS checks remain CI gates. A fresh independent review approved the full synced diff with 45 focused checks and no unresolved blocker.
