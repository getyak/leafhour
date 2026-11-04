# iPhone Experience Implementation Plan

**Goal:** Deliver the six refinements requested on November 4.
**Architecture:** SwiftUI surfaces retain shared LibraryModel/ReaderCloudTools; native UIKit paging and rendering where useful. Journal caches remain account and timezone scoped; messages use existing authenticated APIs.
**Tech Stack:** SwiftUI, UIKit, LeafhourCore, Node server.
**Spec:** docs/superpowers/specs/2026-11-04-ios-experience-design.md

## Global constraints
- iPhone first, minimum iOS 17; preserve unrelated changes and private data.
- No automatic model invocation for gestures, reactions, previews or cache refresh.
- Source/translation/user/AI attribution stays distinct; sharing is explicit and previewed.
- 9.5/10 is a target; report evidence and unverified criteria honestly.

## Review focus
- Horizontal paging versus vertical scroll, text selection and navigation-back priority.
- Account switches and stale asynchronous work must never cross owners.
- Long text, emoji/CJK, Dynamic Type and dark mode keep content available.
- Month/day/timezone changes and new reading invalidate cached statistics.
- Share previews contain exactly the export, without hidden adjacent private content.

### Task 1: Navigation, avatar, vertical elasticity
- [x] Implement bounded native horizontal paging in GlobalChatScreen root; preserve bottom navigation and state.
- [x] Add bundled licensed avatar gallery, local photo import and scoped persistence; wire shelf/settings.
- [x] Verify boundaries, cancellation, narrow layouts and gesture coexistence with targeted tests.

### Task 2: Journal response
- [x] Separate notebook loading and cached statistics publication in ReadingJournalModel/MyReadingScreen.
- [x] Add freshness/invalidation, owner/timezone guards and concurrent month reads.
- [x] Verify warm/offline/cross-month/account switch behavior and record timing.

### Task 3: Chat and actions
- [x] Implement asymmetric bubbles, remove role captions, preserve Markdown/selection.
- [x] Add reaction picker, stable quote, multiselect/copy and share presentation using NativeShareContent.
- [x] Persist reactions and convey validated reactions on next explicit send through existing server contract.
- [x] Verify ordering, restoration, invalid references, isolation and no background model calls.

### Task 4: Long-form sharing
- [x] Replace chunk pagination with one content-measured image and safe allocation limit.
- [x] Use three editorial styles, clean QR footer without printed URL; add optional frosted context fields.
- [x] Verify full text, QR decode, preview/output match, cancellation and long content errors.

### Task 5: Independent acceptance and delivery
- [x] Independent reviewers evaluate each of the six groups, fix identified defects, retain honest scores/evidence.
- [x] Run local Core/app tests, simulator UI and build; inspect final diff.
- [ ] Commit scoped changes, PR, current CI and normal merge per repository authorization. Track production outcome separately in the PR and Actions; this plan records the pre-delivery validation snapshot.
