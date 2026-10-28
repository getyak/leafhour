# Recording-led room renewal verification

Scope: search index, stable/paged personal notebook, calendar feedback and viewport boundaries, shelf text hierarchy, and a light translation separator. See the [Chinese design analysis](../design/2026-10-29-video-review/README.md), [spec](../superpowers/specs/2026-10-29-video-room-renewal-design.md) and [plan](../superpowers/plans/2026-10-29-video-room-renewal.md). Source recording duration is 273.843 seconds with no audio track. No recording frames or real account records enter Git.

## Local checks

- `npm run verify:deploy`: 4,044 tests, 4,043 passed, zero failed, one platform-specific skipped test. Full real copy CLI paths were supplied. The skipped pinned Linux executable/license check is not a local pass; CI executes the Linux environment.
- Runtime build: 928 traced files, 9.0 MB; isolated initialization without a model request. Public build: 703 files, 12 registered media assets. Release allowlist: 1,362 software files; private data/history excluded. The reader's existing 200 KiB stylesheet cap remains unchanged and passes.
- Copy export and real pinned Vale/textlint: PASS, existing reviewed debt remains reported. No locale keys, author text or user titles were rewritten. Copy inventory/source references were regenerated.
- Notebook, API and portal focused regressions: 28 passed. API/loader focused final run after the filter repair: 19 passed. New regressions demonstrated duplicate in-flight loads and calendar misleading feedback before their corresponding fixes.
- Independent source review covered initial UI/loader, then the aggregate API and paged consumer. A 320 × 568 calendar clipping issue was repaired at the owning close rule and independently rechecked. A final adversarial pass then reproduced a selected-book filter reset during paged reopen/retry. The component now retains same-account known book options and clears them on owner change. A failing regression was added before the repair and checks the actual Markdown Blob stays within the selected book. The targeted fix received independent re-review.

## Browser evidence

Chromium (installed Chrome), Asia/Singapore timezone:

- Actual guest library + search: en, zh-Hans, zh-Hant, ja × 320/390/768/1440 px, 16 combinations. Search matches real public title/author, retains keyboard navigation and Escape return. No horizontal page overflow. Paper and night screenshots checked; browser page errors: zero.
- Actual notebook/calendar modules with isolated synthetic input: the same four languages × 320 × 568, 390 × 844, 768 × 720, 1440 × 1000. Sixteen notebook and sixteen calendar combinations; fixed controls, independent result scroll and bottom boundaries checked. Live result publication preserves the actual focused source link. Same-owner reopen reuses pending work. Browser page errors: zero.
- Full application with a temporary local account: thirteen imported synthetic text books and thirteen personal notes, one book archived. Notebook lists all thirteen notes and uses no per-book record requests during notebook loading. Filtering, quotation expansion, Markdown export, attributed source return, reload, and calendar/Escape passed. Reader navigation consumes the one-time `passage`/`note` query after restoring the anchor, as designed; query removal is not a failed source return. Normal reader record requests happen separately after navigation. Browser page errors: zero. Temporary account files were removed by the fixture.
- Bilingual Walden: real source and existing translation render; the sample boundary remains visible in night mode, with original-only continuation. No generation was requested.
- A 112-book isolated loader fixture completes in ten aggregate HTTP page calls; each server page reads at most twelve documents with at most three concurrent reads. This is a request-count measurement, not a network latency claim. Oversized records retain complete text through bounded direct fallback.

The checked screenshots are [stored with the analysis](../design/2026-10-29-video-review/evidence/README.md). Notebook and calendar screenshots are explicitly synthetic acceptance data.

## Copy cleanup

Read `docs/writing.md` and the current `lieflat-less-ai-tone` skill. The Chinese analysis was detected before and after minimum edits: three semicolons changed to full stops; viewpoints, qualification, numeric facts and table structure remained intact. Seventeen semantic candidates were retained and adjudicated. Configuration/verification enumerations and comparison tables remain intact. Raw detection, semantic labels and comparison report stay in the local task evidence directory and are available on request.

## Delivery gates

PR checks, normal merge and exact-commit Production acceptance are required after this local record. Their final status and commit are reported in the task's delivery message; this pre-merge source document does not claim a deployment that had not happened when committed.

Physical iPhone, Safari, spoken screen-reader output, real third-party provider generation, and reader research were not tested. No new dependencies, account data migration, paid generation or scheduled jobs were introduced.
