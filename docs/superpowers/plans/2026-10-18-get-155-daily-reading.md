# GET-155 implementation plan

1. Implement a small shared locked JSON storage primitive and the daily plan/event service, with meaningful failing tests for tenant/grant binding, same-CAS delivery, quiet gates and races. Preserve existing introduction behavior.
2. Add strict owner and narrow scoped-Agent HTTP/MCP interfaces, owner presence tracking and the official-SDK host bridge. Test the actual stdio client and transport cleanup; keep secrets outside output.
3. Mount a separate settings/inbox module in the existing library shell and a small reader presence module. Preserve existing owner fences, focus, paper/night styling and script-size budget; opening settings never generates or schedules.
4. Test rendered user flows and pertinent semantic regressions, register software files in the release allowlist and write truthful configuration/verification docs. The worker must not use credentials, call paid models, create real schedules, write external services or commit.
5. Parent independently reviews and repairs P0/P1, synchronizes main, runs full checks, creates PR, waits for current-head CI/CD and normally merges. After exact-source production deployment, install the authorized host, prove real MCP and labelled station test delivery, preserve the distinct first-scheduled-run boundary, and only then evaluate issue closure.
