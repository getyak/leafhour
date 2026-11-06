# GET-273 Touch Selection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current session; perform independent whole-branch review before delivery.

**Goal:** Complete the original mobile selection behavior in the formal Web reader.

**Architecture:** A small native-touch intent controller owns first-selection normalization. Existing reader snapshots and action owners handle the three actions; a read-only source dialog never rerenders prose.

**Tech Stack:** Plain JavaScript modules, browser Selection/Range, Intl.Segmenter, Node tests and synthetic Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-get-273-touch-selection.md`

## Global Constraints

- No model/provider calls, new account data, simulator use, or release configuration changes.
- Preserve native selection/copy, UTF-16 provenance, account drafts, desktop and keyboard behavior.
- Report source, CI, merge, Production and actual iOS acceptance separately.

## Review Focus

- Early taps, scrolling, pointer cancellation and stale selection events cannot expand or reopen tools.
- Handle adjustments after initial expansion are never snapped back.
- Inline emphasis, emoji, CJK and literal Markdown retain exact source offsets.
- Translated/multi-passage source viewing never fabricates original character alignment.
- Session/navigation/disposal cannot retain an old source dialog or pending touch owner.

### Task 1: native-first selection

- [x] Write and run failing tests for sentence offsets, paragraph fallback, stationary hold, scroll/early release, one-shot normalization and handle adjustments.
- [x] Add `app/reader-touch-selection.mjs`, integrating existing `textRange` through a callback; install passive input listeners and invoke normalization before excerpt capture.
- [x] Verify the focused Node tests, including existing real reader input handlers.

### Task 2: three actions and source inspection

- [x] Test exact touch actions, source provenance and cleanup, quote routing, and note draft continuity.
- [x] Add the touch-only toolbar and read-only source dialog; reuse quoteSelection and openPanel('comment'). Add four-locale labels and release allowlist entries.
- [x] Verify source/copy/build checks and synthetic rendered reader at narrow and desktop sizes, with external and model requests blocked.

### Task 3: delivery

- [x] Independent review; fix confirmed P0/P1 and relevant regressions.
- [ ] Synchronize latest main, run applicable checks, publish a supplemental PR linked to GET-273, follow CI through normal merge.
- [ ] Save precise evidence, read back Linear status, and keep unresolved actual iOS/Production acceptance explicit.
