# Subscription availability — 2026-10-29

The production `/api/billing/catalog` returned `enabled:false`, `mode:test` and both subscription products unavailable during this investigation. Payment remains unavailable; this UI correction does not activate billing or establish checkout/fulfillment acceptance.

The price page retained its normal subscription button labels while unavailable. During catalog loading, its live status was empty. Paid controls now start disabled with an accessible description, loading announces its progress, and each unavailable offer labels its action in English, Simplified Chinese, Traditional Chinese and Japanese. An available offer retains its original action; a fresh available catalog restores the original labels.

Validation performed:

- All four original regression cases failed against the preceding implementation and passed after the correction.
- Six availability regressions pass, including localized unavailable offers, independent monthly/yearly availability and restoring actions after a fresh catalog.
- The complete 75-test billing/checkout/build selection passed after all six availability cases were included.
- Chromium against the isolated local server showed both paid controls as “暂未开放”, the unavailable explanation and the free-reading link. No provider checkout script, customer payment or production financial mutation was initiated.
- Product-copy lint passed with the existing documented warnings/debt. The hosted build and public/release source checks passed.

Full `npm run verify:deploy` under the project’s Node 22 runtime passed: 4,305 tests passed, 0 failed and 1 explicitly skipped. Runtime build, static build, public asset checks and release source checks also passed. The earlier run under local Node 26 exposed a test-reporter compatibility failure in the annual PostgreSQL prerequisite check; that check passed in the complete Node 22 run.

Production acceptance follows the merged source commit; payment remains disabled.
