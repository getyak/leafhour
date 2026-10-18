# GET-155: a quiet daily card in the library

## Authorized outcome and limits

On 2026-10-18 the user explicitly selected Leafhour's own library, every day at 20:00 Asia/Shanghai, for the current book. This supersedes the original issue's task-creation-only limit. The current book is resolved and displayed when configuring; the resulting grant remains fixed to that book. Changing books needs a new grant. No external recipient, notification channel, private notes, whole-book generation or new personality Agent is included.

The actual host for this installation will be a Codex heartbeat in the current chat. It owns the schedule, wakes up, uses the official MCP client and composes one bounded AI card. Leafhour owns consent, quiet gates, stable events and atomic station delivery. No application cron or paid-model key is introduced. A future compatible MCP host may follow the same protocol.

Keep existing scoped grants' seven-day expiry. Display the actual expiry and a reconnect state; never silently extend a grant or claim indefinite service. Prefer a new `daily:deliver`-only token: its tools return only the plan's consented bounded current context and activity summary. It cannot call generic content/activity/notes/comment/audio tools. The plan explicitly records original-text and reading-activity consent. No notes permission is requested.

## State and storage

One plan per account is enough for this version. Its stable UUID, revision, fixed book, goal `resume`, local `HH:mm`, IANA timezone, channel `library`, host label, grant ID/expiry and connection evidence live with the account's station inbox and daily event ledger. Tokens are never stored in the plan. User configuration starts `awaiting-host`; only a real host MCP connection with an actual scheduler ID and authorized context read records `connectedAt`. Active status additionally requires enabled consent, a valid grant and matching connection configuration. Paused, expired, awaiting-host, active and last-delivery states must be honest and visible.

Use hosted `reader_document_cas` via the existing dataStore. Local instances need the existing introduction store's OS-lock and atomic-rename semantics, not merely an in-process queue. Extract that small storage primitive if useful without changing its behavior, and rerun introduction regressions. Never hold a storage lock during model generation.

The event ID is derived by the server from stable plan ID and the plan's local calendar date. Configuration revision is a stale-result fence, not part of that ID. Same-day edits, reconnects and retries must not create a second daily card. Retain bounded ledger/inbox history (at most 90 days/cards) and never replay missed days. Claim has a short lease, at most three attempts in a 30-minute due window, and returns the same delivered event on ambiguous-response retry. `silence` is terminal. A station card and its `delivered` event commit in the same CAS.

## Quiet gates and source projection

Before claim and again before finish, verify token, plan/grant/host binding, consent/revision, book/content version, due window, daily idempotency, reading presence, goal and usefulness. Pause invalidates leases atomically. Generic grant revocation must invalidate the bound daily plan before its API acknowledges success, so a late finish cannot publish after revocation. A failed storage operation is not a successful delivery.

Presence is account-wide: while any book is foreground and focused, an authenticated reader reports a per-tab random ID every 30 seconds. Server timestamps give each lease at most 90 seconds. Hidden/pagehide reports inactive when possible. Any active lease across devices suppresses a card; the host learns only the quiet reason, not another book's identity. Presence never contributes reading time and cannot be written by an Agent. Expiry represents the server's recent observation, not an absolute offline realtime guarantee.

Use existing journey/calendar functions for a user-marked finished book and today's explicit reading-time goal. Do not infer understanding from time. Context uses the existing scoped-agent-reading projection restricted to the saved current passage's original layer, once, at most 24 KiB; do not expose pagination, notes, conversation history or other books. Include original provenance, version and passage identity. Never generate a card from an empty source. A source-position fingerprint already delivered on a prior day with no new reading is `no-useful-continuation`, not a reason to repeat the same card.

