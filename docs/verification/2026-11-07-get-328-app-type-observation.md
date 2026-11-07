# GET-328 actual App and Runner type evidence

The successful `3869043f` build and its 438 source / 99 product fingerprints remain
historical evidence. Its seven-case runtime authorization was withdrawn before
any installation, App launch or UI case. That package has no direct App trait
receipt: UI41's `UIApplication.shared` belongs to the UI-test Runner. OS settings,
Runner categories and App geometry cannot be relabelled as an App process readback.

This source-only follow-up adds a minimal observation under the existing exact
`org.leafhour.get328.acceptance20261107` DEBUG identity and both synthetic opt-ins.
It does not change reader layout, selection, persistence, real accounts or normal
App/Release behavior. No debugger injection, new local native build, device or
Apple operation is part of this source phase.

## Contract

The App writes only its own
`Application Support/GET328CurrentAcceptance/Diagnostics/app-runtime-traits.json`.
Its schema version, actual bundle/PID and per-launch UUID distinguish a fresh
process from stale evidence. Bounded samples record a sequence, actual timestamp,
trigger, `UIApplication.shared.preferredContentSizeCategory` and the current
foreground key window's `traitCollection.preferredContentSizeCategory`, including
their actual accessibility flags and availability. Startup, active/key-window and
content-size notifications trigger fresh API reads. Notification payloads and
test environment declarations never stand in for runtime values. Missing windows
or unspecified categories stay unavailable. Immutable snapshots are written in
order, atomically, away from the UI thread.

The dedicated UI-test helper attaches `GET328-runner-type-profile.json` per case.
It records its actual Runner bundle/PID, timestamp, test name and UIKit category.
The exact Runner identity is
`org.leafhour.get328.acceptance20261107.uitests.xctrunner`; legacy tests do not
enable the observer. Existing test actions, timings and raw `.all` accessibility
audit remain unchanged.

A host verifier compares each latest App sample, actual Runner receipt and the
independently read OS `content_size` token. Missing, unknown, stale, wrong-process,
wrong-case or inconsistent observations fail. An earlier valid sample cannot
hide a newer unavailable sample. Host fixtures are synthetic contract tests,
not actual App execution evidence.

The verifier is `scripts/ios/verify-get328-app-traits.mjs`, exporting
`verifyGET328TypeProfile({appReceipt, runnerReceipt, osContentSize, notBefore,
expectedTestMethod})`. `notBefore` is the actual case-start timestamp; the two
process IDs must differ, and Runner class/method identity must match one of the
four exact authorized methods. The actual receipt is collected while this
task's App is running or retained as a timestamped case observation; a receipt
after termination is not proof that the process is still alive.

The current observer's Git blob is
`8299124e331c20d8cce23db6150bcff0b0086839`. Its DEBUG-false source view matches both
the main baseline `352f1e568158996348fdef37d69746b2e46a07fd` and prior QA blob
`d37c67f3ccfff4ab4ea6cc52d978b9f0e081fbd7`: source-view SHA-256
`2b1a37097e7bb9b7b458533a2fd929c0a97734f815c81499b5df0f47a58b34ef`.
This conservative source check only admits `#if DEBUG` / `#else` / `#endif` and
ignores blank lines; it is not a native Release compilation. The classifier
replaces only that exact after-blob, retaining the existing exact main baseline.
The prior after-blob, different baseline and lookalike verifier paths do not
inherit the new exemption. The pure host verifier receives one exact path entry;
archive, upload, CI and unknown-script gates stay unchanged.

## Delivery and remaining gates

Only exact newly reviewed Git blob pairs may update the finite Release-equivalence
proof. Unknown paths, different baselines and product edits remain conservative.
After affected host checks and independent review, update Draft PR #336 once and
follow that new head's applicable CI. The new package still needs a separately
authorized build and the seven real runtime cases. The Simulator orientation
entry/restore capability also remains an explicit runtime-controller prerequisite;
UI54's normal `defer` is not a cancellation recovery contract.

Source-phase host checks passed: **246 Node iOS-host checks** (including 21
synthetic App/Runner/OS contract tests) and **128 Python checks**, with no failures
or skips. The finite-pair integration first recorded 116 passes / 3 expected
failures before its exact-blob update, then 120/120 after it. These results do not
prove Swift compilation or a live App observation. The old package remains the
only locally built package; the new observer still needs its own authorized
build and real receipts.
