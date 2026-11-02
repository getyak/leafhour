# iOS library and conversational AI

Date: 2026-11-02. Status: implementation authorized by the user's five-part request. The repository instruction to proceed when scope and authorization are clear takes precedence over redundant design-confirmation gates.

## Intent

Make the native iOS library manageable and the assistant natural to talk to. Retain the native SwiftUI app and shared account-scoped services. Preserve originals and existing personal records. A new copy of a book intentionally starts an independent reading record.

## Decisions

- Single-book and multi-select deletion move books into a recoverable removed collection; restoring returns the same identity and records. Device-local and account libraries remain isolated. Removing a local download is distinct from removing its cloud shelf entry.
- Default order is recent actual reading, descending; unread books fall back to their addition date. Addition order remains selectable. Preserve an explicitly chosen saved order and pins.
- Hide the system status bar, including its time, throughout the reading surface; ordinary library and chat screens keep system behavior.
- On an identical-source import, show Keep original, Replace book, and Add as new book. Keep returns the existing identity; replace refreshes the original/package under the existing identity and preserves personal state; new creates a distinct durable identity with empty personal state. Retries of an explicit copy operation reuse its operation identity. Do not silently overwrite. Names alone do not establish duplication.
- Sending a chat message is its submission. Remove the second confirmation for ordinary chat. Retain uncertainty-safe retries, cancellation, current identity checks, and actual billing accounting. The request supersedes the old six-turn/24 KiB conversational context contract; it does not grant access to other accounts or private notes.
- Use the configured model's published/discovered context and output capacities. Do not impose product turn-count, daily conversation, small token, or tool-call budgets. Compact older context when the model window requires it and retain original history. A transport payload limit must not silently become an AI context limit.
- Keep the main system instruction short: the assistant is 松鼠, Leafhour's conversational assistant, with environment and available tools supplied separately. Source attribution and account permission enforcement remain in tools and services.
- Render Markdown blocks natively: headings, paragraphs, lists, quotations, code and tables, with selection/copy and safe links. Match the existing reader typography without turning whole answers into dense cards.
- Composer has a smaller microphone on the left, a growing text field, and send on the right. Keyboard dismissal is available without inserting a third competing button into the composer. Keep the draft visible above the keyboard, including on small screens and accessibility sizes.
- User clarified: sending while recording produces a playable voice message plus its transcript. Live speech recognition fills the composer; tapping the microphone again cancels and restores the pre-recording draft. Sending finishes recognition, retains the recording, uploads it to owner-scoped storage, and submits exactly once. Permission denial, interruptions, backgrounding, account changes and network uncertainty have explicit recovery. Cancelled audio is not uploaded. Existing text-only clients remain compatible.

## Approaches

1. Native UI plus shared services (selected by implementation judgment): reuses current authentication, storage, tools, and offline architecture; requires coordinated Swift and server changes.
2. Embed the web chat/library: smaller native change, but retains keyboard and interaction inconsistency and does not solve offline book identities. Rejected.
3. Replace the assistant runtime entirely: broader migration without a demonstrated need. Retain official DSH and adjust its session/context integration first.

## Validation

Behavioral tests cover preservation/restoration, ordering, independent book copies, duplicate retries, direct chat submission, long context/compaction, owner-bound voice retrieval and voice cancellation. Run affected JavaScript tests, Swift Core and application tests, build the native app, and inspect real simulator screens for library, Markdown, composer and quiet reading. Real microphone hardware, audio routing and physical-device VoiceOver remain separate from simulator evidence. Review before delivery; use the repository's PR/CI/merge workflow and follow existing production/TestFlight automation without duplicate manual releases.

## Sources

- https://api-docs.deepseek.com/api/list-models/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest
- https://developer.apple.com/documentation/speech/sfspeechrecognizer/requestauthorization(_:)
- https://developer.apple.com/documentation/swiftui/view/statusbarhidden(_:)
