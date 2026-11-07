# Quiet native AI implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ask by holding AI while continuing reading/listening, then open the saved answer full screen; keep playback controllable when navigation sleeps.

**Architecture:** Reuse account/book `ReaderCloudTools`, voice retention and immutable request recovery. Introduce a quick-question capture controller and independent listening visibility state. Share one floating AI control between reading/listening; present answers above the retained reader navigation.

**Tech Stack:** SwiftUI, UIKit gestures, AVFoundation/Speech, existing LeafhourCore and ActivityKit.

**Spec:** `docs/superpowers/specs/2026-11-07-quiet-native-ai-design.md`

## Global constraints

- iOS 17 minimum; no additional dependencies, credentials, paid CI or real model calls for tests.
- Existing account/book/source permissions, original voice retention and idempotent retry stay authoritative.
- Reader viewport and playback location must not move on UI status updates.
- User selected ready-marker-only and full-screen answer; no automatic sheet.

## Review focus

- A release during permission preparation must cancel a late recording start.
- A newer unsent draft must survive async quick-question submission and recovery.
- A stopped/navigated/interrupted listening session must not auto-resume after capture.
- Unknown delivery is reconciled with the original request, never sent as a new turn.
- Collapsed-player taps must not reach the transcript or change its playback cursor.

### Task 1: Quick-question state, capture and durable conversation integration

**Files:** create `ReaderQuickQuestion.swift`, `ReaderQuickQuestionTests.swift`; modify `ReaderCloudTools.swift`, `ChatSpeechRecorder.swift` as needed.

**Interfaces:** quick-question controller consumes the shared tools/session/cloud/library and frozen quote. It produces capture/status/target state and explicit start/finish/cancel/open actions. Tools retain quick target/unread state with their draft and expose an immutable quick-send route which preserves unrelated composer contents.

- [x] Write failing tests for preparation release/cancel, immutable target/context, preserved draft, saved-result unread/read, and original-request recovery.
- [x] Run selected app tests, confirm failure is the absent behavior.
- [x] Implement capture/controller and tools integration; keep tasks outside view-bound `.task` cancellation.
- [x] Run selected tests and existing conversation/voice tests.

### Task 2: Independent controls and reading/listening integration

**Files:** modify `ReaderScreen.swift`, `ReaderListeningPanel.swift`, `ReaderSelectionDock.swift`, `ReaderToolPanels.swift`, `ChatConversationView.swift`; create `ReaderListeningControls.swift` and relevant tests.

**Interfaces:** `ReaderListeningControls` owns navigation visibility and transport expansion independently. Both book surfaces use the same quick-question controller. Full-screen conversation receives an explicit target turn ID and reports actual display.

- [x] Write failing state tests for idle navigation sleep, persistent transport collapse, mini-player recovery and safe playback handoff; add UI assertions for no auto-presentation and full-screen return.
- [x] Implement shared hold/tap AI affordance, fullscreen target routing and compact/mini transport.
- [x] Verify short taps never invoke recording, upward cancellation never opens chat, and hidden navigation never hides playback or AI.
- [x] Run selected app/UI tests in portrait/landscape and build the widget/application.

### Task 3: Verify, review and deliver

- [x] Generate the Xcode project and run affected native tests/build, LeafhourCore tests and required repository checks. Record actual results in `docs/verification/2026-11-07-quiet-native-ai.md`.
- [x] Inspect simulator screenshots; record physical voice/background acceptance as unverified unless actually exercised.
- [x] Request independent whole-branch review; resolve important findings with regression coverage.
- [ ] Sync main, commit only task files, push once, create PR, wait for its CI gate, merge normally and update the local main checkout. Distinguish merge from app distribution and device acceptance.
