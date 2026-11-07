# GET-328 hosted controller — activation preparation, no execution grant

This supplements GET-328 and draft PR #336. It does not change the reader or
close native acceptance. The App and test source stays at public commit
`3869043f6a5cb492ee1a777d9a247d1df7d71041`, tree
`396d83fe5a8231cc14b0a76ff4348ceb2aeb71a9`. The controller has its own reviewed
commit and the resulting x86_64 Products will form a new evidence domain.
The old M4 99-file Products, consumed failed grant, raw reports and blocked
ledger are not inputs to this runner and must not be modified or retried.

## What is implemented

The prepared push workflow is limited to the dedicated once-only namespace and
existing actor kubbot/124379614, with no PR/main/manual trigger and
`contents: read` only. It pins public comment6702281018 and issuer124379614.
That comment is pending/consumed=false; no nonce/ref/grant has been issued.
Ordinary PR CI tests this code; its existing generic arm64 Simulator build on
Xcode16.4/SDK18.5 cannot prove the hosted iOS26 UI path. No Preview is requested:
`vercel.json` retains `deploymentEnabled: {"**": false, "production": true}`
after synchronizing main74cee1e; feature/main branches do not request deployment.

Before checkout the workflow exclusively creates a root and records one
monotonic origin. Admission makes bounded anonymous public GitHub reads, checks
the exact repository, actor IDs, source/controller/workflow/ref/nonce, first
attempt, externally consumed grant, expiry and complete same-ref run history. It first reads the fixed current run
ID, verifies its repository/head/path/actor/attempt, and queries history by that
verified numeric workflow_id. Filename lookup is officially supported but this
sequence avoids depending on first-run filename resolution. History uses only
the exact branch filter so another head/event cannot be hidden by query filters.
An unknown response, missing current run, extra previous run, redirect or rate
limit rejects admission without retry. History is an extra fence, not a durable
one-use ledger. The coordinator must preserve its independent consumption record.

The hosted driver checks actual job labels, ImageOS/ImageVersion, Intel host,
explicit Xcode26.6/17F113, SDK26.5 and the selected installed iOS26.5 runtime.
It requires actual Intel dyld-cache header evidence, then boots a new owned
iPhone17Pro UUID. Unknown inventory/schema/architecture fails closed; no runtime
download, SDK/architecture fallback, signing, token, permission, provider or
paid-runner expansion exists. Installed-runtime path/schema acceptance is still
unproved on an allocated runner; refusal is a possible first-run outcome.

Build is unsigned with two compiler jobs. All executable Mach-O slices/platforms,
QA bundle identities, complete new Products bytes and the actual xctestrun's
Runner env=string1 and paths are checked. Products are moved with their relative
layout into the evidence root, not discarded after hashing. Before tests and
packaging their bytes are compared again. Source and controller checkouts must
stay clean and match their own identities.

The original seven are serial and have one aggregate UI window: normal38/41/54,
AX5 38/41/54, then normal real Files PDF73. Each changes and reads back actual OS
type, cold-stops QA App/Runner, runs one exact selector with one test iteration,
and retains raw command exit, exact test-start evidence, xcresult test tree,
full xcresult and screenshot. Missing/duplicate/unknown test results never pass.
A Failed case with exit65 remains an unclassified test failure: it cannot by itself prove a normal assertion failure. This candidate stops remaining cases after any failed/unclassified case, preserves its raw outcome and marks later cases not-run; it does not invent a retry or relax an oracle.
Original all-audits, native Copy/Paste/reflow/rotation and Files/OCR/last-page/
cold-resume assertions are unchanged. A launched command with unknown XCTest
start remains unknown; later unentered cases remain not-run.

`Supervisor` continuously observes free space, own scratch, cancellation and
phase/global deadlines while each child runs; a fresh observation also follows
exit. Probe failure, free<=3GiB or scratch>=4GiB stops work. Scratch accounting takes the larger of explicit-root bytes and dedicated-VM disk growth from the pre-checkout baseline, conservatively including device data and Xcode writes outside the build root; unrelated OS growth can therefore block the run, never weaken the cap. Only its newly created
process groups are signalled, including children that exit during cooperative stopping. If the leader was already reaped and its numeric group remains, ownership is unknown: it is blocked and never signalled.
The leader and whole group must be absent before a command is considered reaped.
Only the owned simulator UUID is shut down/deleted and read back. Uncertain
creation is blocked, not an absence claim. External hard cancellation can still
prevent recovery or upload; `always()` and VM teardown are not restoration proof.

## Budget and artifacts

70 minutes = bootstrap10 + build20 + all-seven30 + cleanup2 + package1 + upload3
+ reserve4. The steps' maximum timeouts total69; build/UI's 1+2 termination grace
minutes consume three of the four reserve minutes. The origin predates checkout,
phase deadlines share it, and new work stops with six minutes left. Start free
space must be>=8GiB. These are limits, not measurements that this task fits.
The shared Mac's 40,000,000,000-byte cleanup target is separate from this
ephemeral standard runner's advertised disk size.

