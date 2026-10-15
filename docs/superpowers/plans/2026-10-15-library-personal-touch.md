# Library personal touch implementation plan

> **For agentic workers:** Use the assigned independent domain tasks with test-first implementation, then integrate and verify the actual browser flows.

**Goal:** Make the paper bookshelf personal and directly manageable, with working gift letters and calendar files.

**Architecture:** Account profile, shelf state, and immutable gift snapshots use the existing durable owner-aware storage boundary. Small browser modules own calendar serialization, book actions, and dragging; existing library/auth services remain authoritative.

**Tech stack:** Native browser modules, CSS, Node.js, existing hosted document store. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-library-personal-touch-design.md`.

## Global constraints

No real test garbage in cloud accounts. No automatic public sharing or deleting real books during verification. Preserve user text, stable paragraph IDs, translations and personal records. Failed or stale asynchronous actions cannot cross account changes.

## Review focus

Account switches during avatar saves and gift creation; concurrent shelf updates; repeated gift acceptance with existing personal translations; unsafe image/metadata and calendar text; accessible dragging alternatives and touch scrolling.

## Tasks

- [x] Profile service, safe provider metadata, editor and bottom-left identity. Files: `server/account-profile.mjs`, `app/library-profile.mjs`, `app/library-shell.mjs`, `deploy/hosted-auth.mjs`, profile tests. Test invalid inputs and owner changes before implementation, then run focused tests.
- [x] Durable shelf state, recoverable removal, restoration and export preservation. Files: `server/library-service.mjs`, shelf tests. Test stale revisions, owner isolation and preserved records before implementation.
- [x] Immutable book gifts and recipient letter. Files: `server/book-gifts.mjs`, `app/book-gift.html`, `app/book-gift.mjs`, `app/book-gift.css`, gift tests. Test privacy, durability, revocation and duplicate acceptance before implementation.
- [x] System calendar serializer and dialog. Files: `app/reading-schedule.mjs`, schedule tests. Verify Unicode folding, text escaping, floating local time, repeated schedules and alarms against RFC 5545.
- [x] Shelf movement and action menus. Files: `app/shelf-order.mjs`, `app/library-book-actions.mjs`, associated tests. Test whole-shelf movement and cancellation before wiring pointer/native drag, accessible move actions and optimistic persistence.
- [x] Integrate routes, strict gift auth returns, profile session state, shelf revisions, static assets and release allowlist. Files: `server/portal.mjs`, `app/portal.js`, `app/home.html`, `server/auth-policy.mjs`, `app/reader-return.mjs`, library CSS and release list.
- [ ] Verify real flows in an isolated local service, seven viewport widths, night, keyboard and reduced motion. Run full deploy verification and independent review; commit only this task, push PR, wait checks, merge, then verify the production source and page flows.

## Execution record

Implemented all modules and integrated hosted entry routes. Independent review found and closed: hosted route allowlist, public-book missing translations, unreadable oversized hosted receive, and offline reorder rollback/account switch status. Focused tests and isolated VM scenarios pass.

The final browser matrix remains explicitly open: the in-app browser disconnected during calendar download verification, and the browser connector plus native fallback could not reconnect. Prior observed sidebar/menu/calendar form and gift-letter browser flows are recorded separately in the acceptance record. Do not label seven-width, touch drag, avatar upload, or calendar import/reminder delivery as passed.
