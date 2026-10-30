# Native Reader Controls — pre-PR implementation checkpoint

> **For agentic workers:** Use superpowers:subagent-driven-development for independent source/renderer/control tasks. Root serializes native builds and owns integration and delivery.

**Goal:** A refined native reader with discoverable bottom tools, horizontal page turns and correct EPUB body opening.

**Architecture:** Preserve ReaderSession source anchors and UIKit/PDFKit selection. Add compatible reader preferences, measured page navigation and a focused bottom bar. Derive EPUB start metadata without removing or renumbering content.

**Tech Stack:** SwiftUI, UIKit TextKit, PDFKit, LeafhourCore, XCTest, iOS 17+.

**Spec:** docs/superpowers/specs/2026-10-30-get-328-reader-controls-design.md

## Global Constraints

- iOS 17+, no new network/model calls or dependencies; existing account and book identities remain unchanged.
- One commit per independently reviewable fix; one GET-328 PR from current public origin/main.
- Preserve valid anchors, drafts, Copy and source versions. Old preferences decode with navigationMode=scroll.
- Native work uses dev-ios-session; only root runs builds. Shared device and services are protected.
- Only synthetic/public-source evidence is committed. No user attachment or private book enters Git.

## Review Focus

- A saved cover anchor must not be overridden by the new EPUB start point.
- Missing EPUB semantics must not discard an unmarked preface or illustrated opening.
- Emoji, combining marks, Markdown and large attachments must retain source and selection mapping after page turns.
- Text-size/rotation and bottom-bar disclosure must not skip visible text or save another chapter's anchor.
- PDF's native page controller and selection/zoom must not be intercepted by custom text paging gestures.

### Task 1: EPUB opening

Files: BookParser.swift, LocalBook metadata in Models.swift, ReaderSession initialization, synthetic core tests.

- [x] Add regression cases for marked cover/bodymatter, unmarked preface, old cache and saved anchors.
- [x] Record failing baseline; implement trusted start metadata while preserving all chapters and IDs.
- [x] Run core tests and independently review the diff; commit the fix.

### Task 2: Reader preference and measured paging

Files: ReaderPreferences in Models.swift, TextReadingView.swift, PDFReadingView.swift, new page-layout helper and native tests.

- [x] Add backward-compatible navigationMode=scroll|paged and decode/round-trip cases.
- [x] Implement actual viewport paging, source checkpoint/restore and PDFKit horizontal mode.
- [x] Test long passages, bidirectional/Unicode content, attachments, chapter boundaries and reflow; review and commit.

### Task 3: Tap and bottom controls

Files: ReaderScreen.swift, ReaderPanels.swift, new ReaderBottomBar.swift and tap policy helper/tests.

- [x] Make single page taps reveal controls while excluding selected text, links and native multitap gestures.
- [x] Integrate compact controls, real speech state, appearance and typography with all secondary tools retained.
- [x] Execute and review regular/accessibility layout and presentation/position checks. Record App 116/116, feature 55/56 and actual-OS 8/10 separately; UI38 and actual-OS UI41/54 remain failed acceptance gates.

### Task 4: Connect existing cloud reading-start metadata

Files: CloudBookSync.swift, OfflineLibrary.swift, ReaderSession.swift, bounded cached-copy metadata helper if needed, Core tests and one isolated native cloud-opening E2E.

- [x] Validate and carry the existing domain `readingStart` to the imported LocalBook without altering chapter or passage IDs.
- [x] Preserve valid saved positions and recover only same-owner/book/version hints from old local caches without writes; absent/invalid hints retain chapter order.
- [x] Run full Core and native App checks and exercise the complete synthetic hinted download/open/cold-resume path. `CoreResourcePositionGreen` 147/147 and current `AppMenuPreview116` 116/116 pass. Source-bound UI55 in the completed `UIFinalCurrent56` passes in 52.625 s with actual hinted c2/p4, user-selected c1, cold saved-c1 and continued-draft source attachments; the old Full55 readiness failure remains recorded. This completes the isolated synthetic cloud-start scope, not real-account continuity.

### Task 5: Native acceptance and delivery

Files: focused UITests and docs/verification/2026-10-30-get-328-reader-controls.

