# iOS social sign-in and account linking

GET-315 follows the user's explicit request to add Google and Apple sign-in and mutual binding to the existing iOS account. Existing autonomous delivery authorization applies; this document records implementation decisions rather than introducing another approval step.

## Intent and account authority

One Leafhour account keeps its stable Supabase user ID and its existing books, notes, summaries and positions regardless of sign-in method. Supabase, after validating the provider, owns automatic identity linking for the same verified mailbox. Leafhour never joins accounts using a client-supplied email, editable metadata, Gmail alias guesses or an Apple relay address guess.

An authenticated account may explicitly link Google or Apple, including a different provider mailbox or Apple relay, by proving control of that provider. Its primary account email/ID remain unchanged. An identity already owned by another account is a conflict; this task does not migrate historical account data or move an occupied identity. No unlink or tester-membership changes are included.

## Approaches

Use ASWebAuthenticationSession with the existing server-side Supabase PKCE integration. This preserves the already-configured Google/Apple web providers and the existing opaque first-party session; no provider secret enters iOS and no new Apple entitlement/profile is needed. Separate native Google/Apple token SDKs would add provider client configuration and signing changes; embedded WKWebView is unsuitable for provider authentication. These are engineering decisions within the user's requested scope.

## Server and client contract

- GET `/api/auth/session` retains its existing fields and adds `nativeOAuth: {version: 1}` when this hosted adapter is installed. Existing `providers` determine which buttons can start a provider flow.
- GET `/api/auth/identities` requires a session and matching `X-Reader-Owner`; returns `{user, identities: [{provider, email, emailVerified}], providers}` from a fresh provider user, not from client claims. Provider identifiers and credentials are excluded.
- POST `/api/auth/native/start` accepts `{provider: 'google'|'apple', mode: 'sign-in'|'link', state, codeChallenge}`. Both state/challenge are base64url encodings of 32 bytes. Link requires a current native cookie and matching owner header. Sign-in rejects an existing account; it is not an implicit account switch.
- Start returns `{url, transactionId, expiresIn: 600}`. URL is the exact canonical HTTPS first-party `/api/auth/native/authorize?ticket=...`. Its short-lived opaque ticket only launches this transaction; it contains no session/provider credential. Client keeps its random S256 verifier and state only in memory.
- GET authorize consumes the launch ticket, installs `marginalia_auth_flow=native.<transactionId>` as an HttpOnly, Secure, SameSite=Lax cookie scoped to `/api/auth`, and redirects to the server-validated authorization URL. Sign-in uses the fixed Supabase authorize endpoint; link uses the returned Google/Apple authorization endpoint with a provider-specific HTTPS host/path allowlist, no userinfo and no alternate port. Existing `/api/auth/callback` remains the sole provider redirect URL, preserving current provider allowlists.
- Native provider callback is selected only by the `native.` cookie prefix. A valid transaction is consumed before token exchange. It exchanges the provider PKCE code, requires a verified provider user and, for linking, the exact original user ID plus a still-active original session. Failure/cancel has a fixed public error category. Success creates a short-lived, single-use native handoff bound to the client's challenge, state and mode.
- Browser callback is always `com.cubxxw.reader://auth/callback?code=...&state=...` or `?error=<fixed-category>&state=...`. No opaque session, access/refresh token or provider diagnostic appears in the URL. No session cookie is installed in this temporary browser for native success.
- POST `/api/auth/native/exchange` accepts `{code, state, codeVerifier}`. Verify S256, expiry, state, replay and any link parent/owner fence before consuming, atomically with consumption. Sign-in returns standard `{user}` and an HttpOnly `marginalia_session` cookie. Linking requires the same original native session and returns the same account/token; after a fresh provider-user check it updates only identity metadata, preserving the original access/refresh tokens and refresh lease. This avoids overwriting a concurrent session refresh. Never reset the account cache or revoke a good old session on uncertain exchange. Callback publication rechecks its transaction marker and cancellation state atomically.
- POST `/api/auth/native/cancel` accepts `{transactionId}` and invalidates any pending launch/callback/handoff. Only a high-entropy transaction proof can cancel; it does not unlink an already-completed provider identity. Check cancellation again before storing/exchanging late success.

Manual linking uses the authenticated Supabase GET `/auth/v1/user/identities/authorize` with `skip_http_redirect=true` and a fresh internal access token, followed by ordinary PKCE exchange. `manual_linking_disabled` and `identity_already_exists` become fixed, understandable errors. Public provider settings do not prove that project-level manual linking is enabled; verify that setting separately before claiming live linking acceptance.

## Native behavior

Use the system authentication session (iOS 17 compatible initializer; exact full callback validation on all supported versions), not the reader's embedded web tools. Initial launch URL must match the configured HTTPS origin, path and ticket shape; reject userinfo, fragments, ports or alternate hosts. Callback accepts only one code or fixed error and one matching state, with no unknown/duplicate query parameters.

Only one operation may be pending. Cancellation, timeout, generation change and late callbacks cannot adopt a credential. System `inactive` during the authentication sheet does not cancel it. Sign-in success follows existing account/cache adoption; linking success requires the captured owner and keeps the existing cache, drafts and reader context. Keychain persistence remains unchanged. Non-file auth URLs must never enter book import.

Unsigned screen: clear Apple and Google buttons above the email form, with truthful provider/service availability. Signed-in screen: real linked methods and unlinked-provider actions. Explain same verified-email account behavior and Apple relay binding succinctly. Keep email/password/code entry. A server without this adapter displays an update/unavailable state, rather than pretending that native OAuth is supported.

## Verification and delivery

Test hosted launch/callback/exchange/cancel/replay/expiry/owner changes; occupied identities and verified-email authority; no token leakage or open redirect; existing web OAuth regression. Test Swift S256, exact URLs, state/duplicate queries, generation and link-account invariance. Run native build/AppTests/UI with the shared Primary iPhone and a synthetic provider fixture. Review independently before one consolidated PR push. Merge only current applicable CI/gates. Track main CI, production and automatic TestFlight upload separately. Real provider consent and physical installation require their own actual evidence; never substitute a fixture.

Official references: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [GoTrue identity endpoints](https://github.com/supabase/auth/blob/master/internal/api/identity.go), [Apple system authentication](https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service).
