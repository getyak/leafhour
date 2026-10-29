# Native iOS TestFlight operations

This chain is implemented for review. It is **disabled by default**. No Apple application identity or credentials are checked in. Neither creating this PR nor merging its source authorizes the first upload, changes to persistent credentials, accepting Apple agreements, inviting testers or enabling automatic publication.

The native app currently reads on the device. The release process does not add account login, cloud sync, model calls, subscriptions or remote update code. Updates are signed builds delivered by Apple's TestFlight client; installation timing also depends on each tester's TestFlight automatic-update preference.

## Approval and configuration record

First confirm the existing ASC application by its actual app ID and Bundle ID, the Apple developer team, the intended certificate, current version/build history and the account's permissions. An app absent from the selected account's search results is an unresolved identity issue, not permission to register a replacement. Keep the empty Release Bundle ID in source; CI supplies the verified identifier explicitly.

Proposed non-secret **repository variables**:

| Name | Meaning / proposed initial state |
| --- | --- |
| `IOS_APP_ID` | Existing numeric ASC app ID, verified directly; currently unset |
| `IOS_BUNDLE_ID` | Exact registered distribution identifier; currently unset |
| `IOS_TEAM_ID` | Verified ten-character Apple developer team; currently unset |
| `IOS_CERTIFICATE_ID` | Existing Leafhour-authorized Apple distribution certificate resource; currently unset |
| `IOS_BUILD_NUMBER_OFFSET` | Nonnegative build-sequence base, chosen after existing build history is audited; default `0` |
| `IOS_TESTFLIGHT_ENABLED` | Master channel switch; absent/`false` until first-upload scope is approved |
| `IOS_AUTOMATIC_TESTFLIGHT` | Automatic iOS updates after exact-main CI; absent/`false` until separately approved |
| `IOS_SIGNING_REFRESH_ENABLED` | Profile mutation switch; absent/`false` until maintenance is separately approved |

Repository scope is deliberate: the prepare job must read policy and identity before entering any secret-bearing environment. These values are identifiers and switches, never key material. Changes are security-relevant and need the requested confirmation.

Proposed **GitHub Environment secrets**, after explicit approval:

| Name | Purpose | Storage / rotation |
| --- | --- | --- |
| `ASC_API_KEY_ID` | Select the existing ASC API key | `testflight`; metadata may be recorded in the private key register |
| `ASC_ISSUER_ID` | Existing ASC key issuer | `testflight`; verify against Apple key record |
| `ASC_PRIVATE_KEY_P8` | Sign short-lived ASC API/upload JWTs | `testflight`; private key only, never Notion |
| `IOS_DISTRIBUTION_P12_BASE64` | Existing authorized distribution certificate plus private key | `testflight`; retain a separately encrypted recovery copy |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Decrypt the P12 | `testflight`; separate private secret |
| `IOS_APP_STORE_PROFILE_BASE64` | Exact app's App Store provisioning profile | `testflight`; verify certificate, team, app and expiry |
| `IOS_SIGNING_MAINTENANCE_TOKEN` | Update **only this repository's** environment secret during an approved refresh | `signing-maintenance`; fine-grained GitHub credential, repository Environments write; do not expand the ordinary workflow token |

`signing-maintenance` needs its own approved ASC key entries and the same audited app/team/certificate repository variables. A key with certificate/profile write permissions can change Apple signing resources; do not copy Capri's key, repository, deployment identity, signing store, token or backend settings. If a separately scoped maintenance identity cannot be provided, keep refresh disabled and replace the profile manually after review. Existing certificate ownership and cross-app use must be reviewed before any future certificate rotation.

Before enabling either environment, configure required reviewers, main-only deployment branch rules, prevention of self-review and no administrative bypass where supported. Confirm those settings separately. The workflow itself cannot prove that a GitHub environment has reviewers: an environment name alone is not an approval gate. No environments or protection rules were created by this implementation.

Notion is a **metadata register**: name, purpose, owning app/repository, environment or vault reference, responsible person, last verified/rotated date, expiration and next action. Never put raw P8/P12/profile bytes, passwords, tokens, recovery codes or live values in Notion. The parent task owns the Notion page and its checklist.

## Release path

