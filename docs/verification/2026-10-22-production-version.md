# Production version verification — 2026-10-22

The initial production website at <https://leafhour.com> serves public source `d0ecf845298b8ea4d1eff513dd7f96cfea9c415d`, which was the latest `origin/main` when this audit began. Local `main` was clean and fast-forwarded from `4f6cbc3c9076d376dd116aff014bb0bbac7c3e2a`; it had no unpushed commit.

## Independent release signals

- Public `/release.json`, requested with `Cache-Control: no-cache`, returned the exact source SHA above.
- [CI run 39599163746](https://github.com/getyak/leafhour/actions/runs/39599163746) completed successfully for that source.
- [Production run 39599727057](https://github.com/getyak/leafhour/actions/runs/39599727057) completed successfully for the same source.
- The GitHub `Vercel` commit status is successful and points to the [production deployment](https://vercel.com/3293172751nss-1526s-projects/leafhour/E7qTm9YrmUz6ZAmwAsF9zabgDKQu).
- Five actual hosted JavaScript responses have exactly the same SHA-256 and bytes as their corresponding `app/` files at that source: `settings-controls.mjs`, `settings-appearance.mjs`, `reader-annotation-records.mjs`, `book-reading-languages.mjs`, and `account-ui-preferences.mjs`.

The connected Vercel MCP context returned no teams or matching projects. That connector context cannot inspect this deployment, so verification used the public endpoint, actual asset bytes, GitHub commit status and workflow runs. No Vercel configuration was changed.

## Actual checks in this session

- `EXPECTED_SOURCE_COMMIT=d0ecf845298b8ea4d1eff513dd7f96cfea9c415d RELEASE_WAIT_SECONDS=0 npm run smoke:production` exited 0. The existing check covers public page routes and assets, discovery metadata, private indexing exclusions, the anonymous session, all thirty public catalogue books, and denied anonymous gift/profile/preference boundaries. It does not invoke a model.
- Existing `tests/reader-annotation-records.test.mjs` passed 25/25, with no failures or skips. This supports rejecting a retained pre-review draft which incorrectly rejects historical references after text or translation edits.
- Chrome opened the actual English and Simplified Chinese home pages. The existing designated-account session was reused to inspect Settings, without editing any fields. The six-category settings dialog and About panel render; the observed console had no warnings or errors. No private book/record contents or screenshots are included in this public record.

These checks establish source identity and observed page behavior. They do not claim a full interactive regression of every authenticated workflow, model/provider availability, OCR quality, or completion of unrelated Linear acceptance items. Existing old worktrees and four stashes remain recovery material.

## Delivery follow-up

This document records the initial live version. After any recovery/audit PR merges, the parent verifies the new merge SHA in `origin/main`, waits for its CI, Vercel and Production checks, and reads the live source again. That final status is recorded in the PR discussion and task closeout rather than falsely treating the earlier green source as the new release.
