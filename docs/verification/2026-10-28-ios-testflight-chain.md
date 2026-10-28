# iOS TestFlight automation verification checkpoint

Date: 2026-10-28. Scope: source implementation and offline validation before the draft PR. This is **not** a signed archive, Apple upload, TestFlight distribution or device acceptance record.

## Source and account audit

- Original workspace `/Users/cubxxw/data/leafhour` was clean on `codex/get-209-ab-verification` at `1126c82`; its origin is the public `getyak/leafhour`. Original files/index were preserved.
- The available local `origin/main` was stale (`dca8eab`). Full Git fetch/shallow clone attempts ended with partial-file/early-EOF transport errors. Some alternative download/filter operations did not execute because automatic approval review exceeded its deadline; these were not treated as an unsafe-action finding or Apple authorization failure.
- A separate local clone/branch under `/tmp/leafhour-ios-delivery` retains the source work. GitHub tools successfully created `codex/ios-testflight-chain` from then-current public main `9c127e0bdbab11ae21dc2f462dad4d8430cd0ef2`. Remote source delivery uses that current public tree, not the old local baseline or any private history.
- Current iOS README, Release xcconfig, Info.plist, committed project and CI were read from public main. `.agents/skills` was absent at that revision (404/root tree confirmation). Release Bundle ID remains empty; no app registration was performed.
- `getyak/capir` reference workflows were read at reference main `235282ecf176d1caaa6c0202d58d25455426e12c`. No Capri files, credentials, signing resources or deployments were changed.
- Read-only GitHub configuration audit found no Leafhour Actions release secret/variable entries and no `testflight`/`signing-maintenance` environments. Existing Preview/Production environments were untouched.
- An existing Chrome ASC session reached the app list. Searching `Leafhour` returned no results in that selected account. No app ID or developer team was inferred from another app, URL UUID or local debug identifier. A follow-up old-brand search was interrupted by user control and was not relied on.
- ASC displayed a membership expiration of 2026-11-24 and an updated Paid Applications Schedule notice. No agreement was accepted or renewal/payment initiated. The exact impact on this app's TestFlight eligibility remains unverified.

## Executed verification

| Check | Actual result |
| --- | --- |
| `node --test tests/ios-*.test.mjs` | 17 passed, 0 failed after the review fixes |
| `python3 -m unittest discover -s tests -p 'test_ios_*.py'` | 3 passed, 0 failed |
| `bash -n scripts/ios/archive.sh scripts/ios/upload.sh` | Passed |
| Ruby/Psych parse of all four changed/new YAML workflows | Passed |
| Official actionlint v1.7.12, all four changed/new workflows, `-shellcheck= -pyflakes=` | Passed, exit 0 |
| Full `npm test` on the available older public baseline plus pre-review task files | 3297 tests; 3084 passed, 198 failed, 15 skipped. **Not a green project suite.** |

The full-suite failures are individually named in [the retained failure list](2026-10-28-ios-local-suite-failures.json). Principal observed causes were sandbox `listen EPERM` (127.0.0.1/::1), unavailable old DSH executable path, expired pricing references and absent native PostgreSQL. This older local baseline is not the current-main PR source; current-commit remote CI must establish the project result. No live `.env`, book files or reading data were copied into the isolated test clone.

The release policy and signing audit initially failed for missing implementations. The review's nested-identity mismatch was reproduced as an assertion failure before correction. No live ASC token/key, profile, certificate or upload was needed for these tests; the certificate and artifact bytes are synthetic.

## Independent review and fixes

A fresh read-only reviewer found three Important issues and no Critical issues:

1. A delayed/uncertain upload could be submitted again on rerun. Fixed: only workflow attempt 1 can submit; subsequent attempts reconcile Apple state without transport, including when the exact build is not visible yet. The operational cost is conservative recovery: an archive that first succeeds only on a later attempt needs an audited new dispatch for a necessary first upload.
2. Nested Apple identity and actual provenance were incomplete in historical receipt selection. Fixed: require complete matching app/bundle/version/build, GitHub's IPA asset digest, actual tag target and successful exact-source CI/release workflow records.
3. Finalization checked the local receipt instead of all published evidence. Fixed: download and validate the published receipt, complete Apple evidence, asset digest and actual tag before new/idempotent success. A partial or mismatched release stops for review.

New/expanded tests cover all three findings. All 17 Node and 3 Python tests and actionlint passed after the fixes. Historical receipt selection requires a completed successful release run; finalization alone permits its own currently executing release run to be in progress.

## Remaining gates

- Current draft-PR commit's complete GitHub CI/native simulator build result; this checkpoint precedes that run.
- Verify the existing Leafhour app ID, exact Bundle ID, developer team, current version/build history and intended certificate in the correct Apple account.
- Confirm candidate environment secrets, separate maintenance permissions and environment protections before configuring any persistent access.
- Separately confirm the first upload scope, including public IPA/receipt prerelease assets; then separately confirm automatic updates.
- Real signed archive/export, exact Apple processing, approved group availability, tester installation and two-build retained-data device update remain unexecuted.
- Account holder must handle any applicable membership renewal or legal agreement through explicit confirmation.

No credentials were created/configured, no profile was refreshed, no Apple upload or invitation occurred, and no automatic release was enabled at this checkpoint.