1. `CI` validates the actual source, the native core and an unsigned simulator app, plus the offline release contracts and actionlint. PR branches only run CI; there is no preview deployment.
2. `Release iOS / prepare` requires `getyak/leafhour`, `main`, current tip and successful same-repository push CI. Manual dispatch additionally requires `publish_testflight=true`, the master switch, and the latest exact-SHA CI success. `publish_testflight=false` is a harmless policy check.
3. Automatic dispatch additionally requires `IOS_AUTOMATIC_TESTFLIGHT=true`. It compares the current source against the last trusted receipt, including renamed/deleted iOS paths; missing or untrusted receipts cannot suppress a release. Comparison truncation is conservative. Web-only changes after a trusted receipt skip release.
4. Freeze a non-sensitive `release-plan.json` with source SHA, CI/workflow run IDs, exact app, version and build. One `archive-upload` job verifies the existing ASC app and rejects an already visible version/build. Install the supplied signing material only on that ephemeral macOS runner. Validate app/team/profile/certificate/expiry, use manual signing without `-allowProvisioningUpdates`, archive with Xcode 26+, and verify signature and exported identity. The IPA remains on this same runner throughout; no binary is transferred through GitHub Artifacts or Releases.
5. Check the local IPA digest, then probe the exact iOS marketing version/build before transport. An absent upload on workflow attempt 1 gets one `altool` submission to ASC only. A transport error still leads to independent Apple polling. 401/403 and other permanent errors fail; 429/network/server reads have bounded retries. The JWT is renewed for each request. Polling ends after 60 minutes, within the 130-minute combined archive/upload job. Later attempts refuse to re-archive or submit the same build; use the separate read-only recovery path.
6. Only `COMPLETE` upload **and** related exact `VALID` build produce `apple-validation.json`. Invalid/failed states stop immediately. Timeout means **unconfirmed**, with no success receipt or release. No export-compliance declaration, review submission, tester repair, assignment, invitation or public link is performed.
7. Recheck the still-local IPA digest and construct a schema-2 receipt using explicit field allowlists. Only `testflight-receipt.json` is retained as the `ios-testflight-receipt` Actions artifact. It contains source/IPA hashes, version/build, app/bundle identifiers, workflow/CI IDs and exact Apple processing evidence; no binary, key, password, tester contact or arbitrary API/plan fields. The IPA and archive are removed at job exit. No GitHub Release, tag, IPA artifact, binary attestation upload or contents-write permission is used. Historical baseline selection verifies the receipt ZIP's server digest, its sole small allowlisted JSON entry, matching app/build identities, the artifact's source-run binding and actual completed successful exact-source CI/release runs. Missing/expired evidence cannot suppress an update.

The first-upload scope is controlled ASC upload only. It does not publish a TestFlight binary through the public source repository. The non-sensitive plan/receipt metadata may be accessible with the public repository's Actions artifacts; the strict JSON allowlist is therefore intentional. Making an Apple-processed build available to an approved tester group and physical-device acceptance remain separate actions.

## Version and concurrency policy

`apps/ios/release.json` contains the native marketing version, initially matching the existing project's `0.1.0`. Confirm the appropriate value against ASC before first upload; this is not inferred from the website's package version. Change this file for an intentional version bump. A manual override accepts only `X.Y.Z` numeric versions, without prerelease/build suffixes or leading zeros.

Build sequence `n = GITHUB_RUN_NUMBER + IOS_BUILD_NUMBER_OFFSET` becomes `1 + floor(n/10000)`.`floor((n % 10000)/100)`.`n % 100`. Thus run 1 yields `1.0.1`, run 9999 yields `1.99.99`, run 10000 yields `2.0.0`. Bounds preserve Apple's maximum component sizes. One workflow run retains its number across attempts. The offset must place new builds above the existing app's build history. Do not delete/recreate the workflow, reset its sequence, change the offset downward or reuse a tuple for different bytes. The pre-archive collision check prevents an existing upload from being mistaken for a newly built IPA.

Release and signing refresh share `leafhour-ios-publish` with `cancel-in-progress:false`. An active upload is not canceled for a newer push. GitHub's default concurrency keeps one pending run; a newer pending run replaces the old pending run. A queued run rechecks the latest main tip and CI. This is a latest-update policy, not a promise to publish every intermediate commit.

## Failed run and uncertain upload

