# Quiet reader interactions implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. One fresh reviewer checks the whole change before delivery.

**Goal:** Fast single taps, a quiet reading viewport, and visible reliable pending quotes.
**Architecture:** Extend existing profile preferences, native gesture handlers and ReaderCloudTools. Keep the same reader/session/clock and immutable pending-request recovery.
**Tech Stack:** SwiftUI, UIKit/PDFKit, LeafhourCore, XCTest; iOS 17+, Xcode 16-compatible source.
**Spec:** docs/superpowers/specs/2026-11-03-quiet-reader-interactions-design.md

## Global constraints

- No generation on opening, selection, dropping, page turning or settings changes.
- Preserve original/layer/source anchors and account isolation; do not alter user data.
- Normal reading has no persistent footer. Existing explicit automatic-page countdown is an opt-in exception.
- Preserve VoiceOver, native long-press handles, links, pinch zoom and 44-point control targets.
- Use the current public-repository checkout on codex/quiet-reader-interactions-20261103; preserve unrelated untracked artifacts. User authorization permits execution and normal PR/merge without another approval gate.

## Review focus

- Fast repeated taps must not collapse into a double-tap selection or one coalesced turn.
- Delayed actions must not turn a different book/page after backgrounding or selection.
- A nonempty draft must not swallow a newly dropped selection; uncertain retries must remain unchanged.
- Removing a quote and refreshing must not silently restore it; send must match visible quote.
- Long translated/Unicode excerpts and accessibility fonts must leave the composer reachable.

## Tasks

### Task 1: Fast taps and secondary preferences

Files: Models.swift, ReaderSharedPreferences.swift, ReaderTapHandler.swift, TextReadingView.swift, PDFReadingView.swift, ReadingAppearanceControls.swift; ReaderNavigationPreferencesTests.swift, ReaderTapTests.swift.
Interfaces: ReaderPreferences.pageTapDelay (0–0.5, default 0), alwaysShowReadingProgress (false); ReaderEdgeTapHandler configures native multitap priority and independently dispatches eligible actions with cancellation.

- [x] Add failing gesture-priority, repeated dispatch/cancellation and preference persistence/default tests; run the focused suites.
- [x] Remove multitap selection contention using public gesture APIs while retaining long press/VoiceOver; add cancellable per-tap response delay and settings in a secondary interaction destination.
- [x] Run affected Core and native suites, including paging/selection.

### Task 2: Quiet viewport and control reveal

Files: ReaderScreen.swift, ReaderBottomBar.swift; ReaderLayoutTests.swift, ImmersiveReaderUITests.swift.
Consumes: alwaysShowReadingProgress. Produces: stable expanded viewport, hidden default controls, awake AI entry and selection actions.

- [x] Update/add assertions for quiet controls, listening/automatic timer absence, usable selection/awake AI and stable expanded layout; observe failure.
- [x] Remove persistent quiet footer, start asleep, reduce stable margins, retain explicit automatic-page status and optional progress; show AI with awake tools.
- [x] Run focused native layout/UI flows and inspect simulator screenshots.

### Task 3: Pending and saved quote UI

Files: ReaderCloudTools.swift, ReaderToolPanels.swift, ChatConversationView.swift; ReaderToolsTests.swift, ImmersiveReaderUITests.swift.
Interfaces: explicitly attach selection once per panel entry, remove selected excerpt without changing base paragraph, preserve immutable retry, parse/render saved turn quote. Composer owns fixed quote presentation.

- [x] Add failing nonempty-draft/new-selection, removal/refresh, retry immutability, saved quote and composer visibility tests.
- [x] Implement context transitions and fixed expandable/removable quote; preserve exact attribution and show saved per-message quote.
- [x] Run Core/native/affected host suites and simulator drag/selection-to-chat flows.

### Task 4: Review and delivery

- [x] Update verification and native documentation with actual results and limitations.
- [x] Perform fresh whole-branch review; fix substantive findings and rerun affected checks.
- [ ] Sync main, run required local build/tests, commit one delivery batch, push, create PR and await CI. Merge normally after success.
- [ ] Verify merged source and follow existing production/TestFlight automation; record actual distribution and physical-device limits separately.

Ruling: the README's dev-ios-session/dev-storage-guard executables are absent from PATH and the local tool directories. Use task-owned /tmp artifacts and the already booted dedicated Leafhour simulator, leave the Tormie simulator untouched, and avoid changing signing or user data. No new deployment chain.

Local gate: Core 303 (2 selected-sample skips), native 284 (2 selected-sample skips), UI 7 and affected host checks 100; zero failures. Xcode 26.4/iOS 26.4, synthetic data. See the verification record for boundaries. Source review: no remaining blocking findings.
