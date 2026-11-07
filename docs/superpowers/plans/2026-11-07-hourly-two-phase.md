# Hourly publishing two-phase implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this one bounded batch and an independent whole-branch review. No production execution in this phase.

**Goal:** Let normal main merges accumulate after a reviewed main-off PR, then safely establish the sole durable publisher without requiring main to equal the healthy legacy source.

**Architecture:** Phase A changes the Git policy to production-only. Phase B pins current main M separately from healthy legacy L/deployment D, initializes disabled state before a durable seed request, reconciles all unknown operations, changes Branch Tracking, and enables a fresh 3660-second hold. Runtime publication still requires current-main CI success and atomic no-force CAS.

**Tech Stack:** Python standard library, SQLite, existing gh/Vercel CLI; no new dependency or credential.

**Spec:** `docs/hourly-publishing-cutover.md` (revised two-phase contract).

## Global constraints

- Only source, lightweight offline tests, independent review and existing Draft PR updates are authorized now. No main merge, real ref/protection/settings/state/scheduler/deployment actions.
- Preserve immutable legacy L/D and the single DB/witness/lock. Unknown never retries or unlocks on time, restart, or a new main SHA.
- Minimum publication hold is 3660 seconds; enable establishes a fresh full hold after all legacy/bootstrap work settles.
- PRs have no Preview. Latest-head applicable CI is required; skipped jobs are not acceptance.
- No large local build/UI work while resource cleanup is ongoing. Normal main writers need no hour-long freeze.

## Review focus

- A main merge between preflight and seed CAS must not select a new legacy source or publish it.
- A lost seed/Branch Tracking reply must survive process exit and DB rollback without permitting another request.
- Empty active queues alone cannot close an externally known unknown request; reconcile known receipts as well as the full provider inventory.
- Late legacy requests after main-off must block enable/publication, rather than silently replacing the legacy baseline.
- Provider fields, ownership, pagination and source mismatches fail closed.

### Task 1: Dual-pin bootstrap and durable cutover

**Files:** Modify `tools/hourly_publisher/{ports,state,controller,cli}.py`; create `tools/hourly_publisher/bootstrap.py`; update the three Python test files and production-trigger tests; revise `docs/hourly-publishing*.md`, `docs/ci-resource-budget.md`, `AGENTS.md`, and review-only `deploy/hourly-publisher/cutover-plan.json`.

**Interfaces:** `ref_request(..., create=True, expected_main=M)` requires M separately; `RuntimePort.staging(M,L,D, production_branch='main')` checks M's exclusive policy and L/D's real READY/own CI/public health. `Journal.create(..., bootstrap=receipt)` stores immutable handover; `Cutover` owns seed and tracking state transitions. Runtime tick remains current-main/green only.

- [x] Write and run meaningful REDs for the old single-pin create and enable's unnecessary main-CI dependency; add dual-pin, ownership/inventory, durable unknown and rollback cases.
- [x] Implement strict source/legacy checks, fully paginated provider inventory and baseline comparison. Bootstrap accepts M!=L and pending M CI; legacy own CI must be green.
- [x] Initialize disabled state before seed. Persist immutable L/D/inventory and seed/tracking intents to independent fsynced witness before side effects. Unknown only reconciles read-only; no transparent reset or new source.
- [x] Revise the executable order: reviewed main-off merge first; settle old requests; init, seed, tracking, enable fresh hold, sole scheduler, two real windows. Retain historical unthrottled gaps as history.
- [x] Run bounded Python and affected Node tests, JSON/plist/allowlist checks; independent review and fix actual important findings with RED/GREEN evidence.
- [ ] Integrate latest main normally, commit one completed batch and push once to Draft #338. Wait for exact-head applicable hosted CI; keep real cutover unexecuted and GET-314 In Progress.

Ruling: execute the already requested native/offline method without another generic design-approval round; the coordinator reviews the concrete Draft and execution window. If wrong, only reversible worktree/Draft material changes.
