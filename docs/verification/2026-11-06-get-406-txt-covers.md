# TXT upload covers (GET-406)

Issue: https://linear.app/getyak/issue/GET-406/新书上传之后没有图片没有自动生成图片

## Change

New TXT/Markdown imports register cover work with the existing host scheduler
after the original and shelf entry are saved. Hosted requests use the existing
`waitUntil` lifetime. Reading and the upload receipt do not wait for the image.
Visible cards join the same account/source-hash job and reuse saved artwork.
Original EPUB/PDF covers retain priority; existing book text and positions are
not rewritten. This does not enqueue a bulk regeneration of old books.

Web cards recover on reconnection and retain a retry beyond the existing
fifteen-minute rejection cooldown. Removed/replaced cards release their timers
and event listeners. iOS recognizes legacy TXT/Markdown metadata without
`coverImage` and retries failed artwork when returning to the foreground.

The existing Ark/Seedream adapter, model selection, credentials and image size
remain in use. A persisted request marker prevents another paid dispatch after
a lease expires, transport becomes uncertain, or saving the result fails.
Only a definitive provider rejection releases the marker for a later retry.
An uncertain result requires reconciliation; refreshing does not submit it again.
This is duplicate-charge protection, not an assertion that Ark billed or refunded
a request. The pre-existing lack of a cover-specific global spending meter is
unchanged; this change does not introduce an allowance or billing entitlement.

## Verification

- Regression cases were observed failing before the corresponding fixes:
  background upload registration, Web reconnect recovery, old native TXT
  metadata, expired-lease replay, provider rejection classification and renderer
  cleanup.
- Service tests cover concurrent requests and copies, account isolation,
  restarts, original-cover precedence, reading-position preservation, rejection
  cooldown and hosted CAS failures both before commit and after commit with a
  lost receipt.
- The final affected service/rendering/HTTP tests and the serialized PDF package
  regression passed: 42 tests. Web build, release policy and copy lint passed.
  The broader local suite reported 4,731 pass, three skip and two failures:
  a missing local PostgreSQL engine for the existing yearly billing fixture,
  and a concurrent local build replacing `dist` during the PDF package test.
  That PDF case passed on a subsequent serialized run. The PostgreSQL fixture
  remains a CI check; it is not recorded as locally passed.
- Native tests cover legacy metadata and an owner-scoped disk-cache restart with
  offline transport. App compilation, simulator checks and CI are recorded in
  the PR when complete; source review alone is not device acceptance.
- The default account was authenticated through the live site's existing Auth
  path before inspecting its shelf. Its actual uploaded TXT edition of
  《剑来》 was present. Its cover returned HTTP 200 `image/webp`; the real Web
  book card displayed a decoded 640×960 image and remained readable after reload.
  These baseline observations preceded this PR's deployment and do not prove
  that the new upload scheduler is already in production.

Private account IDs, cookies, book identifiers, original content and screenshots
are retained only in local task evidence. No other account was inspected or
migrated. Synthetic image-provider tests make no paid calls. Web private artwork
is not cached for offline use: offline checks require readable identity/fallback
and reconnect recovery. Native successful artwork has its existing per-origin,
per-account, per-version disk cache.
