# GET-409: Login and settings

Refs https://linear.app/getyak/issue/GET-409

The account page shows the saved name, email and one avatar entry. Name editing
uses the existing account profile service. Login completes before background
library transfer, and provider metadata does not replace the saved profile.

Settings provide **Export settings**, **Export my data**, **External MCP servers**
and **Leafhour MCP server**. Existing backup, restore and selected-record export
remain available under a closed disclosure.

## Data and connection boundaries

- Account export includes account preferences, private People records, daily
  reading settings, notebook workspace, conversations and checksummed library
  parts. Original files and listening audio are optional. A changed snapshot or
  failed part stops the export rather than producing a partial success.
  Account JSON has its own 1,000-book manifest and a 512 MiB total bound; it does
  not inherit the legacy restore archive's 100-book limit. A 165-book HTTP export
  and a 101-book native export passed regression checks.
- Saved drafts and reading outboxes from this browser/device are included only
  for its current owner. Other devices must export their own unsynced records.
  Credentials, runtime job authority and MCP grants are excluded. The JSON is an
  open data export; the existing library backup remains the restore format.
- External connections use the installed official MCP SDK's Streamable HTTP
  transport. Public HTTPS endpoints and optional Bearer tokens are supported.
  Redirects, private DNS answers, URL credentials and query strings are rejected.
  Responses, timeouts, pagination and connection counts are bounded.
- Tokens are encrypted with AES-256-GCM. A hosted instance uses
  `LEAFHOUR_MCP_CREDENTIAL_KEY`, falling back to `SUPABASE_SECRET_KEY`; local
  instances create a private key file. Changing the key requires reconnecting
  token-protected servers. No token is returned in settings or data exports.
- Tools run only after an explicit action with visible JSON arguments. Shared
  storage atomically registers a dispatch before the remote call. Disconnect
  prevents new dispatches and reports registered calls that may still finish.
  Uncertain write results are not automatically retried.
- The existing Leafhour OAuth server retains its book/type scope and revocation
  checks. Daily delivery grants stay in their dedicated companion settings.

## Verification

Independent review found and verified fixes for stale account callbacks, omitted
device/browser records and disconnect races across hosted instances. The final
review has no unresolved P0/P1 findings.

Focused HTTP, profile, ownership, connector, shared-CAS, interface and dependency
checks passed (49 tests); the expanded export/backup/shelf regression run passed
57 tests. Isolated native PostgreSQL financial checks passed. Native Core passed
418 tests, including four account/export tests, with two unrelated skips.
The native authentication suite passed four tests. The final affected-area run
passed 435 tests, and the pinned Vale/Textlint check and copy canaries passed.

`npm run verify:deploy` passed after synchronizing main at `4ab9fce`: 4,703 tests
passed, one platform-specific test skipped, none failed. It also initialized the
isolated reader runtime, built the Web app, checked the public output, exported
the software allowlist and verified release provenance. The local PostgreSQL
engine was temporary and isolated from existing databases. A dependency symlink
that prevented the PDF packaging test from copying its native binary was replaced
with the same locked version in this task's dependency directory before this run.

Real-service checks used the designated test account. Web name changes were read
back and the original name restored. Chrome rendered branch assets with service
workers blocked, using the real production account/API: 390px and 1440px layouts,
dark appearance, name/email/save tab order and focus restoration were checked.
No page errors or horizontal overflow were observed. This is branch UI evidence,
not evidence that the new account/export endpoints are already deployed.

On the shared Primary iPhone simulator (iOS 26.5), a real-account UI test passed
password logout/relogin, the exact saved name, keyboard visibility, saving the
unchanged name and reading it back after app termination/relaunch (74.6 seconds).
The host restored the simulator clipboard after pasting the Keychain password.
The account's original name was read back unchanged after acceptance.

The connector initialized the official Microsoft Learn MCP server, listed its
three tools and executed `microsoft_docs_search` successfully through the same
public-address-checked transport. It sent only a documentation search query.
Authenticated transport, persistence and disconnect were also exercised against
an isolated official-SDK HTTP server. No paid model calls were used.

CI, merge and matching production acceptance remain separate delivery steps.
Simulator results do not establish physical-device or VoiceOver acceptance.
Private logs, screenshots, credentials and actual exported reading data are not
included in the public repository.

### Hosted entry correction

The first matching-source production check at `1aab086` found that account
settings export returned 404. The Vercel catch-all had an explicit account-route
allowlist that omitted the new exports and MCP management endpoints. Local
`createReaderServer` checks had bypassed this separate admission boundary.

The correction admits only the documented account paths and connector UUID/action
shape. A real HTTP test now runs `createHostedHandler` and `createPortal` together
with isolated auth/storage, through both direct paths and the deployed catch-all
query. It reproduced the 404 before the fix and passed afterward, including
authenticated access, anonymous 401, changed-owner 409, no-store and invalid-path
404 checks. The focused hosted/auth/MCP/production-boundary run passed 85 tests.
Production smoke now probes every new account API for anonymous 401 and no-store.
The failed acceptance attempt created no MCP connection or grant and signed out
its own test session. Matching-source functional acceptance continues after the
corrected entry is deployed.

## Protocol references

- [Official MCP TypeScript client](https://ts.sdk.modelcontextprotocol.io/client)
- [Microsoft Learn MCP reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference)
