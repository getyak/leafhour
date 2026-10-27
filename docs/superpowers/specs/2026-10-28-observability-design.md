# Leafhour observability v1

Status: implementation authorized by the user's 2026-10-28 request, following the in-chat recommendation. Deliver Sentry errors, PostHog first-reading and return-reading dashboards, tests, normal PR merge and production verification, and Notion service addresses and integration keys.

## Boundaries

Observe operational outcomes only. Never export book IDs/titles, passage IDs, source/translation text, selected text, notes, prompts, answers, email, IP, cookies, authorization, raw URLs, query strings, request/response bodies or arbitrary error messages. No DOM recorder, autocapture, fingerprinting or session replay. Analytics is account opt-in and defaults off. Diagnostics has an independent switch and defaults off. A server-only system fault path reports pre-authentication/initialization failures to Sentry without any user/actor or request details, controlled by the global integration flag. Default local/self-hosted configuration sends nothing. The default verification account is excluded server-side from production product metrics.

Use existing accounts and Google login when required. Store deployment secrets in protected platform configuration. User explicitly requested integration keys and addresses in Notion; document the Sentry DSN and PostHog ingestion project key in the project/service records, never management tokens. Keep unrelated project records intact.

## Architecture

A small first-party browser collector emits a closed event schema to `/api/account/observability/events`. Account consent lives in a separate owner-scoped record via existing dataStore/atomic local store. Server revalidates every event and attaches an HMAC-derived account identifier; client account IDs are never accepted. A per-page random operation UUID correlates accepted events and request errors. PostHog receives manual, validated metadata through its ingestion API; no PostHog browser recorder SDK is loaded. Sentry uses its Node SDK with automatic/default data collection disabled and allowlisted event construction. Both sinks use bounded scheduling and fail independently of the reader.

Production dashboards: faults (Sentry issue view plus PostHog fault trend), first reading (`library_opened`, `reader_open_requested`, `reader_content_visible`), return reading (return to `reader_active` within 7 days, plus `reader_resume_result`). All dashboards identify sampling/consent boundaries and exclude synthetic activity. Counts describe behavior, not comprehension. Dashboard creation/configuration is idempotent; do not fabricate user history.

## Shared contracts

`app/observability-contract.mjs`: closed event/property validator shared by server/browser. Event names: library_opened, reader_open_requested, reader_content_visible, reader_active, reader_resume_result, reader_load_failed, client_error, request_failed, ingestion_completed, ingestion_failed, chat_failed. Properties restricted to enumerated page/stage/outcome/resume/client/errorKind and bounded durationMs/status. UUID event and operation identifiers; canonical timestamps. Unknown fields are dropped or rejected; no freeform strings are exported.

`GET /api/account/observability`: `{enabled, analytics, diagnostics, excluded, release}`; no credentials or account identifiers. `POST` the same path accepts only `{analytics:boolean,diagnostics:boolean}`. `POST /api/account/observability/events` accepts `{events:[{id,operationId,name,occurredAt,properties}]}`, max 20 events and 16 KiB. All three require the existing signed-in identity and owner-change protection. Revocation is checked when accepting and before dispatch. Suppress routine expected 4xx/cancellation errors from fault alerts.

Server service `createObservability({dataDir,dataStore,env,schedule,fetcher})` provides config, setConsent, accept, reportError and event methods. Env: LEAFHOUR_OBSERVABILITY_ENABLED, SENTRY_DSN, POSTHOG_PROJECT_KEY, POSTHOG_HOST, OBSERVABILITY_ID_SECRET. Release uses the actual deployed source commit. Transport timeout at most 2 seconds; dedup by event UUID with bounded retention/state. No durable log arrays in book records.

## Verification

Tests must inject secret sentinels into text, URLs, errors and payloads and prove they are absent from outgoing bytes. Verify consent defaults/revocation, account mismatch, test-account exclusion, retries/dedup, limits, offline failure isolation, no replay/third-party browser requests, actual DOM visibility before reader_content_visible, foreground trusted interaction before reader_active, and resume result after real restoration. Then full project tests/build, browser validation, PR CI, merge, same-commit Vercel Production, real sanitized smoke events reaching both vendors and actual dashboard readback. Clearly distinguish received synthetic diagnostics from product adoption.
