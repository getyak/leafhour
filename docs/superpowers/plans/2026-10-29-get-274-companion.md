# GET-274 on-demand reading companion

**Goal:** Summon the companion deliberately, keep the book visible above its half sheet, and return to quiet reading within one second of dismissal.

**Current platforms:** PR #209 remains the historical Web prototype. The production Web reader has an actual authenticated chat service; its selected-quote/annotation CSS currently expands the phone sheet to the full viewport. The native iOS reader has no companion service integration. Its local source/selection and sheet interactions can be implemented and tested without Apple access, but an unavailable state cannot establish actual AI acceptance.

**Approach:** Keep the existing Web chat owner, authenticated service, draft persistence, focus containment and desktop sidebar. Bound the mobile sheet to half the visible viewport even with a quote or annotation, allowing internal scrolling. Return focus to the quiet reading edge after dismissal. In native SwiftUI, add an explicit top-controls summon and system-selection action, with a medium-only companion sheet and an honest unavailable state. Do not add fabricated answers, login retries or model calls. Do not modify the existing prototype.

1. Add regression coverage for close focus and native explicit/selection summons, book visibility and dismissal timing. Reproduce the existing failures before implementation.
2. Update Web layout/focus and native reader/panel/selection owners. Run the existing related host suites, native build and guarded simulator tests in an isolated task bundle with public-domain text. Check copy exports/lint using the provided cached Vale.
3. Obtain independent agent review, fix confirmed findings, refresh main, and deliver one GET-274 PR. Require current applicable CI before ordinary merge. Check the automatic production deployment and actual Web UI. Record simulator, production, real-model, physical-device and TestFlight evidence separately. Keep Linear In Progress when required acceptance remains unavailable; parent finalizes unavailable Linear writes.

Native source and simulator checks do not establish cloud companion functionality, physical iPhone timing, VoiceOver, keyboard, haptics or TestFlight installation/update acceptance. Existing Apple release work is separately owned; this task does not retry or replace it.
