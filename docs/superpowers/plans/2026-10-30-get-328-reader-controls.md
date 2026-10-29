# Native Reader Controls Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent source/renderer/control tasks. Root serializes native builds and owns integration and delivery.

**Goal:** A refined native reader with discoverable bottom tools, horizontal page turns and correct EPUB body opening.

**Architecture:** Preserve ReaderSession source anchors and UIKit/PDFKit selection. Add compatible reader preferences, measured page navigation and a focused bottom bar. Derive EPUB start metadata without removing or renumbering content.

**Tech Stack:** SwiftUI, UIKit TextKit, PDFKit, LeafhourCore, XCTest, iOS 17+.

**Spec:** docs/superpowers/specs/2026-10-30-get-328-reader-controls-design.md

## Global Constraints

- iOS 17+, no new network/model calls or dependencies; existing account and book identities remain unchanged.
- One commit per independently reviewable fix; one GET-328 PR from current public origin/main.
- Preserve valid anchors, drafts, Copy and source versions. Old preferences decode with navigationMode=scroll.
- Native work uses dev-ios-session; only root runs builds. Shared device and services are protected.
- Only synthetic/public-source evidence is committed. No user attachment or private book enters Git.

## Review Focus

- A saved cover anchor must not be overridden by the new EPUB start point.
- Missing EPUB semantics must not discard an unmarked preface or illustrated opening.
- Emoji, combining marks, Markdown and large attachments must retain source and selection mapping after page turns.
- Text-size/rotation and bottom-bar disclosure must not skip visible text or save another chapter's anchor.
- PDF's native page controller and selection/zoom must not be intercepted by custom text paging gestures.

### Task 1: EPUB opening

Files: BookParser.swift, LocalBook metadata in Models.swift, ReaderSession initialization, synthetic core tests.

- [ ] Add regression cases for marked cover/bodymatter, unmarked preface, old cache and saved anchors.
- [ ] Record failing baseline; implement trusted start metadata while preserving all chapters and IDs.
- [ ] Run core tests and independently review the diff; commit the fix.

### Task 2: Reader preference and measured paging

Files: ReaderPreferences in Models.swift, TextReadingView.swift, PDFReadingView.swift, new page-layout helper and native tests.

- [ ] Add backward-compatible navigationMode=scroll|paged and decode/round-trip cases.
- [ ] Implement actual viewport paging, source checkpoint/restore and PDFKit horizontal mode.
- [ ] Test long passages, bidirectional/Unicode content, attachments, chapter boundaries and reflow; review and commit.

### Task 3: Tap and bottom controls

Files: ReaderScreen.swift, ReaderPanels.swift, new ReaderBottomBar.swift and tap policy helper/tests.

- [ ] Make single page taps reveal controls while excluding selected text, links and native multitap gestures.
- [ ] Integrate compact controls, real speech state, appearance and typography with all secondary tools retained.
- [ ] Test regular/accessibility layouts and presentation/position continuity; review and commit.

### Task 4: Native acceptance and delivery

Files: focused UITests and docs/verification/2026-10-30-get-328-reader-controls.

- [ ] Run affected native app tests and E2E flows, saving original screenshots/results.
- [ ] Independently review full branch, repair confirmed important issues and record limitations.
- [ ] Create linked PR; wait for applicable CI, sync base, merge normally and read back exact commit/release status.
