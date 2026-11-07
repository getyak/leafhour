# Selected reading shares and beta usage

User authorization: implement Web and iOS reading cards, direct public-domain paragraph trials, selected content only, statistics without beta quotas, test and publish.

## Share contract
- Freeze the explicit selected excerpt. Never automatically include surrounding prose, another translation, notes, conversations, account identity, or reading history. Changing typography must not change the selected text.
- Card: generous readable quote, clear original/translation attribution, optional book citation, Leafhour signature. Paper, warm and dark themes. Full selected text is retained; long output extends rather than clips.
- Public trial URLs are issued only from the server's bundled public catalogue, after checking the exact book version and paragraph. A private upload's metadata cannot opt itself into publication. Resolver returns URL/provenance only, not personal contents.
- Public URL carries canonical book, paragraph, source version and original layer, never user-selected text, private title/filename, owner, note or bearer token. Anyone may read the corresponding original without login. Image QR generated locally; system sharing includes the same URL. Copy-link remains available independently.
- Private excerpts remain a deliberate local image/text export. Default off for private citation. No trial URL, QR or gift creation in the excerpt flow.
- Reject stale selection/version and cancel async work on account/book change. Offline card export remains possible without claiming a public link was verified.

## Beta usage contract
- Server-authoritative beta policy: no reading-point debit, insufficient-credit gate or daily/per-owner usage quota. Preserve existing ledger, purchases and balances. No later charge for beta calls.
- Keep actual provider usage/cost/unknown-outcome facts, without storing selected/private contents in statistics. Existing financial reconciliation remains active; new unnecessary point checkout is unavailable during beta.
- Preserve source permissions, explicit operation scope, idempotency, cancellation, real model context limits and actual in-flight capacity. No automatic whole-book generation.

## Acceptance
Regression tests must prove selected-only cards, no private link manufacture, exact public anchor without login, beta generation with zero balance/no quote, no debit and truthful usage records. Verify responsive Web output and actual PNG/QR. Native Core/application checks and existing release workflow; distinguish simulator from device and Apple distribution status. Merge only passing required checks, publish via existing production route without paid upgrades or a competing publisher.
