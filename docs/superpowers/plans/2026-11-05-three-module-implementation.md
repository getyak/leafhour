# Three-module implementation, Mac mini validation and release

> Execute continuously with isolated implementation tasks, test-first changes, one reviewed push per deliverable and root-owned sequential merges. Specification: `docs/architecture/three-module-mac-mini.md`.

The user now authorizes implementation/deployment, Tailscale verification, publication of complete local work, sequential merge of outstanding PRs, and a new TestFlight release. Preserve other applications, existing network entrances, private identities, unrelated worktrees and runtime data. No destructive cleanup or signing-resource renewal is part of this task.

## Sequence

1. Publish and verify the completed local reader UI work separately. Inventory other local branches/worktrees and remote PRs; avoid republishing already-merged work. Root owns all merges.
2. Implement real Web/API/Agent runtime boundaries against the accepted design. Preserve first-paint language/auth, existing HTTP/MCP/iOS contracts, scoped tool calls, original/translation attribution, cancellation and provider uncertainty. Runtime adapters must fail closed for unsupported/unconfigured operations; no health-only placeholder may count as a working Agent.
3. Build repeatable Mac mini deployment and verification tooling. Preserve all existing Tailscale Serve/Funnel configuration, other apps and CI. Use a dedicated Leafhour release/runtime/data/config layout. New private HTTPS entry may use the observed free Serve port 19443.
4. Validate the actual deployed paths with the real `test@cubxxw.com` Auth identity, a bounded public/synthetic acceptance book, no other private users' data, and only bounded explicit provider requests needed for acceptance. Distinguish source/unit, deployed provider, network, physical device and production results.
5. Merge deliverables sequentially only after their current checks/review pass. Verify published source commit. Dispatch the existing Leafhour TestFlight workflow exactly once for final main, then verify Apple VALID and existing internal group access. Never pretend skipped archive jobs created a build.

## Implementation ownership and interfaces

The runtime task owns `apps/{web,api,agent}`, `packages/`, necessary service/adapters, root package/release/build manifests and its tests. The macOS operations task owns `infra/macos`, its tests and host runbook only, in a separate checkout. Root owns cross-task integration, verification records, credentials, actual installations/config changes, PR merge order and release dispatch.

Target launch entry contracts: `node apps/api/server.mjs`, `node apps/agent/server.mjs`, and `apps/web/Caddyfile`. Public Web listens on loopback 18330, API on 18331, Agent health on 18332. Internal execution uses a restricted Unix Socket and task-bound authority; no public Agent RPC. Health/version output is sanitized. Implementers must coordinate any necessary interface refinement before depending on it.

## Preflight rulings

- Mac mini is M4/16GB/macOS26.4 with about 34GiB free and existing apps/builds. Start heavy work at concurrency one and do not remove other data.
- Tailscale is healthy and directly reachable. Existing Serve has twelve entrances and an existing Funnel entrance. No reset/clear or replacement of unrelated entries is allowed.
- The SSH user lacks noninteractive sudo, and protected system service directories are not writable. Tooling must distinguish a user-session trial from system LaunchDaemon installation. Prepare the concrete system install first; obtain operator elevation through a safe interactive path if required, never ask for an OS password in chat or weaken FileVault.
- Cloudflare tunnel management authentication exists, but leafhour.com DNS-zone authority and rollback data still need verification. Keep the existing Vercel origin until the replacement passes its gates.
- Existing Leafhour TestFlight signing is valid. Use the GitHub temporary macOS runner; do not fake its guards or alter certificates/profiles. Latest observed Apple build is 0.1.0 (1.0.70); actual new numbering comes from the release run.

## Verification and progress

Record per deliverable: commit/PR, exact tests, deployment identity, approved data identity, actual network/flow evidence and unresolved conditions. Main CI, current Vercel publication, Mac mini installation, real model calls, Apple processing/internal distribution and device upgrade acceptance remain separate facts.
