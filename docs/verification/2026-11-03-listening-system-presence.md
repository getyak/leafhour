# Listening system presence verification

Started 2026-11-03; checks continue on 2026-11-04 (Asia/Singapore). Base: public `getyak/leafhour` main `207452f25f26aa7a7f320e609ceb47ff211640c7`. Work is isolated from unrelated dirty files in the original checkout.

## Implemented scope

- Explicit local speech retains the existing background audio lease and real source checkpoint.
- MediaPlayer now also handles toggle and stop. Preparing speech is pausable before PCM begins. Stop clears metadata and owned commands.
- An embedded WidgetKit Live Activity offers pause/resume and end from Lock Screen / expanded Dynamic Island, using random per-playback tokens. System media presentation retains native playback motion; the custom activity has finite phase transitions and no fabricated audio levels or progress.
- Activity publication serializes create/update/end, checks ownership across awaits, deduplicates unchanged content and does not recreate a dismissed/failed session. Disabled activities leave media playback available.
- Signing/export validates separate exact parent and listening profiles and the embedded extension's identity/version.

## Evidence so far

- Baseline: 41 affected app tests passed before implementation.
- RED: new command tests failed for missing router/toggle/stop/preparation support. GREEN: 47 app tests, then 48 with cross-surface integration coverage, all passed with Xcode 26.4 / iOS 26.4 simulator.
- Release validation: 105 Node contract tests and 11 Python tests passed. New two-profile and embedded-extension validators were each observed failing before implementation.
- Core package: 341 tests executed, 2 skipped, 0 failures. Skipped cases are not device acceptance.
- `git diff --check` passed. App plus embedded widget built for Simulator without signing.
- Initial UI acceptance used `org.leafhour.local`, which deliberately cannot activate the existing synthetic fixture, so fixture setup timed out. The whitelist was retained. A task-owned iPhone 17 Pro simulator is running acceptance with an already allowed synthetic test identifier.
- Read-only independent review identified one important issue: the successful AppIntent path must await queued Activity updates before returning and releasing background execution. Regression and fix in progress.

## Release and device limits

Read-only GitHub environment metadata confirms that `IOS_LISTENING_PROFILE_BASE64` is absent and signing maintenance remains disabled. Creating/registering the exact listening extension and its profile requires the existing separate maintenance approval. No credentials were logged or committed, and no signing switch or Apple resource was mutated. This change is not yet an uploaded/installed TestFlight build.

Physical-device background audio, actual audible continuity, lock/unlock, Dynamic Island coexistence and continuous system media motion, Always-On, VoiceOver, large text, and iOS 27-specific layout are not established by source tests or a simulator build. The custom activity's waveform symbol is a status icon, not measured audio amplitude. The OS controls which presentation occupies the island and can dismiss activities.
