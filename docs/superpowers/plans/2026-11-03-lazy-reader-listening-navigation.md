# Lazy reader and direct navigation plan

> **For agentic workers:** independent domains under superpowers:dispatching-parallel-agents; parent integrates ReaderScreen and runs all Xcode work, then requests independent review.

**Goal:** Faster cached reading entry, content-only listening when no translation, quiet actual-position recovery, chapter transports and direct AI quotation.
**Architecture:** Retain domain services, bounded native rendering, source identities and scoped media ownership. Separate reader-first presentation from deferred work; UI uses current actual comparison/playback state.
**Tech Stack:** SwiftUI/UIKit/PDFKit/AVFoundation, LeafhourCore, XCTest; iOS17+.
**Spec:** docs/superpowers/specs/2026-11-03-lazy-reader-listening-navigation-design.md

## Constraints and review focus

- Never replace integrity guarantees with an unqualified stat-cache success claim; verify changed source/index before reuse, expose deferred failures and preserve repair evidence.
- Background sync/verification cannot overwrite active newer state or another identity; errors/cancellation/teardown stay scoped.
- No missing-translation UI; toggling only changes presentation, and choosing a real translation never silently substitutes variants.
- Locate uses actual speech cursor and does not seek/restart audio; explicit selection clearing preserves native handles until requested.
- Chapter controls preserve playback/pause intent; page gestures and source anchors remain.
- AI quote is a visible tap action and drag remains optional; opening never submits/generates.

## Tasks

### 1. Reader opening performance
- [x] Profile synthetic large-book and gated-sync entry, identify actual foreground costs and record before evidence.
- [x] Add meaningful cache/invalidation/early-presentation/scope tests, observe RED, implement measured lazy entry and deferred work.
- [x] Verify Core/native results and before/after opening limits without claiming untested device timing.

### 2. Listening and selection actions
- [x] Test actual/no comparison, remembered toggle, position recovery, chapter pause/idle behavior and explicit AI quote.
- [x] Hide unavailable comparison, add quiet locate, replace page/paragraph buttons with chapter controls, label direct AI quote while retaining drop.
- [x] Verify native layout/selection and real UI scenarios; no generation on opening.

### 3. Parent integration/review/delivery
- [x] Integrate reduced ReaderReadingTransport, retain page gestures/translation entry, remove obsolete manual-page-button plumbing.
- [x] Run affected local checks and independent review, fix substantive findings and record real limits.
- [ ] Sync main, push one batch, PR/CI/normal merge and exact-source production/Apple receipts.

## Verification receipt

Final local gates: Core 341 total / 2 fixture skips / 0 failures; native host 336 / 2 fixture skips / 0 failures; 8 UI scenarios passed; release helpers Node 100 and Python 9 passed. See docs/verification/2026-11-03-lazy-reader/README.md. Remote delivery remains separately recorded in the final response.
