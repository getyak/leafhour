# My Reading Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for implementation and an independent whole-branch reviewer before merge.

**Goal:** Ship the user-approved native reading journal with real records and purposeful motion.

**Architecture:** Pure journal projection in LeafhourCore; an owner/scope/month-aware loader in the app; small SwiftUI views for overview, calendar, notes and daily detail. Reuse existing cloud records, OfflineLibrary, native reader presentation and settings.

**Tech Stack:** Swift 5.9, SwiftUI, iOS 17+, Foundation calendars; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-02-my-reading-journal-design.md`

## Global Constraints

- Existing account, local books, drafts, source versions and stable anchors remain authoritative.
- No new model generation, synthetic production records or cloud migration.
- Use dev-ios-session and serial two-job builds; preserve shared simulators and other worktrees.
- Reduced Motion, 44 pt targets, selectable content, adaptive colors and large text are required.

## Review Focus

- Last seven days crossing a month/year and local midnight/DST: no missing days or double time.
- Slow/cancelled month and account changes: no stale records or guessed zero totals.
- Partial notebook pagination or failure: preserve loaded notes and show incomplete scope.
- Missing/version-changed source and archived books: explicit unavailable state, never a guessed jump.
- Guest/local drafts and cloud account switches: keep scopes separate and do not invent dates.

### Task 1: Journal data

Files: Core `ReadingJournal.swift`, Core `ReadingJournalTests.swift`, app `ReadingJournalModel.swift`.

- [ ] Add failing tests for interval union, midnight, month boundaries, note identity/attribution and unknown dates.
- [ ] Implement pure date/day/note projection and validate monthly cloud snapshots.
- [ ] Implement an owner-guarded monthly loader with retained cache/failure state and device scope.
- [ ] Verify Core tests, commit data and model.

### Task 2: Native journal

Files: `MyReadingScreen.swift`, `ReadingJournalComponents.swift`, `ReadingJournalCalendar.swift`, `ReadingJournalNotes.swift`, `GlobalChatScreen.swift`, `AppSettingsScreen.swift`.

- [ ] Add the overview, interactive time spines, calendar and notes with the approved layout.
- [ ] Add native day/note detail and verified source return, keeping the reader under one presentation owner.
- [ ] Move settings under avatar with an explicit Done action; preserve existing settings routes.
- [ ] Add short stagger, matched selection, press feedback and Reduce Motion alternatives.
- [ ] Compile and test app behavior; commit interface.

### Task 3: Validation and delivery

Files: isolated Debug acceptance fixture, focused UI/app tests, `docs/verification/2026-11-02-get-358-my-reading.md`.

- [ ] Verify empty/loading/error/data, month navigation, note search/source return, owner transitions, light/night, large text and Reduce Motion with isolated fixture data.
- [ ] Independent branch review; fix confirmed issues and verify affected behavior.
- [ ] Sync origin/main, run applicable checks, push once, create linked PR, wait CI, merge normally and track existing iOS release.
- [ ] Record separate local, CI, merge, Apple and user/device states in Linear and the final response.
