# GET-407 Reading Guide Implementation Plan

Goal: show a once-prepared reading guide inside the existing companion.
Architecture: durable domain attempt state shared by native and Web; clients read before ensuring and never automatically retry terminal states.
Tech stack: Node domain service, vanilla Web modules, SwiftUI.
Spec: ../specs/2026-11-06-get407-reading-guide-design.md

## Constraints and review focus

Preserve account/provider/budget boundaries, GET-385 marginalia, GET-409 settings and GET-408 bookmarks. Unknown results do not replay. Do not change draft or reading position during guide preparation. Test cold clients, lease expiry and stale account callbacks.

## Tasks

- [ ] Add failing domain/HTTP tests for durable states, concurrent cache reads, disconnect and explicit retries; implement in server/reading-guide.mjs and portal route.
- [ ] Add narrative prompt and strict response validation in harness/reading-guide-generator.mjs; retain source-selection renderer as a compatibility utility.
- [ ] Remove native top banner; include guide content in ReaderConversationPanel/ChatConversationView. Persist attempted state before POST and use read-only polling after restarts.
- [ ] Add Web guide controller/view in existing reader-conversation surface; never open a new dialog or overwrite the composer.
- [ ] Run affected host/native tests, copy checks and builds, then independent agent review. Fix confirmed P0/P1.
- [ ] Refresh main, create the unique GET-407 PR, read back its Linear link, verify latest CI, merge normally, follow existing production release and record precise acceptance.
