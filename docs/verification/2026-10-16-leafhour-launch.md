# Leafhour launch verification

Date: 2026-10-16. Source branch: `codex/leafhour-brand-launch`, based on `42427d4f97b639685f9ced219921a8448fa1ade9`.

## Implemented and checked

The existing public repository was renamed to `getyak/leafhour`, retaining repository ID and history. Its homepage is `https://leafhour.com`. The existing Vercel project was renamed to `leafhour`, retained its project identity and runtime configuration, and reconnected to the renamed repository. Both apex and www domain DNS configuration passed Vercel checks. Apex HTTPS returned the existing production release successfully before the brand deployment. The www certificate still needed issuance at that observation; DNS success alone was not treated as TLS success.

The brand uses an original leaf/page/time mark, a serif Leafhour wordmark, forest green, paper, and the existing natural-light reading imagery. Home, reader, library settings, privacy, gift/share surfaces, favicon, social preview, and source email templates now share the identity. The authored social card was rendered to a 1200×630 PNG and inspected. Current Chinese interface copy remains Chinese; this release does not claim full internationalization.

Internal cookies, browser storage keys, book/paragraph IDs, export schema kinds, and the legacy `marginalia-mcp` binary remain compatible. The public package and new binary are `leafhour` and `leafhour-mcp`; the final generated hosted configuration pins the immutable commit underlying release tag `v0.3.0`. Installation evidence is recorded below. No reader/account data migration is part of this change.

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

## Follow-up transition checks

Normal TLS validation now succeeds for www, which returns HTTP 308 with `Location: https://leafhour.com/`. Both domain DNS checks are valid. Vercel's Git connection now identifies `getyak/leafhour` with the original repository ID.

The hosted adapter now consumes `READER_ADDITIONAL_WEB_ORIGINS` with exact owned HTTPS origins. The staged launch explicitly allows both owned web origins, as described below. This preserves password/email login and account-scoped draft/backup operations on the old host. Extra origins are strictly validated; request Host and forwarded headers do not authorize hosted requests. Third-party providers are hidden on noncanonical hosts, and starting OAuth there is rejected before creating a transaction, because its host-only flow cookie could not reach the canonical callback. The canonical OAuth origin stays unchanged. The standalone local entry point does not consume this hosted environment variable.

These behavior changes had observed failing tests before implementation. All 66 focused auth/origin/hosted/local checks passed, and a second independent security review found no P1/P2 issue. The original default account was authenticated by an in-memory HTTP client using its existing secure credential reference. Account identity, book IDs, and personal-record fingerprints were captured only in ignored local evidence for post-deployment comparison; no source data was changed or published.

Final full verification after the origin change: Node 24.22.0, 685 tests, 684 pass, zero failures, one environment-dependent skip; runtime initialization, public build, media integrity, software allowlist, and source-provenance stages all passed. No model request or user-book write was made.

## Staged public launch

While provider-dashboard access is unavailable, retain the last verified OAuth canonical origin on the former host and explicitly allow both owned HTTPS web origins. This makes the new Leafhour site usable with password/email while retaining the existing provider entry on the old host; noncanonical hosts hide third-party buttons. After Supabase/provider redirects and sender identity are verified, change the canonical origin to Leafhour and retain only the former host as an additional recovery origin, then redeploy and verify again. This staged configuration is not a claim that the final provider migration is complete.

Final brand polish also changes user-visible gift/backup download filenames to Leafhour while preserving their legacy schema kinds and import compatibility. English/Chinese spacing is consistent in the privacy page and service messages. The 38 affected export/gift/audio/metadata checks passed after this polish.

## Production acceptance after PR 44

PR 44 was normally squash-merged as `fb6141fc4ceea4a15131fb7abca8a2d6579d6eb1`. Its checks passed before merging. The merged main CI and Production workflow both passed; Vercel deployment `dpl_5etFfVNGEm6TTuR5JAK7vsVBvsr5` reached READY. The new domain's `/release.json` reports that exact source commit. Release tag `v0.3.0` points to the same commit.

