# GET-220 reading chat: local verification

This change keeps reading chat in a bounded desktop overlay and preserves the full-screen mobile surface. Opening, closing and resizing no longer reserve body padding or schedule restoration of an old reading anchor. Temporary paragraph/reading tools close on entry; existing notes and their layout stay in place. Selected source text, attributed quotations, drafts and accepted request identities survive closing.

## Reproduction and scope

The latest public main was `5dc20064499e93a5d9d53497a5d89aed780873ae` (GET-219 retained). Production was `8b9838ddeab579c6a050021216785ef383635f87`. Chrome 155.0.8059.85 at 1440×900 reproduced the same defect in both: opening chat moved the first paragraph from x=395 to x=195, added 400px body padding, and an outside click left chat open. The old 8abb299 patch was obtained from GET-220 Resources, SHA256 `dcee3fb1237f40af0c559d3e53f90b6ca4a47e7fb44d868d3d55c063513e18a0`, compared with main and selectively migrated. Its blanket seven-day date renewal was not used.

Capture listeners now dismiss a complete outside primary click even when the target stops bubbling. The target executes once and keeps focus. Inside drags, cancelled pointer sequences, right clicks and pointer exit keep chat open. Same-click handoffs reuse the existing chat and preserve an existing draft. Escape unwinds explanation, settings, More and chat; foreground chat no longer lets a retained annotation consume Escape. Mobile inert and overflow ownership restore on close, breakpoint changes and disposal. Menu and message overscroll stay within their scroll containers.

`preferenceWrites` is a boolean on both point-gate boundaries, stays off by default and participates in the immutable request digest and idempotency comparison. Point confirmation includes its authority. Pending/unknown work keeps its original payload and checks saved status before recovery. The existing settlement contract still consumes points only for a validated, persisted result. Failed, cancelled and undelivered work remains governed by that ledger contract.

Safe failure categories distinguish not sent, refused, generation, pricing, verification, source change, saving and interrupted state. Diagnostic logs retain bounded request/run IDs and safe stage/code fields; provider text, questions and credentials do not enter those logs. [Price maintenance](pricing-maintenance.md) documents official sources, the bounded validity window and the release check.

## Local evidence

| Check | Result |
| --- | --- |
| Full supported Node suite | 3,395 total; 3,394 pass; 0 fail; 1 macOS platform skip; exit 0 |
| Native financial SQL | Full suite used the complete, checksum- and code-signature-verified official Postgres.app 16.15 tools; disposable databases only |
| Isolated runtime build | Exit 0; 928 traced files, 9.0 MB; initialization without model requests |
| Hosted/public/release checks | All exit 0; 514 public files, 11 registered media assets; explicit release allowlist |
| Initial reader JS/CSS | 327,588 / 200,463 bytes; unchanged limits 327,680 / 204,800 bytes |
| Copy checks | 0 new T1 errors; 373 documented debt entries and 1,996 warnings retained; no stale bindings; 11 real-CLI canaries pass |
| Official price source check | Both reviewed page-byte hashes matched; real-clock release check requires at least 24 hours remaining |
| Browser layout matrix | 40/40: five viewports × four interface languages × paper/night, actual root theme values checked |
| Saved local answers | Each matrix case used the real HTTP/domain/validation/persistence chain with a synthetic generator, then reloaded the same saved turn; concurrent submit did not create a second generation |
| Independent review | No unresolved P0/P1; separate reviewer reproduced and rechecked Escape fixes and independently ran affected tests |

The matrix covers 1440×900, 1200×600, 768×1024, 390×844 and 390×420. It records closed/open/More/input/sent screenshots, composition-event Enter protection, reduced motion, menu bounds, mobile containment and restored background state. [Machine results](browser-final-report.json) retain per-case theme values and assertions. [Additional native events](browser-events-report.json) cover stopped bubbling, focus, pointer exit/drag/cancel, same-click audio handoff, source selection, resizing and breakpoint changes. These use Chrome's actual DOM and event dispatch, rather than the unit DOM fixture.

The initial full-suite attempt failed 11 checks (asset budget, explicit release-file inclusion, new release-stage fixtures and lockfile-bound license evidence). Those failures were repaired without increasing budgets or weakening gates, and the full suite was rerun. The lockfile change only replaces 27 mirror URLs with the official registry; versions and integrity values are unchanged. The license evidence was regenerated and reviewed. Native PostgreSQL was prepared inside this task's registered artifact directory; no global database installation, shared database or iOS simulator was used.

## Delivery and acceptance boundary

Local evidence is separate from current-head CI, merge, Production and a real-provider saved answer. At preparation time the last main Vercel status reported `Deployment rate limited — retry in 24 hours`; existing account/project access had separately reported 403. No deployment, login, provider or project switch is used to bypass those limits. Only main Production is authorized; no Preview is created.

The default `test@cubxxw.com` account was authenticated through the deployed password/Auth path and its real owner identity was checked without publishing the owner ID, credentials or session cookie. No question was sent to the old Production version and no purchase, recharge, new paid task, private-note read or expanded context was used. A real-provider answer for this change is still required after the matching Production revision is available. No completion claim follows from the synthetic generator, CI or merge alone.

Physical OS IME, a physical soft keyboard and native browser-toolbar zoom remain unverified. Composition events, short viewports and the recorded 200-percent-equivalent layout are bounded browser checks. GET-220 must remain In Progress until its required publication and real acceptance gates are satisfied. Related GET-218, GET-219, GET-201 and GET-222 states are not changed by this work.
