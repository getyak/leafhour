# Leafhour launch verification

Date: 2026-10-16. This record separates shipped source, live service configuration, actual user-flow acceptance, and the remaining Google branding review.

## Current outcome

[Leafhour](https://leafhour.com) is live on the new domain. The public repository is [getyak/leafhour](https://github.com/getyak/leafhour), with its original repository ID and history retained. The existing Vercel and Supabase projects and Apple/Google client identities were retained; their display names and relevant domain configuration were updated. No library migration was needed.

The final service cutover deployed reviewed runtime source `84ba7d2c9edbf98b71c8287bb07dff03ebb22680` through Vercel deployment `dpl_7QN3uia8Ub9ZHpnFt2K3kYHq8cbm`, which reached READY. The live release endpoint reported that source. This follow-up changes the public privacy contact to the now-tested support alias and records external acceptance; its own merge and production result must still be checked after landing.

Real browser verification passed for the existing default account's password and email-code sign-in. Google sign-in completed with the browser account explicitly authorized by the user, returned to Leafhour, and matched the selected account in account settings. Apple displayed “Leafhour Web”; after the user completed Apple's password/passkey authentication, the browser returned to Leafhour and authenticated account settings matched the authorized account. Provider checks used the separately authorized browser identities; they did not replace the default data workspace.

The remaining service gate is **Google consent-screen branding**. Google's first review rejected the homepage because domain ownership had not yet been verified. Search Console subsequently confirmed DNS ownership on 2026-10-16 at 08:13 UTC, and the authoritative DNS record matched. Google explicitly requires waiting 24 hours before retrying. The new name, logo, homepage and privacy URL are saved, but the previous verified brand remains visible until re-verification succeeds. The user authorized a one-time follow-up in this chat for October 17 at 16:30 Asia/Singapore. This is a scheduled retry, not an approval claim.

## Brand and experience

The identity uses an original leaf/page/time mark, a serif Leafhour wordmark, forest green, paper, and the existing natural-light reading imagery. The central line is “Stay with a book.” Home, reader, library settings, privacy, gift/share surfaces, favicon, social preview, and authentication email templates share this identity. The social card was rendered and inspected at 1200×630. The original mark was also rendered to a 120-pixel PNG and uploaded for Google's branding review.

The real production homepage was inspected at 1440-pixel desktop and 390-pixel mobile widths. The mobile homepage was also checked in night mode. The public reading page was inspected at both widths. The mobile documents had a 390-pixel viewport and 390-pixel document width, with no horizontal overflow. Typography, reading controls, brand entry points, and the light/night visual hierarchy were inspected in screenshots. These are real browser viewport checks, not native-phone testing. Browser-extension overlays are outside the application's UI.

The current interface remains predominantly Chinese. Full English localization is a follow-up for the global audience; the English wordmark and headline do not constitute an English product experience.

## Email configuration and delivery

- Resend reports `leafhour.com` as verified. Its exact DKIM TXT and sending CNAME records, plus DMARC, were saved in Cloudflare and checked against authoritative DNS. Provider-specific records were used rather than assuming older SES examples.
- Supabase's sender is `Leafhour <hello@leafhour.com>`. The existing SMTP host, port, username and stored secret were preserved. The three provider templates—confirmation, magic link/OTP, and password recovery—were updated from the checked-in source files. A fresh-page editor readback confirmed every subject, source-equivalent HTML ignoring inter-tag whitespace, and one literal `{{ .Token }}` per template.
- The first live Leafhour send failed with a real provider 403: the product's existing sending key was restricted to the previous domain. That key was edited in place to sending-only access for `leafhour.com`, retaining the secret. No all-domain access or replacement key was created. A second attempt delivered the new-brand verification message to the user's actual inbox.
- The current suppression list was empty. The default test mailbox's existing Cloudflare route was already active and was not changed; no speculative suppression deletion or replacement of its domain's MX records was performed.
- Incoming routing for `leafhour.com` is enabled. Exact `hello@leafhour.com` and `support@leafhour.com` rules use a verified owner destination. A self-test addressed only to these two owned aliases produced two real Cloudflare **Forwarded** events, one per alias. Catch-all routing remains disabled/drop. The privacy contact was switched to the tested support alias after this check.

The real login code was consumed in memory for the browser sign-in test. No code, password, token, provider secret, private inbox content, or private-library fingerprint is included in this public record or source tree. Recovery-template readback and isolated recovery-contract tests passed; an actual password reset was not performed.

## Login domain and providers

Production now sets `READER_PUBLIC_ORIGIN=https://leafhour.com` and `READER_ADDITIONAL_WEB_ORIGINS=https://reader.cubxxw.com`. Supabase's Site URL is Leafhour, and its redirect allowlist contains the exact new and former `/api/auth/callback` URLs. Live anonymous capabilities advertise Google/Apple on Leafhour and hide them on the former host. Both hosts retain password/email access. Codes remain six digits, valid for ten minutes, with a sixty-second resend interval.

Google's existing web client was renamed Leafhour Web and gained the new exact JavaScript origin. The old origin and existing Supabase provider callback were preserved. The new name, mark, homepage and privacy link are saved; the separate branding verification gate is described above. No extra user-data scopes or new client secret were introduced.

Apple's existing Services ID and primary App ID retain their identifiers and capabilities. Their descriptions are now Leafhour Web and Leafhour. The new web domain was added alongside the old domains, with the existing Supabase return URL retained. `hello@leafhour.com` was registered as an additional Private Email Relay source, and Apple's table showed its successful SPF check. The former sender remains registered. The tested Apple login shared the actual account email; delivery to an Apple hidden-email address was not tested.

The former host remains available for unsynced browser drafts and compatible recovery/export operations. Storage belongs to its web origin; retaining key names does not transfer local drafts. There is no blanket old-host redirect and no forwarding of posted passwords or authorization codes across origins. Hosted origins accept exact owned HTTPS entries; Host/forwarded headers cannot authorize credential requests. Noncanonical OAuth starts are rejected before creating a flow transaction.

## Account and data continuity

Before and after the brand launch, the existing default account successfully used the actual password endpoint through an in-memory client and its secure credential reference. Account identity, all ten book IDs, 209 comments, two highlights, and record fingerprints matched. Fingerprints and private records stayed in ignored local evidence.

The later real browser email-code and password checks opened the same default account and confirmed its login email and ten-book room count. The layout showed one featured book and nine remaining shelf cards. The account password was not changed, and these checks did not upload books or alter the default account's notes, highlights or progress.

Internal cookies, storage keys, book/paragraph IDs, export schema kinds, and the legacy `marginalia-mcp` binary remain compatible. User-visible package/export naming is Leafhour. The user's original checkout remains clean at `d7eb1e3435c9e1323b7033a7ba3ee85523b7c84c`; task changes and ignored evidence were prepared in the isolated launch worktree.

## Source validation and delivery

PR [44](https://github.com/getyak/leafhour/pull/44) normally squash-merged as `fb6141fc4ceea4a15131fb7abca8a2d6579d6eb1`. PR [45](https://github.com/getyak/leafhour/pull/45) normally squash-merged as `84ba7d2c9edbf98b71c8287bb07dff03ebb22680`. Their required checks, merged-main CI, production workflows, source-provenance checks and production smoke passed. The `v0.3.0` tag points to the PR 44 merge source.

The latest complete runtime verification before the service-only cutover used Node 24.22.0: **685 tests, 684 passed, zero failures, one environment-dependent skip**. The skipped case requires a Linux Node binary unavailable on the macOS host. Isolated runtime initialization (928 files, 9.0 MB), hosted/public build, media integrity, the 329-file software allowlist, and source provenance passed. All 66 focused auth/origin/hosted/local checks passed. The provider contract uses fixtures and does not substitute for the live browser results above.

Both source email templates were rendered with synthetic codes at 320, 390 and 600 widths, without overflow in all six previews. No model requests were made for these verification runs. Earlier independent source/security reviews found no remaining P1/P2 regression in origin handling, private-library boundaries, compatibility, email focus or release scope.

Normal HTTPS verified the homepage, library, public reader, privacy page, brand CSS, mark and social card, with appropriate MIME types. Core deployed asset bytes matched reviewed source. `www.leafhour.com` returned 308 to the apex with normal certificate validation. The production smoke checked the source commit, representative pages/assets, anonymous session, three-book public catalog, and gift/profile access boundaries.

## Agent adapter installation

The actual immutable-commit installation initialized `leafhour` version `0.3.0` and returned all ten tools using:

```text
npx --yes --package=git+https://github.com/getyak/leafhour.git#fb6141fc4ceea4a15131fb7abca8a2d6579d6eb1 leafhour-mcp
```

The first successful uncached install took 353.8 seconds on this machine; a cached repeat passed in 4.09 seconds. Earlier tag-based attempts timed out during Git retrieval at four and ten minutes. The repository has about 44 MB of tracked files, including historical visual evidence. The generated setup therefore pins the verified full release commit. npm's full-SHA archive path was checked in the local implementation and [upstream source](https://github.com/npm/pacote/blob/main/lib/git.js); this is not a claim of universally fast or small installation.

An intentionally invalid verification grant was used. No tool was invoked, private book read, or model requested. Installation into the user's own Agent host and a real scoped-grant reading session were not tested.

## Review follow-ups

The highest-value next steps are a complete English interface, visible whole-library export/restore in the main interface, and a smaller Agent package download. These are product follow-ups rather than completed features in this brand release. Google consent branding remains subject to its scheduled re-verification; all login success statements above refer to the actual tested flows, not the approval status of its new visual identity.
