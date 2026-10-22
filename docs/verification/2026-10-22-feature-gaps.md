# Published feature gaps: MCP, usage and billing

Checked on 2026-10-22 against public main `d9b2ff42cab5e1abe1766a87a6fa22956961b799`. The live `/release.json` returned that same source. A current deployment does not establish that planned product features are complete.

| Area | Observed implementation | Remaining gap |
| --- | --- | --- |
| MCP | stdio adapter, scoped HTTP/OAuth service, reading skill and four-language connection guides exist. | The bookroom has no connection/grant-management screen. GET-196 remains In Progress; actual ChatGPT authorization, tool calls and revocation are not accepted as complete. |
| Actual token usage | Request limits, maximum output sizes and cost reservations exist. | No complete provider-usage capture, durable per-account usage ledger, aggregation API or account usage screen was found in the inspected source. |
| Subscription | Export and restore explicitly remain available without a subscription. | No implemented paid-plan lifecycle, subscription status or entitlement enforcement was found. The existing paid-value research issue GET-153 is not a payment implementation. |
| Recharge | Provider credentials allow the configured service to request generation. | No implemented checkout/order/payment-webhook/balance-ledger/refund chain or recharge screen was found. Replenishing a provider account is different from a Leafhour user's balance. |

## Source evidence

- `app/library-shell.mjs` mounts only Account, Reading habits, Daily reading, Appearance, Data and About. It does not mount MCP, Usage, Billing or recharge panels. `app/portal.js` maps the legacy `#agent` hash to Account, which cannot manage grants.
- `server/portal.mjs` exposes grant listing and revocation through authenticated APIs. A server API or guide is not a usable bookroom management screen.
- `harness/chat-generator.mjs` deliberately calls its byte-based cost reserve `reservation-not-invoice`. The default `onReceipt` callback is a no-op. `harness/chat-plugin.mjs` reserves before dispatch and forwards stream chunks without settling actual provider usage.
- `server/translation.mjs` and `server/dialogue-generator.mjs` consume model content but do not persist the response's actual token usage. Existing request quotas and audio price estimates do not constitute an account bill.
- Keyword checks covered the original 26 registered worktrees' relevant source directories, plus the new task worktree. Matches for generation output limits and comments about billing were not counted as implemented accounting. This is not a claim that every repository elsewhere on the computer was audited.
- Linear GET-196 is still In Progress. Its latest handoff records an unpublished consent-route fix in a separate Symphony clone. Linear's shared-context helper returned `Tool get_agent_context not found`; issue details and comments were successfully read through the Linear connector instead.

## Correction to the earlier recovery audit

The earlier audit covered this repository's registered worktrees and did not include Symphony's independent GET-196 clone. That clone contains valuable, unpushed public-source commit `0aae7e3507f04320c61f71e2eb846b600ad7ab74`. The old clone and its commit remain preserved.

The production failure was reproduced without credentials: `/api/mcp/consent.js` returned 308 to `/api/mcp/consent`, which returned 404. OAuth metadata itself returned 200. This explains a concrete broken connection step despite the latest source being deployed.

This task recovers the extensionless consent-script route and compatibility aliases, retains the native POST failure guard, and removes the false claim that the website already provides Agent settings for revocation. Without JavaScript, that guard returns 415; it is not a functional no-JavaScript OAuth flow. The production smoke now checks the actual extensionless script directly, rejecting redirects, missing routes, HTML and a missing submit handler. No authorization scope or billing behavior is added.

## Verification

The unchanged baseline passed 12 OAuth/HTTP checks. The recovered regression failed against the old `.js` URL before the runtime fix. Focused OAuth/HTTP/setup/config checks then passed 19/19. The Vercel static build passed. The broader MCP suite passed 32/32 in the parent task. The five newly added smoke-boundary cases first failed against the old smoke; all 15 smoke-boundary checks passed after the probe was added. Independent source review found no unresolved P0/P1 after corrections. Current-head CI and exact-source production verification are pending and will be recorded in the delivery PR; the route repair alone does not complete GET-196's real ChatGPT acceptance.

No product model, OCR or payment request was made for this investigation. No user balance or historical usage was invented. Completing usage requires provider receipts and account-safe durable accounting before a numerical dashboard; subscriptions and recharge additionally require an explicit product/payment contract and payment lifecycle implementation.
