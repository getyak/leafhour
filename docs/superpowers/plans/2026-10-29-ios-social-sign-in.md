# iOS Social Sign-in Implementation Plan

> **For agentic workers:** Use scoped subagents for the independent hosted adapter and native UI/client work, then an independent whole-change security review. Root owns portal integration, integration verification and delivery.

**Goal:** Google/Apple sign-in and explicit identity binding on iOS, preserving the existing account and reading data.

**Architecture:** The existing hosted Supabase PKCE flow issues a verifier-bound one-time native handoff. ASWebAuthenticationSession returns that handoff to the isolated native client, which obtains the existing first-party opaque session over HTTPS.

**Tech Stack:** Node ES modules, hosted CAS document store, Supabase Auth, Swift/SwiftUI, AuthenticationServices, CryptoKit.

**Spec:** `docs/superpowers/specs/2026-10-29-ios-social-sign-in-design.md`

## Global constraints

- Keep `getyak/leafhour`, canonical server origin, existing account UUID and compatibility cookie names.
- Never log credentials or move real account records; test with synthetic identities and isolated fixtures.
- iOS 17.0 minimum; fixed `com.cubxxw.reader://auth/callback`; 600-second transactions, short-lived single-use handoffs.
- Provider secrets/access/refresh stay server-side. Native Keychain stores only the existing opaque credential.
- Existing web auth remains compatible. Linking never resets the offline library or claims a different UID.

## Review focus

- Replays, concurrent exchanges, consumed/cancelled transactions and late provider completions cannot install a session.
- Linking must reject a revoked/replaced parent, a different UID and an occupied provider identity.
- Same verified mailbox is delegated to Supabase; neither relay nor raw/alias email authorizes data access.
- Deep link and launch parsing reject duplicate or extra parameters, credentials, origin drift and token leakage.
- Old production servers and unavailable providers remain truthful; synthetic tests do not establish live Google/Apple acceptance.

## Tasks

### 1. Hosted adapter (account_sync)

Files: new `deploy/hosted-native-auth.mjs`, integration in `deploy/hosted-auth.mjs`, new `tests/native-oauth.test.mjs`.

- [x] Add failing service tests for sign-in/link launch, browser PKCE, one-time native exchange, verified user and account invariance.
- [x] Implement adapter using existing request/session/CAS helpers. Expose `beginNativeOAuth(token, input, expectedOwner)`, `launchNativeOAuth(ticket)`, `finishNativeOAuth(transactionId, {code,error})`, `exchangeNativeOAuth(token, input, expectedOwner)`, `cancelNativeOAuth(transactionId)` and `identitiesFor(token, expectedOwner)` from hosted auth. Start returns the exact contract above; launch returns `{authorizeUrl, transactionId}`; finish returns `{redirectURL}`; exchange returns `{token,user}`.
- [x] Add meaningful race/expiry/cancel/conflict tests, execute focused Node suites and report real results. Do not edit portal or native files.

### 2. Native client and UI (reader_tools)

Files: `CloudLibraryClient.swift`, new core OAuth policy/types, AccountScreen, LeafhourApp account adoption, Info.plist, native/AppTests. Agent owns project regeneration after native files are final.

- [x] Add failing policy/client tests for S256, strict URL/state parsing and no credential changes on cancellation or owner drift.
- [x] Implement contract methods and system browser coordinator with one pending operation and complete callback validation.
- [x] Add unsigned provider buttons and signed-in real identity/binding section. Link success keeps the existing library/context; handle callback URLs separately from file imports.
- [x] Run focused lightweight checks; leave shared simulator/build execution to root to avoid contention.

### 3. Portal, deployment surface and synthetic integration (root)

Files: `server/portal.mjs`, hosted API route configuration if required, new HTTP tests and native UI fixture.

- [x] Add failing HTTP tests for start Origin/owner, authorize cookie, native callback without browser session, exchange cookie and cancellation; retain web callback tests.
- [x] Wire native routes before ordinary auth callback/user resolution as required. Set no-store/no-referrer on every redirect/handshake response. Cap bodies/query shapes; preserve existing generic web fallback.
- [x] Ensure new auth paths reach the hosted function and the release manifest includes new modules.
- [x] Run affected host tests, vendor/contracts, native build and simulator/AppTests/UI once using registered artifact storage. Inspect real native screenshots.

### 4. Review and delivery (root + reviewer)

- [ ] Verify actual project/provider/manual-linking configuration without touching another Supabase project or printing secrets.
- [x] Independent auth/security review; reproduce/fix confirmed findings and rerun affected checks.
- [ ] Commit only this task, create linked PR, require current CI gate, sync main before normal merge.
- [ ] Read back merge/current main CI, production result and exact TestFlight receipt. Stop waiting on an explicit Vercel rejection; preserve issue as In Progress if live acceptance is blocked.
- [ ] Save evidence and clean only task-owned rebuildable artifacts/resources.
