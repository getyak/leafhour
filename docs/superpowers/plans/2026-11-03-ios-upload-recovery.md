# iOS upload recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and requesting-code-review for the final independent review.

**Goal:** Publish the completed reader improvements in a fresh higher TestFlight build and confirm availability to the existing internal group.
**Architecture:** Preserve the current source/IPA/Apple identity gates and one-submission policy. Repair diagnostics at the transport boundary before one fresh release; a failed/uncertain old build is never rebuilt or reuploaded under its previous tuple.
**Tech Stack:** Node.js 22, bash, Apple's installed altool, existing GitHub Actions/ASC release flow.
**Spec:** User request on 2026-11-03: complete a new release, republish, resolve and optimize the failed delivery.

## Global constraints

- Preserve unrelated files and the existing Apple app, signing, source provenance and strict receipt allowlists.
- Do not print raw transport output, credentials, JWTs, URLs, private paths or arbitrary server messages.
- One upload attempt per new run; no retries of build 1.0.55 and no success claim without independent Apple confirmation.
- Main-only automatic publication; no preview or duplicate manual/automatic dispatch.
- Routine publication is authorized; actual new legal/security/payment decisions retain their specific requirements.

## Review focus

- Plaintext Apple errors and launcher-prefixed JSON must produce actionable enums/codes without leaking arbitrary content.
- Braces, quoted JSON strings, malformed output and credential-looking fields cannot confuse extraction or appear in output.
- Missing Apple visibility after an upload error is an unconfirmed delivery, never described as successful processing.
- Interrupted or delayed receipt lookup must not authorize another upload of the same tuple.
- A real Apple VALID build is separate from actual availability in the existing internal TestFlight group.

## Tasks

### 1. Transport evidence and diagnostic repair

- [x] Compare the last working release against failed 1.0.55: identical uploader and macOS runner image; archive/signing passed, transport failed after approximately 15 minutes.
- [x] Reproduce official installed altool output using an absent synthetic file: despite `--output-format json`, launcher preamble and ERROR lines are plaintext, including numeric codes 20 and 31. The existing parser discards all of this as unstructured.
- [x] Add regression tests in `tests/ios-transport-diagnostics.test.mjs` for actual plaintext shape, prefixed JSON, network/auth failures and non-disclosure; observe RED.
- [x] Repair `transportDiagnostics(text)` in `scripts/ios/transport-diagnostics.mjs` to parse bounded known shapes and emit only existing/new fixed enums and numeric codes; preserve structured handling.
- [x] Clarify upload-versus-Apple-confirmation log phases in `scripts/ios/upload.sh` and `scripts/ios/app-store-connect.mjs`, without changing the one-attempt or independent verification policies.
- [x] Run affected Node/Python tests and shell checks; review the complete change, then document evidence and limitations.

### 2. New release and acceptance

- [ ] Sync main, commit/push the complete batch, create PR, wait affected CI and normally merge.
- [ ] Observe the single resulting automatic release. Once ready to publish, release any obsolete read-only reconciliation job after verifying it has no upload/signing activity; never cancel an unknown upload.
- [ ] Verify the new plan/source/build, Apple COMPLETE/VALID and schema-2 receipt provenance. Diagnose a fresh failure from improved evidence before any further new build.
- [ ] Confirm the exact new build in the existing internal TestFlight group, handle authorized routine release confirmations, record final status and notify the user.

## Known limit

The old raw altool output was intentionally removed by the prior ephemeral runner. Its precise external failure cause cannot be reconstructed from the old enum-only log. The diagnostic loss is reproducible locally; recovery of the actual delivery is established only by the new release's result.
