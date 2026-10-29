# GET-312 connected iOS reader verification

Issue: [Connect the iOS library and add native reading tools](https://linear.app/getyak/issue/GET-312/connect-the-ios-library-and-add-native-reading-tools). Integrated with public main `9ed97de`, including GET-274's native selection dismissal and companion half sheet. Exact final application/core source hashes are in [evidence.json](evidence.json).

## Delivered behavior

The native app uses the website's email/password or email-code login and existing owner-scoped APIs. Downloaded books, saved notes, reading positions, recorded reading activity and saved notebook summaries belong to the signed-in account. Keychain retains the opaque session; URLSession cookies and account caches are isolated. Signing out returns to the separate device library.

Notes and positions save locally before synchronization. Stable IDs deduplicate retries; remote note edits/deletions propagate without replacing conflicting local edits. A newer remote position requires a choice. Oversized notes remain local and do not block valid notes or progress. Original upload is explicit, with unique exact source matching for migrating local references; ambiguous references stay in the original local book.

Markdown uses pinned official Swift cmark/GFM with native attributed text, continuous selection and Unicode source mapping. Headings, emphasis, lists, quotes, code and native tabbed tables render without source markers. Search operates on visible text and returns source anchors. Cloud Markdown chapters remain separate, and historical source IDs and original bytes are retained.

The compact native dock exposes contents, system listening, translation, notes and additional tools. It sleeps during reading and can be restored from the edge/handle. Translation, typography, search, saved introductions, conversation and export use native panels. GET-274's explicit companion and PDF selection actions now reach the real account service. Companion dismissal clears native selection and returns directly to reading; actual notes keep their save gates. Additional website tools use a clearly labeled ephemeral WKWebView with exact-origin navigation and an isolated session.

## Executed checks

| Check | Actual result |
| --- | --- |
| Core host suite | 76 tests, 0 failures |
| Native app model/policy tests | 18 tests, 0 failures; actual unsigned app build |
| Native account/reader UI probe | 1 complete XCTest, 46.943 seconds, 0 failures |
| Web reading regressions after main integration | 46 tests, 0 failures |
| iOS release/vendor Node contracts | 90 tests, 0 failures |
| iOS Python contracts | 9 tests, 0 failures |
| Independent review | Six initial findings repaired; follow-up and integration reviews clean |

The UI probe used only synthetic data in `org.leafhour.get312-probe` on the existing Primary iPhone / iPhone 17 Pro / iOS 26.5. It exercised native login, account shelf, saved summaries, cloud download, formatted Markdown, two distinct translations, the listening panel without autoplay, cloud notes, chapter isolation and the real companion composer with the keyboard. It returned to reading without generating a model answer. Actual screenshots are in [screenshots](screenshots/); the source fixture and probe are in [probes](probes/).

The test initially exposed a clipped first heading and loose Markdown spacing; final screenshots reflect the repaired layout. A later screenshot exposed cached translation content with a failed online refresh: the tool's duplicate path encoder escaped hyphens in book IDs. The new regression failed first, and the fix reuses the shared RFC 3986 encoder. The accepted UI run checks that refresh has no error and original Markdown is readable in the translation panel. Earlier compile/setup failures, a virtualized offscreen-row assertion and a resume-position assumption are excluded from acceptance.

Accepted raw XCTest bundles are retained in [native-results.tar.gz](native-results.tar.gz). Every archived file was compared with its source SHA-256. Logs and review reports are retained separately. Vendored dependencies have independent manifest pins and file length/SHA-256/Git-blob checks; upstream source whitespace is preserved, so the source diff whitespace check excludes the pinned vendor directory.

## Actual production account integration

The same Swift client logged in through the existing Keychain credential, verified the default test account and read 103 shelf books. A complete existing book downloaded as 7 chapters / 579 passages, with matching source IDs and personal-record version. No existing book or personal record was written by this read probe.

A separate, tiny original Markdown fixture verified the actual upload and synchronization chain in that account. Eight checks passed: upload identity, complete download, note/progress publication and readback, repeat-sync deduplication, remote note edit pull, preserved progress conflict and explicit cloud-position resolution. Its one note remained one note after retries. The exact returned fixture identity/version/source hash/filename and current account were checked before a compare-and-swap archive. Readback confirmed absence from the active shelf and presence in the recoverable trash. No other book was modified; no model request was made. See [live-sync-result.json](live-sync-result.json).

## Scope and pending distribution

Cloud downloads are verified **text and existing-translation reading copies**. Original EPUB/PDF files remain separate in the cloud; local EPUB/PDF originals retain the existing native reading path. Local drafts stay on the device. System listening uses installed device voices and pauses when backgrounded. Additional website tools are explicitly identified as web tools rather than counted as native parity.

These results establish source, host, simulator and the described production API checks. They do not establish physical-device audio quality, full VoiceOver, small-screen/iPad acceptance, signed distribution, TestFlight upload/availability, installation or update retention. GET-276 remains the owner of that broader acceptance. No first-upload or automatic-TestFlight switch was changed.
