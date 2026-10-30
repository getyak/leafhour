# iOS quiet shelf implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Deliver the six requested iOS shelf, settings and reading improvements.
**Architecture:** Extend existing library metadata/client for covers; keep shelf controls in compact native menus. Add independent persisted reading layers to the existing source renderer and bounded foreground translation coordinator using existing billing/idempotency services.
**Tech Stack:** SwiftUI, UIKit/TextKit, LeafhourCore, Node service.
**Spec:** docs/superpowers/specs/2026-10-30-ios-quiet-shelf-design.md

## Global Constraints

- iOS 17+, immutable source/IDs, original/literal/interpretive remain distinct.
- Account-fenced private data, no real data or credentials in repo/logs.
- At most current/next chapter AI, explicit opt-in and cost scope, durable exact-request retries.
- Preserve device-local data, notes, anchors, old preferences, existing navigation/selection.
- No preview deployment, one consolidated PR, separate evidence gates.

## Review Focus

- Cover failure/account switch/offline must not leak an image or block opening books.
- Very long titles and accessibility text must preserve usable controls.
- Translation updates and mode switches must preserve source paragraph anchors.
- Partial existing translations/provider uncertainty must not cause overwrite/rebill.
- Background/mode exit/account switch stops new generation; old responses stay scoped.

### Task 1: Remote covers
- [x] Add metadata/transport tests that fail before cover support.
- [x] Extend brief/CloudShelfBook, bounded authenticated/static image client and owner-keyed disk cache; pass real cover to shelf/resume/detail.
- [x] Run affected server/core tests, commit.

### Task 2: Quiet book interactions
- [x] Make entire book one open action; remove resting availability/action text and preserve accessible intent/details context menu.
- [x] Add small offline corner mark; verify blocked download still allows downloaded book reading; commit.

### Task 3: Settings
- [x] Recompose account and reading settings with preview, focused groups, tactile controls and progressive disclosure.
- [x] Verify native large text, themes, persisted preferences and account flows; commit.

### Task 4: Compact shelf controls
- [x] Replace pinned segmented filter/search stack with one shelf heading range menu; place sort/layout and search on demand.
- [x] Preserve search/filter/sort persistence, empty/retry/resume; verify native layout; commit.

### Task 5: Single download progress
- [x] Show progress and cancel inside active book; keep global activity only for imports not represented on shelf.
- [x] Verify slow download/cancel and reading another local book; commit.

### Task 6: Source/translation/parallel and bounded AI
- [x] Add failing compatibility/rendering/anchor/scope/idempotency tests.
- [x] Implement ReadingLayers model, cached/current-next refresh, source-aware rendering/selection and foreground sequential translator with durable pending request.
- [x] Run core/app/native UI tests, commit.

### Final delivery
- [x] Independent whole-branch review and confirmed findings repaired.
- [x] Impacted host checks, native units and UI evidence recorded in `docs/verification/2026-10-31-get-344-ios-quiet-shelf/`.

Remote CI, normal merge and the distinct Production/TestFlight receipts are tracked on GET-344 and its consolidated PR after this evidence commit. Source evidence alone does not claim those external outcomes.
