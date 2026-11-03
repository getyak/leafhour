# iOS transport recovery and fresh release

Date: 2026-11-03. Base: `af1cf722c2805fdcbdcf61bafc493943dffbf4d8` (reader improvements, PR #303).

## Observed failure

Release run `41633403551`, build 0.1.0 (1.0.55), successfully archived and verified its local IPA. The transport exited 1 after approximately 15 minutes; the following 60-minute independent Apple lookup ended with `not visible`. The sole surviving artifact is the original non-sensitive plan, not a success receipt. Original transport output was deliberately deleted by the ephemeral runner; its precise external error cannot be reconstructed from the earlier generic category.

The uploader and release workflow were unchanged from successful build 1.0.54. Both runs used `macos-26-arm64/20261026.0455`. The signed archive and source checks passed in both. This identifies the failed boundary as transport, without claiming a specific network, permission or validation cause that the retained evidence cannot prove.

Apple's installed `altool` 26.30.4 reproduced the diagnostic-loss defect locally: validating an absent synthetic file with `--output-format json` emitted a launcher banner and plaintext `ERROR` lines with codes 20 and 31. The old whole-output JSON parser reduced these to an unstructured error.

## Change

The diagnostic parser now handles ordinary JSON, launcher-prefixed JSON and plaintext altool errors. It respects escaped/quoted braces, inspects a bounded tail and candidate count, and emits only fixed categories and bounded numeric/known named error codes. Raw messages, credentials, URLs, paths and arbitrary code strings are not reflected. Unknown failures retain an explicit unknown category.

Transport failure is explicitly logged as delivery unconfirmed. The independent lookup is named upload/build confirmation; `not visible` does not imply accepted bytes or Apple processing. No upload flags, credentials, signing identities, timeout, one-submission policy, source/IPA checks or strict receipt rules changed.

## Local validation

- Regression RED: the original 3 diagnostic tests passed; 5 new behavioral cases failed as expected before implementation.
- GREEN: 105 iOS release-helper Node tests and 9 Python tests passed.
- `bash -n scripts/ios/upload.sh` and `git diff --check` passed.
- Actual local plaintext probe now yields codes `[20,31]` and fixed categories only.
- Independent review found no substantive blocker; escaped quotes/braces and a >1 MiB malformed log probe also passed.
- No native application/UI code changed in this recovery; prior native UI acceptance is not counted as rerun here.

## Publication policy and acceptance boundary

The user explicitly requested a new publication after the failed attempt. Build 1.0.55 is not retried or rebuilt. A fresh higher tuple must be selected by the existing verified-main release plan. Only one automatic or explicitly needed manual dispatch is allowed; first inspect automatic release activity to avoid duplicates.

The old 1.0.55 heartbeat was removed because the new publication supersedes its no-new-upload scope. The old reconciliation run `41648368763` performs only GET requests, with archive/upload jobs skipped; it may be ended after checking that boundary to release the shared publisher lock. An unknown upload is never canceled.

New PR/main CI, the matching release plan, Apple COMPLETE/VALID, strict schema-2 receipt provenance, and availability in the existing internal TestFlight group are subsequent acceptance gates. Their exact run/build and results belong to the final delivery record; this local document does not claim a new build is already available or installed.
