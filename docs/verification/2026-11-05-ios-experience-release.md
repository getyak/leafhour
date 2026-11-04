# iOS experience release recovery — November 5

The user requested merge and publication of PR #311. Existing source, local
acceptance and the six independent assessments remain unchanged.

## Runner allocation failure

The original PR CI run `41863616816` completed its web, catalog and release
contract jobs successfully. Its native job `126692876788` never acquired a
runner and was canceled. GitHub's check annotations state:

> The job was not acquired by Runner of type hosted even after multiple attempts

They also identify capacity constraints for macOS arm64 runners. The CI gate
correctly failed for `native-ios: abandoned`; this result was not bypassed.

## Recovery

Use the standard `macos-15-intel` pool for native validation and
`macos-26-intel` for the existing ephemeral archive/upload job. Both labels are
listed in GitHub's [hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [runner image inventory](https://github.com/actions/runner-images).

The OS versions, existing test commands, arm64 simulator compilation, iOS 17
deployment target, Xcode 26+ release requirement, signed app identities,
profile/certificate validation, same-source CI requirement and single-upload
policy remain in place. No new Apple resources, credentials, tester groups or
public binary hosting are introduced.

Cloud CI, merge commit, production verification and Apple processing receipts
are recorded separately in the PR/Actions delivery record after each completes.

Local recovery validation: 113 Node release/CI contract tests passed, 11 Python
release/signing tests passed, pinned actionlint v1.7.12 passed, and an independent
agent review found no architecture-specific host dependency or lost release
guard. The official actionlint archive was verified against its GitHub release
SHA-256 before execution. Cloud results remain separate.
