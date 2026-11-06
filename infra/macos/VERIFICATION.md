# Operations tooling verification — 2026-11-05

The implementation was checked in an isolated checkout. No remote installation, service bootstrap, Tailscale change, DNS change or production data operation was performed by this task.

| Check | Observed result |
| --- | --- |
| `node --test infra/macos/tests/*.test.mjs` | 15 passed, 0 failed |
| `node --check` for the five production `.mjs` files | Passed |
| `sh -n infra/macos/system-install.sh` | Passed |
| `git diff --cached --check` | Passed before commit |

The tests exercise temporary files, a temporary Unix Socket, synthetic child processes and a fake Tailscale command. They verify incremental Serve ownership, preservation of unrelated configuration and Funnel, collision/concurrent-change refusal, artifact tamper and symlink rejection, private configuration permissions, role separation, drain ordering/timeouts, freeze-before-rollback, log rotation/redaction, environment isolation, signal forwarding and initialization without overwriting credentials.

The full `build:modules` artifact pipeline requires the runtime implementation to be integrated into main, official pinned runtime inputs and an arm64 macOS builder. It has not been executed by this task. Neither a successful launchd installation nor native SDK compatibility, production dispatch, an external ledger acknowledgement, database migration, backup restore, FileVault cold boot, public-origin cutover or physical-device acceptance is claimed here. The root implementation task owns these checks.

The runtime implementer confirmed candidate control is persisted under an API Socket digest, so candidate pause does not pause the old API. The deployment tool uses the agreed POST-only internal control protocol and waits for the returned `inflight` count; it does not infer provider completion from process exit.

The existing front end still uses stable module URLs. Keeping an old release on disk does not prove that an already open page can load every previous resource after a cutover. Cross-version page acceptance remains required before a public-origin switch.

The Chinese runbook was checked with `lieflat-less-ai-tone`. The original detector output, final detector output and all 55 labeled semantic candidates are retained in `verification/tone-*.json`. The review removed decorative semicolons, unified one same-paragraph artifact name and replaced one conclusion preface with a direct statement. Complete technical/configuration/acceptance enumerations were retained. No command, path, environment name, operational requirement or limitation was changed by the wording pass.

## Delivery review — 2026-11-06

Merged public `origin/main` at `754dbf14` into this branch without conflicts. The review checked immutable artifact verification, environment/role isolation, default dry-run commands, private configuration permissions, incremental Tailscale ownership, cutover recovery ordering, launchd registration removal and resource limits. No blocking source finding remained.

The 15 isolated operations tests passed again with zero failures or skips, and all five production JavaScript syntax checks and the shell syntax check passed. `tests/macos-ops.test.mjs` now imports the same suite so the repository's default `npm test` also executes these checks. They still use temporary files, synthetic processes and fake service/Tailscale operations.

The default-suite entry plus the release and CI resource-plan suites passed 25 tests with zero failures or skips on Node 26.10.0. The release allowlist check passed for 1,534 software files, and `git diff --check` passed. This is affected local verification; the full repository suite and remote CI are tracked separately.

The standalone operations source can be merged before the three-module runtime, but building and operating a real release requires that runtime's `build:modules`, `/version`, `/healthz` and authenticated POST-only Unix Socket control contracts. This delivery does not install or start services, execute the native artifact pipeline, change Tailscale, apply a database migration or validate production/physical-device behavior.

## Root build-host fixtures — 2026-11-06

The production build of merged source `76a5466c` failed in two positive user-trial tests because the hosted build runs as UID 0. `initialize` correctly rejects a root caller for user-session trials; the tests had depended on the build host being non-root. Production safety checks, service code and deployment/CI configuration remain unchanged.

A temporary Node 22.23.4 preload that makes `process.getuid()` return 0 reproduced both failures: the controller and service suites had 4 passes, 2 failures and no skips, with the same user-trial guard error. The two positive fixtures now use test-scoped `t.mock.method` only when the actual caller reports root. A separate regression calls the unchanged initializer as root, verifies rejection before the instance directory is created, and checks that its identity mock restores the original function.

After the change, the same controlled root-caller run passed all 7 controller/service tests, including the new root-refusal regression. The complete isolated operations suite and its default `tests/macos-ops.test.mjs` entry each passed all 16 tests with zero failures or skips on Node 22.23.4. The preload is a controlled caller-identity simulation on macOS, not a claim that a new hosted deployment has already passed. No real service installation or production operation was performed.
