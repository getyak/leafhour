# Listening study implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans, then request independent whole-branch review.

**Goal:** Quiet contextual Chat, reliable reading navigation, and selectable bilingual immersive listening.
**Architecture:** Reuse ReaderSession preferences, ReaderSpeech and its source-coordinate cursor; lazy native selectable paragraph views feed explicit seeks. Overlay controls share reading appearance.
**Tech Stack:** SwiftUI, UIKit, AVFoundation, LeafhourCore, XCTest; iOS 17+.
**Spec:** docs/superpowers/specs/2026-11-03-listening-study-design.md

## Global constraints

- Preserve account/source/layer boundaries, drafts, native copy, Markdown offsets and original PDF pages.
- No generation on opening/settings; no fabricated translation or sentence alignment.
- Preserve unrelated artifacts; one consolidated push after local verification/review.
- Temporary speed boost is bounded to 5× and never saved as the user's preferred rate.

## Review focus

- Stale transcript/translation cannot seek into unrelated text; Unicode offsets remain valid.
- Selection/manual browsing cannot be interrupted by speech following or hidden tools.
- Boost restores on release, cancellation, background and dismissal.
- Large type/narrow/landscape layouts retain visible content and reachable controls.
- Rapid taps turn individually across animation/chapter boundaries without creating selection.

## Tasks

### Task 1: Transcript, seek and gesture regression

Files: ReaderListeningTranscript.swift, ReaderSpeech.swift, ReaderTapHandler.swift, ReaderInteractionTests.swift, ReaderImmersionTests.swift, ImmersiveReaderUITests.swift.
Interfaces: ReaderSpeech.seek(_:to:) validates ReaderSpeechLocation; transcript paragraph models preserve source/layer mapping. Shared speed-boost lifecycle restores the stored rate.
- [x] Add and run failing seek/Unicode/stale-source/comparison/boost tests.
- [x] Implement validated seek and transcript projection; diagnose gesture conflicts using real native tests.
- [x] Run affected native tests.

### Task 2: Listening and Chat presentation

Files: ReaderListeningPanel.swift, new native transcript view, ReaderBottomBar.swift, ReaderScreen.swift, ChatConversationView.swift, profile preferences/tests.
- [x] Implement continuous selectable transcript, paragraph comparison, shared appearance and overlay navigation with idle hiding.
- [x] Add chapter actions and hold-to-boost with accessible alternatives.
- [x] Apply quiet composer, single-line context and saved-citation rule.
- [x] Run native/Core tests and portrait/landscape/selection/rapid-tap UI acceptance; inspect screenshots.

### Task 3: Review and delivery

- [x] Record actual validation and limitations; review full diff independently.
- [ ] Synchronize main, run affected checks, commit/push once, create PR, wait for CI and merge normally.
- [ ] Track existing production/TestFlight automation and record actual release state separately from physical acceptance.

Pre-flight: transcript projection and seek share ReaderSpeechLocation (chapter, passage, layer, exact snapshot, UTF-16 offset); comparison never substitutes translation offsets for source sentence positions.

## Execution and review receipts

- Core 325 (2 existing selected-sample skips), native 302 (2 skips), host contracts 100, Python 9: zero failures in the final full runs. The final lazy-projection/touch-target cleanup passed 40 affected native tests and the bilingual listening UI flow.
- Five reader/Chat/listening UI methods passed in the verified run; three affected flows (quote removal, bilingual idle-hide, chapter roundtrip) passed again after the quote fix. Speed hold, landscape, native selection and rapid taps have simulator evidence.
- Independent static review completed without remaining blocking findings. Cross-sentence selection, chapter/layer pinning, VoiceOver following, boost idle-hide and a narrow-gap observation were fixed. No deferred correctness finding.
- Corner tap RED: four expected failures; GREEN: all 11 tap tests passed. Unicode stale-source seek and profile preference checks passed. The submitted quote remains visible once while streaming, with only current-context attribution in the composer after removal.
- Delivery checklist state at source commit intentionally precedes PR/CI/merge. The resulting PR and final chat carry exact remote merge, production and Apple-processing receipts; do not infer those from local tests.
