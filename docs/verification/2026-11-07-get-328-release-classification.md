# GET-328 release classification and build-only handoff

This follows the source-only [phase-A checkpoint](2026-11-07-get-328-preparation.md)
at `33bfa919`. No native build, lease, install, UI run, upload or provider setting
change is authorized by this document. Other projects retain the scheduled lane.

## Small release-classification change

The old automatic path considered every `apps/ios` test/config change a reason
to archive again. After the existing exact-main CI and trusted Apple receipt
verification, preparation now classifies the actual receipt-to-head comparison.
The existing manual publish, channel, provenance, signing and single-upload gates
remain in place. No provider variable, permission or workflow is changed.

The three mixed files have a **finite, reviewed before/after Git blob proof**:

| File | Before blob | After blob |
|---|---|---|
| `apps/ios/project.yml` | `6f4f1640cecae45e2ee86f692df8bdeb840ac640` | `026bfb94225bb058ceb725147f3678cd2df3d5a8` |
| `apps/ios/Leafhour.xcodeproj/project.pbxproj` | `7020d4306d650f6d8680b77e055c213727295e03` | `5c0645ea7ce691dd3e98d37a4eaa48da66f66c7b` |
| `apps/ios/Leafhour/VideoAcceptanceFixture.swift` | `352f1e568158996348fdef37d69746b2e46a07fd` | `d37c67f3ccfff4ab4ea6cc52d978b9f0e081fbd7` |

Independent review and phase-A metadata readback established that these exact
project changes preserve all ten existing Debug/Release configuration objects,
the default archive scheme and app metadata. The factory change is inside
`#if DEBUG`; its Release branch still returns nil. This proves the reviewed
Release behavior/configuration equivalence, not byte identity of a hypothetical
new IPA or a new Apple/source mapping.

For each mixed file, automatic skip requires `modified`, no rename, exact head
blob and exact baseline file/type/path/blob fetched at the **trusted receipt
commit**. There is no Swift/YAML/PBX regex stripping or general project/DEBUG-file
exemption. A new product or configuration edit does not inherit this proof.

The current archive-layout contract also excludes UI/App/Core tests, verification
images, the three exact GET-328 QA config/Info/scheme paths, host tests, known
web/service/prose paths and the exact preparation/classifier decision helpers.
These do not enter the current default Release archive. A future build graph
that consumes those paths must update the classification in the same reviewed
change. Archive/signing/upload/provenance helpers, native source/metadata/assets,
vendor/dependency inputs, CI and unknown paths stay release-relevant.

Renames consider both paths. Missing/malformed comparison entries, 300-file
truncation, diverged history or a different comparison/merge base cannot prove
equivalence and preserve the conservative release decision. Baseline API read
errors fail preparation before any plan is written; they do not authorize a skip
or an unnecessary upload. The classifier is standalone Node code and uses only
the existing GitHub `contents: read` capability.

## Actual host evidence

- Before implementation, the real `prepare()` integration harness ran **55
  tests: 41 passed / 14 expected failures**, exit 1. It exercised actual ZIP
  digest/decoding, trusted source/CI provenance and isolated plan-file writes.
- Final complete affected Node suite: **224/224 passed**, 0 failed/skipped,
  `node --test --test-concurrency=2 tests/ios-*.test.mjs`, exit 0.
- Historical pre-controller Python signing/release check: **11/11 passed**,
  exit 0. After adding the build controller, the same full host-suite command,
  `python3 -m unittest discover -s tests -p 'test_ios_*.py'`, passed **128/128**,
  including 117 new controller/budget/protocol/probe/teardown tests, exit 0.
- Counterexamples cover mixed product/tests, both rename directions, every
  mixed-file unknown head/baseline/status/type/path, Release/Info/assets/vendor
  changes, CI/dependencies/unknown inputs, incomplete/diverged comparisons,
  permission failure, invalid receipts, manual publish and exact-main CI guards.
- Independent source review found one P2: a test incorrectly froze live files
  to historical hashes. The test now uses immutable historical metadata, while
  unknown future blobs and a real Release-code append remain relevant. Final
  review found no unresolved P0/P1/P2. No native compiler or runtime was used.

The resource audit reported roughly 13 GiB free and exit 2 with shared-host
warnings; its device inventory is not a build-session entry receipt. This phase
performed lightweight host checks only. Preserve the earlier source/host evidence
and all original native failures. Hosted CI and live receipt classification are
still unrun for this branch.

## Accurate first-window command and limits

Only after the coordinator hands off the lane: one build-for-testing, jobs 2,
20-minute child cancellation deadline; estimated cold duration 10–25 minutes, final Products
0.3–0.8 GiB, total incremental build/cache 2–4 GiB. Proposed task monitoring
limits are 3 GiB of new task artifacts and 10.5 GiB Data free. These are forecasts
and cancellation limits, not an OS disk quota. The task-owned controller and
its source-only verification are described in
[the build controller handoff](2026-11-07-get-328-build-controller.md).

`dev-ios-session --timeout` controls **lock waiting**, not child runtime. The
controller measures from its actual build child's start and initiates cancellation
at 1,200 seconds; identity checks, graceful termination and owner teardown are
separate. It preserves the existing session guard's sole authority over the child
process group. The following is an offline plan only:

```sh
cd /Users/cubxxw/.codex/worktrees/get-328-current-acceptance/leafhour
python3 scripts/ios/get328_build_only.py --plan
```

Fresh source, resources/pause/audit and lane checks precede this. Record the exact
entry **Booted/Shutdown** before a state-changing action; restore that state in
finally and read it back, even after timeout/cancellation. Do not boot an
entry-Shutdown device to read UI preferences during build-only. The later UI
window restores size/appearance/orientation as well, before restoring Shutdown
when that was its entry state. Nothing is changed for the next task's convenience.

The older registered build roots were reservations and have not been used. The
controller allocates fresh registered evidence/products roots per real attempt;
its actual records and deferred execution command are in the controller handoff.
Actual container paths and snapshots remain unknown/uncreated. The later
seven-case window separately proves the exact
QA identity/ownership and snapshots task-owned data before installation/reset;
an unexpected existing container or active process aborts without overwrite.

## Cleanup allowlist

Keep the exact Products for the later seven-case window. After acceptance or
explicit abandonment, verified retention of unique evidence and absence of live
references, only that attempt's registered rebuildable products root is initially eligible:

```sh
dev-storage-guard remove-artifact <exact-products-path-from-that-attempt-ledger>
```

The formal build root, preparation evidence, original failures, container backups,
source worktrees, shared dependencies/caches, simulators and other tasks' products
are outside this initial whitelist. No cleanup has run. PR/native CI, the seven
runtime scenarios, Apple mapping and any distribution decision remain separate.
