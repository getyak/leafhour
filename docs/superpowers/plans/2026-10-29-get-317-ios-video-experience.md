# GET-317 · native experience implementation plan

Spec: `docs/superpowers/specs/2026-10-29-get-317-ios-video-experience-design.md`.
Base: `f77288cc57658acedf6b2a83a31e281b5dfde7e2` from freshly fetched public origin/main.
Worktree: task-owned managed worktree, branch `codex/get-317-ios-video-experience`.

The user expressly requested implementation, independent subagents, sequential commits and a final PR. Existing autonomous delivery authorization applies; no additional design approval is assumed or requested. Build/test processes remain serialized on the shared 16 GiB Mac. The source video and private frame evidence stay in the task artifact directory.

## Tasks / commit boundaries

1. Record video facts, issue inventory, acceptance and scoring rules (this document and spec).
2. Add true cloud chapter progress and task-specific cancellation; test cancellation before publication and preserve completed copies (V01–03).
3. Add searchable/filterable/sortable shelf, grid/list preference and honest cover fallbacks (V04–06).
4. Expose shelf loading, offline and error states without dimming all content (V01,V07).
5. Correct reader/chrome safe-area relationship without breaking anchor restore (V08).
6. Make selection failure and save-recovery actions accurate (V15).
7. Bound wide-screen reading and preserve image alternatives (V09,V20).
8. Preserve speech pause through speed/voice changes (V14).
9. Keep conversation input and latest turn reachable, with accurate loading/failure (V12–13).
10. Improve translation context/variant readability and native sheet behavior (V11–12).
11. Separate record empty/error/cache outcomes, remove empty-book/zero-time visual clutter (V16–18).
12. Complete contents and note-editor follow-up only for confirmed issues (V10,V19).
13. Build a deterministic, isolated native acceptance fixture and exercise full flows, cold persistence, keyboard, themes, compact/iPad, error/cancellation and accessibility assertions (V21–23).
14. Independent whole-branch/screenshot review; repair confirmed important findings with regression coverage (V24).
15. Run applicable host/native checks, create one PR linked to GET-317, wait for same-head CI, sync target branch, merge normally preserving separate commits, then verify the configured production and native release states. Update and read back Linear truthfully.

Each implementation task is a separate commit; follow-up fixes receive their own commit. Agents own disjoint files and return one problem at a time for root-coordinated commits. Root checks actual diffs and integrates generated Xcode project source membership.

## Validation

- Before heavy work: pause-marker check, `dev-storage-guard resources` and `audit`; issued task artifact path.
- Swift package: full `swift test --package-path apps/ios/LeafhourCore --scratch-path <artifact>/swift-build --jobs 2` under `dev-ios-session run`.
- Native app: unsigned Debug build and hosted app tests on Primary iPhone with task-specific bundle identifier and DerivedData; no user app reinstall/reset.
- UI: XCUITest acceptance cases against isolated local data; retain `.xcresult` and inspect actual screenshots.
- Host: relevant `tests/ios-*.test.mjs`, vendor checksum and release contracts. Existing CI owns broad affected checks.
- Compact/iPad use existing pool profiles with explicit reason; no device erase or shutdown.
- Cases are recorded as pass/fail/unavailable. No unrun case contributes to the 98% target.

## Review focus

Cancellation may race a completed local publication or server upload; do not claim rollback. Shelf UI must remain usable while preserving account switching guards. Reader viewport changes must not break source/scalar anchors or selection. Paused speech must not emit sound. Conversation composer must survive keyboard and large text in a half sheet. Record errors must not silently turn into empty data. Public evidence must contain no private book text, credentials or real records.

## Progress

- Video frames inspected; source audio verified silent.
- Independent native/code reviews completed. Confirmed cancellation-publication and older-version reachability findings were repaired in separate commits with regression coverage.
- The implementation covers shelf presentation, download progress/cancellation, reader safe areas and anchors, selection, contents, notes, translations, companion input, speech and record state handling. The issue ledger includes supplementary runtime discoveries V25–50.
- Current main authentication changes were merged into the branch before the final regression cycle. After integrating current main, 95 core tests and 73 hosted app tests passed. The full normal-source19 run passed 39 of 44 UI cases and failed five: the two retained unfiltered audit cases, a remembered Files-directory locator, one return-to-reader edge gesture, and the confirmed 34-point Cancel target. Source20 fixes the Files locator and adds a real rotation case; source21 fixes the Cancel target and centers the actual top-edge gesture. The final source21 suite completed with 43/45 passing; only the retained unfiltered UI32/UI38 audits failed. All three repaired interactions passed in this full run. Source22 adds only the older-compiler guard and passed all 73 app tests on the current SDK. Compact/iPad did not execute because the device gate refuses a second simulator while borrowed Primary stays Booted.
- GET-317 remains In Progress with need human: the 98% acceptance gate and auxiliary profiles remain unmet. The verification report records exact outcomes. Create one draft PR and read its same-head CI; retain the branch, worktree and evidence for the remaining acceptance work. Do not merge or mark the issue complete before the required acceptance gates are resolved.
