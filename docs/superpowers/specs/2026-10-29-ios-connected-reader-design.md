# Connected native reading (GET-312)

The reader should use the same Leafhour account and personal library as the website, render imported Markdown as a document, and make reading tools easy to discover and comfortable to use on iPhone. This implements the user's three requests in that order. Implementation choices below are the agent's decisions under the repository's standing autonomous delivery authorization.

## Approach

Keep the iOS 17 SwiftUI application and native text selection. Reuse the existing authenticated domain APIs rather than introducing a separate Supabase client or duplicating server authorization. Use an isolated URLSession and Keychain-backed session, account-scoped offline storage, stable cloud chapter/passage identifiers and an explicit upload action. Preserve anonymous device books in their existing namespace.

Persist notes and progress locally before networking. Retry note writes using stable identifiers. A newer cloud position produces a visible conflict and keeps the local position until the reader chooses. An interrupted or offline request must not report a successful sync. A downloaded text reading copy is labeled separately from its original EPUB/PDF; incomplete content must not be called a complete offline book.

For Markdown, compare native open-source alternatives against long-document selection and existing anchors. Use the official Swift cmark/GFM parser with a native attributed-text renderer and source offset mapping. Keep original source bytes, passage IDs and existing personal data. MarkdownUI's current maintenance status and block-level selection make it a weaker fit; replacing the whole reader with a web renderer would require replacing already-tested native selection/reflow behavior.

Expose a lightweight reading toolbar when entering a book. Let it sleep while scrolling and return through the existing edge affordances. Use native sheets for contents, notes, search, typography, translation, listening and companion actions. Keep ordinary text taps inert. System speech offers local listening; translation and companion requests use existing cloud endpoints only after an explicit user action. Missing translations and unavailable/offline services remain visible states.

## Interfaces and ownership

- `CloudLibraryClient.data(path:method:body:ownerID:) async throws -> Data` centralizes authenticated requests.
- `LocalBook.cloud: CloudBookIdentity?` carries the server book ID/content version independently from local integrity hashes.
- Cloud chapter and passage IDs remain the authoritative source anchors.
- Account worker: client, login/account UI, shelf, offline cloud copies, sync and core tests.
- Markdown worker: pinned parser sources/licenses, source mappings, renderer and parser tests.
- Reader worker: toolbar, native panels, local speech and explicit cloud reading tools.
- Controller: integration, bounded tests, independent review, PR/CI and delivery evidence.

## Acceptance

1. Log in and restore the same account; list and download its books and display its notes, progress, activity and available summaries. Save a note and position offline, then synchronize safely. Switch/sign out without exposing another account's cache. Keep local unsigned books recoverable.
2. Render headings, emphasis, links, lists, quotes, fenced code and GFM tables without exposing source markers. Verify Unicode selection, source references, reflow and legacy imported books.
3. Discover and operate native tools, start/pause listening, inspect existing translations and explicitly request absent ones, return from panels to the same book position. Verify accessible labels, touch sizes and reduced-motion handling.
4. Host tests, unsigned simulator build, focused native integration probes and independent review precede source delivery. CI/merge, website release, TestFlight distribution and physical-device acceptance are separate evidence states.

No full-book model generation, paid task, proactive notification, account migration, signing change or new tester invitation is implied by this work.