Only logs/results/products/receipts/fixture are archived from a fresh evidence view. The original start receipt is copied verbatim into receipts; DerivedData Logs and all Products are preserved. Rebuildable scratch intermediates/caches stay in the job root, explicitly excluded and never deleted by packaging. A report identifies
complete or partial evidence. Actual App/debug dylib/widget/Runner/test plugin/
embedded frameworks/xctestrun, full xcresults and screenshots are included.
The tar preserves paths, modes, internal links and hidden contents. A manifest
binds exact tar bytes and every entry. Both tar+manifest together must be<=256MiB;
oversize is blocked rather than trimmed. The package is uploaded unchanged with
three-day retention, within existing storage allowance. A provider refusal is
not permission to raise quota, add credentials or upload elsewhere.

After a separately approved run the coordinator downloads that exact artifact
before expiration, then uses existing Python (no SDK required):

```sh
python3 scripts/ios/hosted_get328.py verify-download \
  --archive /absolute/download/evidence.tar \
  --manifest /absolute/download/evidence.manifest.json \
  --expected-manifest-sha256 TRUSTED_64HEX_FROM_THE_EXACT_RUN_RECEIPT \
  --root /absolute/new-empty-destination
```

Download verification validates safe relative entries, modes, links and bytes;
the destination must be new. Upload success and verified durable download are
separate states. The CLI requires the manifest SHA from the exact trusted run receipt. The coordinator also compares the artifact digest and package
hash with the exact run's receipt/manifest; it must not trust a substituted pair
of tar+manifest just because they agree with each other.

## Canonical PDF change

`ci/fixtures/get328/` reuses the previously verified 243472-byte public-domain
Alice73 PDF verbatim, SHA256
`0e5810fe2dfe46470a388382d3a0149a42bf36e54df354980a312f05483650b9`.
It contains all twelve narrative chapters, 26441 words/811 paragraphs and THE END
across73 pages. Its only metadata identifies Lewis Carroll and the deterministic
public fixture; no real account, upload, credential or private reading data is
included. This avoids Node/npm/canvas downloads and cross-architecture regeneration
risk. It changes neither the PDF identity nor the real Files/OCR test oracle.
It is staged only in the owned QA App Documents immediately before PDF73, never
pre-imported into the library. The original evidence copy remains untouched.

## Execution request remains pending

`activation-request.pending.json` and the pinned public comment are deliberately
invalid authorization: status=pending and consumed=false. No new nonce/ref or
consumed grant has been created. The existing gh login and actual comment author
are both kubbot/124379614. The next ordinary branch push explicitly uses the
existing gh credential helper, without exporting credentials or changing login. Before any activation the coordinator
must review the final actual controller SHA, file manifest, this PR's exact-head
CI and independent review, then approve the concrete single-use material.

The implemented grant channel is a fixed public GitHub issue comment authored by
the coordinator's pinned user ID, containing precisely the JSON envelope consumed
by admission. The sole pending metadata placeholder is [comment6702281018](https://github.com/getyak/leafhour/pull/340#issuecomment-6702281018), created/read back as kubbot/124379614. It remains pending and cannot admit a run. At activation,
the resulting actual activation commit and these exact actor/comment/issuer
pins must be independently reviewed and pass ordinary CI. Only then may the coordinator
publish/update the comment with that commit SHA, fresh nonce/ref, exact runtime,
limits/cases, consumed=true and whole-second UTC expiry, preserve its independent consumed
record, and read back the updated comment before creating the exact new ref
using existing ordinary git authentication. All causal timestamps use
YYYY-MM-DDTHH:MM:SSZ; comment.updated_at must be strictly earlier than
run.created_at. Wait until the published comment update second has ended before
creating the ref; same-second ambiguity is refused, never rounded or retried.
Do not use workflow GITHUB_TOKEN push or trial dispatch to discover permissions;
do not merge just to register the workflow. Failure, cancellation, queue expiry
and unknown result consume that one authorization; no automatic rerun/ref remake.

Official references: [runner images](https://github.com/actions/runner-images/blob/fad015e47059f40cf0786dcb4593384f6a0720d3/images/macos/macos-26-Readme.md),
[Universal recipe](https://github.com/actions/runner-images/blob/a0cebcf751b0569ae75d1abce04f8377877fed1c/images/macos/scripts/helpers/Xcode.Installer.psm1#L131-L166),
[token event rules](https://docs.github.com/en/actions/concepts/security/github_token),
[cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation),
[artifact permissions](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/README.md#permission-loss),
[Apple result bundles](https://help.apple.com/xcode/mac/current/en.lproj/devc38fc7392.html).

## Evidence boundary

All local validation for this PR is bounded, off-device Python testing with
temporary host files/processes and mocked external SDK/API boundaries. No local
SDK, Simulator, native build or seven-case run is authorized in this phase.
The first disabled-source commit9691ee0 passed all six ordinary CI checks in
run42337663411, including81 Python tests; its generic native build was actually
Xcode16.4/SDK18.5/arm64, with no UI tests. This is separate from the prepared
activation head and its own CI.
Actual runtime inventory/boot, x86_64 compilation, original seven, recovery and
upload/download on GitHub are unproved. App/window content-size category direct
readback is still absent in source386, even if these seven eventually pass.
No current-observer-head, physical-device, VoiceOver, real-account, TestFlight
or 95/98 score claim follows from these tests. No merge or deployment is included.
