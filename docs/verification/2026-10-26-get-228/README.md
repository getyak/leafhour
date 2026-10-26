# GET-228 — Book info introduction and sharing recovery

Baseline: `97fba8a84477aeebc1c3c79ebfc343553627a849` from the public `getyak/leafhour` main branch. Scope is [GET-228](https://linear.app/getyak/issue/GET-228), with the existing GET-202 writing contract. No account, book-rights, billing, model-provider or publishing policy was expanded.

## Findings and behavior

A second `reader:ready` could invalidate a pending optional book-actions import and clear its feedback without restarting it. An unusable trigger could also abandon that import without a recoverable state. The introduction controller accepted incomplete metadata, had no client read deadline and supplied no working read-retry action. These are distinct from an empty introduction. Normal authenticated Production Alice metadata returned HTTP 200 at the baseline, with real supplied description and an enabled Share button; the historical screenshot alone does not establish that normal requests always fail.

| State | Reader sees | Available action |
| --- | --- | --- |
| Not yet read / loading | Loading feedback; existing supplied description remains visible | Close; Share carries the actual loading reason until its optional module loads |
| Real supplied or saved text | Introduction body and its existing provenance | Existing sharing path |
| Successful read with no text | Explicit localized empty state | Generate only when the service explicitly reports availability, with scope and cost shown |
| Read or generation failure | Localized safe reason, including timeout/access/rate limit/source change | Retry reloads metadata with GET; it never starts paid generation |

Reads share a foreground request and have a 15-second deadline. Explicit generation retains the server's 60-second limit with a 65-second client envelope. Close, page leave, owner/source changes and late responses are fenced; timers and abort listeners are released. Reopening performs only a metadata read. The common popover and existing account/command-palette owners remain unchanged.

Sharing remains independent of introduction failure. During optional-module loading/failure, the disabled button describes the adjacent visible status. A local book with no library identity describes the visible import requirement. Enabled Share drops this description, including across locale changes. Private-library sharing continues through the existing gift composer and preview/explicit seal flow. Cancelling native sharing replaces any previous success notice; clipboard denial after a prior copy restores the copy action and opens the manual link.

## Verification

- Eight substantive regressions failed against the previous implementation: malformed metadata, deadline, duplicate read/owner fence, same-source ready during import, abandoned hidden trigger, working read-only retry, native-share cancellation after success, and clipboard denial after success. No provider call or public link creation was used to establish the failures.
- Independent model review: no unresolved P0/P1/P2. The reviewer ran 74 affected Node tests and an actual-module DOM composition covering source/owner, ready/chapter ordering, unknown/loading/empty/error, four locales, accessible Share descriptions and Retry focus. See [review.md](review.md) for source fingerprints. This is model review, not a human assistive-technology study.
- Full host suite: 3472 passed, 0 failed, 1 platform-specific skip (the modified Linux Node-license rejection case). Native PostgreSQL checks ran using the existing checksum-verified official Postgres disk image mounted read-only for this task; the first discovery-path failure was repaired rather than skipped.
- Fixed Vale 3.24.0 and textlint 15.8.0: pass, with existing warnings/debt retained. Two stale English debt entries were manually pruned after the relevant wording removed the developer term. No allowance or new debt was added. Two copy exports were byte-identical.
- Pricing, runtime trace, public Vercel build, asset checks, release policy and release verification passed. Reader JS is 327653 bytes (cap 327680), CSS 203118 bytes (cap 204800); budgets were not increased.
- Actual packaged browser replay: **8/8 passed** in Chromium 153 and WebKit 26.6, across EN/1280/paper, zh-Hans/390/night, zh-Hant/320/paper and JA/320/night. See [browser.json](browser.json). It covers supplied and real empty metadata, 500/429/403/invalid JSON/null, actual 15-second client timeouts, GET-only retry/focus, cancelled/late reads, existing gift-dialog cancellation/draft recovery, Escape/outside dismissal and 200% text sizing. A deliberately dispatched chapter event collapses its parent tools; the lazy opener correctly reports an error and close/reopen recovers with one read. The packaged reader and all optional modules/assets are served from the build, without source fallback.
- Production receipts remain separate and are posted on the associated PR after exact-commit release readback. Transport faults are labelled fixtures and are never claimed as real provider failures or real empty Production metadata.

The public verifier is [tools/verify-book-info-browser.mjs](../../../tools/verify-book-info-browser.mjs). It requires an explicit registered artifact directory and existing browser module/executable paths. Its server has no model generators. Supplied/empty successful metadata comes from real isolated domain services; only failure/slow responses are transport fixtures. No test publishes a real gift or sends content externally. Representative screenshots contain only public-domain Alice or disposable synthetic text.

Real device input, screen-reader speech and native-language human review are not claimed. The existing baseline cold CSS first-frame P2 from GET-227 remains outside this change; these results do not claim zero first-open flash. CI, merge, hosted revision and Production acceptance must be read back for the final commit and are separate from the local results above.