Normal HTTPS requests to the homepage, library, public reader, privacy page, brand stylesheet, mark, and social card returned 200 with appropriate content types. The social card is a valid 1200×630 PNG. The homepage contains the published Leafhour name, canonical site URL, social image, and “Stay with a book.” line. Deployed bytes match local source for the brand stylesheet, mark, social card, portal script, and library workspace module. www returns 308 to the apex under normal certificate validation. The production smoke checked deployed source, representative pages/assets, anonymous session, public catalog, and gift/profile access boundaries.

The existing default account successfully signed in on `https://leafhour.com` through the actual password endpoint using its secure credential reference. Account identity, book inventory, and personal-record fingerprints match the pre-launch inventory. The comparison and fingerprints remain in ignored local evidence; no book, note, highlight, password, or provider credential was changed. This verifies the HTTP account flow, not interaction through the browser login form.

Anonymous session metadata confirms password/email availability on both owned hosts. Third-party buttons are hidden on the new, temporarily noncanonical auth host; Google and Apple remain advertised on the former host. Their complete interactive flows have not been reverified during this launch. Email availability metadata does not prove sender migration or inbox delivery.

The user's original checkout remains clean at its original commit `d7eb1e3435c9e1323b7033a7ba3ee85523b7c84c`. Task code and evidence were prepared in an isolated managed worktree.

## Remaining service and experience gates

The Chrome control connection still reports `cgWindowNotFound` after the user reopened Chrome. Provider dashboards remain inaccessible through that connection. No Leafhour Resend domain, Supabase sender/template/site URL change, Google/Apple dashboard update, incoming support alias, or real inbox receipt is claimed. The staged auth origin remains the former host until those checks can be performed. A separate request to use the installed Kimi extension is pending explicit user selection.

Desktop/mobile/dark-mode actual app layouts and the browser login form still require interactive verification. Template rendering and static assets do not substitute for those checks.

## Agent release installation

The first real tagged MCP installation check timed out after four minutes while npm was downloading the shallow Git repository; a ten-minute direct-network retry also timed out during Git retrieval. The repository contains approximately 44 MB of tracked files, including historical visual evidence. A comparison using the full release commit succeeded: the actual `npx --yes --package=git+https://github.com/getyak/leafhour.git#fb6141fc4ceea4a15131fb7abca8a2d6579d6eb1 leafhour-mcp` installation initialized as `leafhour` version `0.3.0` and returned all ten tools. That first successful download/install took 353.8 seconds on this machine. An intentionally invalid verification grant was used; no tool was invoked, private book read, or model requested. This does not claim installation into the user's own Agent host or a live scoped-grant reading session.

The generated configuration now uses that verified full commit instead of resolving the tag at installation time. npm's Git fetcher has an explicit full-SHA archive path; its local implementation and [upstream source](https://github.com/npm/pacote/blob/main/lib/git.js) were inspected. The full commit also prevents later tag movement from changing what the configuration runs. The existing configuration test was first observed failing for the old tag reference, then updated implementation passed. This change does not claim a universally faster download or a smaller package.

The initial verification subprocess had no proxy environment variables. A separate tag-download comparison explicitly forwarded the machine's existing system HTTPS proxy to npm without changing system settings or disabling TLS validation. The successful immutable-commit installation above used the direct-network environment; proxy performance is not the basis for the source change.

After the configuration change, all four configuration checks passed. The complete Node 24.22.0 deployment verification passed again: 685 tests, 684 pass, zero failures, one environment-dependent skip; isolated runtime initialization, hosted build, public-media integrity, 329-file software allowlist, and source-provenance checks also passed.

Review follow-ups after the service gates are cleared: complete English interface localization for the global audience, make whole-library export/restore visible in the main interface, and reduce the Agent adapter's first-install download footprint. These are follow-ups, not implemented claims in this brand release.
