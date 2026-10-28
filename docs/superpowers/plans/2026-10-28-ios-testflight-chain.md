# iOS TestFlight chain implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this authorized implementation. Source delivery is a draft PR; credential configuration, first upload and automatic publication require separate confirmation.

**Goal:** Provide a repeatable Leafhour native iOS archive → upload → Apple processing → trusted receipt chain and safe signing maintenance.

**Architecture:** GitHub CI verifies source without signing. A disabled-by-default release workflow freezes a successful current-main CI revision and its version/build identity, archives and uploads one exact IPA to ASC on the same ephemeral runner, independently polls Apple, and retains only a minimal non-sensitive receipt after an exact VALID build. Signing maintenance, read-only recovery and access audit remain separate. No TestFlight binary is hosted by GitHub.

**Tech stack:** GitHub Actions, Node 22 standard library, Python standard library, Bash, Xcode 26+, existing committed Xcode project. No Fastlane, new backend or paid service is required.

**Spec:** Parent task delegation dated 2026-10-28; `AGENTS.md`; `apps/ios/README.md`. Reference: `getyak/capir` release/signing workflows at `235282ecf176d1caaa6c0202d58d25455426e12c`.

## Global constraints

- Reuse an explicitly verified existing Leafhour ASC app. Never guess IDs or register a replacement.
- Preserve all unrelated work; publish only to `getyak/leafhour`, as a draft PR at this stage.
- Default release, automatic updates, profile refresh and access repair/invitation remain disabled.
- No live credentials, books, private reading data or signing bytes in Git, Notion, logs or artifacts.
- No public GitHub Release or IPA artifact. Archive/upload share one runner; only explicitly allowlisted non-sensitive JSON may leave it for GitHub.
- Credential grants, security settings, agreement acceptance, first upload and enabling automatic release require parent/user confirmation.
- A successful simulator build does not establish signed distribution, Apple processing, tester installation or update retention.

## Review focus

- Stale/foreign CI and feature-branch dispatch must not reach signing secrets.
- A rerun after an uncertain upload must reconcile the exact original IPA/build before any further submission.
- A malicious/mismatched or incomplete receipt must not suppress an update or claim success.
- A profile for another app/team, wildcard, expired certificate or device/enterprise profile must fail before archive.
- Signing refresh must never revoke another application's shared certificate or overwrite an unrelated resource.

## Task 1: Source policy, versioning and Apple confirmation

Files: `scripts/ios/{release-policy,app-store-connect,release,prepare}.mjs`, `apps/ios/release.json`, `tests/ios-*.test.mjs`.

- [x] Test disabled/manual/automatic policy; stale/foreign/failed CI; strict semantic versions; Apple-sized monotonically increasing build numbers.
- [x] Implement short-lived ES256 JWTs, read-only exact app verification and exact iOS version/build upload lookup.
- [x] Test transient retries, terminal failure and processing timeout; preserve an unconfirmed outcome on timeout.
- [x] Bind source, CI run, Apple identity and IPA digest into a trusted receipt.

## Task 2: Signed artifact and maintenance boundaries

Files: `scripts/ios/{archive,upload}.sh`, `scripts/ios/{signing,verify-ipa}.py`, `scripts/ios/{signing-audit,access-audit,receipt-provenance}.mjs`, workflows and signing tests.

- [x] Validate the exact supplied profile and its P12 certificate, archive with manual signing and remove temporary material.
- [x] Keep the original IPA on the same runner, check its digest before/after controlled ASC upload, and reconcile Apple state without a second submission.
- [x] Audit existing resources by default. Explicit maintenance creates one exact profile, validates it and stores it in the existing environment; preserve old resources.
- [x] Implement metadata-only access audit with no invitation/repair mode.
- [x] Wire prepare, combined archive/upload and separate read-only reconciliation jobs with no binary artifact/release; add offline sharing-boundary tests.

## Task 3: Reviewable delivery and operations evidence

Files: `docs/ios-testflight-release.md`, `docs/verification/2026-10-28-ios-testflight-chain.md`, iOS README.

- [x] Document candidate credentials/settings, versioning, concurrency, retries, rotation, rollback and device update acceptance.
- [x] Fresh review, resolve material findings, run current tests and workflow lint (20 Node, 3 Python, actionlint v1.7.12 after the controlled-upload revision).
- [x] Create draft PR #240 from current public main; keep draft and do not merge or dispatch publication.
- [ ] Report exact verified results and pending Apple/security decisions to the parent.
