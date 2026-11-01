# Smooth iOS reading implementation plan

> **For agentic workers:** Use native execution and an independent final review as authorized in AGENTS.md.

**Goal:** Quietly reopen the recent book and eliminate avoidable page-turn work and intermediate frames.
**Architecture:** Reconcile at the opening boundary; reuse native text/PDF surfaces with configurable presentation and separate content-layout identity.
**Tech Stack:** Swift, SwiftUI, UIKit/TextKit, PDFKit, XCTest.
**Spec:** docs/superpowers/specs/2026-11-01-ios-smooth-reading-design.md

## Global constraints

Account/book ownership and source anchors remain authoritative. No model calls or new dependencies. iOS commands use dev-ios-session; heavy jobs run sequentially. One PR; one commit per optimization.

## Review focus

Unknown/late network results; newer offline events; interrupted cross-chapter transitions; rapid touch while animation runs; preference-only updates that accidentally rebuild text or stop position persistence.

### Task 1: Quiet opening

- [ ] Add Core sync tests for newer remote, newer local, live reader and recoverable displaced positions.
- [ ] Implement reconciliation at pull boundaries and one-shot startup selection after account shelf refresh, with account/navigation guards.
- [ ] Verify Core and startup App tests, then commit.

### Task 2: Configurable transitions

- [ ] Add persistent animation/input preferences with backward-compatible decoding and tests.
- [ ] Implement lightweight slide/instant around existing native surface, preserve optional curl, and cover before any content mutation.
- [ ] Keep manual animation intact under touch; coalesce one pending direction with stale-session guards.
- [ ] Separate text-layout identity from behavior preferences; verify checkpointing, selection and both native readers, then commit each optimization.

### Task 3: Acceptance and delivery

- [ ] Run Core and native App/unit/UI checks sequentially; measure 50 turns and transition coverage with unique witnesses.
- [ ] Obtain independent review and fix confirmed high-risk findings.
- [ ] Record actual results, update copy inventory as needed, push once, create linked PR, pass CI and merge normally.
- [ ] Read back release/Apple state and retain unmet physical-device gates in the issue.
