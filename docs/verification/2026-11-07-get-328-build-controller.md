# GET-328 build controller handoff

This is source preparation for one coordinated build-for-testing window. It is
not a device session, a native test result, or a TestFlight receipt. The controller
does not install or launch an app or run UI tests.

## Entry and exact command

The two implementation files are `scripts/ios/get328_build_only.py` and
`scripts/ios/build_only_budget.py`. The default invocation and `--plan` only print
the fixed policy; they perform no tool probes or artifact registration:

```sh
python3 scripts/ios/get328_build_only.py --plan
```

After the coordinator grants the native lane, use the reviewed clean commit and
the freshly verified **exact active** Xcode Developer directory. Do not execute
this during the current source phase:

```sh
python3 scripts/ios/get328_build_only.py --execute \
  --expected-head <reviewed-full-commit-sha> \
  --expected-developer-dir <verified-exact-active-developer-directory>
```

The private worker entry is bound to the live outer ancestor, running ledger,
configuration digest, controller/helper hashes, exact registered paths and a
single-use claim. Copied environment values do not establish session ownership.
Existing inherited session claims are preserved and verified, never scrubbed to
obtain another lease. A standalone call uses the existing Primary selection and
`dev-ios-session run --timeout 0`. This timeout is for lease waiting.

## Runtime policy

The fixed child command uses `LeafhourGET328CurrentAcceptance`,
`GET328Acceptance`, exact bundle `org.leafhour.get328.acceptance20261107`, jobs 2,
unsigned Simulator `build-for-testing`, and attempt-owned DerivedData/module
cache/xcresult paths. It never switches toolchains or invokes another release
pipeline. Source and resolved SDK/tool paths, versions and hashes are retained;
this is not a claim that every byte of the installed SDK is hashed.

One monotonic deadline starts at the actual child spawn: 1,200 seconds. A
remaining-time bound applies to the whole resource probe chain. Deadline expiry
initiates cancellation; graceful termination and the session owner's final group
teardown can take additional time. The probe samples Data free bytes and allocated
bytes of both owned artifact roots, with no symlink traversal and hard-link
deduplication. Cancellation thresholds are free space **at or below 10.5 GiB** or
new task artifacts **at or above 3 GiB**. These are sampled cancellation triggers,
not OS disk quotas; the build can allocate between observations.

An expired probe can return only an explicitly marked cached measurement with its
original measurement timestamp, to trigger deadline cancellation. Other probe
errors remain errors. Probe timeouts terminate and reap only the controller's own
helper. Leader cancellation requires the still-outstanding child handle plus
matching PID/parent/group/birth identity. Only the existing session owner controls
group teardown; this controller never signals foreign compilers or process groups.

## Entry state, finalization and retry gate

Under genuine ownership, record the selected device's exact entry Booted/Shutdown
state before mutation. Build-only does not boot a Shutdown device for UI preference
inspection. Finalization restores that same state only inside the owned session,
and verifies group quiescence. If leader exit/identity, ownership or quiescence is
unknown, write a minimal blocked record and defer expensive hashing/product
traversal so the session owner can perform its teardown promptly. After the guard
returns, the outer controller makes read-only checks of the session fence, device
state and references to both owned artifact roots. A
successor session or inconclusive observation blocks handoff; it never restores a
device outside its lease.

The task-only stable flock and atomically fsynced ledger live at
`/Users/cubxxw/.local/share/leafhour-reading-evidence/get328-build-only/ledger.json`.
Each real attempt receives fresh registered evidence and products directories.
Running, blocked or malformed prior state refuses another attempt. A conclusive
nonzero build exit can make the gate ready, while remaining a failed build.
Known pre-spawn resource refusal may be ready for a later explicit attempt only
after the required provenance, ownership/restoration and reference checks.
Before any session starts, a separately typed resource refusal records that no
session or build was started; it does not invent SDK, entry-state or restoration
receipts. Unknown exit, ownership, source, restore, signal or cleanup stays blocked.
The controller never retries automatically or clears an unknown ledger.

Retained per-attempt records include `entry-state.json`, `source-sdk-before.json`,
`command.json`, `build.log`, `monitor.jsonl`, `report.json`, `session.log`, reference
checks and `outer-final.json`, or a blocked failure record. Raw exit code, resource
cancellation and final gate status are separate. A pre-session refusal cannot
contain native records that were never observed.

Keep exact Products for the later seven-case acceptance window. There is no
automatic deletion. After acceptance or explicit abandonment, preserve unique
evidence and prove no active reference before `dev-storage-guard remove-artifact`
on only that attempt's exact products root. Evidence, original failures, QA data,
shared caches, other projects and devices remain outside that cleanup scope.

## Verification boundary

Offline tests use fake processes, clock, resources, source/SDK and devices. Probe
and handle tests also create bounded **owned host Python** children; those are not
native builds or device sessions. Controller, budget, protocol, teardown and probe
tests run in the existing Python iOS-host suite. CI uses Linux, so temporary test
roots replace the artifact-parent constant inside tests only; production keeps
the exact `/private/tmp` registration boundary.

The final evidence packet records the reviewed commit, both controller SHA-256s,
actual command fingerprint, raw test counts and review findings. Native build,
seven runtime cases, CI/merge, Apple source mapping and any new distribution are
separate pending stages. Test-only changes do not prove a new release binary.