Finish accepts `message`, `silence` or `failed` for the claimed event. A message has at most 600 Unicode code points and one exact source quote (at most 240), bound to the claimed passage/version; offsets and the versioned `/read?...&contentVersion=...&layer=original` link are computed/validated by the server. Treat AI text as plain data, visibly label it `AI · 每日陪读`, keep it separate from user comments/notes and never mark it as approved understanding. Unknown delivery is avoided by the same-CAS station commit; no external provider delivery is supported in this version.

For immediate real integration acceptance, an authenticated owner may request one explicit `test` delivery per local day. It creates a separate server-generated short-lived test event, visibly labelled as a connection test, not a scheduled 20:00 message. The host cannot create this exception. All permission, quiet, source, lease and publication gates still apply. Normal scheduled calls cannot consume or generate tests implicitly.

## Interfaces

- Owner HTTP under `/api/library/daily-reading`: GET plan/inbox; POST configure (baseRevision, fixed book and explicit consent); `/pause`, `/resume`; `/test` creates the limited test event. Config responses reveal a newly issued narrow token only once for host setup. Owner header, origin, no-store and body-size rules apply. GET must not create grants, model jobs or schedules.
- Owner-only `/api/library/daily-reading/presence`: strict tab ID plus active boolean; no client timestamps, owner IDs or Agent writes.
- Scoped Agent actions `daily-connect`, `daily-claim`, `daily-finish` and corresponding `reader_daily_*` MCP tools use only `daily:deliver`; strict schemas, bounded replies, no caller-provided owner. Connection binds the plan, grant and host install identity plus real scheduler reference. Claim normally considers only today's scheduled event; an explicit owner-created test ID may select its test event.
- `tools/daily-reading-host.mjs --config /absolute/private.json connect|claim|finish`: official SDK stdio client against `server/mcp.mjs`, token from a checked private 0600 file injected only into the MCP subprocess environment. Never accept a token/password on argv or print it. Validate HTTPS/loopback origin, forbid redirects and URL credentials. `finish` reads a private JSON input file. Always close MCP transport. No provider key or internal runtime key is needed by this host bridge.

## Design and actual installation

Add a restrained `每日陪读` settings panel using existing paper/sage tokens, native labels and the existing settings focus/tab behavior. Show the fixed book, 20:00, Beijing timezone, channel, expiry and host state together; do not display a working toggle when only a JSON configuration was downloaded. Save prepares the connection. Pausing is always direct. Resume preserves the schedule only when it still matches the consent and valid grant; schedule-changing edits require a fresh host acknowledgement.

Render a quiet inbox card in the library near current reading. No popup, floating assistant, confetti, badge pressure or autoplay. Show book/source locator, AI attribution, time and an explicit return-to-original link. Narrow layouts, night mode, keyboard operation and reduced motion follow the existing shell. Opening settings or loading the inbox never triggers generation.

After independent review, current-head CI, merge and production deployment, the parent resolves the designated account/current book, saves the authorized plan, creates the actual 20:00 Asia/Shanghai Codex heartbeat and stores its ID, then completes a real MCP handshake. The prompt references only a private config path, reads once, writes only the selected station card, and uses no MiMo Token Plan key or other unattended provider key. Automation notifications are failures-only; routine success/quiet produces no separate chat notification. Verify the returned next-run timezone and read back both automation and plan. Run one clearly labelled owner-requested live connection test and read back its event/card, then pause/quiet/expiry gates with synthetic fixtures. A future first scheduled 20:00 receipt is distinct from setup and test delivery.

## Verification

RED/GREEN tests cover strict owner/token boundaries, narrow scope, two processes/instances claiming, lost finish responses, pause/revoke during generation, source changes, cross-device presence, goal completion, unchanged reading, silence, retry exhaustion, expiry, missed-day coalescing, test-event authorization, exact Unicode quote and versioned return. Use synthetic accounts only. Actual credentials, real books, schedules and model calls are parent-only acceptance. Perform independent P0/P1 review, relevant full deployment checks and real rendered 390px/desktop/night/focus inspection; never substitute a static design or deterministic model for real host delivery.
