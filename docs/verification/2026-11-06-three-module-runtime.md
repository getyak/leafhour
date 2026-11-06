# Split runtime source verification

Date: 2026-11-06. Scope: an opt-in Web/API/Agent runtime foundation and its compatibility adapters. Existing local and Vercel entry points remain available. This delivery does not install services, apply a cloud migration, enable a provider, change DNS or certify a production cutover.

## Implemented source

- Separate loopback API and Agent entry points, a restricted authenticated Unix socket, credential-role checks, an explicit capability list and a public-only Caddy root.
- Persistent admission, input fingerprints, one shared execution lease, fencing, ordered progress, private content-checked staging and quarantine after uncertain provider dispatch.
- API-owned tool closures and current authority checks. Agent-side search executes within the active task rather than waiting for a nested queued task.
- A delivery migration that commits the domain CAS, unique job receipt and final queue event together. Lost acknowledgements reconcile the same receipt; CAS contention reuses the candidate.
- Separate build manifests and an Agent dependency check. Legacy services accept injected adapters while preserving their current ownership, source validation and cancellation rules.

The main sync retains the 2026-11-06 cover scheduling and reading-guide attempt states. An expired or disconnected guide remains uncertain rather than automatically generating again. Code review also reproduced two defects with failing regression tests: an old heartbeat could abort the next task, and a receipt for one domain document could make a rejected write to another document appear saved. Heartbeat failure now targets its own task controller. Receipt recovery checks the account and document key as well as the receipt and result digest.

## Verification

- Node 22.23.4 is used for the checks below.
- 88 affected ingestion, cover, guide and runtime tests passed before the review fixes. The current 24 module tests passed, including both red/green regressions.
- A new test executes the actual delivery migration in a disposable native PostgreSQL cluster. It verifies atomic result/receipt/event persistence, duplicate delivery, cancellation rejection, authenticated-role denial and two processes racing to publish one job into different documents. No configured database URL or real user data is used.
- `npm run check:modules` passed: 15 module source files and 49 Agent dependency files checked.
- `npm run build:modules` passed, including the existing Web build and public asset budgets.
- The maintained copy exporter regenerated its three tracked inventories. Real Vale 3.24.0 and textlint 15.8.0 passed: zero new T1 errors, 371 retained debt alerts, 2,284 retained warnings, no exceptions and no stale bindings. Copy canaries passed.
- The initial full Node run completed with 4,780 tests: 4,766 passed, no failures, 14 skipped. Thirteen skips were missing explicit real copy-tool paths. The final current-source run supplied those paths and included the review regressions and native delivery SQL test: 4,783 tests, 4,782 passed, no failures, one skip. Only the Linux-only pinned Node-license check was skipped on macOS.

## Remaining acceptance and design differences

The queue currently uses the existing `reader_documents` CAS adapter, with large values in private blob references. It is not the dedicated job/event table and `SKIP LOCKED` design. Domain delivery receipts have their own table. The shared queue serializes execution at one task; no multi-tenant capacity claim is made.

Existing business endpoints retain their response contracts and wait through the compatibility adapter. The job events endpoint returns ordered JSON for polling. A general `202 + jobId` admission contract and an SSE replay surface remain future work. API tool closures cannot be reconstructed after process loss; affected jobs fail closed or remain quarantined, rather than replaying a provider request.

Real provider execution has not been accepted for every adapter. No independent dispatch-log service, backup-restore reconciliation, recovery epoch, target-machine isolation, cross-account production drill, old-page asset compatibility, physical iPhone acceptance or TestFlight release is claimed here. These gates remain necessary before replacing the existing production execution path. The split API disables generation when receipt storage or required dispatch durability is unavailable. An isolated local ledger is not an offsite backup.

The implementation plan is retained as a plan. Source tests, PR status, deployment, migration and real-user acceptance are separate facts.
