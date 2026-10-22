# MCP book highlights and AI evaluations

Date: 2026-10-22. Implementation and verification record. Delivery and matching-release live acceptance are tracked on [PR #164](https://github.com/getyak/leafhour/pull/164).

## Behavior

The existing bounded reading tools remain available. Remote OAuth can additionally request `annotations`, `highlight:write` and `annotation:write`. Optional consent boxes start unchecked; only a subset of requested scopes can be approved. Missing selections and old connections remain `content` only. Scope-specific tools are listed only when granted, and domain services enforce the scope again.

`reader_add_highlight` saves an exact typed selection into the same account/book records used by the web reader. It preserves source/chapter/passage identity, exact UTF-16 boundaries and translation state validation. Its narrow receipt retains the canonical highlight identity across retries and deduplication; deleted highlights do not reappear. `createdVia: external-agent` survives backup and restore.

`reader_add_annotation` stores the caller's AI explanation or evaluation in the existing reader annotation thread with fixed External Agent attribution. A matching optional highlight ID links both. The AI-only read projection excludes user follow-ups and private notes. These writes do not call a paid model, change reading position or add reading time. Existing stdio user-comment behavior is unchanged. Highlight and annotation saves remain two separate idempotent operations; partial-save recovery is documented.

The consent page, four public guides, four README tool inventories, MCP contract and installable reading skill describe actual scopes and the write sequence. The skill distinguishes code-point content continuation from UTF-16 selection offsets, requires the prefix needed for conversion, enforces selection limits, and avoids saving an unsolicited critique or claiming an unacknowledged save.

## Verification

- Red/green checks established the initially missing scope expansion and external-highlight entry point before implementation.
- Final domain/protocol/documentation group: **79 passed, zero failures or skips**. Files: `highlights`, `mcp-oauth`, `reader-annotations-external`, `reader-annotations-external-cas`, `readme-languages`, `reader-annotation-records`, and `reader-annotation-tools` test files.
- Additional hosted-handler/SDK HTTP scenario: **1 passed**. Genuine Node IncomingMessage/ServerResponse over an in-process Duplex exercises website password login, DCR, returned consent HTML, explicit scope selection, token exchange, the SDK Streamable HTTP client/server JSON path, narrow highlighter receipts, AI-only reread, web-record/thread persistence, strict unknown fields, old read-only denial and post-withdrawal rejection. This harness opens no TCP listener and makes no external requests; it is not live network or browser acceptance.
- The ordinary existing TCP test fixtures remain available unchanged by default for CI. The sandbox refuses their `listen` call with EPERM; the new annotation scenario uses the explicit in-process fixture.
- Independent review: **42 focused tests passed**. The reviewer reproduced a stalled highlight CAS committing stale translated text after a translation acknowledgment. The added gated regression failed before the fix. Source acknowledgment now touches the same records key, forcing the delayed CAS to retry and revalidate; the regression and subsequent focused suite passed. Revocation uses the same records fencing pattern.
- Hosted web build, public-build scan, 877-file software release allowlist, pinned Vale/textlint copy lint and diff whitespace check passed. Existing copy debt/warnings remain visible. Generated copy inventory/candidates were refreshed.
- One intermediate whole-suite attempt ran **3,208 tests: 3,007 passed, 186 failed, 15 skipped**. Most failures were denied TCP listeners; PostgreSQL shared-memory creation was also denied. Runtime/DSH fixtures failed with the checkout's incomplete shared dependency installation or symlinked node_modules. The runtime build specifically could not trace the existing DSH SDK's missing `lib/index.js`. These failures are not represented as a clean full-suite or runtime-build result; final CI is still required.

All test identities, sources and prose are isolated synthetic fixtures. No live account book, payment, model, OCR or speech provider was used.

## Initial delivery attempt

The GitHub connector refused branch creation on `getyak/leafhour` with HTTP 403, `Resource not accessible by integration`. The desktop GitHub connection could not complete its existing device authorization. The execution sandbox also cannot reach GitHub through the configured proxy or directly. No branch, PR, remote CI, merge or Production deployment was completed. The source changes and a local commit are preserved for delivery when repository write access is available. No preview deployment was requested.

Production acceptance must later verify the matching release SHA, public OAuth metadata and real default-test-account authorization, selected public/synthetic book, highlighted quote, attributed AI evaluation and rejection after revocation. A scripted synthetic test does not establish that an actual ChatGPT account is connected.

## Native delivery recovery

The later user request authorized real publication through local git/gh. A native command channel confirmed the existing keyring-backed GitHub account has repository push/admin permission. The feature branch was pushed normally and PR #164 created against the unchanged public main; no force push or Preview deployment was used. The earlier connector/sandbox failures remain historical evidence, not the current delivery state.

A fresh isolated `npm ci --ignore-scripts` installed 695 locked packages. The first unrestricted default-concurrency full run completed 3,216 tests: 3,214 passed, one failed (`home-auto-entry`: “a verified account gets a separate bounded read and owner-check window”), and one platform skip. That existing 10 ms timing case passed in isolation. The full suite rerun with four concurrent files completed **3,216 tests: 3,215 passed, zero failures, one platform skip**. The runtime built and initialized 928 files (9.0 MiB) without model calls. Hosted web build, the 409-file/11-media public scan, 877-file release allowlist, source-provenance verification, pinned copy lint and copy negative canaries all passed. No failing test or lint rule was disabled.

The real default account's Supabase-backed website password login returned 200 and its current user identity was checked. The keychain password was read only at runtime and not logged. A live HTTPS SDK acceptance script is prepared to read the public Alice opening, save one attributed highlighter/evaluation pair in that account, verify the web domain records and unchanged progress/time, then revoke the grant and require HTTP 401. Final results and the exact production source SHA belong to PR #164's delivery record; preparing this script is not itself a passed live acceptance.

At the recovery checkpoint GitHub's [official status API](https://www.githubstatus.com/api/v2/summary.json) reported degraded Actions performance and an investigating “Incident with Actions Results” starting 2026-10-22 14:18 UTC. Required PR CI was queued without a runner. Publication continues to require the actual successful current-head CI, followed by the matching main Production deployment and live acceptance.
