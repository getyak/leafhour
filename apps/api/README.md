# Split runtime entry contract

The legacy local `npm start` and hosted Vercel entries remain compatible. The split runtime uses `node apps/api/server.mjs`, `node apps/agent/server.mjs`, and `apps/web/Caddyfile`.

Build from a clean, allowlisted source release with `npm run build:modules -- --out <release-root>`. This creates `web/public`, `web/templates`, and `manifest.json`; API/Agent retain source-relative compatibility imports. Never serve the source tree as a Web root.

API configuration:

- `LEAFHOUR_API_PORT` defaults to `18331`; `READER_PUBLIC_ORIGIN` is the canonical HTTPS origin. `READER_ADDITIONAL_WEB_ORIGINS` accepts comma-separated exact HTTPS origins for a private trial.
- `LEAFHOUR_DATA_DIR` is a private, slot-specific cache directory. Supabase remains authoritative; the production entry has no local JSON fallback.
- `LEAFHOUR_INTERNAL_SOCKET` is a restricted Unix socket. Its parent must have the shared API/Agent group and setgid permissions; the socket is mode `0660`. Existing sockets are never silently replaced.
- `LEAFHOUR_AGENT_TOKEN_FILE` contains the shared executor identity (at least 24 characters). Web must not be able to read this file.
- `LEAFHOUR_AGENT_CAPABILITIES` is the exact enabled list from `packages/contracts/execution.mjs`. Missing capabilities are unavailable; there is no inline provider fallback. Include the five local extraction/PDF types for imported user files and `web-search` for library-chat search.
- `LEAFHOUR_WEB_ROOT` and `LEAFHOUR_TEMPLATE_ROOT` point to the matching built public/template artifacts. `LEAFHOUR_SOURCE_COMMIT` supplies source identity for staged runs.
- Only API receives Supabase administrative credentials. Provider credentials are rejected before startup.

Agent configuration uses the same socket/token file and capabilities, `LEAFHOUR_AGENT_PORT` (default `18332`), and only its required provider credentials. Supabase administrative credentials are rejected before startup. `LEAFHOUR_AGENT_PAUSED=1` pauses its paired API socket's claim gate on the first successful connection. Control changes can resume that same process; a different API socket has a separate persistent gate.

Both health ports expose `GET /healthz` and `/version`; they return fixed operational fields, source identity and protocol, with no book/user content. UDS operations are POST-only under `/internal/v1/`, authenticated by `Authorization: Bearer <executor identity>`. `control` takes `{}` to query or `{"paused":true|false}` to update and returns `paused`, `inflight`, `queued`, and `needsReconciliation`. These counts cover shared execution state; the pause gate belongs to this socket. SIGTERM stops new work and propagates cancellation; uncertain dispatched calls remain quarantined.

Apply `supabase/migrations/202611050001_execution_deliveries.sql` before enabling generation. Missing receipt storage disables capabilities in the split API while preserving reading. A candidate becomes delivered only after its domain CAS and unique receipt commit together; the database also updates the queue mirror in that transaction. Lost HTTP acknowledgements query that receipt. CAS contention retries the merge with the same candidate, never the model. Existing domain request and points receipts stay authoritative for their own settlement.

Provider dispatch requires an independent append service: `LEAFHOUR_DISPATCH_LEDGER_URL`, `LEAFHOUR_DISPATCH_LEDGER_TOKEN_FILE`, and `LEAFHOUR_DISPATCH_LEDGER_KEY_FILE` (64 hex characters). API encrypts content-free intent metadata with AES-256-GCM; the endpoint must acknowledge `{id,durable:true}` for the same id. An absent/failed acknowledgement never grants dispatch. `LEAFHOUR_ALLOW_LOCAL_LEDGER=1` and `LEAFHOUR_DISPATCH_LEDGER_FILE` are only for an isolated trial and do not satisfy the independent-backup requirement.

API tool closures remain authoritative. Agent receives definitions and a fenced task lease, never a selectable account ID or database credential. Every tool/result is checked against that lease, current backend authority and original scope. Network search executes in the current Agent task and returns through the original API closure; it does not queue a nested model job.

Large inputs and results are stored in private, content-checked staging objects. The queue retains their references, dispatch metadata and receipts. API restart cannot deserialize tool closures: lost contexts fail closed, and dispatched unknown attempts are not automatically retried. This runtime does not claim exactly-once external calls, unlimited queue capacity, a completed offsite recovery drill, or compatibility for every resource requested by a page opened before the first versioned rollout. Retaining old release directories alone does not establish that last property.
