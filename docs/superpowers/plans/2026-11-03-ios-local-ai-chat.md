# iOS local AI and immediate chat implementation plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent server/UI tasks. Steps use checkbox syntax.

**Goal:** Use native local books with AI without cloud-library upload and make chat immediate, compact and responsive.
**Architecture:** Keep DSH on the existing model service; relay read-only local tool requests through authenticated NDJSON and owner/run/call-scoped shared documents. Native tools resolve against a captured local book/version; optimistic UI and streamed responses apply to cloud and local book chat.
**Tech Stack:** SwiftUI, LeafhourCore/Foundation, Node ESM, official DSH, existing document CAS and billing.
**Spec:** ../specs/2026-11-03-ios-local-ai-chat-design.md

## Global Constraints

- No private-note access, original upload, fabricated translations or cross-account reads.
- Official DSH and existing billing remain authoritative; account login for model service is independent from book upload.
- Source versions/IDs and uncertainty-safe retries remain stable. Provisional streamed text is not a terminal receipt.
- Existing unrelated output files are excluded. PRs run CI only; main releases through existing automation.

## Review Focus

- Cross-account, cross-book, stale-version and late tool replies must not broaden source access.
- Interrupted sends must retain one immutable message and recover the same request.
- Main-actor work on large local books must not stall return navigation.
- Duplicate and out-of-order stream events must not resurrect cancelled/replaced turns.
- Narrow screens and Dynamic Type must preserve composer, source removal and return controls.

### Task 1: Server local-tool relay
- [x] Add failing server tests for owner/run/call isolation, cross-instance result delivery, cancellation and duplicate sends.
- [x] Add local chat routes with shared-document relay, existing runtime/billing, bounded validation and honest source provenance.
- [x] Run affected server tests and inspect authority/lifecycle behavior.

### Task 2: Native source tools and transport
- [x] Add failing Core tests for current context, outline, paged reading/search, citations and source mismatch.
- [x] Implement local read-only tools and incremental NDJSON transport, bound to captured owner/book/version.
- [x] Connect local-book chat, drafts/recovery and cloud streaming in ReaderCloudTools and ReaderConversationPanel.
- [x] Verify immediate immutable outgoing messages, incremental answers and same-request recovery.

### Task 3: Compact chat and responsive return
- [x] Simplify ChatConversationView and reduce assistant typography; consume model loading/optimistic state.
- [x] Diagnose and correct return latency while preserving local saves; inspect simulator screens and interaction timing.
- [x] Run native Core/application tests and simulator build under the existing device/storage guard.

### Task 4: Review and delivery
- [x] Review integrated diff, resolve findings and run affected checks/build.
- [x] Write verification evidence, commit task files, push once and open PR.
- [ ] Wait for CI, merge normally, track production/TestFlight and separate live/device acceptance.
