# Visible reading save feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. This session uses the existing native implementation workflow and an independent agent review.

**Goal:** Make the existing reading autosave status and recovery visible at the natural edit position.

**Architecture:** A presentation-only helper reuses the existing status/retry/recover nodes and owns transient UI timers. The original form retains request dispatch, drafts, CAS, owner checks and serialization; its native fields describe the same status before choice enhancement. Local CSS keeps feedback visible without changing dialog geometry or focus.

**Tech Stack:** Existing ESM, CSS tokens, Node behavior tests and the existing frozen-source Chrome fixture; no new dependency.

**Spec:** `docs/design/2026-11-07-get-201-visible-reading-feedback.md`

## Global Constraints

- Reading autosave already exists; do not replace it. Keep normal Save hidden and explicit retry/read-only recovery.
- Show success for1500ms then fade for160ms; errors persist. Timers cannot clear newer messages or another owner.
- Preserve original nodes, 44px touch areas, locale updates, reduced motion and input focus.
- Fresh resource guards, one isolated headless installed Chrome, stop near10.5GiB; no Primary/native/full local build, production/auth/account/model expansion.

## Review Focus

- A stale success/fade callback must not erase a new error or owner state.
- Rendering and locale refresh must not dispatch saves or move focus.
- Keyboard focus must stay visible beside sticky feedback on390px.
- 409 recovery remains read-only and keeps drafts before explicit retry.
- Presentation timers must not become another autosave scheduler.

### Task1: Present the existing save lifecycle in view

**Files:** Create `app/settings-save-feedback.mjs` and `tests/settings-save-feedback.test.mjs`; modify `app/library-reading-preferences.mjs`, `app/library-shell.css`, `release-files.json`, generated copy inventory and verification docs.

**Interfaces:** `mountSaveFeedback({document,status,retry,recover,getOwner,timers,translate})` returns `{root,set(id,params,error),clear(),refresh(),sync(),dispose()}`. It consumes existing nodes and UI messages, produces no business event or request.

- [ ] Add behavior RED for same-node status/recovery, success1500ms/fade160ms, persistent503/409, stale callbacks after newer messages/owner/disposal, and locale refresh without resetting timers.
- [ ] Run the new helper tests before implementation; preserve the expected failure.
- [ ] Implement only presentation, inject a deterministic timer in helper tests; keep the original form debounce timer contract.
- [ ] Attach the helper, reuse existing message IDs and connect native/choice descriptions; render actual saving instead of blank busy status.
- [ ] Run helper, choice, settings and shell checks; record any existing dependency-blocked suites without installing shared dependencies.
- [ ] Use the normal copy exporter and verify unchanged catalogue values/protection. Update the public source allowlist for the new runtime helper.
- [ ] Commit locally, prepare a new frozen component artifact at the full commit, check every input/output hash.
- [ ] Re-run natural503/409 ×1440/390 with no forced button click or manual scroll: error and retry visible, field/group associated, draft retained, read-only409 recovery. Add timer/locale/focus/reopen/late-result checks; preserve all failures and retries.
- [ ] Independently review P0/P1 and scoped visual results; fix confirmed issues with RED→GREEN. Consolidate push to a GET-201 follow-up PR; wait for the latest applicable CI and coordinate merge. Never close the whole parent from this batch.
