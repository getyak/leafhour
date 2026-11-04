# Reading Craft Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. The user explicitly requested autonomous execution without questions.

**Goal:** Preserve reading position in chat and make text, references and typing reliable across large text and short-height screens.

**Architecture:** Native user-scroll phases own intent; a bottom marker owns position. The latest two exchanges share an eager layout inside the lazy history. The composer owns navigation and attachment previews. Native text measurement returns the proposed column width.

**Tech Stack:** SwiftUI, TextKit, XCTest/Vision, existing isolated DEBUG transport.

**Spec:** `docs/superpowers/specs/2026-11-04-reading-craft-design.md`

## Constraints and review focus

- Keep full conversation records, native selection, source/translation attribution, message roles, drafts, voice originals, retry and account isolation.
- Never infer user intent from content reflow or programmatic scrolling.
- A completed or growing response must not move an earlier answer being read.
- Keep the live exchange measurable before scrolling without eagerly creating every historical text view.
- Preserve initial portrait half-sheet behavior; make actual compact-height typing and reference inspection reachable.
- No real account data, paid model requests, new dependencies or distribution version bump.
- Reuse this checkout on its task branch and leave unrelated untracked work untouched.

## Task 1: Native text sizing

Files: `ChatMarkdownView.swift`, `ChatMarkdownTests.swift`.

- [x] Reproduce proposed-width versus natural-width negotiation and repeated native text replacement.
- [x] Return the proposed width and measured native height.
- [x] Verify one measurement/installation and preserved selection across 20 negotiations for plain and Markdown content.

## Task 2: History and scroll control

Files: `ChatConversationView.swift`, app tests and `IOSLibraryChatUITests.swift`.

- [x] Separate native user phases, bottom visibility and explicit return-to-latest.
- [x] Settle iOS 17 inertia and cancel stale settlement work.
- [x] Keep the previous and live exchanges measured while older exchanges remain lazy.
- [x] Place navigation inside the composer with 44pt hit bounds and no answer overlap.
- [x] Verify three streamed exchanges, real visible ending via OCR, earlier-history access, keyboard position and a 200-turn synthetic history.

## Task 3: Short-height composition

Files: `ReaderPanelPresentation.swift`, `ChatConversationView.swift`, `ImmersiveReaderUITests.swift`.

- [x] Require actual landscape interface dimensions, not only a device-rotation request.
- [x] Adapt only vertically compact presentation to a large/full-width surface.
- [x] Keep condensed attachment previews with complete expandable source information and explicit keyboard dismissal.
- [x] Verify real landscape typing, reference inspection and draft preservation, plus portrait quote regression.
- [x] Verify an eight-line landscape draft remains complete and sending/reference/return controls remain reachable.

## Task 4: Delivery

- [x] Run final affected checks and independent source review; inspect final native screenshots.
- [x] Check Chinese documentation, stage only task files, commit and push once.
- [x] Create PR, wait for the required CI gate, merge normally, verify remote status and the existing deployment flow. PR #308 merged as `789d0e6`; main CI and Production verification passed.
- [x] Distinguish source delivery from TestFlight distribution and physical-device acceptance. The existing automatic iOS workflow produced Apple VALID `0.1.0 (1.0.62)` from `789d0e6`; physical-device installation is unverified.

## Task 5: Small-screen follow-up

- [x] Reproduce the actual SE3 AX5 landscape failure instead of substituting a larger phone. Native keyboard notification includes the candidate bar at y=169; the keyboard accessibility frame begins at y=213.
- [x] Confirm the 52.5pt attachment row and typing row overflow the 91pt remaining below navigation. The source overlaps navigation by 17.5pt and the send button crosses the true keyboard boundary by 13.5pt.
- [x] Use one typing row while compact and focused. Reuse the microphone slot for a 44pt attachment inspector; inspecting dismisses the keyboard and expands existing, unchanged source/reference content. Microphone access returns when the keyboard is dismissed.
- [x] Keep only one visible, scrollable draft line while short-height attachment details are expanded; preserve the complete raw draft. Make the source-layer label use explicit ink color.
- [x] Recheck navigation and whole-button bounds against the actual resized viewport, eight-line draft inspection, portrait rotation, and ordinary phone presentation. Final SE run: 17 affected app tests and three UI flows passed. Ordinary phone: 17 app tests and three UI flows passed before the last same-row latest change, which passed the new SE history/draft flow. Independent review found no P1/P2 issues. Submit the combined follow-up once.

## Verification ledger

- Baseline: public main `3b183ce3`, unrelated untracked evidence preserved. Documented dev guard executables were unavailable; task-owned temporary output and jobs=2 used. No global guard installation or cleanup.
- Width regression: the native short text preferred 118pt against a 302pt proposal. Twenty negotiations caused 21 native measurements and 41 text installations. Returning the proposal width passed with one measurement and one installation, with selection retained.
- Runtime isolation: full eager layout passed the failing AX5 stream flow. Final code keeps only the latest two exchanges eager. A 200-turn hosted scene retained all records and created 12 native text views.
- Earlier geometry/inset prototypes and temporary tracing were discarded. Final intent is driven by native interaction, not layout movement. All temporary trace code is removed.
- An earlier rotation-only test produced portrait screenshots. It was corrected with an interface-dimension assertion and rerun on task-owned simulator `Leafhour Craft Rotation QA`; the actual keyboard-overlap failure was then reproduced and fixed.
- Source changes and runtime evidence are recorded in `docs/verification/2026-11-04-reading-craft.md`. iOS 17 device behavior and actual VoiceOver remain separate acceptance work.

- Final source review: no P1/P2 findings. Full app suite 354 total, 352 passed and 2 missing-local-sample skips. Subsequent touch-area refinements passed all 17 affected app tests plus four real presentation/keyboard UI flows, including complete 44pt send bounds and landscape-to-portrait draft retention.
