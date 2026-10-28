# Homepage Scroll Motion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement in this session, then request a fresh review.

**Goal:** Deliver visible, reversible scroll-driven motion for the already approved Ambi-inspired homepage.
**Architecture:** A pure homepage-only motion owner creates paused native effects and seeks them from measured geometry. Existing home bootstrap chooses it for the explicit scroll-story surface; the reader and private library stay outside it.
**Tech Stack:** Native HTML/CSS, Web Animations API, requestAnimationFrame, node:test.
**Spec:** `docs/superpowers/specs/2026-10-28-home-scroll-motion-design.md`

## Constraints and review focus

Preserve source text, translations, current actions, DOM/keyboard order, 12px functional type and shared interaction tokens. No new dependency, generation, permissions or persistent data. Cover restored scroll/reversal, short/tall sample cards, language-driven height changes, live reduced-motion changes, pagehide/pageshow and a replaced homepage.

- [x] Add failing behavior tests for progress/reversal, frame coalescing, reduced motion, hidden/unsupported surfaces and disposal.
- [x] Implement `app/home-scroll-story.mjs`, integrate through the existing `home-motion.mjs` entry, and register the public module/release files.
- [x] Add the decorative reading layer and scoped motion/sticky CSS; preserve live content and controls.
- [x] Inspect real scroll sequences in normal-motion browser views, then verify reduced/static/no-JS/private and responsive behavior.
- [x] Refresh copy source mappings, run affected foundation/typography/home tests and runtime/build checks, and obtain a fresh review.
- [ ] Commit/push/attach PR, require complete current-head CI, merge normally and verify the matching formal release and real scrolling.
