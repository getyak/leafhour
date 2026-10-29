# GET-315 — iOS Google/Apple sign-in and linking

Scope: native and hosted source implementation, isolated tests and actual simulator views. **This is not evidence of real Google/Apple consent, deployed manual linking or physical installation.** Source/config/test hashes are pinned in `evidence.json`; release/CI/source receipts are tracked on the linked PR and GET-315.

## Behavior delivered

- Google/Apple enter the existing Supabase PKCE flow through the system authentication browser. The app receives only a short-lived, verifier-bound, single-use handoff before obtaining its isolated opaque session over HTTPS.
- The account page lists fresh provider identities and supports explicit linking to the signed-in account. Linking retains the original native token, Supabase access/refresh tokens, account ID, offline library, reader context and drafts.
- Same verified-email association remains Supabase's authority. Apple relay/different mailboxes require explicit linking; an occupied identity is a conflict. There is no raw-email data migration, identity transfer, unlinking or tester mutation.
- Cancellation, timeout, replay, stale generations, parent-session revocation and unexpected provider/redirect addresses are fenced. Old hosted versions expose a truthful update/unavailable state while keeping existing email login.

## Final accepted local verification

| Check | Result |
| --- | --- |
| Hosted native/web authentication and policy tests | 86 passed |
| Related portal/account/auth presentation regressions | 49 passed |
| Complete Core host Swift suite | 85 passed |
| Native app build and AppTests on Primary iPhone simulator | 22 passed |
| Native UI flow: provider buttons, linked methods, existing record | 1 passed, 26.302 seconds |
| iOS release/vendor Node contracts | 90 passed |
| Python iOS contracts | 9 passed |
| Vendored dependencies | ZIPFoundation 26 files; swift-cmark 71 files verified |
| Independent static auth/security review | No confirmed P0/P1/P2 |

The four new AppTests include browser failure/single operation, cancellation/late callback, timeout, and a real LibraryModel linking path that preserves the existing library, reader, draft, notes and opaque token. Core tests exercise S256, exact URLs/state and asynchronous owner/generation changes. Hosted service/HTTP tests cover both PKCE layers, verified provider authority, atomic handoff consumption, cancellation during callback/exchange, parent revocation, missing providers and provider URL restrictions. Existing web callback behavior remains covered.

The registered artifact root was `/private/tmp/ai-test-GET-315.dhzzB2`. Native tests used `dev-ios-session` and the existing Primary iPhone (iPhone 17 Pro, iOS Simulator 26.5); task-only bundle IDs were `org.leafhour.get315-native` and `org.leafhour.get315-probe`. The borrowed device stays booted. Test source and fixture are in `probes/`; final logs and xcresult summaries are adjacent. Full raw diagnostics remain private. Initial SwiftUI/type-inference compile failures were fixed. The UI probe was corrected to select the foreground visible record button rather than the identically named button behind the sheet; the final complete flow passed without changing product behavior for that selector.

## Screenshots

These are actual native simulator screenshots using a synthetic account/provider fixture. The displayed associated Google identity is fixture data; it does not prove a real Google identity was linked.

- [Google and Apple entry](screenshots/01-login-options.png)
- [Existing account and linked methods](screenshots/02-linked-methods.png)
- [Existing record remains accessible](screenshots/03-account-records.png)

## Live configuration and release boundary

An anonymous read of production `/api/auth/session` confirmed Google and Apple provider availability before implementation. The connected Supabase account only exposed unrelated DayPage projects; no such project was used. Existing local Vercel credentials returned 403 for user/team/project reads, and the Vercel connector returned no matching usable team. Browser management sign-in did not complete. No unrelated environment, real identity or signing credential was changed, and no real provider consent or model call was started.

Consequently, **the Leafhour project's manual-linking switch remains unverified**. It is not reported as disabled or enabled. Restore the matching management connection, confirm canonical domain/repository/project ownership, verify manual linking, deploy the updated hosted adapter, then record real Google/Apple same-account and explicit relay-link results. Provider availability alone is not evidence of manual-linking configuration. GET-315 remains In Progress with `need human` while this live acceptance dependency is unresolved.

The user previously enabled automatic iOS uploads. Only the final exact-source workflow/Apple receipt can establish this candidate's upload and processing; a prior build's receipt is not reused. Production deployment, tester access, physical installation and a retained-data TestFlight update remain separate checks.
