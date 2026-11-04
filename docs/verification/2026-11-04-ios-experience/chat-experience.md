# Chat experience implementation and evidence

Date: 2026-11-04. Implementation agent: chat_experience. Independent visual and interaction acceptance belongs to the parent review run; no subjective 9.5/10 or physical-device claim is made here.

## Delivered

The shared conversation surface places reader messages on the right in a restrained adaptive green fill and assistant replies on the left in an adaptive neutral fill. Repeated “你问” captions disappear. Native selectable text, Markdown, source excerpts, reply identity, voice attribution and failed/running states remain. Empty companion prompts no longer create a fictitious reader bubble or share message.

Both the native text-selection menu and whole-bubble menu expose reference, whole-message copy, six built-in reactions, multiselect and share/forward. Multiselect preserves original speaker/order. Existing like actions remain compatible with the native menu. Reactions are stored with the existing account/book-scoped local draft, have a removable badge and a brief notice. A reaction saves locally without submitting a model request. The next explicit question carries only reactions on messages with the same captured content version; historical and unversioned local marks remain visible without blocking a new edition's chat.

The new chat share sheet uses the common long-image renderer and three styles. Style and optional adjacent-context controls precede the image. Adjacent excerpts are disabled by default, retain their author, and are previewed in full before export; clipping is marked with an ellipsis. The QR leads to Leafhour's home page, never a public private-conversation endpoint. The system share sheet handles destinations and forwarding.

## Server contract

Reactions contain only turn identity, user/assistant role and an allowlisted emoji. Before generation, each target resolves from the authenticated owner's existing conversation, with book/version and completed-assistant checks. Client-supplied message text and arbitrary reaction labels are rejected. Book, account-wide and local-book chat all use this contract. Resolved reactions enter the model as attributed JSON data. Paid requests preserve canonical reaction targets for exact retry matching. Book export/restore validates reaction text against the complete imported history; repeated import remains idempotent.

## Checks actually run by this agent

- Initial reaction/encoder test failed before encoder integration, then passed.
- 94 Node checks passed across reaction, encoder, book chat, account chat, local chat and billing-related suites. Log: `/tmp/leafhour-chat-tests.log` (ephemeral, not committed).
- The expanded reaction-only run passed 5 checks, including paid account/local exactly-once receipt recovery and book export/restore. Log: `/tmp/leafhour-reaction-final.log` (ephemeral).
- A newly added second restore reproduced the independent review finding before repair. With the answer-only comparison excluding already-validated relationship metadata, the repeated restore check passed.
- Swift frontend parsing passed for changed conversation, text menu, tools, share-panel and test sources. This is syntax evidence, not an app build.
- Added app tests cover reaction restoration and explicit-send timing, legacy-like removal, stale/unknown-version filtering, ordered attribution, companion omission and context author preservation.
- Added isolated `IOSLibraryChatUITests.testMessageReactionMultiselectAndArtisticSharePreview` covers a synthetic send, native reaction menu, multiselect and all three share styles with explicit adjacent context. Parent runs the compiled app/UI tests and retains simulator screenshots.

## Independent review corrections

Fixed duplicate book restore failing on a single-row answer comparison, legacy like removal re-applying a thumb, clipped context losing its speaker, empty companion reader bubbles, and obsolete-edition reactions blocking normal sends. No service-side ownership or version check was relaxed.

## Outstanding acceptance

Actual UI-test execution, screenshot-based spacing/contrast review, VoiceOver operation, hardware haptics, external destination installation and physical iPhone experience are not established by these source checks. The 9.5 target must be evaluated from that evidence, not inferred from test count.
