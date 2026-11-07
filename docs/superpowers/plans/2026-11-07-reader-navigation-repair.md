# Reader navigation repair

User correction: AI appears and disappears with navigation. Repair white/blank transitions and missing navigation when switching reading/listening or closing contents. This supersedes #347's permanent AI affordance.

## Evidence and scope

- Baseline synthetic UI test fails because AI is hittable with sleeping chrome.
- Local listening switch measured 3.339s including XCTest action/readiness overhead and diagnostic sampling; retain video and compare after repair rather than claiming this is isolated app CPU time.
- Transition process sampling is mostly idle main run loop, not a model/network task. Source currently pushes listening into a new navigation destination, toggles system bars, freezes the complete reader, and resets chrome asleep without restoring it on pop.
- Reading contents uses a custom drawer; listening contents uses a separate sheet. The drawer has a system-white background independent of the book's paper. Unify those entry points and keep local mode switching in one mounted window.
- Large white flashes are not yet consistently reproduced in the short synthetic book; verify frame sequences, larger text/PDF and contrasting paper themes before making a device-level claim.

## Work

- [x] Replace the listening navigation push with retained reading/listening surfaces in the existing window. Preserve source viewport, playback and explicit player collapse. Return actions reveal menus.
- [x] Show AI only with the corresponding menu. Active capture keeps menus from auto-sleeping; completion never wakes them. Preserve original capture/receipt/account contracts.
- [x] Route contents through one themed drawer in both modes and restore the originating surface and visible navigation after close/jump. Keep settings/modal behavior independent.
- [x] Run failing visibility/transition regressions, existing source position/selection, player/voice/full-screen AI and dark/large-text checks. Review the complete final diff before a concentrated PR push.
- [ ] Run current-head CI, merge normally after all checks pass, sync local main and distinguish code from device/distribution acceptance.

Production scope: ReaderScreen, ReaderListeningPanel, ReaderContentsPanel, ReaderListeningControls, and explicit native visibility in TextReadingView/PDFReadingView. No backend, credentials, billing, CI authorization or paid execution changes.

Local results and baseline failures: [verification](../../verification/2026-11-07-reader-navigation-repair.md). The final delivery step is tracked by the PR and its current-head checks.

Hosted CI follow-up: a real 30-minute timeout interrupted the simulator architecture compilation. Extend only the existing native job limit to 45 minutes, keeping every gate and the same standard runner. Validate the workflow and resource-selection contracts before the next concentrated push.
