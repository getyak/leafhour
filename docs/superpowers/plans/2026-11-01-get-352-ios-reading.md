# GET-352 iOS reading implementation plan

> For agentic workers: use subagent-driven development for the scoped implementation domains and an independent whole-branch review. Native tests run centrally and serially.

**Goal:** Deliver the six requested iOS improvements with recoverable data and quiet, native interactions.

**Architecture:** Retain the TextKit/PDFKit reader and stable source model. Scope preferences to the library, send acknowledged commands to the actual viewport, use local speech audio processing, and reuse Web share permissions through native previews and routing.

**Tech stack:** Swift 5.9, iOS 17+, SwiftUI, UIKit, PDFKit, AVFAudio, existing LeafhourCore services.

**Spec:** `docs/superpowers/specs/2026-11-01-get-352-ios-reading-design.md`.

## Global constraints

- Public `getyak/leafhour`; base `85bf3a3`; branch `codex/get-352-natural-ios-reading`.
- No paid/new model calls, social SDK, fabricated data, automatic public uploads or default playback.
- Preserve selection, copy, links, source anchors, private data and device/account ownership.
- Speech speed 0.5–5, default 1; automatic interval 5–120 seconds, step 5, default 30.
- Native execution only via `dev-ios-session`, one build/test at a time. No preview deployments.

## Review focus

1. A stale timer or cancelled animation cannot advance a different book/chapter or overwrite the current anchor.
2. Shared settings survive book A → B → restart without sharing progress or crossing account scope.
3. Speech faster than the native synthesis-rate ceiling really changes output speed, and highlights follow output.
4. Public/private and original/translation selections keep their exact sharing and import boundaries.
5. Long text, Dynamic Type, iPad share presentation, backgrounding and native selection stay usable.

## Tasks and ownership

### 1. Default paging, page curl and shared settings — paging_preferences

Files: `Models.swift`, `ReaderSession.swift`, `OfflineLibrary.swift`, focused new profile/transition files, `TextReadingView.swift`, `PDFReadingView.swift`, navigation/selection helpers, relevant Core/App tests. Only typography/appearance structs in `ReaderPanels.swift`.

- [x] Write behavior tests for new defaults, legacy migration, A→B/relaunch/scope isolation and page-command boundaries.
- [x] Add profile loading/writing using serialized domain services; keep old per-book records readable.
- [x] Implement public native page curl and reduced-motion behavior with real selectable text restored.
- [x] Consume `ReaderPageRequest` and acknowledge actual outcomes for text and PDF.
- [x] Expose optional selected-quote share callback while retaining the native menu.
- [x] Central native verification, self-evaluation and independent review.

### 2. Contents and automatic turning — contents_autoturn

Files: extracted `ReaderContentsPanel.swift`, new `ReaderPageCommand.swift`, automatic-turn controller/panel and behavior tests. Root owns screen/tool wiring.

Produces: `ReaderPageRequest` with id/expectedNavigationID/direction/origin and `ReaderPageRequestOutcome` (`settled`, `end`, `notReady`, `blocked`). Exact declarations live in the new command file and are shared with the paging implementer.

- [x] Write tests for real-order filtering/current-location and explicit timer-state transitions.
- [x] Replace crowded contents controls with current chapter, locate and search.
- [x] Implement start/pause/resume/end, measured-page command acknowledgement and stale-navigation rejection.
- [x] Pause for interaction/selection/tools/speech/background; stop at end and launch stopped.
- [x] Central native verification, self-evaluation and independent review.

### 3. Listening speed — root

Files: `ReaderSpeech.swift`, focused audio-renderer/speed-control files, listening section of `ReaderToolPanels.swift`, `ReaderInteractionTests.swift` and audio timing tests.

- [x] Write tests for endpoint/invalid rate handling, distinct high-rate output, pause/resume and cursor continuity.
- [x] Replace synthesis-rate multiplication with local audio playback-rate processing.
- [x] Tie word markers to played samples and preserve existing delegate/cursor recovery semantics.
- [x] Add the 0.5–5 slider, accessibility and shared `speechSpeed` persistence.
- [x] Verify with actual local synthesis/output timing in Simulator and state device-audio limits.

### 4. Sharing, selection and App import — sharing_import

Files: focused native share models/card/preview/activity/import routing files, `LeafhourApp.swift`, `LibraryScreen.swift`, library presentation/core adapters and tests. Root owns reader-panel wiring; paging agent owns native text-menu callback.

- [x] Research first-party interaction examples and existing Web share routes/permissions.
- [x] Write routing/payload tests, including arbitrary-host rejection, private data omission and deduplication.
- [x] Implement preview, image/text representations and copy-link for authorized links.
- [x] Implement selected-text card and safe supported document/Leafhour link import with explicit confirmation.
- [x] Verify long selection, readable image output and available system destinations. Actual iPad and physical social destinations remain separate acceptance boundaries.

### 5. Integrate, refine, evaluate and deliver — root plus independent reviewer

- [x] Integrate screen/toolbar/lifecycle callbacks with no ownership conflicts.
- [x] Run complete Core and application suites, affected host contracts and focused real UI flows.
- [x] Inspect actual screenshots; refine hierarchy and interaction regressions found.
- [x] Independent spec/quality review; fix and reverify material findings.
- [ ] Commit each optimization separately; push once, one PR linked to GET-352.
- [ ] Latest CI and repository gates pass; merge normally, read back exact revisions and existing releases.
- [ ] Publish a truthful verification record; close Linear only when its acceptance is actually met.
