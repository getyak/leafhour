# GET-352 independent review

Date: 2026-11-01. Branch: `codex/get-352-natural-ios-reading`. Base: `85bf3a3`.

## Verdict

**Pass at source-review level: no unresolved confirmed P0/P1/P2 finding after corrective readback.** This is an independent source review, not a runtime or release acceptance claim. The parent agent owns serialized Core/App/UI execution; this reviewer did not start a build, simulator, or child agent and did not modify implementation code.

Reviewed the design and implementation plan, repository contracts, complete implementation diff and relevant existing save, navigation, account, gift and download call chains. The review follows the pre-landing checklist's two-pass approach: races/data boundaries first, then behavior and recovery. Pending test results are not counted as defects.

Final corrective-wave readback used the frozen working tree above local Core commit `36f9489`, relative to base `85bf3a3`, and `.superpowers/sdd/2026-11-01-get-352-ios-reading/review-final.diff` (SHA-256 `15c9a00cda971aa956ab9e73e4b1d9a836293cd2ee31a486109690dce847be47`). Source-review verdict remains **Pass**. App pass 7 was still running under the parent's guarded worker during this review; its eventual result is not inferred here.

## Open findings

None in the final source readback. Native test, UI and release gates remain separate.

## Findings corrected during review

### P2 — Pending cross-chapter turn inherited by a newer navigation — corrected

Initial location: `apps/ios/Leafhour/TextReadingView.swift:642–649`; creation at `587–594`, invalidation at `110–114` in the first-pass source.

Originally `pendingPageTransition` stored only a direction. A cross-chapter turn set it, called `session.go`, and scheduled an asynchronous `restore`. If a second explicit navigation replaced that restoration before its main-queue callback ran, the old callback was correctly rejected by `restorationGeneration`, but the replacement restoration still consumed the old direction. For `.previous`, it forcibly set the **new target chapter** to its last page and called `capture()`, overwriting the anchor explicitly selected by the newer navigation. `animatePage` captured the replacement navigation identity, so its later guards could not detect this reuse. Cancelling a touch/selection/background transition also left this pending direction behind.

Deterministic reproduction using the existing pagination fixture:

1. Open chapter 1 at its first page in a book with a multi-page chapter 0.
2. Call `coordinator.turnPage(.previous)`; do not drain the main queue yet.
3. Call `session.go(to: 0, anchor: chapter0Start)` and `coordinator.updateContent(view)` to represent a newer explicit jump.
4. Drain the main queue. The surviving restoration first restores `chapter0Start`, then the pending `.previous` branch moves to chapter 0's last page and persists that position.

Corrective readback: `PendingPageTransition` now stores session owner, post-`go` navigation ID, chapter ID, preferences, geometry and restoration generation. `pendingTransitionIsCurrent` is checked before content updates and restoration; `cancelPageTransition` clears the pending state and returns a non-success outcome on supersession, touch, selection and background cancellation. The surviving callback checks the bound generation before applying its direction. `testAQueuedPreviousChapterTurnCannotOverrideANewerExplicitSourceJump` explicitly queues the old turn, replaces it with a third-chapter anchor, and checks both current and persisted positions.

Evidence level: confirmed by the concrete synchronous/queued call chain; this reviewer did not execute the native fixture.

### Other corrected findings

- **P2, late public-link result replacing a newly created gift link.** `loadPublicLink` originally set `ownerID`, awaited `shelf`, then rebuilt `content` from `initial`. A user could create a gift while that lookup waited; the later public lookup then replaced its `/gift/...` URL with `/read?...`, while the UI still said the gift was created. Current `NativeBookSharing.swift` checks `gift == nil` before applying the public result. Source readback confirms the guard; runtime regression evidence belongs to the parent run.
- **P2, silent file-export preparation failures.** The `ShelfSharePanel` replacement originally retained `preparing`/`error` writes but removed all rendering of those values. An undownloaded selection or export failure simply lost the file-share action with no explanation. The first correction restored the notice. Final source uses `ShelfShareFilePreparation`, renders `preparation.notice`, exposes an explicit retry, preserves already prepared files across a failed batch, and rejects files completed after a scope change. Source readback confirms these paths.

