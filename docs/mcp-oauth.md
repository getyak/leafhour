# Install the reading skill and connect MCP

Leafhour provides a reading skill and two MCP transports. A skill teaches a host how to read carefully; a connection supplies access. Installing one does not install or authorize the other.

## Reading skill

The repository contains `skills/leafhour-reading/SKILL.md`. With a skills-compatible host, review this repository and install only `leafhour-reading`:

```sh
npx skills add getyak/leafhour --skill leafhour-reading
```

Alternatively copy `skills/leafhour-reading` into your host's skill directory (for Codex, `~/.codex/skills/leafhour-reading`). Restart or reload that host's skills. This folder has no executable helper and contains no credentials. Installing it does not change global MCP settings.

The [Tencent/WeChatReading reference](https://github.com/Tencent/WeChatReading), checked on 2026-10-21, provides reading skills under [Apache-2.0](https://github.com/Tencent/WeChatReading/blob/main/LICENSE). This implementation borrows the idea of a discoverable reading skill; no Tencent code or installation script is copied or executed. Leafhour remains AGPL-3.0-only.

## ChatGPT remote connection

Use a ChatGPT account/workspace that permits custom MCP connections. The current [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [authentication guide](https://developers.openai.com/plugins/build/auth) are the authority for the host UI and OAuth contract. The exact menu and availability depend on the account; missing access requires the account/workspace owner.

1. In ChatGPT's custom MCP connection management, add **Leafhour** with server URL `https://leafhour.com/api/mcp` and OAuth authentication. The server advertises DCR with public-client authentication. In the 2026-10-21 real-host test, ChatGPT rejected DCR creation; the pre-registered public-client path below created the private plugin successfully. No client secret is required. Do not paste a Leafhour password or browser cookie into ChatGPT.
2. Start the connection's authorization flow. Sign in on `https://leafhour.com` with the existing account. The sign-in return keeps only an opaque authorization request ID, never credentials.
3. On **Connect one book**, verify the signed-in account, client callback origin and selected book. Choose **Allow this book** or **Cancel**. Client names are unverified client-supplied labels. Read-only access remains the default. If the client requests optional annotation scopes, check only the permissions you want: reading AI annotations, saving exact-text highlights, and saving AI annotations. All optional boxes start unchecked; only the requested and selected scopes are granted for one hour. Old grants never expand.
4. After the host returns from OAuth, ask: “Use Leafhour to identify my connected book, read its directory, and quote the first passage with a source link.” The host should call `reader_get_connection`, `reader_get_manifest` and `reader_get_chapter` or `reader_get_context`.
5. The website has no connection management page. Use the authenticated service API to list `GET /api/library/grants`, identify this connection's grant, and revoke it with `POST /api/library/grants/{id}/revoke`; a compatible OAuth client may instead use the advertised revocation endpoint with its access token and public client ID. Repeat a tool call: it must return 401 and require fresh authorization. Access otherwise expires after one hour. Removing the host connection does not prove previously copied text was deleted.

The remote tools are `reader_get_connection`, `reader_get_manifest`, `reader_get_context`, `reader_get_chapter` and `reader_search`. They reuse the same bounded domain projections as stdio (24 KiB data, at most 20 records, version/snapshot continuation). Optional tools are `reader_get_annotations` (`annotations`), `reader_add_highlight` (`highlight:write`) and `reader_add_annotation` (`annotation:write`); only approved tools appear. They expose no private notes, user follow-ups, reading activity, model generation or audio. External AI prose is stored with fixed External Agent attribution, separately from user comments. A shared public book is still bound to the approving account's grant. No tool takes an owner/workspace selector; the server captures identity from the authenticated session and grant.

### Pre-registered public client

In ChatGPT's advanced OAuth settings, select **User-Defined OAuth Client**. Copy the exact callback URL shown there. Register that callback at your Leafhour instance using the public registration endpoint; this request contains no password or secret:

```sh
curl -fsS https://leafhour.com/api/mcp/oauth/register \
  -H 'Content-Type: application/json' \
  --data '{"client_name":"ChatGPT Leafhour","redirect_uris":["REPLACE_WITH_EXACT_CHATGPT_CALLBACK_URL"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"response_types":["code"],"scope":"content"}'
```

Enter the returned public `client_id` in ChatGPT, leave the client secret empty, and select token endpoint authentication **none**. Retain the discovered authorization/token URLs, resource `https://leafhour.com/api/mcp` and `content` scope for read-only access. For highlighting and AI evaluations, request `content annotations highlight:write annotation:write` and explicitly select the desired permissions on Leafhour’s consent page. Reauthorize an old connection to change permissions. Continue through **Create as a plugin** and **Connect Leafhour**. Do not repeat registration or creation after an uncertain response; inspect the existing result first. Self-hosted instances use their own configured origin. `ui_locales` from the host is accepted only as a bounded language hint and discarded before grant state is stored.

No refresh token is issued: access expires after an hour and the host must reauthorize. The AS advertises only the authorization-code grant. Clients requiring refresh tokens or CIMD must select the supported DCR/code path or report incompatibility; those methods are not advertised. DCR registrations persist so an installed connection can reuse its client ID, with a fail-closed cap of 1000 clients. Unknown client metadata and unsupported grant types are rejected.

## Self-hosting and protocol

Set `READER_PUBLIC_ORIGIN` to the instance's exact HTTPS origin and run the existing server with persistent data. The local plain-HTTP service retains stdio; it does not advertise OAuth. No additional provider secret or identity account is required. Existing website authentication verifies the user; the MCP authorization server issues its own opaque credentials rather than forwarding Supabase tokens or cookies.

The resource is `<origin>/api/mcp`. Protected resource discovery is at `/.well-known/oauth-protected-resource/api/mcp` (also available at `/.well-known/oauth-protected-resource`). Authorization server metadata is at `/.well-known/oauth-authorization-server`. The Vercel rewrites route these to the existing function. Other reverse proxies must forward them unchanged. OAuth endpoints are under `/api/mcp/oauth/`: `register`, `authorize`, `consent`, `token`, `revoke`.

The server requires S256 PKCE, exact registered HTTPS callback matching, single-use authorization codes (two minutes), browser/session-bound consent (ten minutes), and exact `resource` at authorization and exchange. It returns the metadata issuer in `iss` on success and cancellation. It stores credential/session hashes and verifies expiry, resource, book, owner and domain-grant revocation on every MCP request. Website cookies and manual stdio grants are not accepted as remote MCP access tokens. The OAuth revocation endpoint requires token plus registered client ID and revokes the underlying domain grant.

DCR and OAuth exchanges do not fetch client URLs; callback and logo metadata cannot cause server requests. Consent escapes titles and labels, applies no-store/no-referrer and a restrictive CSP, and requires same-origin POST plus a browser-bound anti-CSRF value. Storage uses the existing hosted CAS or local locked JSON store; callbacks contain no external side effects. Persistence errors fail closed.

Rate limits are persistent across function instances: 10 registrations, 60 authorization starts, 120 token exchanges/revocations per minute globally, 60 MCP requests per token per minute, and an overall 2000 checked requests/minute ceiling. Full capacity returns 503; 429 includes Retry-After. Metadata reads are public and do not grant access. Pending authorizations/codes/tokens are bounded and expired entries are pruned on mutations. Production perimeter controls remain useful for traffic that does not reach those checked operations.

The existing SDK 1.x negotiates MCP 2025-11-25; this change does not upgrade it to the July 2026 protocol. Stateless Streamable HTTP uses POST with JSON responses; authenticated GET/DELETE return 405. The client must send the standard MCP Accept headers and retain negotiated protocol headers. See [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and the [SDK maintenance documentation](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).

## Acceptance and limits

Run the automated OAuth and hosted HTTP tests with synthetic accounts. They exercise website password sign-in, DCR, consent, token exchange, actual SDK HTTP discovery/calls, strict scopes, foreign-book rejection, no reading-time effects, revocation, expiry, malformed input and throttling. Existing stdio tests verify compatibility. No model or OCR provider is called.

These results establish implementation behavior, not that a real ChatGPT account has installed the server. Record the merged source SHA, matching production deployment, public HTTPS metadata, real test-account identity, selected synthetic/public book, real host authorization/call and post-revocation rejection separately. A local Inspector or a scripted HTTP client cannot substitute for the ChatGPT step. If the host's UI/account authorization is unavailable, leave GET-196 open and document the exact missing step.

## Highlight and evaluate a passage

Request the annotation scopes above when connecting. Call `reader_get_connection` to inspect the actual granted scopes; do not infer permission from the user's request or a stored book. Read only the needed passages with the existing bounded tools.

1. Construct a `leafhour-reading-quote` from the exact returned text, book/chapter/passage IDs, source version and layer. Offsets here count **UTF-16 units in the complete passage layer**; content pagination offsets count Unicode code points. Reconstruct the needed layer chunks before converting positions. Translations require their real `translationStatus`.
2. Call `reader_add_highlight` with `{bookId, id, quote}`. The receipt contains only `highlightId`, `status` and `createdAt`. Exact retries reuse the same ID and payload. A deleted highlight returns `deleted` and must not be treated as a new save.
3. Call `reader_add_annotation` with `{bookId, threadId, messageId, quote, highlightId, body}` to attach your AI evaluation. Reuse the returned highlight ID; do not send an annotation if the highlight is deleted. AI commentary is labeled External Agent and is visible in the reader's annotation card. The external host supplies the prose; Leafhour does not call its model or consume credits.
4. With `annotations` permission, use `reader_get_annotations` for bounded AI-only rereads; private reader replies remain excluded. These writes do not change reading position or time.

Highlight and annotation saves are two idempotent operations, not one cross-document transaction. If the annotation save fails, retain the successful highlight receipt and retry the unchanged annotation payload; do not create another highlight. Exact acknowledged historical retries may return their original receipts while a fresh grant is valid. New selections must match the current text and version.
