# iOS reading style and Chat implementation plan

**Goal:** Deliver GET-357 with configurable reading style, concise settings, crafted sharing and global native Chat.
**Architecture:** Reuse profile preferences, native text/PDF rendering and existing book conversation endpoints. Root tabs own navigation; a shared conversation view serves global and selection entry points.
**Tech Stack:** SwiftUI, UIKit, LeafhourCore, XCTest; iOS 17+; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-01-ios-style-chat-design.md

## Global constraints
Preserve account isolation, saved records, stable text anchors, explicit generation/price confirmation and uncertain-request identity. No paid generation during UI verification. Use the shared Primary iPhone through dev-ios-session and bounded jobs.

## Review focus
1. Account changes while requests are in flight cannot expose the previous owner's chat.
2. Refresh failures retain already loaded messages and drafts.
3. Typography presets cannot change translation/navigation/listening preferences.
4. Card styles preserve every selected character and readable contrast.
5. Large text/keyboard keeps completion and return actions reachable.

### Task 1: Reading styles and settings
- [x] Add backward-compatible paper themes and typography presets, persistence tests.
- [x] Share appearance controls across reader and global Settings; collapse content/navigation details.
- [x] Verify text/PDF/page-animation backgrounds and preference migration.
- [x] Commit the complete reading/settings improvement.

### Task 2: Native global Chat
- [x] Load context and history directly from any owned shelf book without opening it.
- [x] Reuse the billing/confirmation path, keep tools and durable draft per book/account.
- [x] Build root tabs and shared clean conversation UI; use full-height selected-text presentation.
- [x] Test context, account ownership, refresh retention and retry identity; commit.

### Task 3: Excerpt sharing
- [x] Add three export palettes and framed preview/style controls while retaining measured pagination.
- [x] Test long multi-page cards and palette contrast; commit.

### Task 4: Delivery
- [x] Run Core/app checks and affected native UI flows; capture actual screens and inspect them.
- [x] Independent agent review, fix confirmed issues and validate affected paths.
- [ ] Push once, one associated PR, applicable CI/gates, normal merge and release readback.
- [ ] Record exact evidence and remaining acceptance boundaries in verification doc and Linear.
