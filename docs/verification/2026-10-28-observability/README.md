# Observability v1 acceptance

User authorized implementation, normal merge, production release and Notion service/key updates on 2026-10-28. This document separates local implementation, actual vendor configuration and production acceptance.

## Completed implementation checks

- Server boundary and real HTTP route tests cover consent, user isolation, closed metadata, exclusion, 30/minute +256/day budgets, 24h deduplication, independent vendor failures and bounded Sentry concurrency.
- Real PDF runner fixtures prove only persisted done/failed/needs_review outcomes emit domain metadata, and an instrumentation callback cannot break stored results. Stored failed chat receipts emit once even when HTTP succeeds.
- Browser regression tests cover delayed initial consent, actual DOM visibility, delayed/fast saved-position restoration, later horizontal columns, actual trusted page buttons and committed drags, programmatic/blocked flips, account changes and revoke races.
- Chromium evidence is isolated: synthetic account and public filler book, intercepted first-party APIs. It proves UI timing and payload exclusion, not production vendor receipt. See the two JSON files and three screenshots here.
- Added Chinese privacy/settings copy was inspected against docs/writing.md and the current tone skill. Each added passage is below the detector minimum; no statistical score is invented. Necessary field exclusions remain explicit. No unrelated policy text or existing voice was rewritten.
- Three existing English navigation-label copy adjudications were source-inspected again after the privacy notice/date insertion. Exact values and actions are unchanged; only current candidate locations and source bindings were renewed. No legal body text was admitted as reviewed navigation.

## Vendor configuration read back

- Sentry: dedicated leafhour project 4512329406545920, getyak team in existing organization; isolated Node SDK, no default data collection or replay SDK.
- PostHog: dedicated Leafhour organization and project 691966. Project replay=false, autocapture_opt_out=true, anonymize_ips=true; no recorder browser SDK is shipped.
- Dashboards: faults2267269, first reading2267303, return reading2267305. All three and six query-based insights were created through the authenticated API and read back. Empty real cohorts are expected; no fake adoption history was added.
- Production-only encrypted deployment configuration is set. Default QA ID was resolved by authenticating the prescribed test account through current Auth and added to server exclusion. No private book content was read.
- User-authorized ingestion DSN/project key and service/dashboard addresses were saved to existing Sentry/PostHog Notion service records. Management credentials and HMAC identity secret were not copied to Notion, source or this record.

## Local release verification

Final local full project verification passed: 3766 tests passed, 0 failed, 1 macOS platform skip (the pinned Linux Node mutation check). Isolated runtime initialization, public build, release allowlist and source-provenance checks passed without model requests. The complete runtime contains928 files/9.0MB. Dependency evidence binds817 packages and16 reviewed expressions after selecting the compatible MIT SDK10.77.1. Retention cohorts require actual future elapsed time; dashboard creation does not prove adoption or comprehension. Raw-provider retention at30days is a target, not a verified setting.


Compiled Chromium acceptance uses the actual hashed main script and unmodified built raw deferred bridge:327303 bytes within the unchanged327680-byte limit. Four config0/700ms × personal-record0/1400ms orderings restore the actual visible target correctly. Next controls and a verified hit-tested committed drag emit activity; programmatic flips do not. The error page emits one fault after paint without reading funnel events. No third-party requests, private sentinel export, missing assets or unhandled page errors were observed. Existing inline-style CSP console violations are retained in the fixture report and are not a claim of a clean production console.

Production acceptance is added to the delivering pull request's verification section after current-head CI, normal merge and matching-commit deployment. The Notion service/project records carry the same live status and service addresses. Local/fixture checks above do not substitute for actual vendor receipt.
