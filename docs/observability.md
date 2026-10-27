# Operational diagnostics and reading analysis

Leafhour uses a first-party collection boundary. Browsers never load a recorder, PostHog browser SDK, or third-party analytics script. The backend forwards only validated metadata to Sentry and PostHog. All vendor forwarding is disabled unless `LEAFHOUR_OBSERVABILITY_ENABLED=true` and the corresponding protected configuration is present.

## Configuration

Set `SENTRY_DSN`, `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` (the documented regional ingestion origin), and a separate random `OBSERVABILITY_ID_SECRET` in the deployment secret store. Never commit values. `VERCEL_GIT_COMMIT_SHA` identifies a production release. The account identifier sent to PostHog is a keyed digest, not an email or raw account ID; it is pseudonymous and is still personal analytics data. Rotating the digest secret breaks cross-release retention continuity.

The account's usage-analysis switch defaults off. Diagnostic collection has a separate switch. A server-only system fault path reports pre-authentication and initialization 5xx failures to Sentry with no account/actor identifier. It is controlled by the global integration flag and is never exposed as a browser endpoint. Personal diagnostic forwarding remains separately opt-in. Existing reading progress, notes and user-managed timers are independent of these switches and continue working when telemetry is disabled. Events waiting for delivery are checked against current consent again. Browser events cannot impersonate reserved server outcomes. Each account is limited to 30 accepted events per rolling minute and 256 per rolling day; accepted event UUIDs remain deduplicated for 24 hours. System fault budgets are per running process (5/minute and 100/day), not a distributed global limit. Self-hosted and local instances default to sending nothing.

## Data allowed to leave

Only closed event names, random event/operation UUIDs, canonical time, deployed source commit, enumerated page/stage/outcome/error category, HTTP status, and bounded durations. Server-generated environment/synthetic classification cannot be overwritten by a browser. No book or passage IDs, book titles, selected text, original/translated content, annotations, questions/answers, raw exceptions, arbitrary URLs, network bodies, IP, cookies, email, authorization or download tokens leave through this integration. The Sentry client has default instrumentation disabled and reconstructs safe events before sending. Request failures retain a category and operation ID, not raw request context.

## Dashboard definitions

- **故障**: diagnostic trends by event name, stage and release; Sentry issue view for safe error categories. Only unexpected server/reader faults count. Cancellation and ordinary validation/authentication failures do not become fault alerts.
- **首次阅读**: sequential `library_opened` → `reader_open_requested` → `reader_content_visible`, with unique actors, sample counts and a bounded conversion window. The opening event means the current reader document observed after its initial consent check; it is timestamped then rather than backdated to navigation. A later opt-in does not reconstruct prior actions. Public catalogue browsing and private import are not conflated into an upload requirement.
- **回来续读**: first `reader_active` to a subsequent `reader_active` within seven days, plus actual `reader_resume_result` outcome. `reader_active` is a foreground interaction proxy and does not prove understanding. Initial content visibility is not proof that delayed saved-position restoration succeeded.

Production views exclude synthetic events and verification accounts. Consent-off visitors and missed delivery are outside observed samples; absence of an event alone does not prove abandonment. No synthetic adoption history is generated to fill dashboards. Fresh retention cohorts require real elapsed time.

## Operations

Use the random operation ID to correlate a browser diagnostic and its domain request. Telemetry transport is bounded and fails independently of the reader. This is best-effort delivery, not a transactional audit log; it does not replace authorization or financial records. Existing Vercel/Supabase logs remain platform-owned. No new log-drain subscription is required.

Retention target for raw observability events is 30 days where provider configuration permits. Do not promise automatic expiry unless vendor settings have been read back. Account deletion requires removing its pseudonymous analytics actor separately from reader backup deletion. Export/delete/access authorization audits remain in the existing application boundary; diagnostic ingestion never grants access to user books or notes.

## Management and verification

`tools/configure-observability.mjs` creates or updates named PostHog dashboards from definitions, using an external management credential only at execution time. Runtime ingestion keys cannot read analytics or administer the vendor. Dashboard URLs and ingestion configuration belong in the authorized Notion service records; management credentials do not.

Verification requires secret-sentinel transport tests, default/withdrawn consent, account isolation, test-account exclusion, deduplication, body/rate limits, vendor failure isolation, meaningful browser timing, full project build/tests, actual vendor receipt and matching-commit production smoke evidence. Never equate configured projects or local tests with accepted production delivery.

Primary references: [Sentry data filtering](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/), [PostHog capture API](https://posthog.com/docs/api/capture), [PostHog dashboards API](https://posthog.com/docs/api/dashboards), [Vercel background work](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
