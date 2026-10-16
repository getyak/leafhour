# Leafhour launch verification

Date: 2026-10-16. Source branch: `codex/leafhour-brand-launch`, based on `42427d4f97b639685f9ced219921a8448fa1ade9`.

## Implemented and checked

The existing public repository was renamed to `getyak/leafhour`, retaining repository ID and history. Its homepage is `https://leafhour.com`. The existing Vercel project was renamed to `leafhour`, retained its project identity and runtime configuration, and reconnected to the renamed repository. Both apex and www domain DNS configuration passed Vercel checks. Apex HTTPS returned the existing production release successfully before the brand deployment. The www certificate still needed issuance at that observation; DNS success alone was not treated as TLS success.

The brand uses an original leaf/page/time mark, a serif Leafhour wordmark, forest green, paper, and the existing natural-light reading imagery. Home, reader, library settings, privacy, gift/share surfaces, favicon, social preview, and source email templates now share the identity. The authored social card was rendered to a 1200×630 PNG and inspected. Current Chinese interface copy remains Chinese; this release does not claim full internationalization.

Internal cookies, browser storage keys, book/paragraph IDs, export schema kinds, and the legacy `marginalia-mcp` binary remain compatible. The public package and new binary are `leafhour` and `leafhour-mcp`; the generated hosted configuration uses release tag `v0.3.0`. The tag and actual installation are launch gates until verified. No reader/account data migration is part of this change.

## Source validation

- Node 24.22.0: `tools/verify-deploy.mjs` passed: 679 tests, 678 pass, 0 fail, 1 environment-dependent skip. The runtime was built and initialized (928 files, 9.0 MB); the public build, 329-file software allowlist, asset integrity, and source provenance checks passed. No model requests were made.
- Auth-focused checks: 58 pass. An isolated 13-assertion provider contract used `https://leafhour.com` and verified callback construction, stable identity, recovery without account creation, one-time password setup authorization, token/session constraints, and logout. This used fixtures, not real accounts or mail.
- Login and recovery templates were rendered at 320, 390, and 600 widths with synthetic codes: no horizontal overflow in all six previews. Both templates retain one literal `{{ .Token }}`. Those previews contain no real login codes.
- An initial full run found a minimal DOM fixture lacking `prepend` and a pre-existing audio test using a fixed 30 ms wait. The heading now uses the existing `append` composition. The affected 11 checks and subsequent complete verification passed; the audio implementation was unchanged.
- Independent read-only review found no P1/P2 source regression. Static asset routing/allowlisting, private-library noindex/canonical idempotence, compatibility, email focus, and source scope were reviewed.

## Deliberate transition constraints

The old host remains available for recovering or exporting unsynced browser drafts. Browser storage belongs to its origin; retaining key names does not transfer it. Do not blanket-redirect the old host or forward posted passwords/OAuth codes across origins. New-domain sessions require a fresh login, while durable account identity and library storage remain unchanged.

## External acceptance still required at this checkpoint

Production source commit and assets, www HTTPS redirect, existing-account login/library continuity, Resend domain authentication and inbox receipt, Supabase sender/templates/site URL/redirect allowlist, Google origin, Apple web domain and Private Email Relay sender, and desktop/mobile actual page layout. A prior test-recipient bounce was observed and requires checking recipient routing and suppression before claiming delivery.

Browser configuration access became unavailable during this checkpoint. No provider success, inbox receipt, real-login success, or actual app visual acceptance is inferred from source tests or HTTP asset responses. Subsequent verified results should be appended below with their evidence and limits.
