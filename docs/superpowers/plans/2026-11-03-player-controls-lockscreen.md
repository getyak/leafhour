# Player controls and lock screen implementation plan

> **For agentic workers:** Use inline execution with isolated parallel domains under superpowers:dispatching-parallel-agents. Integrate and independently review once before delivery.

**Goal:** Land the approved listening layout, a truthful current-page translation controller, and real lock-screen artwork/playback.
**Architecture:** Existing session/speech/preferences remain authoritative. TextKit/PDFKit emit immutable visible-page snapshots; the translation plan consumes their IDs. A MediaPlayer adapter publishes scoped metadata and remote commands. Independent cover rendering uses real artwork or title metadata.
**Tech Stack:** SwiftUI/UIKit/PDFKit/MediaPlayer/AVFoundation, LeafhourCore, XCTest; iOS 17+.
**Spec:** docs/superpowers/specs/2026-11-03-player-controls-lockscreen-design.md

## Global constraints

- No 回到朗读 affordance. Native selection, copies, links, PDF zoom, VoiceOver and source offsets remain available.
- Exact current-page paragraph intersection; full paragraph completion was explicitly authorized. Existing account/source/language/idempotency/cost rules remain.
- Background audio explicitly authorized. Reading time and translation still stop in background; no invented audio duration.
- Keep unrelated dirty artifacts and use the existing dedicated Leafhour simulator/test fixtures. One consolidated push after local review/checks.

## Review focus

- Rotated/reflowed/stale geometry cannot widen translation scope or silently fall back to a chapter.
- Paragraphs across page boundaries, translation/source projection, headings and image-only PDF pages retain true source IDs.
- Late cover tasks/remote commands cannot change a newer book or a signed-out identity.
- System interruptions, background, rate boost and teardown release media/commands correctly.
- Native text selection/manual browsing, long translations, large type and landscape do not hide text behind controls.

## Tasks

### 1. Visible page and translation scope

Files: ReaderVisiblePage.swift, TextReadingView.swift, PDFReadingView.swift, ReadingLayers.swift, ReaderReadingContent.swift and focused tests. Parent integrates ReaderScreen and confirmation copy.
Interfaces: ReaderVisiblePage captures sessionID/navigationID/chapterID/preferences plus ordered source passageIDs; isCurrent(session) rejects stale scope. Text/PDF views expose optional onVisiblePage callbacks. ReaderReadingContent.prepare(... scope:.page, page: ReaderVisiblePage?) validates before building a plan; no page snapshot means no generation.
- [x] Write failing exact-IDs, boundary, stale/unknown viewport and persisted-page-scope tests.
- [x] Implement snapshot emission and bounded plan/recovery behavior; run affected tests.

### 2. Lock-screen metadata and artwork

Files: new ReaderNowPlaying.swift, ReaderListeningArtwork.swift and native tests. Parent owns ReaderSpeech integration, background capability and lifecycle hooks.
Interfaces: a scoped ReaderNowPlayingController with publish/update/clear and remote callbacks; a renderer producing square aspect-fit real-cover or typographic fallback images. No external credentials, real records or invented duration.
- [x] Verify official Apple API requirements and add failing metadata/ownership/artwork tests.
- [x] Implement adapter and artwork; provide exact integration API and evidence.

### 3. Approved native player and reading controller

Files: ReaderListeningPanel.swift, ReaderListeningText.swift, ReaderBottomBar.swift, ReaderScreen.swift, ReaderSpeech.swift, Info.plist and affected tests.
- [x] Restore independent source/comparison/transport regions, shared functional bar and no return affordance.
- [x] Integrate page/chapter actions, configured page-translation display and explicit confirmation.
- [x] Integrate current-book artwork/remote commands and background playback, preserving reading/translation pause semantics.
- [x] Verify native/Core/host checks plus actual simulator portrait/landscape/select/translate/background/lock-screen states.

### 4. Review and delivery

- [x] Independent whole-change review; fix substantive issues and rerun affected checks.
- [ ] Record real evidence and limits; sync main; commit/push consolidated PR; wait CI and merge normally.
- [ ] Verify exact-source production and Apple-processing receipts separately from physical acceptance.

## Final source review and validation

Independent review completed. Fixed page invalidation/unsubmitted intent retirement with deterministic RED→GREEN, original-page PDF boundary is now stated, TOC chapter/heading intent retained, Markdown probe layout cached. Audio ownership, microphone, actual PCM state and late cover/remote behavior have isolated tests. Core329 (2 skips), native331 (2 skips), host100, Python9 passed. UI records and physical-system-presentation limitations are in the verification document. The final PR/chat records remote delivery state; local checks do not imply tester availability or physical lock-screen acceptance.
