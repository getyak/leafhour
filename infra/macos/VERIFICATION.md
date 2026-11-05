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