Additional integration changes brought to this reviewer were read back: `ReaderSession.save` persists the shared preference authority before `library.saveState` can schedule cloud synchronization, with `testStateStoreSeesTheNewSharedAuthorityBeforeSchedulingSynchronization`; selected translation attribution now verifies the original, variant, exact offset and selected text against the cached translation before treating its current review status as applicable. These are source checks, not claims that their newly added native tests have passed.

## Final corrective-wave review

The following runtime/integration findings were supplied by the parent, then independently traced through the latest implementation and regression-test source. They were not independently reproduced by this reviewer.

- **Destroyed SwiftUI host reentered by native observer removal:** both Text/PDF coordinators now set `isInvalidated` and `restoring`, cut optional host callbacks, then tear down curl/selection/gesture observers. Already queued receipt and selection callbacks check invalidation at delivery. Nonoptional wake/selection/scroll routes are guarded at their coordinator entry points. The reader resets transient touch state at mode/background boundaries and ignores duplicate touch booleans. Text/PDF dismantle regressions exercise a real observer, queued rejection, and subsequent late callbacks. No remaining unguarded path to the reported touch-state crash was found.
- **PDF native pager used a scroll transition:** paged PDF now uses the real single-page `PDFView` without its internal page controller. Fitted one-finger horizontal gestures enter `turnPage` and the temporary curl; selected or zoomed pages yield to native behavior. PDF-only pan priority is opt-in, leaving text-reader precedence unchanged. The public accessibility override distinguishes handled, blocked and native-scroll results, preventing fallback during a turn, selection, teardown or horizontal book boundary. Tests inspect real page/curl state, zoom geometry and the public accessibility method. Source review finds the reported mismatch addressed; visual/device behavior still depends on runtime evidence.
- **Synthesis metadata was not audible progress or always source coordinates:** a per-utterance collector now pairs timestamped delegate words with adjacent legacy source UTF-16 ranges, rejects surrogate-splitting ranges, and omits unpaired SSML expansion words. Delegate/closure duplicates are deduplicated by the locked capture. PCM segments retain the unchanged file's order; source markers advance only through `.dataPlayedBack` completions, with generation, pause and final-completion checks. Provider cancellation seals the capture and cannot cancel a different utterance. The Chinese/emoji trace and late-metadata regressions match these boundaries. Metadata arriving after scheduling can still be reported late; the code and evidence do not justify a universal timing-precision guarantee for every voice.
- **Share presentation, QR and pending import integration:** the reader share panel is embedded in the host navigation stack; its completion uses the host's flush gate, and interactive dismissal combines creation and host-save blocking. Canonical content-link validation excludes authentication parameters from QR payloads. The frozen quote's original/variant/offset/text must match before inheriting review status. Incoming presentation masking no longer consumes the queued request; book authorization comes from `reading-manifest`, so archived shelf presentation is not mistaken for lost content access. Public preview transport removes cookies, additional headers, credential storage and cache and rejects redirects. Existing cloud request generation/origin checks remain the authenticated boundary.

Parent-reported Core, paging and sharing test totals are recorded in the main delivery evidence, not promoted here to independent execution. Earlier failures, crashes and fixture corrections must remain visible there; this source pass does not replace the final complete application run, UI acceptance, CI or release gates.

## Scoped follow-up: automatic-turn transaction stall

**Pass for the deferred automatic-request correction; no additional confirmed P0/P1/P2 in this scoped review.** Scope was limited to `TextReadingView.consumePageRequest`, its cancellation/teardown callees, and the added queued-request/default-timer regressions. Reviewed diff: `auto-final-review.diff`, SHA-256 `91d5b894e19659bcc934fdd380e3b3c585f7effbb48eda50ac9e954d37f1be49`.

