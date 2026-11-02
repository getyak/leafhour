# iOS import lifecycle implementation plan

**Goal:** Import on iOS without blocking existing reading, with quiet shelf progress and conservative title recovery.
**Architecture:** Cancellable utility processing; profile-actor commit; main-actor lifecycle presentation.
**Spec:** ../specs/2026-11-02-ios-import-lifecycle-design.md

- [x] Add failing regression cases for title fallback, profile responsiveness during parsing, cancellation, duplicate retry and remaining on shelf.
- [x] Add bounded parser progress and local front-matter title recovery; preserve original bytes and stable IDs.
- [x] Move processing off the profile actor with cancellation forwarding and commit-time deduplication.
- [x] Show receiving/processing/verifying/completed states in the shelf, dismiss shared-file panel immediately, remove automatic reader presentation.
- [x] Run core tests, iOS app tests and repeated native system-picker acceptance; review the complete diff.
- [ ] Publish the verified batch as a PR, merge after CI, and follow existing release workflows.

Review focus: same-job retry races; cancellation after verification; account fences; very large books/progress update pressure; honest failure recovery and title fallback.
