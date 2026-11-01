# Reading controls and direct Chat implementation plan

> Native implementation executes in this chat; after the user confirmed both clients, use superpowers:dispatching-parallel-agents for disjoint Web and backend files. Obtain independent review of the complete change before pushing.

**Goal:** Remove settings clutter and the Chat book-selection gate, with a compact dismissible contents panel and full-page reading conversations.

**Architecture:** Reuse ReaderPreferences and ReaderCloudTools. Generalize the existing chat service to an explicitly separate account conversation, retaining its storage, limits, tools, billing and retry logic. Keep the reader session alive underneath a native navigation destination.

**Tech Stack:** SwiftUI/UIKit, LeafhourCore, Node ES modules; no new dependencies.

**Spec:** ../specs/2026-11-01-reading-chat-followup-design.md

## Global constraints

- Preserve account/source ownership, original/translation attribution, stable anchors and local drafts.
- All simulator work goes through dev-ios-session; heavy commands run sequentially.
- No preview deployment, no provider/account switching, no automatic model generation.
- One commit per user-visible improvement, one PR associated with GET-357 follow-up; record unavailable Linear writes honestly.

## Review focus

- Empty-library account chat must work without reading or creating a book.
- Pending/retry requests must retain identical identity after restart and account changes.
- Account-level billing must not bypass quote validation or charge duplicate receipts.
- Closing contents must consume the outside tap and preserve page/anchor.
- Settings and full-page navigation must preserve accessibility and unsaved data gates.

## Tasks

1. [x] Simplify native reading controls: shared category selection; live preview, sample typefaces, size/spacing sliders and compact paper swatches. Reuse in global reading settings. Verify actual rendering and preference persistence.
2. [x] Refine contents: compact type scale and row hierarchy; owned outside-dismiss presentation with close/drag/search/current-location affordances. Verify outside tap and source position.
3. [x] Add account conversation to reader-chat service, chat input encoding, credit scope and authenticated portal routes. Test no-books, owner isolation, tool authority, bounded history, same-ID retry, cancellation, export and paid quote/settlement.
4. [x] Open global Chat to companion and composer; make book context optional. Persist account draft with existing owner storage, retain billing confirmation and recovery. Verify native transport fixtures and empty/error states.
5. [x] Route reading/selection Chat through a full-height native destination; preserve session and explicit return. Validate position and draft continuity in UI tests.
6. [ ] Run affected Node/Core/native tests and build sequentially; independently review and fix confirmed issues. Push once, create PR, wait applicable CI, sync main, merge normally and read back delivery. Track Production/TestFlight boundaries separately; document evidence and clean only task-owned artifacts.

7. [x] Web settings, contents and full-page Chat: shorten grouped controls and preserve semantics/localization; use the shared account endpoint by default, with explicit optional book selection; browser Back returns to the original anchor. Run affected Web tests and compiled browser replay at narrow/desktop widths.

## Execution ledger

- Native controls: three categories, direct typography sliders, compact swatches; actual source preview retained. First compile found a generic Binding inference error and a fixture declaration order error; fixed before simulator acceptance.
- Ruling: expand scope to Web and iPhone and parallelize disjoint implementation after the user's explicit both-clients answer; heavy jobs remain serialized. This supersedes the original native-only assumption.
- Baseline Node reader-chat and input suites passed before implementation (see task artifact baseline-node.log).

- Local completion: native application 235 tests (one artwork skip), seven affected UI cases passed after fixture/locator fixes and actual contents presentation correction. Backend 144/144; final Web 222/222 plus boundary 86/86. Initial full Node 4475 pass / 26 fail / 16 skip; affected failing-file rerun 90 pass / 0 fail / one Linux fixture skip after fixes and an independent dependency installation. PostgreSQL annual billing and real Vale copy lint remain CI gates.
- Hosted build, isolated runtime initialization, public build scan, release allowlist and release integrity checks passed. Independent final review has no remaining P0/P1/P2 findings.
