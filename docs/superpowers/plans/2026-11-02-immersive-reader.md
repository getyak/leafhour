# Immersive iOS reader implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. Review the whole change with a fresh reviewer.

**Goal:** Coordinate paper, glass, selection-to-Chat, foreground time and immersive listening.
**Architecture:** Reuse ReaderSession, ReadingActivityClock, ReadingJournal and ReaderSpeech. New focused views own presentation; account and generation boundaries stay in existing services.
**Tech Stack:** SwiftUI, UIKit, LeafhourCore; iOS 17+ with iOS 26 glass availability checks.
**Spec:** docs/superpowers/specs/2026-11-02-immersive-reader-design.md

## Global constraints

- No new model generation on selection, drag, page/theme changes or listening.
- Preserve original/layer anchors, explicit pause, profile isolation and existing data.
- Minimum native action target 44 points; support Dynamic Type, Reduce Motion and Reduce Transparency.
- Test with isolated synthetic data. No private reading data in source/evidence.

## Review focus

- Dropped external or stale selections must not become attributed source quotes.
- Opening Chat/listening and backgrounding cannot accumulate reading time.
- Reopening controls cannot resume manually paused time or speech.
- Unicode and translated speech must highlight displayed words in displayed-text coordinates.
- Failed cloud/local time reads stay distinct from measured zero.

## Tasks

- [x] 1. Add preference/lifecycle regression tests, observe failures, implement automatic estimate and persistent opt-out. Run Core tests.
- [x] 2. Add paper-aware glass, reduce stable reader margins and integrate time/selection docks. Native layout tests cover narrow/AX layouts. Add quote-drop validation tests.
- [x] 3. Add book-time history using existing local ledger and authenticated month summary, without combining overlapping cloud/local totals.
- [x] 4. Replace listening sheet with adaptive full-screen player and real sentence/word following. Test sentence Unicode mapping, no-autoplay and native orientations.
- [x] 5. Run affected native suites and UI flows, inspect screenshots, perform independent code review, update acceptance/docs and prepare one reviewed delivery batch. CI, PR merge and automated release receipts are recorded in the PR and final response.

Ruling: proceed with routine design choices under the user's AGENTS.md direct-execution authorization; no extra design approval gate. Use existing checkout on a new codex branch; leave unrelated untracked artifacts untouched. Default estimate is visible and reversible; focus remains explicit. Changes to listening presentation require updating tests that previously expected playback to dismiss the panel.

Verification rulings: native UIKit first-open text can have no viewport anchor; timing now falls back to the visible chapter's first stable passage without mutating position. Extending a drawn footer beyond its parent safe area did not extend its touch region, so controls remain inside the safe area and the body instead uses a 4/48-point budget. The book-time sheet starts expanded to expose date detail. Speed buttons use borderless style to prevent Form row-wide action dispatch. Actual system appearance is selected externally for each theme-matrix run.
