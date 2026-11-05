# Sliding login verification — 2026-11-05

Tracking: [GET-398](https://linear.app/getyak/issue/GET-398). The user approved implementation and normal repository delivery for Leafhour. Other products are source-audit-only; the [portfolio overview](https://linear.app/getyak/document/全部产品登录会话核查总览-2026-11-05-b29f3c0caeaa) links all 14 projects, 13 separate audit documents and seven Backlog / need human follow-ups. Tormie retains its existing GET-378 status and label.

## Behavior

Web uses 30 idle days and iOS uses 90 idle days. Explicit foreground entry/input renews the server deadline, with at most one client attempt every five minutes. Normal identity lookup, provider refresh, background sync, programmatic scrolling and programmatic focus do not renew it. Expired/revoked credentials cannot be revived; account and offline ownership remain unchanged.

Browser credential retention is separate: a new sign-in sets a 365-day HttpOnly, Secure, SameSite=Strict cookie. The activity endpoint never writes an authentication cookie. The server still rejects the credential after 30 idle days. Continuous Web use requires sign-in again at the physical cap; the native Keychain is not governed by that browser cap. Legacy Web cookies keep their old physical expiry and require one new sign-in for the longer browser retention; valid native credentials can upgrade on activity.

## Review and decisions

A fresh read-only reviewer checked the original implementation, coverage and documentation. It found two Important issues, no Critical/Minor findings, and reproduced both without real accounts:

1. A delayed activity response could replace a newer login cookie. The implementation now never writes that cookie from activity. Real HTTP regression cases cover logout/relogin and direct new login while an older activity response is held.
2. Browser-generated programmatic scroll events can have `isTrusted=true`. Activity now listens to actual pointer, keyboard, wheel and touch input instead, plus visible entry/visibility changes. Programmatic scroll/focus has a separate regression.

Both defects were observed in failing regression tests before the fixes and then passed. The reviewer did not re-review the subsequent fixes; their covering tests and final integration checks provide the fix evidence.

Ruling: use a 365-day physical browser cap rather than rolling the shared authentication cookie — late responses must not choose an earlier account. Cost: continuously active Web users still sign in once per year.

Ruling: do not rewrite legacy browser cookies from activity — preserve the same race protection. Cost: existing Web users sign in once when their original cookie naturally expires.

Other review boundaries: upstream hosted Supabase configuration is not verified by local fixtures; client type selects retention, not permissions; external MCP/API grants remain independent; physical-device and assistive-technology acceptance remain separate. Existing login/logout/OAuth cookie races were outside the new activity-writing defect; this change does not claim to redesign all authentication flows.

## Checks

- New hosted/local idle-window and Web-input tests: RED before implementation, GREEN afterward.
- Real HTTP delayed-response regressions: three failures before the cookie fix, GREEN afterward.
- Programmatic scrolling/focus regression: failed before the input-event fix, GREEN afterward.
- Authentication, OAuth, owner-scope, release snapshots, library/reader bundling and extracted portal fixtures are included in affected checks.
- LeafhourCore: 414 tests executed, two skipped, zero failures. Includes 14 new native activity/request tests. Existing skipped checks are not device acceptance.
- iOS Simulator Debug application build: `BUILD SUCCEEDED`, code signing disabled. This is not a device install or TestFlight publication.
- Initial complete Node run found integration failures in the new release allowlist, deterministic extracted-function fixtures and initial bundle budgets. The manifest, fixture dependencies and explicit lazy-reader boundary were corrected; startup budgets were not increased.
- Final complete Node run: 4,696 total; 4,682 passed, 14 skipped, zero failures (`node --test --test-concurrency=4 --test-reporter=spec tests/*.test.mjs`).
- Production Web build, public-asset/privacy check, source-provenance shape check, first-paint consistency, pricing receipt and whitespace checks passed. The working-tree build is not a published source receipt.
- Isolated Simulator interaction: synthetic local shelf/book, buttons, touch-drag scrolling, long-press selection and foreground return passed. The test used a temporary fixture-only bundle identifier derived from the same Simulator build, not a production account or physical phone. Mouse wheel and the expired auto-hidden contents target were not counted as passes.
- Fixed-version real Vale 3.24.0 / textlint 15.8.0 copy lint passed with zero new T1 errors and zero stale bindings; documented debt and warnings remain visible. Planted-violation canaries passed.
- The first PR CI stopped at generated copy-inventory drift before running the Web suite. The two source-inventory artifacts were regenerated; no runtime behavior changed in that follow-up.
- Real Chrome regression: programmatic scrolling produced a trusted scroll event without a new activity request; real wheel input then produced exactly one bounded activity request. Actual window focus switching and touch were not counted as browser passes.
- Merge, exact production source and TestFlight processing are tracked separately in GET-398 after this source commit; this document does not claim they already succeeded.

No passwords, provider tokens, session cookies, user books or private records are stored in this evidence. Production probes may use only the authorized default test identity and must revoke only their own newly created sessions.
