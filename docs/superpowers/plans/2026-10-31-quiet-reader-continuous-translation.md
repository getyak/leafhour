# Quiet reader and continuous translation implementation plan

> **For agentic workers:** Use superpowers:executing-plans or scoped parallel work with the file ownership below; use test-driven-development and a fresh whole-branch review.

**Goal:** Implement the approved quiet iOS reader and automatically prepare missing translations for the current and immediately following chapter on every maintained reader surface.

**Architecture:** Preserve the native source text, selection and stable anchors. Separate reading tools from their presentation so available window space can change without recreating the session. Add one shared, authenticated, single-passage translation step API; all clients drive this serially while reading, first finishing the current chapter and then preparing only its immediate successor. Reuse the existing translator, source/version checks, durable billing ledger, caching and two independent translation variants.

**Tech Stack:** SwiftUI/UIKit/PDFKit, LeafhourCore, Node ES modules, the shared web/Android reader runtime.

**Spec:** `docs/superpowers/specs/2026-10-30-iphone-duo-reader-design.md`, plus the user's 2026-10-31 automatic translation instruction, which supersedes the old explicit-generation-only rule for this bounded reading workflow.

## Global constraints

- iOS 17 minimum remains. Current host has Xcode 26.6/iOS 26.5; do not claim new Duo reserved-region APIs or true Duo simulator acceptance without the matching SDK.
- Main text remains selectable; source IDs, Unicode source anchors, notes, cached originals, PDF positions and cloud owner/version remain authoritative.
- Automatic generation is limited to current plus immediately next chapter, sequential single-passage requests. No whole-book traversal, background push, account switch, provider replacement or pricing bypass.
- Missing translations start preparing automatically; no static “尚无译文，以下保留原文” in ordinary article flow. Loading/failure/offline/funds states remain honest and actionable. Source remains available through original mode.
- Existing reviewed translations are retained; literal and interpretive remain independent AI drafts. Automatic arrivals preserve reading anchor and do not silently switch reading mode or replace an active text selection.
- Native tests/builds run through `dev-ios-session`; use Primary iPhone and shared artifact scratch storage. Agents do not start overlapping builds.
- Submit the final coherent change to PR #273 after checks and independent review. Keep unrelated work intact.

## File ownership and interfaces

1. **Server/web worker:** Own `server/reading-translation.mjs`, the route integration in `server/portal.mjs`, `app/reader-auto-translation.mjs`, its browser entry wiring, passage-state messages and corresponding Node tests. Do not edit iOS files.
2. **Native UI worker:** Own `ReaderScreen.swift`, a focused adaptive layout/toolbar file, `ReaderPanelPresentation.swift`, necessary `ReaderPanels.swift` dismiss/presentation changes and focused AppTests. Do not edit automatic translation or core content types; coordinate before any shared-file change.
3. **Controller:** Own native translation coordinator, ReaderSession content overlays/preferences, rendering/source mapping in TextReadingView, cloud cache integration, tool integration, docs and final integration checks.

Shared API: `POST /api/library/books/:id/reading-translation` accepts `{chapterId, contentVersion, phase: "current" | "next", passageId?: string}`. `chapterId` is always the current chapter; the server resolves the next chapter itself. A call generates at most one missing eligible passage. Response: `{contentVersion, chapterId: targetChapterId|null, phase, done: boolean, passage?: <existing paragraph payload>}`. `done` means no eligible missing passage remains in that phase after this receipt. Auth, version, chapter membership and configured translation are checked before provider work. Request/ledger IDs are deterministic per owner/book/source/passage and retain existing retry/settlement safety. The next phase cannot recurse into a third chapter. On a terminal rejection clients stop until explicit retry or a changed reading scope.

## Review focus

- Account/source changes during preparation must never publish into a different book or charge an unrelated account.
- Concurrent web/native readers must not duplicate provider generation or settled charges.
- Selection and note editing during a translation arrival must not acquire a false source quote or move the source anchor.
- Rapid compact/wide/keyboard transitions must preserve drafts, active request identity, PDF and text position.
- Offline, missing model access, oversized paragraphs, exhausted credits and cancellation must stop bounded work without retry storms or fabricated success.

## Task 1: Shared single-passage generation and web/Android scheduling

- [x] Write tests for current/next boundaries, deterministic deduplication, version/owner checks, cache reuse, rejected charges and abort/visibility behavior; run RED.
- [x] Implement the shared API using `library.translate` and `creditGate`, with no billing bypass and no automatic recursive traversal.
- [x] Implement client scheduling on current reading scope, including next chapter loading, source-mode/auto preference, cancellation, bounded retries and low-noise states. Preserve anchors and selected text on result arrival.
- [x] Run targeted Node tests and packaged reader/Android contract checks; record actual results.

## Task 2: Native quiet controls and adaptive presentation

- [x] Add tests for quiet default, one tools entry, compact/wide policy and retained tool state; run RED.
- [x] Implement quiet paper/typography and on-demand menu; keep accessible return navigation, PDF/scroll/paged input and the same ReaderSession.
- [x] Move notes/translation/companion between usable wide side presentation and compact presentation without treating presentation dismissal as user cancellation.
- [x] Verify anchor restoration, note draft, keyboard and large type with hosted native tests. Record the unsupported physical hinge/SDK boundary.

## Task 3: Native translation content and pipeline

- [x] Add core/AppTests for cached variant decoding, source-safe displayed offsets, automatic receipt merging, cancelled/stale scopes and current→next-only traversal; run RED.
- [x] Add persisted source/translation/parallel preferences and per-source translation overlays; keep source text and stable anchors immutable.
- [x] Call the shared step API while foreground reading. Apply matching receipts to source-mapped native text, persist cloud cache and stop on scope changes, user disable or rejected service/billing.
- [x] Integrate automatic preparing/failure/retry controls in reading tools, retain source choice, and avoid static missing-translation prose.
- [x] Run affected Swift core/native tests plus unsigned build serially through the shared iOS session.

## Task 4: Integration, review and delivery

- [ ] Run appropriate complete host checks/build contracts, native build/tests and bounded rendered acceptance; do not call fixture success real-provider or real-Duo success.
- [x] Request independent whole-branch review, fix confirmed important findings and rerun their meaningful regressions.
- [ ] Update contract, verification evidence and PR title/body around actual shipped scope; push once the coherent local change passes, inspect exact-head CI and read back PR state.

Pre-flight: Task 1 API schema is consumed by Task 3. Task 2 keeps `ReaderScreen` and presentation state ownership; controller integrates coordinator hooks only after the worker returns or by an agreed hook. Core models/rendering are controller-owned, so UI worker must avoid editing them.

Execution evidence: 157 Core tests and 125 native AppTests passed; UI62/63 passed in the isolated simulator identity. Whole-branch review findings were fixed RED→GREEN. Full host: 4417 pass / 2 fail / 3 skip (4422 total); failures are native Postgres unavailable and the pre-existing pricing release window. Runtime/Web/public/allowlist and real copy lint/canaries passed. Pricing files/guards were not weakened. Delivery remains PR-only until the release gate is resolved.
