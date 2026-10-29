# iOS Google and Apple sign-in

GET-315 adds system-browser sign-in and explicit account linking to the native reader. Its [design](superpowers/specs/2026-10-29-ios-social-sign-in-design.md) and [verification record](verification/2026-10-29-get-315-ios-social-sign-in/README.md) separate source/fixture evidence from actual provider acceptance.

## One account and its data

The stable Supabase user ID owns the library and native offline namespace. Changing sign-in method does not rename that namespace or migrate books, positions, notes, drafts or summaries. Supabase validates provider identities and automatically associates the same verified email with the existing user; the application does not authorize by a submitted email or guess email aliases.

In the account screen, sign in to the existing account first, then choose **关联 Apple** or **关联 Google**. This also supports an Apple hidden email when the user proves control of the provider. The existing primary account and native token are retained. If a provider already belongs to another account, no identity or reading data is moved. Refresh the linked-method list to inspect the actual result. Closing the system browser stops native adoption; it cannot undo an association the provider has already completed.

## Hosted prerequisites

Use the existing Leafhour Supabase project and existing Google/Apple provider configuration. Both must report their real availability. Manual identity linking must be enabled in that same project's Auth configuration; provider sign-in being enabled does not establish this. No new project, Apple Services ID, registered bundle or signing entitlement is required for this browser flow.

`READER_PUBLIC_ORIGIN` must be the exact canonical HTTPS first-party origin. Supabase still redirects to `<origin>/api/auth/callback`, as the website does. Do not add an arbitrary client redirect or expose provider tokens. The app's registered local callback is `com.cubxxw.reader://auth/callback`; the server creates that callback only after consuming the browser transaction. Handoff codes expire after at most two minutes and require the original S256 verifier/state.

Deploy the updated hosted adapter before accepting native social sign-in. The app checks `/api/auth/session` for `nativeOAuth.version == 1`; an old/unavailable server displays an update or connection explanation and retains email login. Manual-linking-disabled and occupied-identity errors are explicit; they are not treated as successful binding.

## Acceptance to record

1. Use an authorized provider account. Existing same-email Google, Apple and email entry must return the same server user ID and existing library. Never use a different real account as a substitute for a failed test login.
2. From an authenticated account, bind the second provider; reload the fresh identity list and compare ID, primary email, native opaque token and existing book/note/position/draft state. Include Apple relay as a separately verified scenario.
3. Cancel/expire an operation, return from background, sign out or switch account during it, and replay a completed handoff. No stale callback may adopt another credential or overwrite the original reader.
4. Record source commit, exact main CI, hosted release and exact TestFlight receipt separately from provider consent, tester access and a physical retained-data update.

At the initial 2026-10-29 implementation checkpoint, the connected Supabase account did not expose Leafhour and the existing local Vercel credential returned 403. The actual manual-linking configuration and real Google/Apple flow therefore remained unverified. Synthetic results must retain that qualification until the actual project and deployed source are verified.

References: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [GoTrue identity authorize endpoint](https://github.com/supabase/auth/blob/master/internal/api/identity.go), [Apple system authentication](https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service).
