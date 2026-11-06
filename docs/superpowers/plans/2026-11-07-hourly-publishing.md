# Hourly publishing implementation plan

> **For agentic workers:** use superpowers:executing-plans in this session; independent whole-branch review before delivery.

**Goal:** one durable entry advances the production Git branch to CI-approved main at most once per rolling 3,600 seconds.

**Architecture:** a local Python/SQLite controller uses existing Git/GitHub credentials and Vercel's existing Git integration. It advances `production` normally (never force pushes), does not create a deployment token/hook or change CI permissions. A single SQLite journal survives process and machine restarts; ambiguous pushes block new work until remote-ref reconciliation. No scheduler installation or Git/Vercel cutover in this preparation PR.

**Tech stack:** Python standard library, SQLite FULL synchronous transactions, Git/gh, existing Vercel CLI for read-only target inspection, launchd template.

**Spec:** `docs/hourly-publishing.md` and GET-314's original rolling-hour choice.

## Global constraints

- Preserve PR260. Current main Git deployment remains active until replacement readiness is proven.
- Existing team `team_nMU4o8gjejVzBhcnMfqgUQbJ`, repository `getyak/leafhour`, domain `https://leafhour.com`; project ID must be independently verified, never guessed.
- Fresh browser access works; old API403 is not proof of no team permission. Current provider CPU pause/402 still blocks production acceptance.
- No new account, billing, token/hook, CI write grant, support message, model call, private library, iOS build or upload.
- Synthetic tests only; no automatic dependency installation. CI on the current head and independent review before normal PR merge.

## Review focus

- Two workers/restarts must not create two reservations or retry uncertain pushes.
- Clock rollback, hour boundaries, delayed acknowledgement and lost/replaced DB must not shorten the interval.
- A stale prepared worker must be fenced after expiry, disable or replacement.
- Only current main with its latest successful CI attempt, correct origin, target project/branch and exclusive Git policy may advance.
- Ref acceptance, provider READY and same-source HTTP verification are distinct states; failed/paused/unknown results cannot be green.

## Tasks

1. [x] Write synthetic SQLite/controller tests first; observe missing-feature failure. Implement journal, rolling interval, leases, durable arming, reconciliation and explicit recovery. Test real multi-process contention and killed-process recovery.
2. [x] Implement narrow Git/gh/read-only Vercel adapter and inactive CLI. Test actual temporary bare Git remotes, subprocess failures and forged/stale source metadata. No production API mutation.
3. [x] Add inactive scheduler/config templates and concrete staged cutover/rollback instructions, including credential proof, seed while branch is disabled, single-entry swap, 60-minute activation hold and source verification.
4. [x] Add cheap Python tests to CI's always-run contract job, preserve existing heavy-job policy and main chain; run applicable tests, actionlint and release checks; independent review and fixes.
5. [ ] Consolidate push/PR linked to GET314, current-head CI and normal merge. Keep issue IP until the single publisher is actually enabled and production verified; record exact remaining external action for main coordination.
