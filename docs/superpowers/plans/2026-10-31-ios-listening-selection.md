# iOS listening and paragraph selection implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with an independent final review.

**Goal:** Start and resume listening at the right sentence, follow its actual position, and make first long press select a stable paragraph.

**Architecture:** Keep ReaderSpeech and ReaderSession; add typed source/layer cursor and sentence mapping. Feed real speech events into TextKit/PDFKit temporary highlights. Observe native gestures for a one-time paragraph expansion.

**Tech Stack:** SwiftUI/UIKit, AVSpeechSynthesizer, NaturalLanguage, PDFKit, existing local storage.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-listening-selection-design.md`

## Constraints and review focus

- iOS 17 minimum; no dependency or paid/cloud request. Existing source anchors and independent translations remain unchanged.
- Serial native validation, reuse Primary iPhone/build caches; global pause marker remains intact under the session's native-validation authorization.
- Verify callback ownership after pause, voice change, stop, chapter/layer/source change; avoid wrong-layer offsets and stale highlights.
- Avoid automatic follow while dragging/selecting, redundant per-word text reconstruction, and paragraph selection that moves the viewport or replaces native editing.
- Check long sentences across pages, emoji/combining text, Markdown markup, PDF extraction gaps, and persisted cursor invalidation.

### Task 1: listening position and actual sentence progress

Files: `ReaderSpeech.swift`, new `ReaderSpeechPosition.swift`, `LeafhourCore/Models.swift`, existing speech/core tests.

- [x] Reproduce the current mid-paragraph start regression with a failing test.
- [x] Add layer-aware speech position/sentence mapping and optional, backward-compatible local resume state.
- [x] Implement real callback progress, exact pause/resume, sequential passages/chapters and sentence-scoped voice restart.
- [x] Verify scoped resume and stale callback refusal; commit.

### Task 2: text/PDF highlighting and follow controls

Files: `TextReadingView.swift`, `PDFReadingView.swift`, `ReaderScreen.swift`, `ReaderToolPanels.swift`, native layout/UI tests.

- [x] Verify real drawing-only highlight ranges, source/translation mapping and viewport-follow behavior.
- [x] Wire visible position and playback cursor; preserve native selection and source anchors. Manual navigation/selection suspends follow.
- [x] Return to the book after play; offer explicit start-here, pause/resume and back-to-listening without growing page margins.
- [x] Verify both reader engines and actual speech callbacks; commit.

### Task 3: paragraph-first native long press

Files: new `ReaderParagraphSelection.swift`, reader coordinators, selection tests and native UI tests.

- [x] Add tests for full passage selection, Unicode/Markdown/layer identity, links, existing handles and stable viewport.
- [x] Observe native long press, expand once, retain native Copy/menu and use the live selection when invoking anchored actions.
- [x] Verify real long press and Copy with synthetic text, plus page-turn precedence and PDF boundaries; commit.

### Delivery

- [x] Independent review and fixes, complete affected checks, one PR tied to GET-347.
- [ ] Exact-head CI, normal merge, Production/source readback and automatic TestFlight receipt; report physical-device limits separately.
