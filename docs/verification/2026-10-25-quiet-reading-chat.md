# Quiet reading conversation — 2026-10-25

> Historical session report, archived on 2026-10-30. Its blocked-delivery statements describe October 25. The later recovery is documented in [GET-220 / PR #183](2026-10-26-get-220/README.md). PR #227 replaced the desktop overlay with a sidebar; [GET-274 / PR #258](2026-10-29-get-274/README.md) retained it and introduced the mobile half sheet. The test totals and pricing verification below are historical evidence, not a current release claim.

Base: public main `a6476d2`. Scope: a quiet chat entry, outside dismissal, related transient tools, and blocked conversation submission.

## Findings and changes

- Desktop chat previously reserved a full-height right column, changed body padding, shifted reader controls, and scheduled reading-anchor restoration. It now floats above the page with bounded height; opening, closing and resizing do not rewrite the reading layout or restore an old anchor. Mobile retains full-screen focus containment. Resize preference remains compatible.
- A complete outside click now closes chat without explicit focus return. A gesture starting inside, pointer exit, the AI trigger, and a companion/quote handoff do not immediately dismiss it. Drafts and running request identifiers remain intact. Capture-phase listeners also observe annotation/highlight clicks that stop propagation.
- More closes when the reader clicks its composer; Escape closes More before chat. Its scroll height is bounded by the chat surface. Opening conversation clears transient paragraph controls while retaining the selected quotation; hovering the reading trigger cannot open another surface over a dialog.
- The unbilled chat price reference expired at `2026-10-22T17:36:28.143Z`. The generator rejects it before bridge/model startup. A new no-socket regression first reproduced `Pricing reference expired or unavailable` at the October 25 incident time, then entered the synthetic runtime after renewal. The [official CNY price page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) was checked on October 25: the conservative peak rates remain CNY 2 input / CNY 8 output per million tokens. The reference retains its seven-day expiry, the CNY 0.75 cap, and existing request/tool limits. This is admission verification, not proof of a successful real model reply.
- Paid conversations with explicit `preferenceWrites` were rejected by both billing allowlists. The boolean is now accepted and validated. Quotes and retries still bind it into the complete input digest, so changing consent cannot reuse the original quote.

## Evidence

- Task-only checkout: **134 passed, 0 failed, 0 skipped**, using Node 26.10.0. Files: `chat-pricing-reference`, `reader-chat-generator`, `reader-conversation`, `reading-toolbar`, `billing-generation`, `credit-client`, `library-chat-ui`, `reader-chat-workspace`, `provider-pricing` tests.
- `node tools/build-vercel.mjs`: passed both in the shared checkout and the isolated task checkout. `git diff --check`: passed.
- Shared checkout full-suite attempt: **3,265 total; 3,075 passed, 175 failed, 15 skipped**. This run preceded the final pricing change and included concurrent tasks. HTTP/harness listeners failed with `listen EPERM`; native PostgreSQL could not allocate shared memory; process-start tests hit restricted network APIs. The yearly hosted-skip assertion also differed under Node 26. Two unrelated assertions were red: `gift-compose-ui` source-disclosure copy and `ui-locale-reader-foundation` system-vs-Japanese selection. These failures are not reported as passing or waived for merge.
- The installed Node 22 executable could not launch because `libsimdjson.30.dylib` was missing. It was not repaired as part of this task.
- Independent review found and prompted repairs for same-click companion dismissal, stopped-propagation outside clicks, and bounded-menu clipping. No fresh post-fix browser acceptance is claimed.
- The live default test account was confirmed through the authenticated session endpoint before one bounded, existing question was submitted. Production accepted the question and eventually showed a failed turn. No replacement reply was fabricated. Live browser automation was subsequently interrupted by concurrent browser activity; a local visual fixture was prepared, but its new layout was not accepted in-browser.

## Delivery state

The shared checkout's unrelated language, copy and hover work is preserved. A separate local checkout contains only this task, including only the overlay guard from the shared toolbar file. Native worktree tools failed; the original `.git` is read-only, so the task was isolated through a local clone.

GitHub MCP authorization failed. Local `git` and `gh` were also checked: the session could not connect through its configured proxy, direct GitHub access failed, and direct DNS lookup for production failed. These are session access failures, not proof that the host proxy is down or that GitHub credentials are invalid. No PR, merge, deployment, or repaired-production acceptance is claimed.
