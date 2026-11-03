# Listening system presence verification

Started 2026-11-03; checks continue on 2026-11-04 (Asia/Singapore). Base: public `getyak/leafhour` main `207452f25f26aa7a7f320e609ceb47ff211640c7`. Work is isolated from unrelated dirty files in the original checkout.

## Implemented scope

- Explicit local speech retains the existing background audio lease and real source checkpoint.
- MediaPlayer now also handles toggle and stop. Preparing speech is pausable before PCM begins. Stop clears metadata and owned commands.
- An embedded WidgetKit Live Activity offers pause/resume and end from Lock Screen / expanded Dynamic Island, using random per-playback tokens. System media presentation retains native playback motion; the custom activity has finite phase transitions and no fabricated audio levels or progress.
- Activity publication serializes create/update/end, checks ownership across awaits, deduplicates unchanged content and does not recreate a dismissed/failed session. Disabled activities leave media playback available.
- The system-owned elapsed-listening timer advances only during real output. Pause/preparation freeze it; owner change resets it. Significant clock changes reproject its date anchor from monotonic elapsed time. It never writes the reading ledger.
- Signing/export validates separate exact parent and listening profiles and the embedded extension's identity/version.

## Evidence so far

- Baseline: 41 affected app tests passed before implementation.
- RED: new command tests failed for missing router/toggle/stop/preparation support. GREEN: 47 app tests, then 48 with cross-surface integration coverage, all passed with Xcode 26.4 / iOS 26.4 simulator.
- Release validation: 105 Node contract tests and 11 Python tests passed. New two-profile and embedded-extension validators were each observed failing before implementation.
- Core package after synchronizing main and adding the timer: 350 tests executed, 2 skipped, 0 failures. Skipped cases are not device acceptance.
- `git diff --check` passed. App plus embedded widget built for Simulator without signing.
- Initial UI acceptance used `org.leafhour.local`, which deliberately cannot activate the existing synthetic fixture, so fixture setup timed out. The whitelist was retained. The task-owned iPhone 17 Pro / iOS 26.4 simulator uses an already allowed synthetic test identifier.
- Final UI acceptance: 2 passed, 1 explicitly skipped, 0 UI failures. The activity test verified background time advancement, pause freeze, resume and end without foregrounding the app. Background playback and real cursor advancement also passed. The Control Center test was skipped only after the actual `cc-root-folder-view` was found empty of every system control; the basic toolbar alone remained. Screenshots confirm this environment limitation, so system media tile presentation is not counted as accepted.
- The combined final run encountered a unit-test host connection hang before unit tests started. A separate final unit-only run on the warmed simulator passed all 88 affected app tests with no failures. The final UI cases above came from the combined run; its overall command is not reported as successful.
- Independent review found the successful AppIntent path returned before queued Activity updates finished. A suspended-end regression was observed failing, then passed after the command captured and awaited its owner's async drain before returning. A scoped timer review found wall-clock changes could distort the live date projection; forward/backward-clock regressions were observed failing, then all 3 clock tests and the full Core suite passed after rebasing on significant time changes.
- Source investigation found the previous `.duckOthers` audio option implicitly enabled mixing, which prevents eligibility as the Now Playing app. The primary-playback regression failed before switching to non-mixable `.playback` / `.spokenAudio`, then passed. See [Apple's eligibility guidance](https://developer.apple.com/videos/play/wwdc2022/110338/).
- Full Node run: 4,599 passed, 14 skipped, 1 hosted PDF subprocess timed out during heavy local load. The isolated PDF recheck passed (1/1). This was before the unrelated main #305 synchronization; current main's CI was independently confirmed successful. Web production build passed. Release contract reruns and Python profile/package checks passed. No skipped case is represented as accepted.

## Integration

Main `55b474e310f1833bbc510e8008e6e115b347c530` was merged into the isolated feature branch without conflicts, followed by the native/Core verification above. The original checkout's unrelated work was retained. Source PR/remote CI and signing maintenance are separate gates; neither a simulator build nor CI success establishes an uploaded build.

## Release and device limits

The initial read-only check found `IOS_LISTENING_PROFILE_BASE64` absent and signing maintenance disabled. On 2026-11-04 the user explicitly authorized completing this exact extension's registration/signing and continuing publication. The existing authenticated Apple Developer session was used to register `com.cubxxw.reader.listening` under the verified existing team and generate `Leafhour Listening App Store 20261104`, selecting the existing certificate resource `39R5B437Y4`.

The downloaded profile was independently checked against the existing main app profile: exact parent/child identifiers, same team, distinct profile UUIDs, App Store distribution entitlements, existing certificate bytes/fingerprint and expiry all passed. It expires 2027-08-22. Only the validated child configuration was stored as `IOS_LISTENING_PROFILE_BASE64` in the existing `testflight` environment. Existing certificates/main profiles were retained; the global automated maintenance switch remains disabled. Profile bytes and key material are not logged or committed. At this pre-merge checkpoint no new TestFlight upload is claimed; post-merge source/build evidence belongs to the existing release receipt workflow.

Remote PR CI for implementation head `525889aae58a4062df1b6497f18bef922515c4e0` passed every selected job, including native iOS build, full web checks, catalogue checks, release contracts and CI gate. This subsequent documentation update records the authorized signing outcome; it does not change implementation code.

Physical-device background audio, actual audible continuity, lock/unlock, Dynamic Island coexistence and continuous system media motion, Always-On, VoiceOver, large text, and iOS 27-specific layout are not established by source tests or a simulator build. The custom activity's waveform symbol is a status icon, not measured audio amplitude. The OS controls which presentation occupies the island and can dismiss activities.
