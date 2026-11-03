# Listening system presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect explicit listening to background playback, system media controls and an interactive Dynamic Island/Lock Screen activity.

**Architecture:** Extend the existing owned Now Playing session. Bind a random session token to in-process AudioPlaybackIntent actions and a serialized ActivityKit adapter. Share only presentation attributes/intents with an embedded WidgetKit extension.

**Tech Stack:** Swift 5.9, iOS 17+, MediaPlayer, AVFoundation, ActivityKit, WidgetKit, AppIntents, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-03-listening-system-presence-design.md`

## Global Constraints

- iOS 17+, no new model calls, no invented duration/progress/waveform.
- Preserve account/source ownership and existing dirty work in the original checkout.
- Xcode 26.4 can verify compatibility interfaces, not iOS 27-specific APIs or devices.
- Session actions must not control a replacement reader; pause retains position, stop clears both presentations.
- Default activity only for explicit playback; respect system authorization/dismissal.

## Review Focus

- Buffered/preparing playback must be pausable even before PCM starts.
- A delayed stop or cleanup from an old session must not clear a new book.
- Activity request/update completion after stop must not resurrect a card.
- No ActivityKit authorization must leave background audio and remote commands usable.
- The extension must embed and sign with the parent bundle identity without leaking run data.

### Task 1: Owned media and activity command contracts

**Files:** `ReaderNowPlaying.swift`, `ListeningShared/ListeningPlaybackAction.swift`, `LeafhourAppTests/ReaderNowPlayingTests.swift`, `LeafhourAppTests/ReaderInteractionTests.swift`.

**Interfaces:** `ListeningPlaybackCommandCenter.bind(sessionID:handler:)`, `perform(_:sessionID:) -> Bool`, `unbind(sessionID:)`; media commands add `togglePlayback` and `stop`; snapshots distinguish preparation.

- [ ] Add tests for preparing/playing/paused toggle, stopped state and stale handlers; run the targeted tests and observe expected failures.
- [ ] Implement owner-checked command routing, media stop/toggle mappings and real output/preparation state publication.
- [ ] Run Now Playing and reader interaction tests green, including existing background and takeover cases.

### Task 2: Live Activity lifecycle and interactive native views

**Files:** `ListeningShared/ListeningActivityAttributes.swift`, `ListeningShared/ListeningPlaybackIntent.swift`, `Leafhour/ReaderListeningActivity.swift`, `ListeningWidget/ListeningWidget.swift`, `ListeningWidget/Info.plist`, `Leafhour/Info.plist`, `project.yml`, generated project, new activity tests.

**Interfaces:** `ReaderListeningActivityPublishing.publish(sessionID:state:)`, `end(sessionID:)`; async backend start/update/end injected for isolated race tests.

- [ ] Write lifecycle tests first: deduplication, stop-before-create, replacement and dismissed activities; observe failures.
- [ ] Add serialized ActivityKit publishing, random session routing, explicit pause/end actions, legible compact/minimal/expanded/lock layouts and finite state transitions.
- [ ] Add/embedded widget target and generate project; build app and widget. Run lifecycle and action tests green.

### Task 3: Listening UI and delivery verification

**Files:** `ReaderListeningPanel.swift`, focused UI tests and `docs/verification/2026-11-03-listening-system-presence.md`.

- [ ] Make ending listening directly discoverable in the player and verify the same state lifecycle.
- [ ] Run affected tests and simulator build/visual inspection with isolated fixtures. Record actual results and physical/iOS 27 limits.
- [ ] Obtain fresh whole-branch review, address material findings, synchronize main and rerun affected checks if needed.
- [ ] Commit this task only, push once, create PR, wait for required CI, normally merge and inspect existing release workflow outcomes.

### Necessary release integration

The embedded widget changes the signing graph. Validate distinct exact main and `.listening` profiles using the same existing team/certificate; pass bundle and profile variables per target, verify the embedded extension in the IPA, and consume `IOS_LISTENING_PROFILE_BASE64`. Ordinary release must not create Apple resources or enable signing maintenance. The existing maintenance workflow is disabled and requires separate approval; report the missing profile as a release blocker, not a successful TestFlight delivery.
