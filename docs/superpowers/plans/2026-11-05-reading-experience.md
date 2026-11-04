# iPhone Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. User authorized independent agent design/evaluation and direct implementation.

**Goal:** Deliver R1–R16 in the linked spec with honest, reproducible evidence.

**Architecture:** Keep the existing native reader and account-scoped services. Publish local content before optional work; use stable identities and bounded, cancellable generation. Separate feature files rather than expanding shared reader state unnecessarily.

**Tech Stack:** SwiftUI/UIKit, LeafhourCore, Node ESM, XCTest, node:test.

**Spec:** `docs/superpowers/specs/2026-11-05-reading-experience-design.md`

## Global Constraints

- Stable passage IDs, account and source-version isolation remain mandatory.
- Synthetic or isolated public-domain fixtures only; never commit runtime data or credentials.
- No full-book automatic translation. Only explicit enablement authorizes bounded following work.
- Unknown or untested results cannot be marked passed or assigned a fabricated 95 score.
- Preserve other chats' work; task branch starts from public origin/main.

## Review Focus

- Same account UID with changed metadata must keep the visible library.
- Suspended network and local source integrity work must not block a usable opening.
- Rapid chapter/language changes must cancel stale translation and search publication.
- Gesture selection and vertical scrolling must not create accidental bookmarks.
- Offline, large text, old saved state and non-Latin source offsets must remain usable.

### Task 1: Shelf refresh and sorting (R1–R2)

Files: LibraryScreen.swift, LibraryPresentation.swift, LibraryModel.swift, Core shelf models, affected shelf tests. Independent design report: shelf-design.md.

- [ ] Pin default new-book/recent ordering, unchanged snapshots and same-UID metadata behavior in tests; run red.
- [ ] Keep cached presentation alive and coalesce redundant refresh publication; compare account identity by UID.
- [ ] Run affected shelf/Core/app checks; review against report and record score evidence.

### Task 2: Local opening and staged work (R3–R4)

Files: LibraryModel.swift, Core OfflineLibrary.swift, ReaderSession.swift, reader text layout and opening tests. Independent report: opening-design.md.

- [ ] Test held cloud requests, local upload mapping and synthetic large book opening; record baseline.
- [ ] Remove synchronous network dependencies from local opening; defer safe verification/layout work with stable positions.
- [ ] Run integrity/recovery and opening regression tests and capture before/after timing.

### Task 3: Reading guide and follow-ups (R5–R6)

Files: ReaderCloudTools.swift, ChatConversationView.swift, new guide/follow-up helpers, existing introduction/chat services where needed. Independent report: ai-design.md.

- [ ] Test guide caching/version/failed retry and exactly three distinct suggestions per completed turn.
- [ ] Present a non-blocking default guide; add compact direct-send follow-ups using ordinary send and existing local-book permissions.
- [ ] Run affected chat/introduction tests and app layout tests; record evaluation.

### Task 4: Contents search (R7–R8)

Files: ReaderContentsPanel.swift, new ContentsSearch helper, BookSearch.swift and isolated AI source adapters. Independent report: contents-design.md.

- [ ] Test body matches grouped under true chapters, exact Unicode anchors, stale query cancellation and invalid AI references.
- [ ] Integrate local search and explicit AI search inside contents without moving reading progress during search.
- [ ] Verify empty/error/offline, jump behavior and dynamic type; record evaluation.

### Task 5: Bookmarks (R9–R10)

Files: new ReadingBookmark model/panel/gesture helper; BookState/ReaderSession persistence and ReaderScreen integrations. Independent report: bookmarks-design.md.

- [ ] Test backward decode, stable anchors, duplicate protection, color/name persistence and scope isolation.
- [ ] Add pull feedback and right-top bookmark control with explicit accessible alternatives and list navigation.
- [ ] Test gesture discrimination plus app UI; record evaluation.

### Task 6: Reading-following translation (R11–R15)

Files: ReaderReadingContent.swift, ReaderPageTranslationPanel.swift, reading language/preferences/layers, server/portal.mjs, translation.mjs, library-service.mjs and translation-batch.mjs. Independent report: translation-design.md.

- [ ] Pin disabled/no calls, bounded scope, language intent parsing, template settings and cancellation races with tests.
- [ ] Implement explicit enablement, one-line target, visual templates and live parallel configuration.
- [ ] Propagate cancel to active provider fetch and fence late results; preserve existing uncertain billing/request recovery.
- [ ] Run affected server and native suites; verify final screen and record evaluation.

### Task 7: Integrated review, delivery and acceptance (R16)

- [ ] Independent review of each domain and whole diff; resolve material findings.
- [ ] Run final affected tests, build, copy and release policy checks appropriate to final paths.
- [ ] Save evidence, honest scores and remaining physical-device items in docs/verification/2026-11-05-reading-experience/README.md.
- [ ] Commit only task files, synchronize origin/main, push once, create PR, wait CI gate and normally merge.
- [ ] Reconcile remote commit, Production deployment and actual online checks; record iOS release separately.