- [x] Save current App 116/116 and source-verified focused UI33/34/41/44 results, plus the unedited synthetic typography-preview screenshot. Preserve the first 4/4 focused run as rejected because its raw Dead-path UI plugin was old; the later owned-runner reset supplies a separate normal-path current-source 4/4. Save the latest full feature result (55/56, 19 raw UI38 audit failures, controller65), 73-observation source readback/independent review, actual UI35 JSON postflight and the unedited synthetic UI46 dock screenshot.
- [x] Execute all promised native waves and save their complete evidence. `UIFinalPostRestart56` is 55/56 with UI38 raw 19/controller65/2057.454 s/minimum 33.150 GiB; 73-observation source readback and independent review match. Legacy V5 runs all 6 at 5/6, with PDF import unproved. Actual-OS V4 runs all 10 at 8/10, with UI41/54 failed; all 10 authority exits 0/source maps match, UI40/44 actual AXXXL proofs true, and large/light restored/read back true/errors[]. Preserve all earlier failures and preparation 133/zero-native evidence.
- [ ] Full runtime/AA acceptance: UI38 raw 19, legacy PDF import and actual-OS UI41 typography checks/UI54 native-menu reopening remain unpassed. Completed execution and code review do not close these failures or establish 95/98 experience scores.
- [x] Independently review the current implementation and confirmed repairs; no confirmed outstanding P0/P1 in reviewed code. Record source/readback limits and UI38 raw failures separately; code-review completion does not waive runtime or AA gates.
- [ ] Create linked PR; wait for applicable CI, sync base, merge normally and read back exact commit/release status.

## Current checkpoint — completed feature wave, 2026-10-30

- Current source is `f7c5785` (33 local commits). Test-query correction `03b96d8` short-circuits the existing native-menu existence predicate; it does not change product menu behavior or original timings/assertions. Preview fix `f7c5785` preserves bounded source excerpts with word boundaries and an ellipsis.
- Current whole-feature evidence uses `final-post-restart56-source.json` / `final-post-restart56-build-authority.json`; source maps remain identical to accepted f7. Its 55/56 case result and 19 raw UI38 assertions stay separate from 73-observation source readback/independent-review success and from any 95/98 experience claim.
- The original independent UIKit control failed before the latest authorized Primary restart, then passed in 9.878 s unchanged. Original reader UI45/54/57 passed focused 3/3 and again in the latest full run, without a product-code change. The old rotation failures remain recorded.
- Native regression execution is complete. Root closes out this batch with the recorded failures, this checkpoint, one concentrated push/PR, applicable CI, normal merge and exact TestFlight readback. No generic stream-tool rollout, new feature, extra model call or real-account retry is added to this closeout.
- Current host checks are Node 100/100 (zero failed/skipped, 728.162625 ms) and Python 9/9 (0.300 s); historical Node 90 remains separate. Latest full-wave UI58 passes its three real Copy/Note/Paste rounds in 160.342 s.
- `UIFinalLegacy6PostRestartV5` cases 1/2/3/4/6 pass in 37.508/17.822/34.468/31.658/42.461 s. Case 5 fails in 18.683 s after six bounded Files routes, with no import/manifest and PDF postflight −5; this does not establish renderer acceptance or rule out renderer defects. All six authority exits 0/source maps match, minimum 35.55999 GiB. The receipt canonical-parent fix is off-tree, independently reviewed and changes no product source.
- Actual-OS `UIRealOSAX5PostRestartV4` is 8/10 after all 10 execute; minimum 34.223564 GiB. UI41 fails in 77.577 s after its one-way missing-字号 search reaches Form bottom, leaving typography frame/font gates unverified. UI54 fails in 42.658 s: first Copy clicked, copied bytes unverified; after the second long press, `This` has selection handles but no native menu. Its real AX5 menu-reopening chain is unpassed; Note/Paste/reflow/rotation/cold steps were not reached. Independent reviews confirm no product P0/P1 cause from this evidence, without waiving either failure.
- The real-account read probe built but a single 150 s external timeout produced empty runtime evidence. Phase/authentication-attempt completion and cleanup are unknown; no real-account acceptance or automatic retry is authorized by this result.
- Task cleanup is recorded: only owned process termination checks and synthetic UIKit app/runner uninstall; GET317 app/data retained, Primary Booted, Compact/iPad Shutdown, large/light read back. Formal evidence and DerivedData remain retained, so full resource reclamation is not claimed.
- At this fixed pre-PR checkpoint, push/PR/CI/merge/live Apple build readback and the new TestFlight release were not yet recorded. Their subsequent final status belongs in the GET-328 PR/Linear issue. Existing GET-317 gaps, physical-device VoiceOver/keyboard and real-account/provider boundaries remain in the verification README.

This plan now records the pre-PR state, rather than serving as a live release ledger. Complete native execution and incomplete runtime acceptance are both retained; later delivery milestones are recorded on the linked PR/Linear issue.
