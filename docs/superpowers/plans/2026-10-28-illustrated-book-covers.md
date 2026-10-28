# Illustrated multilingual book covers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace all 64 public book bindings with the user-approved original printmaking covers and native four-language text, and release them to Production.

**Architecture:** Text-free responsive static WebP artwork indexed by exact edition ID, a separate multilingual metadata table and the existing shared DOM cover renderer. Existing private metadata and records remain intact. Production catalog membership is pinned before generation and checked again before release.

**Tech Stack:** Existing Node ESM, native DOM/CSS, built-in image_gen for original art, @napi-rs/canvas for WebP asset export and visual contact sheets.

**Spec:** docs/superpowers/specs/2026-10-28-illustrated-book-covers-design.md

## Global Constraints

64 live public editions; en, zh-Hans, zh-Hant, ja cover labels. One artwork per public edition. Stable content/records unchanged. AGPL public getyak/leafhour. Existing dirty work preserved via isolated worktree. No production account writes, no Preview deployment, no secrets or raw user books in repository.

## Review Focus

- A Japanese UI-language commit must repaint existing connected covers without changing the book or making model requests.
- Long Japanese/Chinese titles and multi-volume English subtitles must remain readable without hiding their identifying volume.
- Broken/blocked image fetches must reveal a usable native title rather than an empty cover.
- Private/imported or tampered public-looking metadata must never load an arbitrary remote image or overwrite original source text.
- Only the complete current 64-book set may ship; optimized responsive assets must avoid a multi-megabyte initial shelf download.

### Task 1: Original artwork and per-edition manifest

**Files:** Create app/book-covers/*.webp, app/book-cover-artwork.mjs, catalog/book-cover-artwork.json, docs/book-cover-artwork.md; test tests/book-cover-assets.test.mjs.
**Interfaces:** Produces bookCoverArtwork[id] = {src,srcSet,ink,paper}, same-origin /book-covers URLs, and provenance/sha256 of final assets.
- [x] Capture public IDs and preserve four approved sample artworks.
- [x] Generate and inspect remaining 60 artworks with one built-in image_gen call per asset, save each result immediately and retry only failures.
- [x] Add meaningful failing coverage/asset budget validation, then export responsive WebP assets and make the test pass.
- [x] Verify all 64 originals on contact sheets; correct actual defects only.

### Task 2: Four-language native cover rendering

**Files:** Create app/book-cover-labels.mjs and docs/book-cover-localization.md; modify app/book-binding.mjs, relevant cover consumers/styles; test tests/book-binding.test.mjs and tests/book-cover-localization.test.mjs.
**Interfaces:** Consumes bookCoverArtwork and bookCoverLabels[id][locale] = {title,author,subtitle?}. Preserve paintBookCover(cover,book) and synchronous return value; allow explicit locale for isolated tests.
- [x] Research and save Japanese/English/Chinese metadata with sources and volume/attribution distinctions.
- [x] Write and run tests proving locale, unknown/private, unsafe text, failed-art and repaint behavior; observe new behavior fail first.
- [x] Add shared static illustration + native text rendering, bounded locale refresh and CSS that matches approved proportions.
- [x] Run the changed tests and inspect the actual shelf/current-book/detail/gift layouts at desktop and phone sizes.

### Task 3: Review and release

**Files:** Update relevant documentation and docs/verification/2026-10-28-illustrated-book-covers.md; generated copy inventory only when required by current repository checks.
**Interfaces:** Uses completed assets/rendering and existing CI/Production pipeline.
- [x] Run the required CI-equivalent checks and release build; compare source catalog membership with Production.
- [x] Get fresh independent code/visual review and resolve important findings.
- [ ] Commit only this task, push codex/illustrated-library-covers, create/attach PR, wait for CI and normal merge.
- [ ] Wait for exact-commit Production, verify public assets and browser language/layout/fallback behavior, record real evidence and report actual release status.
