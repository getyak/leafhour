# Quiet reading craft implementation plan

Goal: Polish the moments around reading without interrupting the text.

Architecture: Keep bounded library preview and stable paragraph anchors; add a source-validated personal question and a small shared paper companion. Reuse current draft and session persistence rather than creating a second store.

Tech Stack: Node ESM, browser modules, HTML/CSS, node:test.

Spec: `docs/superpowers/specs/2026-10-15-quiet-reading-craft-design.md`

Global Constraints: Current account only, no synthetic personal quotes, no automatic model calls, no automatic dialogs or completion marks, no forced delays, no body mascot or extra body animation. Preserve other chats' work. Task commits contain only assigned files. Parent registers any new static assets and release files. No nested subagents.

Review Focus: Valid source anchors and ownership; no stale asynchronous UI; actual acknowledgement vs local durability; position continuity; quiet visual hierarchy; reduced motion; keyboard focus.

## Task 1: A real question beside the return-to-reading card

Files: `app/library-workspace.mjs`, `app/reading-dashboard.mjs`, `app/portal.css`, `server/portal.mjs` (preview route only), `tests/library-preview-http.test.mjs`, a focused helper test if needed.

- [ ] Add failing tests selecting only the latest valid current-version user question, ignoring wrong book/version/invalid passage/AI origin. Test bounded response and authenticated ownership with isolated data.
- [ ] Enrich the existing preview response with at most one compact personal question; anonymous preview must not read personal records. Keep source excerpt intact. Query only the selected book; never a whole-library scan.
- [ ] Render a modest slip below the current-book excerpt: “上次留下的问题”, actual user text, and a clear link to its original paragraph. Hide completely when absent; truncate visually with an accessible full text if needed. Maintain owner/sequence protection and hide stale question during loading/switch/logout.
- [ ] Ensure question link targets its own paragraph, not resume paragraph, and uses the existing question-note entry. No auto opening before explicit link action.
- [ ] Run focused tests, self-review, commit task files, and write report with exact validation and constraints.

## Task 2: A quiet bookmark and honest save receipts

Files: `app/reading-arrival.mjs`, `app/reading-arrival.css`, `app/index.html`, `app/reader.js`, `app/reading-session.js`, `app/styles.css`, new small pure status/companion modules and focused tests as justified. Do not touch Task 1 files.

- [ ] Inspect current draft/outbox/coordinator contracts. Add meaningful tests for successful acknowledgement, durable local failure, memory-only failure, new input during submission, and final-session pending vs confirmed state.
- [ ] Reuse the paper character drawing as a small shared primitive, with loading book pose and static bookmark ending pose. Put the ending figure only in the explicit ending dialog, visually secondary. No looping animation there; hidden/background and reduced-motion behavior remain quiet.
- [ ] Update note and ending save receipts to reflect actual server acknowledgement and local persistence. Never claim retained locally when persistence failed. Keep new drafts intact when earlier submitted text is acknowledged.
- [ ] Show an accurate final reading-position/session state in the ending dialog without conflating note saves, pending queue, cloud acknowledgement, and in-memory fallback. Continue/close/retry remain usable; no forced waiting or automatic marking.
- [ ] Run focused tests, self-review, commit task files, and write report. Tell parent any new static assets for registration.

## Task 3: Main-agent aesthetic and interaction acceptance

Files: `docs/reading-journey.md`, new acceptance record; parent owns static routes/release manifest and final integration corrections.

- [ ] Review task diffs against the spec after each implementation; independent fresh reviewer for spec and code quality, with parent judging appearance and interaction in the actual page.
- [ ] Run an isolated local server with synthetic data. Inspect 320/390/768/1440 layouts, dark and reduced motion, authentic question return, keyboard focus, save pending/failure/success and close/reopen, selected text, original/translation/parallel anchors, and ending dialog.
- [ ] If a real interaction defect is found, dispatch a bounded fix to its implementer and recheck it. Avoid rebuilding already-correct language switching.
- [ ] Record evidence and limitations, run deployment verifier, inspect whole branch, sync target main, create/update PR and merge on passing checks, then follow existing deployment and verify current assets online.
