# Library arrival implementation plan

Goal: books first, calendar on demand, one factual daily greeting.
Architecture: preserve the existing library services and owner scope; add a cheap metadata view and bounded arrival summary, then mount a separate bubble beside the existing companion.
Tech stack: existing JavaScript modules and Node test runner; no new dependencies.
Spec: ../specs/2026-10-28-library-arrival-design.md

## Constraints and review focus

Account boundaries and stale results must hold during hydration and greeting. Never infer yesterday's reading mode from today's position. Midnight, DST, overlapping sessions, sparse history and failed network calls must remain truthful. Delayed personalization must not overwrite a user's shelf reorder, focus or filters. Persist only greeting preferences and shown-date markers in browser storage.

- [x] Add failing domain/service/HTTP tests for a metadata-only list and an arrival summary without note text. Implement in server/library-arrival.mjs, server/library-service.mjs and server/portal.mjs.
- [x] Add failing UI tests for deferred calendar work and greeting lifecycle. Implement app/library-arrival.mjs and CSS, portal integration, and on-demand daily inbox. Reuse ui-locale and squirrel position; add four-language copy and the explicit locale owner audit entry.
- [x] Verify isolated tests, copy export/lint, build and browser flow; review whole diff with a fresh reviewer. Fix material findings and record evidence.
- [ ] Synchronize main, commit only this task, push, create/attach PR, wait CI, normally merge, follow Production and verify the deployed commit.
