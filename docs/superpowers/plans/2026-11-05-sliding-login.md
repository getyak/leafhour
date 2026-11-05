# Sliding Login Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for server/Web work and the delegated native client task. Steps use checkbox syntax for tracking.

**Goal:** Keep active Web users signed in across 30 idle days and iOS users across 90 idle days.

**Architecture:** Explicit foreground activity renews the existing opaque server session. Browser authentication cookies are issued only at sign-in with a 365-day physical cap, so late activity cannot overwrite a newer login. Token refresh, background requests and failed authentication never renew retention.

**Tech Stack:** Node.js, browser ES modules, SwiftUI and the existing native HTTP client.

**Spec:** `docs/superpowers/specs/2026-11-05-sliding-login-design.md`

## Global Constraints

- Web: 30 idle days. iOS: 90 idle days. Client activity: at most once every five minutes.
- Preserve account, library, private-note, offline and per-session logout boundaries.
- Never revive an expired/revoked session or treat background polling as user activity.
- Existing approval covers implementation and normal repository delivery; other products remain audit-only.

## Review Focus

- A stale renewal racing logout must not revive a session.
- A previous account's delayed response must not affect the current account.
- Unattended visible tabs and background native sync must not renew themselves.
- Legacy cookies must migrate while valid, without silently resurrecting expired credentials.
- Web/native OAuth and email paths must use the same retention policy and cookie serialization.

## Tasks

- [x] Add failing clock-driven hosted/local and HTTP tests for idle boundaries, migration, revocation and cookie renewal.
- [x] Implement shared policy, hosted/local renewal and native OAuth retention; expose the owner-bound activity route.
- [x] Add failing Web activity tests, implement visible-input activity and integrate library/reader entry.
- [x] Delegate native HTTP/lifecycle changes with regression tests; run the native package checks after integration.
- [x] Update deployment documentation; run affected checks and a production build; review the final diff independently.
- [ ] Push one reviewed PR, wait for checks, merge normally, verify production source and track the existing iOS release chain.
- [x] Record all other GetYak project findings and actionable follow-ups in Linear without changing their products.
