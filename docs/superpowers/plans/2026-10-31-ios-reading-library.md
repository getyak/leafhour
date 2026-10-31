# iOS reading and library implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; independent code review before delivery. Steps use checkbox syntax.

**Goal:** Resolve the five native reading/library requests in one PR, one commit per optimization.

**Architecture:** Retain ReaderSession/TextKit and the durable generation worker. Extend its bounded plans and existing SwiftUI shelf components without adding a second data or generation service.

**Tech Stack:** SwiftUI, UIKit/TextKit, LeafhourCore, existing authenticated HTTP service.

**Spec:** `docs/superpowers/specs/2026-10-31-ios-reading-library-design.md`

## Global constraints

- iOS 17 minimum; no new dependency. Account/device pins remain isolated.
- At most 100 missing paragraphs in one explicitly requested chapter; uncertain old envelopes preserve their original scope/key.
- Keep native copy/selection, source identity, independent translation variants and background cancellation.
- Host pause permits lightweight source work only. Never label unexecuted tests passed.

## Review focus

- Pagination must use compact actual page insets, including checkpoint/restore and clipping.
- A resumed uncertain request must not receive a new identity or silently expand scope.
- Navigation during plan preparation must not submit work for another chapter.
- Empty or partial translations must not become invented or overwritten translations.
- Account changes/filtering/downloads must not reuse a stale selected book or another account's pin.

### Task 1: compact horizontal reading

Files: `ReaderScreen.swift`, `TextReadingView.swift`, `ReaderLayoutTests.swift`.

- [ ] Add actual viewport checks for compact pages and source-anchor continuity.
- [ ] Apply stable 16-point top/28-point bottom paged margins; remove the hidden 50-point TextKit floor from capture/restore/pagination.
- [ ] Verify pagination, native selection and layout through guarded native tests when allowed; record any resource hold explicitly.
- [ ] Commit the reading-space fix.

### Task 2: on-demand translation

Files: `ReadingLayers.swift`, `ReaderReadingContent.swift`, `ReaderSettingsControls.swift`, `ReaderPanels.swift`, `ReaderScreen.swift`, existing reading tests.

- [ ] Add single/current-chapter plan tests, current-first ordering and fixed-scope recovery checks.
- [ ] Add explicit passage/chapter scopes; preserve decoding of existing envelopes. Stream durable completion progress.
- [ ] Put preparation immediately below the mode picker and make it reachable from missing-translation reading; offer the first paragraph on explicit mode change, without automatic generation.
- [ ] Verify boundaries, cancellation and cache persistence; commit.

### Task 3: title download mark

Files: `BookShelfComponents.swift`.

- [ ] Move downloaded status before the title in both layouts, retain detailed VoiceOver status, and commit.

### Task 4: long-press selection, pins and sharing

Files: `LibraryPresentation.swift`, `BookShelfComponents.swift`, `LibraryScreen.swift`, `LibraryPresentationTests.swift`.

- [ ] Cover stable pin ordering, persisted owner scope and metadata-only shares.
- [ ] Implement contextual actions, explicit selection state and selected-book toolbar; clear stale selections.
- [ ] Verify both layouts/account changes, then commit.

### Task 5: three-cover rows

Files: `LibraryScreen.swift`, `BookShelfComponents.swift`, existing layout tests.

- [ ] Use three equal columns and 12-point gaps; scalable 13-point titles and 11-point author text; accessibility row fallback.
- [ ] Verify narrow widths and title wrapping; commit.

### Delivery

- [ ] Independent review; fix confirmed correctness findings.
- [ ] Affected host checks, exact-head required CI, normal merge, release readback and Linear readback. Leave actual native/provider/device acceptance pending unless executed.
