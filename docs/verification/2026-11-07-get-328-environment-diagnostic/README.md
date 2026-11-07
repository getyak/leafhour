# GET-328 hosted environment diagnostic: source preparation

This entry prepares one separately authorized, read-only environment diagnostic.
No diagnostic execution is authorized by this document, the pending comment, a
passing source CI, or the implementation itself. GET-328 remains In Progress;
the original seven UI cases remain0/7. No App build, device creation or TestFlight
upload belongs to this entry.

## Why this is separate

The approved original-seven attempts [42341326070](https://github.com/getyak/leafhour/actions/runs/42341326070)
and [42344311588](https://github.com/getyak/leafhour/actions/runs/42344311588) both
stopped at their first `simctl list runtimes --json`, after30 seconds and180.382
seconds respectively, without output. Neither created a device or started build/UI
testing. Each actual42-entry partial archive was restored and independently
verified. Both old comments, consumed records, refs and restored originals remain
unchanged. An empty runtime query is not proof of a missing or incompatible runtime.

The second job reports ImageVersion20260824.0517.1. Its exact
[official inventory](https://github.com/actions/runner-images/blob/macos-26/20260824.0517/images/macos/macos-26-Readme.md)
declares Xcode26.6/17F113, SDK26.5 and installed iOS26.5 simulators. A declared
inventory does not prove this VM's first-launch state, actual runtime headers or
CoreSimulator service health.

## Entry and authority

The only trigger is a new, nonforced push to
`codex/get-328-environment-once/<controller-sha>/<nonce>`, by kubbot/124379614,
attempt1 in public getyak/leafhour. There is no PR/main/manual entry.
`contents: read` is the only configured permission.

The new fixed [comment6703465445](https://github.com/getyak/leafhour/pull/340#issuecomment-6703465445)
is a separate channel created on PR340 before batching this new PR's first push.
It has scope `GET-328-hosted-environment-diagnostic`, pending/consumed=false,
and no nonce/ref/times. It cannot admit a job. Neither consumed original-seven
comment is reused or edited. The matching pending contract is in
`activation-request.pending.json`; its public envelope has exactly16 fields.

After a final SHA, complete file manifest, independent review and applicable CI
have been reviewed, only the coordinator may approve another concrete once.
That later operation must durably create its exclusive consumed record before
publishing its consumed comment, read back exact bytes/author and strict UTC
ordering, then create its exact ref once. This code only reads admission; it
cannot consume grants, create refs or rerun Actions.

Admission binds the public current run first, then requests its numeric
workflow's complete branch-only history without head/event filtering. Exactly
one first-attempt run and one assigned standard Intel job must match. Public
comment ID/author, repository, source/workflow SHA, read-only scope, exact probe
list, empty cases, all limits and whole-second timestamps are checked. A
same-second comment update/run creation, pagination, unknown API result, old
grant, changed image or mismatched code closes the entry.

## Shared boundary

The first exclusive stamp precedes source acquisition. Its one monotonic clock
sets work cutoff at t0+240 and total cutoff at t0+330. The first finalization
also has at most90 seconds, clamped to that same330; phases and process changes
cannot reset it. Every owned command has at most20 seconds including its
termination and receipt reserve. The six-minute Actions job is an outer bound,
not a fresh budget for each step.

The actual standard macos-26-intel host must report x86_64, ImageOSmacos26 and
ImageVersion20260824.0517.1. A changed image stops before tool/runtime probes.
Start free space is at least8GiB; the existing3GiB free floor and4GiB growth
bound remain. Collected output, snapshot and archive remain bounded; the
combined tar and manifest cannot exceed32MiB and retention is exactly3 days.
Unknowns, nonzero exits and cancellation close new work. Only bounded owned
finalization may follow. Reaped leaders never license signalling a reused
numeric group. Failed recovery remains unknown.

## No-post source acquisition

Standard checkout actions register post-job work that is outside the worker's
deadline. This workflow instead includes readable, generated copies of the
reviewed core and bootstrap, with byte-for-byte source tests. It performs no
checkout action and has no action post entry.

The bootstrap fetches only six controller files plus the pinned official
uploader from immutable public source URLs, using one bounded owned curl per
asset. All expected sizes/hashes are literal in the reviewed workflow. Files
are published only after no-follow, ownership, exact byte/hash and no-clobber
checks. No App, test bundle, book or runtime is downloaded. The first stamp,
manifest, source receipt and ready receipt share the same identity and clock.
The collector rechecks this closure before admission/probes.

`scripts/ios/render_get328_diagnostic_workflow.py --check` verifies the generated
workflow against these exact sources. Regeneration is source preparation only.

## Observations

After admission, the serial plan reads:

1. Selected Xcode version plist, SDK settings and SDK target declarations.
2. Explicit existing CoreSimulator runtime directories, registration metadata,
   bounded runtime plists and cache header bytes. SDK support is not presented
   as runtime compatibility, and absent candidate files do not prove global absence.
3. Tool help, then a single `-checkFirstLaunchStatus` only if the actual help
   advertises it. No first-launch repair, license acceptance or download.
4. A service status query, bounded recent CoreSimulator logs and owned worker
   process metadata. No service start/restart, device create/boot or global kill.

Passive tool/runtime reads also run in separate owned Python children under the
same20-second supervision. No `simctl list runtimes/devices` is retried. Every
later observation is explicitly not-run after an unknown; no fallback platform,
runtime, architecture or paid runner is selected.

## Artifact capability and evidence

A dependency-free local Node24 action receives the normal existing Actions
artifact capability and starts the Python worker. Only an explicit environment
allowlist reaches that worker. Native/API children receive no runtime credential.
The official uploader is fixed at commit
`ea165f8d65b6e75b540449e92b4886f43607fa02`, `dist/upload/index.js`,5051718 bytes,
SHA256 `0165b8a75330f3228f2c7a234b4ff8a107b9139c2b519147f4c8e9fe99b262d8`.
Its runtime inputs are explicit; no npm install, new token, OIDC or permission
is introduced.

The official bundle can emit signed-URL masking commands to stdout. Its stdout
and stderr therefore go directly to DEVNULL; raw provider output is never
written to a log. Only a unique owned GITHUB_OUTPUT file is parsed, requiring
exactly artifact-id/digest/url, no duplicate or extra fields, and exact repo/run
binding. Exit0 alone, or valid-looking output after a deadline, cannot establish
upload success. There is only one uploader invocation. The pinned library's
internal HTTP retry/backoff exists, but it cannot extend the outer20/330 limits;
this entry does not claim HTTP is retry-free.

Probe/API bytes are frozen before the sensitive uploader control file exists.
The legacy evidence implementation is loaded in a fresh private module policy
with32MiB/20-second limits; its canonical256MiB module and source are unchanged.
The payload contains logs/receipts and honestly remains partial relative to
App acceptance. Packaging uses a child under the common deadline. The operator
must download the actual artifact and verify its provider digest and the exact
job's trusted manifest SHA before restoring every actual entry.

Failures before verified source/uploader readiness, exhausted time/resources or
unknown upload can leave only job logs and partial local evidence. The entry
does not claim an archive was produced or finalized in those states, clip an
oversize archive into apparent completeness, or automatically re-upload.

## Validation and remaining evidence

Host tests use synthetic files, virtual clocks, tiny owned Python/Node workers
and explicit network-deny guards. They verify code boundaries, source generation,
clock/ownership/cancellation, API evidence,32MiB packaging and secret exclusion.
They do not run Xcode/CoreSimulator, contact the artifact service, prove this
runner's actual environment or count as the original seven UI cases.

Latest exact source test/review/CI results are recorded in this PR and its
durable handoff. No actual diagnostic, new original-seven run, deployment or
Apple upload has been authorized by this source-preparation change. Hourly
publishing remains OFF; the separately handled public beta deployment is not
touched here.
