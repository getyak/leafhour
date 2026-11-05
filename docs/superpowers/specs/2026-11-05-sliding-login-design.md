# Sliding login sessions

The user approved Web sessions expiring after 30 idle days and native iOS sessions after 90 idle days. This replaces the fixed seven-day application session without changing account or library ownership. Other GetYak products are audit-only in this request.

## Approach

Keep the existing opaque credential and server-side provider refresh. Add an explicit, owner-bound foreground activity endpoint; do not count ordinary authentication checks, background polling, model jobs or provider-token refresh as activity. This is preferable to extending every authenticated request, which would keep unattended clients signed in indefinitely. Merely increasing the fixed deadline would still interrupt people who use the product regularly.

`POST /api/auth/session/activity` accepts `{client: "web" | "ios"}` and the existing cookie, Origin and `X-Reader-Owner`. Successful authentication and an atomic check of revocation, owner and the existing deadline precede renewal. The response is `{user, expiresAt, maxAge}`; maxAge describes the logical idle window, not browser retention. Client type selects retention only, never permissions; an established iOS session is not downgraded by a web request.

Browser credentials have a 365-day physical retention cap, issued only on sign-in (HttpOnly, Secure, SameSite=Strict). Activity never writes an authentication cookie: a delayed response from an earlier account otherwise overwrites a newer sign-in before JavaScript can reject it. Server-side 30-day inactivity remains authoritative even while the browser still stores the credential. Continuous Web use requires signing in again after the physical cap. This cap does not govern the native Keychain.

New email sessions accept the same optional client field (default web); the dedicated native OAuth exchange always issues iOS retention. Existing unexpired seven-day server sessions upgrade on explicit activity. Legacy Web cookies retain their original browser expiry and need one new sign-in for the longer browser retention; no forced immediate logout is introduced. Native credentials can migrate while still valid. Expired/revoked sessions cannot be revived. Logout continues to revoke only that device/session. Local self-hosted email authentication follows the same policy.

Web activity comes from visible entry, return to foreground and trusted input, throttled to once per five minutes with no periodic heartbeat. Native activity is sent on foreground entry and actual input, also throttled; background sync and network recovery do not renew it. Transient errors retain offline data and allow a later attempt. No client credentials enter browser storage, logs or export.

## Verification and delivery

Exercise exact idle boundaries, repeated activity, ordinary checks without renewal, valid legacy migration, revoked/expired sessions, owner mismatch and logout racing renewal. Verify real HTTP cookie renewal and both client lifetimes, Web activity visibility/throttling and native request/lifecycle behavior. Run affected authentication/native checks and the production build before a single PR push; independently review before merge. Record merged source, production source, TestFlight processing and physical-device acceptance separately. Existing upstream identity-provider limits may still require earlier authentication.
