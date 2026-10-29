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
- Independent native audit complete; P0 not found, reader overlay is the primary P1 candidate pending runtime evidence.
- GET-317 created In Progress. Implementation and runtime validation pending.
