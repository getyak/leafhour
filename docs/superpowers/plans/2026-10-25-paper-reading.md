# Quiet Paper Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship quiet facing pages, typographic chapter openings and interruptible soft page turns without disturbing readable text or saved positions.

**Architecture:** Keep reader-pagination as the single navigation owner. A small motion state machine owns gesture/spring progress; a separate DOM adapter renders a bounded temporary bent leaf. Existing flow headings become the chapter-opening surface in page mode.

**Tech Stack:** Existing Node/ES modules, native HTML/CSS, Pointer Events, requestAnimationFrame, node:test. No added package.

**Spec:** `docs/superpowers/specs/2026-10-25-paper-reading-design.md`

## Global Constraints

- Keep the existing scroll/spread choice, saved layout, account preferences, paragraph IDs, original text and separate translation variants.
- No runtime dependency, automatic image generation, model request, private-note access, source rewrite, new billing work, or changed data ownership.
- Only completed turns commit a page/position; reduced motion bypasses snapshots and animations.
- Preserve other conversations' uncommitted work in the original checkout. Deliver only this branch's changes through public getyak/leafhour and normal CI/main Production.

## Review Focus

- A rapid opposite input or a second drag during spring settling must start from the displayed progress and never double-commit.
- Resize, mode/chapter/session change, pagehide and disposal must invalidate every late frame and release pointer capture.
- A paragraph split across columns, a long first paragraph, or a narrow chapter opening must retain its source position and all text.
- Text selection, links, controls, composing input, a dialog or open notes must not become a page gesture.
- A large chapter or denied snapshot capability must stay readable; temporary copies must never add accessible text or duplicate IDs.

---

### Task 1: Motion ownership and soft-leaf geometry

**Files:** Create `app/reader-page-turn.mjs`; create `tests/reader-page-turn.test.mjs`.

**Interfaces:** Produces `createPageTurn({requestFrame,cancelFrame,onPaint,onCommit,reducedMotion})`, with `turn(direction)`, `grab(direction)`, `drag(progress,velocity)`, `release(cancelled, {elapsed})`, `cancel()` and `dispose()`. Paint state is `{progress,direction,active}`; commit receives direction exactly once. Produces `leafSegments(progress,width,count,direction)` with contiguous segment transforms for a curved, constant-length leaf. The DOM adapter consumes these functions in Task 2.

- [x] Write behavioral tests for pending versus committed turns, cancelled/reversed drags, immediate reduced motion, superseded frames and disposal. Name each failure before implementation.
- [x] Run `node --test tests/reader-page-turn.test.mjs`; observe the missing behavior fail.
- [x] Implement the state owner and curved-leaf geometry, without reading text or making network calls.
- [x] Run the same tests and the existing pagination tests; require green.
- [x] Commit only these modules/tests plus the approved design and plan.

### Task 2: Live reader integration and paper layout

**Files:** Create `app/reader-page-surface.mjs`, `app/reader-page-inputs.mjs`, `app/reader-paper.css`; modify `app/reader-pagination.mjs`, `app/reader-pagination.css`, `app/reader.js`, `app/reading-flow.css`, `server/server.mjs`, `tools/build-reader-web.mjs`, `release-files.json`; extend `tests/reader-pagination.test.mjs` where navigation ownership changes.

**Interfaces:** Consumes Task 1. Produces `mountReaderPageSurface({document,viewport,text,getGeometry,isBlocked,onTurn})` with `turn(direction)`, `cancel()`, `sync()`, `dispose()`; `getGeometry()` returns `{page,step,count,columns,gap}`. A successful turn asks the existing pagination owner to perform its immediate page transition. Chapter-boundary navigation continues through the existing owner.

- [x] Add failing regression coverage for an unfinished turn invalidated by navigation/reflow and for selecting/editing/modified keys not initiating a turn.
- [x] Implement the bounded inert snapshot adapter and page-edge drag handles. Route button/key turns through it; cancel on ownership/layout changes and document hiding. Keep a direct fallback for unsupported/large/reduced-motion cases.
- [x] Style facing paper pages, gentle gutter/edges, quiet footer, and the first flow heading as the chapter opening. Keep narrow openings compact and overlays from resizing paper.
- [x] Register the modules in local serving, the web bundle and release allowlist; regenerate copy evidence only if scanned source bytes change.
- [x] Run focused pagination/motion/reader locale and navigation tests, then inspect the actual browser at 390, 768 and 1440 pixels, including selected text, settings, font changes, night and reduced motion.
- [x] Commit the integrated behavior and verified layout.

### Task 3: Verification and normal release

**Files:** Create `docs/verification/2026-10-25-paper-reading.md` and public synthetic-book evidence as useful; regenerate `docs/copy/` outputs if required.

**Interfaces:** Consumes the complete live reader from Task 2. Produces a reviewed PR with CI, merge and same-commit Production evidence recorded separately.

- [x] Run `npm test`, the pinned copy lint/canaries, hosted build and applicable release checks. Resolve introduced failures; identify baseline/environment failures by actual evidence.
- [x] Request one fresh whole-branch review against the spec, plan, diff and Review Focus. Fix important findings with regression evidence.
- [x] Record real test/browser results and limitations; verify the original checkout's saved file hashes remain unchanged.
- [ ] Synchronize main, push this task branch, open/attach a PR, wait for current-head CI and merge normally. Do not request or wait for Preview.
- [ ] Wait for Production and verify the deployed source commit and online reader behavior. Report implementation, merge, deployment and acceptance accurately.
