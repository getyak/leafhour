# First-paint language implementation plan

Spec: docs/superpowers/specs/2026-10-28-first-paint-language.md
Use executing-plans with focused independent backend/client work and a fresh final review.

- [x] Shared pure hint/initial-decision codec and classic prepaint handoff; failing tests, implementation, green tests.
- [x] Lean hosted/selfhost localized HTML, CSP and runtime templates; HTTP and package tests.
- [x] Singleton seeded initialization and owner/persistence fences; locale/account and slow-load tests.
- [x] Browser first-paint/refresh/reentry probes, existing startup budgets, copy inventory, full CI and independent review.
- [ ] Push/attach PR, wait current checks, merge normally, verify matching production and publish actual receipt.

Local release verification passed: 3,943 tests passed, 14 native/platform cases skipped locally; the required Linux/PostgreSQL and iOS gates run in CI. Pinned copy lint/canaries pass. Independent final review approved with 45 focused checks. Browser receipts and release boundaries: docs/verification/2026-10-28-first-paint-language.md.
