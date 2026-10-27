# GET-276 native source delivery

The owner explicitly resumed source development on 2026-10-27 after the Apple preflight: native project, interfaces, complete EPUB/PDF import and offline reading must proceed independently of Apple login. TestFlight and physical-device acceptance remain separate dependencies. No Apple application was created, no permissions were expanded and no tester was invited.

## What this source phase implements

The iOS 17+ app uses SwiftUI navigation, the system file picker, UIKit text selection and PDFKit. Device-local books are available without Apple/cloud login. The native library, import/retry, book detail and integrity/repair, reading, contents, full-text search, preferences, original quote, personal notes/drafts and export screens use actual local content. There are no preloaded sample books, test-only app entry points, fabricated translations, OCR results or model answers.

The original is retained before parsing. EPUB import consumes the complete spine plus supplementary XHTML and local resources; PDF preserves all original pages, even when text extraction is absent. TXT and Markdown import as plain text. Bounded entry iteration, expanded/individual byte limits, CRC checks, safe paths and entity checks protect extraction. Offline status requires a complete verified manifest. Incomplete/failed/cancelled imports retain a retryable source. Duplicate bytes identify an existing book without overwriting its personal records.

Atomic scoped storage separates device-local data from authenticated-account UUID namespaces. These tests prove namespace isolation, not a shipped cloud login. Stable source versions and paragraph/page anchors bind notes, drafts and continuation. Repair uses a persistent directory-swap journal; a missing index still exposes a recoverable library entry. A newly selected matching original can repair a damaged original/manifest without replacing notes. Failed saves remain visible and block exits that would drop the in-memory draft.

The debug bundle `org.leafhour.local` is an unsigned local development identity. Release requires the verified existing application's identity through ignored signing configuration. The project does not register an application or assume App Store Connect access. The code-signing certificates found during preflight are not distribution acceptance.

## Verification and evidence

- **21 host Swift tests passed**, including complete 12-chapter EPUB and all-page PDF, original-byte preservation, deduplication, state/draft cold restore, namespace isolation, corrupt/missing content, interrupted-job recovery, repair-swap crash recovery, selected-original repair, `.md` repair, staging cleanup, PDF repeated-text ranges, unique passage IDs, UTF-16 entity rejection and XHTML whitespace/preformatted semantics.
- **62 related Node tests passed**, including native dependency tampering, existing reader prototype interactions and release-policy checks. The independently pinned vendor checker validates all 26 files of ZIPFoundation 0.9.20 against upstream Git blobs and SHA-256. Upstream commit: `22787ffb59de99e5dc1fbfe80b19c97a904ad48d`; MIT license included. No dependency download is needed for native builds.
- Pinned Vale 3.24.0/textlint 15.8.0 copy lint and the planted copy canaries passed. Existing warnings/debt remain visible; no unrelated copy was edited. The frozen public source object was fetched before checking debt bindings. Release allowlist validation passed with native source included.
- Unsigned arm64 iOS builds passed. Native tests use only the existing allowlisted **Primary iPhone / iPhone 17 Pro / iOS 26.5**, through the machine-wide `dev-ios-session` guard. No simulator was created, cloned, erased or taken from another owner.
- Final native UI run passed **3/3 tests**: EPUB chapter XII + cold resume; native long-press selection + draft relaunch; PDF system import + page 73 of 73. The final run used the reviewed source including save-failure exit guards. Physical iPhone/TestFlight results are not inferred from these checks.

Native acceptance documents are disposable derivatives of the repository's public-domain `catalog/alice.txt`: the full 12 narrative chapters as EPUB and the complete local text rendered into a 73-page PDF. PDF generation maps unsupported WinAnsi glyphs only in that test derivative; the native app reads the actual supplied PDF and does not perform that conversion. These documents are not bundled with the app or committed. Their manifest, original hashes and generation record are retained with local evidence. They establish whole-file/whole-spine/page coverage for the supplied documents, not universal EPUB/PDF compatibility or physical-device acceptance.

Earlier failed runs are retained. They exposed paragraph-ID collisions, repeated-PDF-quote offsets, UTF-16 entity detection, recovery dead ends and save-failure exits; confirmed source issues were fixed and reviewed. UI locator corrections are separate: file icons rather than filename labels select PDF documents, native edit actions are MenuItems, and XCUI normalized slider movement is approximate. The last PDF page is checked using the explicit next-page control. A draft test preserves pre-existing content and compares the actual UI text before/after relaunch instead of assuming an empty draft.

Independent sub-agent review was performed before delivery. All confirmed P0/P1 findings were closed; tests, CI, merge and external acceptance are separate evidence states.

[EPUB cold resume](screenshots/epub-cold-resume.png) · [EPUB chapter XII](screenshots/epub-last-chapter.png) · [Native draft restored](screenshots/native-draft-restored.png) · [PDF page 73/73](screenshots/pdf-last-page.png). The screenshot hashes and test identifiers are in [ui-evidence.json](ui-evidence.json).

## Acceptance still open

| State | Result |
| --- | --- |
| Native source, host tests, unsigned build | Implemented and locally verified as above |
| Primary simulator UI | 3/3 actual native UI tests passed |
| Cloud account, upload/download queue and sync conflicts | Not connected in this device-local phase |
| Existing literal/interpretive translations and cloud companion | No native service integration claimed; original remains readable |
| Real airplane-mode cold start and device interruption/storage testing | Pending physical acceptance |
| VoiceOver, large-text/narrow-screen/iPad matrix | Implemented system semantics; complete matrix not accepted |
| App Store Connect identity/signing, archive/upload and Apple processing | Pending existing Apple access |
| Test group, invitation, acceptance and physical installation/update | Pending confirmed authorized group/tester and device |
| Update data retention through TestFlight | Pending real update |
| Linear Done | Prohibited until the full issue acceptance is complete |

The existing Leafhour Figma/Web prototype remains a design reference. It is not native validation. This source phase does not close GET-272/273/274 or claim their canonical delivery.

## Reproduce

Build/test commands and data boundaries are documented in [the native README](../../../apps/ios/README.md). Host core tests need no simulator. The optional `LeafhourUITests` scheme uses the actual system picker and requires the named public acceptance files in this test app's Documents; it does not add production test hooks. Use a registered output directory, acquire the shared Primary guard, install the unsigned test app and retain its existing data. Do not delete/reinstall a user's app or erase the shared simulator to obtain clean state.

Full runtime logs, original failed runs, dependency acquisition diagnostics, fixture hashes, `.xcresult` bundles, review and resource receipts are preserved under the task's permanent local evidence directory. Only rebuildable task outputs may be reclaimed after source delivery and formal evidence preservation. The pending issue worktree and installed app data remain protected.
