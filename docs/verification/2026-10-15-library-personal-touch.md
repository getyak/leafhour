# Library personal touch acceptance — 2026-10-15

Scope: account identity, sidebar details, book menu, durable shelf positions, recoverable removal, calendar export and gift letters. Isolated fixtures only; no cloud test books, real gifts, account changes, calendar events or model requests were created.

## Implemented behavior

- Sidebar has inset selection, fine paper borders, footer actions and an account avatar/name entry. The profile editor crops raster avatars locally and saves the name/avatar under the authenticated owner.
- Book controls appear on hover/focus and remain visible on touch layouts. Menu actions show book information, compose a gift, export a schedule, move the book, or move it to a recoverable trash.
- Native cover dragging and pointer/touch handles reorder the whole shelf, with keyboard/menu alternatives. Server revisions prevent competing writes. Failed optimistic writes refresh or roll back the same owner's prior order.
- Calendar files use floating local start/end times, optional recurrence and display alarms. Opening the file and importing it remains a user action. Serialization follows [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), including text escaping and UTF-8 line folding.
- Gift snapshots contain the complete extracted original, stable paragraph IDs, editorial material and optionally existing translations. Notes, questions, positions, reading sessions, email addresses and private file paths are excluded. The public page opens as an envelope and a framed letter; its package is downloadable and receivable into an authenticated shelf. Existing recipient variants and personal records survive receipt. Revocation stops subsequent access, not copies already downloaded or received.
- Public gifts retain their snapshot until revoked. Hosted receipt rejects reconstructed books above 3.5 MB before any write, because the reader still uses a bounded JSON response; larger packages remain downloadable for local receipt.

## Actual verification

The local service at a separate port used a temporary directory with three synthetic uploads. Root browser observations confirmed the paper sidebar, six-book shelf, account monogram/name, expanded book menu and calendar form. The gift implementer separately exercised opening/folding the letter, keyboard activation, 390 × 844 width, night appearance, reduced motion, receipt and a real chunked JSON download. Restoring that downloaded Walden package into a clean isolated service yielded 585 paragraphs and zero personal notes. Those gift screenshots were displayed during the run, not saved as files.

Automated tests cover profile validation and provider metadata, owner changes, shelf revision conflicts and recovery, archived exports, immutable snapshots and revocation, safe gift auth returns, chunk downloads, public missing-variant merge, interrupted/concurrent receipt, transfer limits and calendar escaping/recurrence/alarms. Independent review reproduced and closed four findings: hosted route blocking, missing public-book translations, oversized unreadable receipt, and offline reorder rollback. Five isolated execution scenarios check rollback and account switches during both failed and successful refresh.

Final focused verification: 71 tests passed, zero failures. After syncing the current main branch, full `npm run verify:deploy` passed: 544 tests, zero failures, one existing platform skip (545 total). The actual SDK runtime initialized 927 files / 9.0 MB without model requests. Public build: 125 files; release allowlist: 289 software files. Earlier runs encountered runtime packaging timeouts during the host interruption and were not counted as passing. A fresh complete run after synchronization resolved those failures. Clean remote CI and deployment checks are also required before merge and are recorded with the PR.

## Remaining UI gates

The in-app browser disconnected during the calendar-download step. Reconnection failed because the browser surface was unavailable; the alternate browser connector failed to load its request policy, and the native fallback could not bind its window. No browser security setting was changed.

The seven-width integrated library sweep, real touch/native drag, avatar file upload/persistence, final keyboard focus after reorder, and calendar UI download therefore remain unverified. No system calendar import or actual reminder delivery is claimed. A menu closed during screenshot capture; an open menu inspected separately remained open and its calendar action worked. No broader stability claim is inferred from those observations. The local real-user reading preview was not changed.

## Release checks

Deployment status and the exact source revision are verified after merge. Production verification is read-only: public page/assets, new hosted-route responses and release identity. It does not create a public gift or modify a real profile or shelf.
