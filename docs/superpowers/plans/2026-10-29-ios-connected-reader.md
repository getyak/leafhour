# Connected native reading implementation plan

**Goal:** Connect the native iOS reader to the existing account library, render Markdown properly and integrate native reading tools.

**Architecture:** Existing domain APIs, account-scoped offline-first storage, official cmark/GFM parsing with UIKit selection, SwiftUI tool sheets and system speech. Three workers own disjoint files; controller integrates and verifies serially under the shared iOS guard.

**Tech stack:** Swift 5.9+, iOS 17+, SwiftUI/UIKit, Foundation URLSession, Security Keychain, AVFoundation, vendored open-source cmark.

**Spec:** `docs/superpowers/specs/2026-10-29-ios-connected-reader-design.md`.

## Global constraints

- Keep account namespaces, cloud source IDs, original bytes and existing personal data.
- Never log credentials; reuse existing authenticated APIs and owner fences.
- Save locally first; retain failed uploads and conflicts; no fabricated success or translation.
- All iOS commands run through `dev-ios-session run`; builds use at most two jobs.
- One PR linked to GET-312; applicable checks and independent review must pass before normal merge.

## Review focus

- Session restore/expiry/sign-out while a request is in flight cannot cross accounts.
- Retried note saves cannot duplicate or overwrite unrelated records.
- Cloud content changes or newer progress cannot silently replace local work.
- Unicode, Markdown syntax removal and reflow preserve source anchors.
- Panel dismissal, backgrounding and speech navigation do not lose reading position or continue unwanted generation.

## Task 1: Account library and synchronization

- [x] Implement isolated `CloudLibraryClient`, credential persistence and login/session restore.
- [x] Implement cloud book identity and verified account-scoped reading copies using manifest/chapter APIs.
- [x] Integrate account shelf, record/activity/summary display, explicit upload and durable local-first note/progress synchronization.
- [x] Test authorization fences, failures, retries, outbox persistence and conflicts with isolated fixtures.

## Task 2: Markdown documents

- [x] Pin upstream parser source and license/provenance; keep offline builds reproducible.
- [x] Parse complete Markdown and render native attributed text with source offset mapping.
- [x] Test GFM blocks/inline text, unsafe links/HTML, Unicode anchors and legacy import compatibility.

## Task 3: Native reading tools

- [x] Add discoverable, collapsible native toolbar and accessible sheets.
- [x] Add user-started local speech with pause/resume, speed and passage navigation.
- [x] Connect existing translation, introduction/summary and reading-chat APIs with honest offline/error states.
- [x] Keep original, literal/interpretive translation and personal notes distinct.

## Task 4: Integration and delivery

- [x] Run core host tests and unsigned simulator build serially; repair integration failures.
- [x] Run focused native probes against a task-owned app and isolated fixtures; capture screenshots/results.
- [x] Run independent review and address confirmed correctness/security findings.
- [ ] Update README and evidence, commit, push, open linked PR, wait for applicable CI and normally merge.
- [ ] Read back merge/release states and record remaining native distribution/physical acceptance explicitly.

Source verification is recorded in `docs/verification/2026-10-29-get-312-connected-reader/`. The final PR/CI/merge readback is recorded on GET-312.
