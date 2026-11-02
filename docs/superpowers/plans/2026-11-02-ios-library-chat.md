# iOS Library and Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track actual evidence; do not equate source, simulator, production, and TestFlight.

**Goal:** Deliver manageable shelves, explicit duplicate choices and natural text/voice conversations.

**Architecture:** Keep SwiftUI, OfflineLibrary and the existing account-scoped server services. Separate content digests from intentionally distinct book identities. Store voice media behind authenticated owner-bound routes and retain transcripts in ordinary conversation turns.

**Tech Stack:** Swift 5.9 / iOS 17+, SwiftUI, Speech, AVFoundation, native CommonMark/GFM parser; Node 22+, official DSH SDK.

**Spec:** `docs/superpowers/specs/2026-11-02-ios-library-chat-design.md`

## Global Constraints

- Existing personal records survive keep/replace/delete/restore. Add-as-new starts independent records.
- Real data stays outside Git. Tests use isolated fixtures. Persisted acceptance data belongs to test@cubxxw.com only.
- Keep identity checks, cancellation, idempotency and uncertain-result recovery.
- Native microphone permission is requested only by a user microphone action.
- Only current task changes are delivered. Preserve unrelated untracked materials.

## Review Focus

- A copied book must remain readable after relaunch, export/import, repair, and cloud upload without failing digest validation.
- Offline deletion and delayed cloud acknowledgements must not resurrect a removed book or hide another account's books.
- Model compaction must retain the current question, roles and tool-result pairing without deleting original history.
- Sending/cancelling during speech finalization or an account switch must not submit or expose another recording.
- Voice/long-answer additions must work through streaming, history, retries and Markdown rendering rather than only one endpoint.

### Task 1: Assistant runtime and durable conversational history

**Files:** `harness/chat-generator.mjs`, `harness/chat-plugin.mjs`, `server/reader-chat.mjs`, chat history/model helpers, focused JS tests.
**Interfaces:** Keep existing generator/job API; accept optional `voice` metadata on a turn validated against an injected owner-bound media service. Root implementer supplies the media service and native UI.

- [ ] Add failing behavior tests for direct-send compatibility, >6-turn history, long prompts/answers, model-derived capacities and context compaction.
- [ ] Remove conversational confirmation requirements and product quotas while preserving billing receipts, permissions and retry safety.
- [ ] Simplify the conversational instruction, use model capacities, and retain/compact history as required.
- [ ] Test all affected runtime, chat, stream and history behavior; document exact limits imposed only by transport/provider.

### Task 2: Shelf management and quiet reading

**Files:** native `LibraryScreen.swift`, `LibraryPresentation.swift`, `BookDetailScreen.swift`, `ReaderScreen.swift`, shelf/model helpers and tests.
**Interfaces:** Existing account archive/restore queue; local reversible archive helper implemented in its own OfflineLibrary extension. Coordinate `LeafhourApp.swift` edits with Task 3.

- [ ] Add tests for recent-reading default/unread fallback and local/account delete/restore.
- [ ] Add single/multiple removal and recovery with clear consequences and usable selection controls.
- [ ] Hide system status bar only in reading; preserve chosen sort settings.
- [ ] Verify Swift tests and native screens, including large text.

### Task 3: Duplicate import choices and independent identities

**Files:** `OfflineLibrary.swift`, import/identity helpers, cloud upload client, duplicate server/library/import code and tests; coordinate model/shelf UI edits with Task 2.
**Interfaces:** Native duplicate detection and explicit keep/replace/new policy; stable operation identity for a new copy; server upload/import accepts equivalent optional policy while old clients default to keep.

- [ ] Add failing tests for the three choices, independent state after reopening, retry idempotency and original integrity.
- [ ] Implement explicit choices for local import and cloud upload using existing identity/ownership boundaries.
- [ ] Preserve old package compatibility, source digests, personal state and recovery originals.
- [ ] Verify affected JS/Swift tests and the complete import UI flow.

### Task 4: Native conversation, Markdown and voice media

**Files:** `ChatConversationView.swift`, `ReaderCloudTools.swift`, new speech/composer/Markdown components, native cloud chat models, `Info.plist`, owner-bound server voice service/routes, focused tests.
**Interfaces:** Voice receipt `{id, mimeType, durationMs}`; transcript is the turn question. Audio route authenticates the current owner and returns only that owner's asset. Existing text-only turn shape remains valid.

- [ ] Test direct send, draft restoration on speech cancellation, recording lifecycle, voice ownership and uncertain retry identity.
- [ ] Remove ordinary-chat confirmation, implement native Markdown and keyboard-aware microphone/text/send composer.
- [ ] Record/play audio and recognize live speech, finalize once on send, retain pending media until a trusted receipt.
- [ ] Integrate streaming/history/voice metadata and verify on the simulator.

### Task 5: Integration, independent review and delivery

- [ ] Run affected host/Swift/application checks and native build; inspect actual screenshots.
- [ ] Independently review complete diff and fix meaningful findings.
- [ ] Update behavior/verification docs with actual evidence and limitations.
- [ ] Commit one coherent delivery, push, create PR, wait for current CI and merge normally.
- [ ] Track existing production and TestFlight automation and distinguish merged, deployed, processed and device-verified outcomes.
