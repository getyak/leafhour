# Leafhour 阅读位置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在宽度、字号和正文层变化后，重开仍能找到原来读到的文字。

**Architecture:** 使用独立的会话定位模块，封装纯文本段落的字符几何与格式校验。页面缓存逻辑位置，布局恢复不改写讨论上下文。旧像素字段保留作迁移入口。

**Tech Stack:** DOM Range、浏览器原生模块、Node 测试、隔离 Playwright。

**Spec:** `docs/design/2026-10-27-ios-polish/READING-POSITION.md`

## Global Constraints

- 硬截止 2026-10-27 12:00 Asia/Singapore；不调用模型或真实账号，不因发布限流反复部署。
- 固定公版样章；稳定段落、原文/两种译文、讨论/笔记的归属不混用。
- 兼容当前会话键和旧 `readingTop`，不扩大问题和笔记的持久化范围。
- 只改本轮设计目录、该计划和已有的 `tests/ios-design-interaction.test.mjs` 检查入口。

## Review Focus

- 目标靠近书尾、无法顶到窗口上沿时仍可见，不伪造空白内容。
- 反复宽度切换不能让字符锚点逐次向前漂移。
- UTF-16 偏移不能落在代理对中间，不能跨正文层直接套用。
- 旧记录和错误的书/版本/段落须有明确回退，不能制造错误进度。
- 初次恢复和排版变化不能改绑问题、草稿或出处回程。

### Task 1: 会话定位模块

**Files:** Create `prototype/reading-position.mjs`, `reading-position.test.mjs`; update `tests/ios-design-interaction.test.mjs`.

**Interfaces:** `normalizeReadingPosition(raw, identity, text)` returns `{position,sameLayer}` or null; `captureReadingPosition(scroller,identity,passageId=null)` returns a schema-1 locator or null, with an explicit paragraph for user navigation; `restoreReadingPosition(scroller,raw,identity)` returns the canonical locator or null. Identity has `bookId`, `sourceVersion`, `layer`; locator adds `passageId`, `offsetUtf16`, `fraction`, `viewportOffsetPx`.

- [ ] Write failing tests for identity, finite fields, text bounds, surrogate boundaries and immutability.
- [ ] Run pure tests and observe missing-helper assertions fail.
- [ ] Implement the plain-text DOM adapter and normalization; run tests to pass.

### Task 2: 恢复、迁移与真实输入验证

**Files:** Modify `prototype/app.js`, `prototype/style.css`, `verify-prototype.mjs`, `build.mjs`; create `verify-reading-position.mjs`; update README/WORKLOG and evidence.

**Interfaces:** Page persistence writes `readingPosition` beside legacy pixels; startup and layout changes call Task 1's adapter. Discussion state stays independent. Browser verifier seeds only isolated synthetic state and exports a narrow resume screenshot.

- [ ] Reproduce cross-width failure with the original 402→320, 28 px setup and validate its starting paragraph.
- [ ] Add failing checks for layout changes, migration, invalid records and discussion isolation.
- [ ] Integrate cached locators, layout-event suppression and the entry marker; preserve legacy key and pixels.
- [ ] Run new checks plus the original 11 and first-round 14 browser checks, pure CI entry, standalone and actual screenshots.
- [ ] Add a clearly labelled Figma restoration specimen, read it back; do not wire false cross-paragraph states.
- [ ] Obtain one independent review, fix material findings with reproducing checks, then submit through the normal CI/merge gates. Record Vercel quota separately from source delivery.

## Self-review

The adapter owns only reading locators; the page owns storage and gesture intent. The DOM is the fixed prototype's escaped plain-text spans. This deliberately avoids claiming general EPUB or cross-account restoration. Existing discussion and source-return regressions remain required.
