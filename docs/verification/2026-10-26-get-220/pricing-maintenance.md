# Reading AI price-reference maintenance

GET-220 keeps the existing provider, model, CNY/USD budgets, request and tool limits. An expired reference still refuses generation. Each model dispatch checks the half-open validity window `[checkedAt, validUntil)`; opening a run does not lease prices past expiry.

`harness/pricing.json` is the legacy CNY admission reference. `server/provider-pricing.mjs` owns credit-funded USD reservations and usage estimates. These are separate currencies and are not exchange-rate conversions. `harness/pricing-verification.json` records the actual source retrieval time, official model version, verified rates and source-byte SHA256 values. No renewal happens on startup, a failed source check or a build.

The GET-220 worker checked the official [CNY](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) and [USD](https://api-docs.deepseek.com/quick_start/pricing/) pages at the receipt's `observedAt`. The legacy CNY expiry is capped at the existing Harness Search/Fetch free-period boundary, 2026-10-31T16:00:00Z. Its current reservation code does not include standalone Search/Fetch charges. Renewing beyond that boundary requires a separately verified fee treatment within the existing budget; moving the date alone is insufficient.

1. Before publishing, run `node tools/check-pricing.mjs --sources`. It checks the official source bytes against the reviewed receipt and fails if the source is unreachable or changed. Inspect changed official pages and rates before recording a new receipt; a hash mismatch does not automatically mean prices changed.
2. After an actual review, record the true retrieval/check time and model version, reconcile both currencies with the official pages, and choose a validity window of at most seven days. Keep the CNY promotion ceiling until its tool-fee treatment is reviewed. Preserve source hashes and the review evidence.
3. Run `npm run verify:deploy`. Its first stage checks both references and requires at least 24 hours remaining, before tests or packaging. Boundary, malformed, future-dated, near-expiry and source-failure tests do not replace this real-clock release check.

The maintainer preparing a release owns this check and the receipt update. This change creates no scheduler, notification or automatic model request. If a deployed reference expires, reading, saved answers and export remain available; new AI work fails with a safe pricing-unavailable category and keeps the original question identity. A production repair still requires normal CI, publication and a persisted real-provider answer.