| Stage | Recovery |
| --- | --- |
| CI or prepare | Fix source/configuration; require exact current-SHA CI. Disabled switch is intentional. Do not bypass failed checks. |
| Archive before upload | Correct the verified identity/signing issue. The combined job refuses same-run retries to prevent a different IPA from reusing a build tuple. After auditing Apple state, use a newly authorized run/new build for any necessary first submission. |
| Transport error / Apple timeout | Keep the original workflow run and its non-sensitive plan. Dispatch this workflow on main with `reconcile_run_id=<original run ID>`; it restores only that plan, verifies the original app/source/successful CI, and queries Apple without archiving, uploading or modifying signing. Even if `publish_testflight=true` is also supplied, reconciliation takes precedence. Delayed visibility remains unconfirmed; it never permits another submission. |
| Definitive INVALID/FAILED | Diagnose Apple's result and fix source/configuration. Use a new run/build after review; never manufacture a VALID receipt. |
| Valid Apple build, receipt storage failed | Use read-only reconciliation and retain the returned observation. It is not promoted into a trusted successful release baseline for a failed source run. Inspect the GitHub artifact/service failure before a new authorized run. |
| Runner/IPA no longer available | The IPA is intentionally not retained on GitHub. Reconcile Apple first; if a new submission is needed, approve a new run/new higher build. Never rebuild arbitrary bytes under the old tuple or introduce public binary hosting as recovery. |

Only non-sensitive plan, receipt and read-only observation JSON artifacts are retained, for up to 90 days. Recovery observations use a different artifact name and cannot become an automatic-release baseline. Signing files, IPA/archive bytes, private keys and raw transport logs are excluded. A signed archive is not evidence of Apple processing. A transport exit code is not evidence of successful upload. Processing is not evidence of tester access or installation.

## Signing audit and refresh

`Refresh iOS signing` defaults to `audit`. It verifies the exact existing app, bundle resource, intended certificate type/expiry and profile metadata using GET requests only. It does not create a certificate, revoke a resource, repair entitlements or renew membership.

An approved `refresh` dispatch additionally requires the mutation variable, `confirm_profile_refresh=true`, the protected maintenance environment and attempt 1 of that dispatch. It creates one `IOS_APP_STORE` profile for the exact resolved bundle resource and existing certificate, retains all previous resources, independently decodes/validates the returned profile, then replaces only `testflight/IOS_APP_STORE_PROFILE_BASE64` using the separately scoped maintenance token. It never copies certificate/key values to output. Cleanup removes generated transient files even on failure.

POST requests are never retried automatically. If creation or secret storage fails after submission, the outcome may be uncertain: inspect ASC for `Leafhour App Store <run ID>` and the GitHub secret's update metadata before another approved dispatch. GitHub cannot return the stored secret value; independently validate a subsequent approved archive rather than inferring it from a successful HTTP response. A failed refresh must not revoke the old profile or interrupt another app.

P12/certificate/private-key rotation remains a separate authorized operation. Install and validate the new pair before retiring any old material. Never revoke a potentially shared certificate as cleanup. Membership renewal and Apple agreements are handled by the account holder through explicit approval, not this workflow.

## Pause, rollback and retained-data update acceptance

Pause automatic updates by disabling the release workflow or setting `IOS_AUTOMATIC_TESTFLIGHT=false`; disable the master switch to stop manual publication too. Do not cancel an upload whose Apple outcome is unknown. Record the last trusted receipt.

For a source rollback, revert the problematic change on main, preserve the same distribution Bundle ID/team and require new CI. Publish the restored source as a **new higher build number**. Do not move historical tags, overwrite a receipt, reduce a build number, erase the app or revoke signing credentials. Selecting a previously available TestFlight build can be a temporary tester action, subject to Apple's availability/90-day limit; it is not a guaranteed remote rollback. Expiring a bad build or changing distribution groups is a separate confirmed Apple action.

Before enabling automatic updates, record two real builds on an authorized physical device: install build A from TestFlight; import owned/public-domain EPUB and PDF; save reading position, a note and a draft; retain a verified export; publish build B from a subsequent successful main commit; update through TestFlight **without uninstalling**; reopen and verify original hashes, complete offline content, position, notes, drafts and export recovery. Record device/OS, app/version/build IDs, receipt/run links and actual before/after results. Do not use App Store/Apple credentials in this document. No reading data should enter CI artifacts.

## Official references

- [Apple upload and processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds) — app association by bundle/version/build, separate processing, current Xcode requirements.
- [Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) — tester groups, review and 90-day availability.
- [ASC token generation](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests) and [exact app build uploads](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-builduploads).
- [Apple build number](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion) and [App Store profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/).
- [GitHub workflow_run trust boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) and [deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/managing-environments-for-deployment).