The earlier static pass and 213-test application pass did not establish the automatic-turn E2E path. The parent's subsequent UI run exposed a real **P1 main-actor stall**: the default timer reached `updateUIView`, moved the real offset from 0 to about 705, and called the curl snapshot synchronously inside SwiftUI's rendering transaction. The original `auto-trace-system.log` stops at `text_curl_start`; `snapshotView(afterScreenUpdates: true)` could wait for the same transaction whose completion its caller blocked. This was a runtime defect, not a missing assertion or a timer that failed to fire.

The correction registers the pending request synchronously but queues the actual turn after the representable update returns. Before mutation, the queued closure requires the same live pending request, parent request, view, session owner, navigation identity, restoration generation, render signature, bounds and insets; it then checks restoration/curl/selection/touch/paged eligibility again. A newer jump or changed identity produces `.notReady`; selection/touch produces `.blocked`; request removal cannot turn; teardown first invalidates and removes the pending request, and the queued closure delivers no callback into the destroyed host. Once a valid turn begins, the existing animation completion and controller request-ID checks remain responsible for its receipt. No path was found that lets this added queue boundary execute an expired request after a newer navigation or teardown.

Regression source was read for `testQueuedAutomaticRequestCannotOverrideANewerExplicitSourceJump`, `testQueuedAutomaticRequestRechecksCancellationSelectionTouchAndTeardown`, the one-real-page/no-fabricated-activity test, and `testDefaultMonotonicTimerPublishesARealRequestAfterFiveSeconds`. The latter uses the production monotonic clock and timer rather than manually invoking the due action.

This reviewer also read the parent's existing runtime logs without starting another native run. `auto-fixed-trace.log` records all four focused App tests passing: default timer 5.032s, real-page turn 1.178s, newer-jump rejection 0.030s, and queued interruption rejection 0.058s; UI101 passes in **38.585s**. `auto-fixed-trace-system.log` records `fire → request → bridge_update → text_deferred → offset 0→705 → curl completed → matching settled receipt`, followed by pause, explicit resume and background pause. Thus the scoped runtime loop has actual evidence in addition to source review. Temporary trace calls are absent from the current controller, text viewport and curl implementation. The trace-free `native-final` complete run was still in progress at this follow-up; its result remains a separate delivery gate, not inferred from the instrumented run.

## Checked boundaries and remaining evidence limits

- Shared preferences use the profile-specific `OfflineLibrary` root, serialized session saves, an explicit preferences store for cloud-backed readers, retained legacy per-book records, and recoverable corrupt-file errors. No confirmed cross-account leak or save-queue defect found.
- Automatic requests reject stale navigation before execution and receive viewport outcomes; user activity callbacks are bypassed for automatic text/PDF turns. The corrected cross-chapter state is also bound to the intended navigation after execution starts. Controller interruption/removal paths and end/timeout handling were reviewed.
- Speech uses baseline local synthesis, serialized PCM file writes/EOF, `AVAudioUnitTimePitch`, per-generation source-range collection, played-segment receipts and temporary-file cleanup. No additional confirmed defect found by inspection. Output speed, marker/audio alignment and physical-device audio quality require the parent's native evidence.
- Sharing keeps quote/book payloads separate, validates canonical URL/token shapes, previews gift scope, requires an explicit gift/import action, and uses account-bound services. Public gift preview has a cookie-free session and rejects redirects. Native text menus preserve system actions and re-read current selection.
- Long cards measure their actual text, split without dropping characters, and provide complete-text fallback when image limits are exceeded. Source review does not establish narrow-screen/maximum Dynamic Type, iPad activity presentation, installed app delivery or real-device acceptance.
- PDFKit continues to own rendering, selection, links and zoom; the fitted paged gesture now explicitly uses the shared curl path. Real touch/VoiceOver and cancellation interaction still warrant visual/device acceptance. The implementation's custom scheme is distinct from an associated-domain universal-link release.
