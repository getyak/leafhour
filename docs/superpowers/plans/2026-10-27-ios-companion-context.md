# Leafhour 陪读上下文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新提问跟随正在读的段落，已有讨论和草稿保留原引用，入口明确两者。

**Architecture:** 纯模块决定入口与引用关系，页面保管讨论生命周期。现有 quoteIdentity 格式保持兼容，显式讨论意图单独保存。显示更新只改上下文提示与按钮，不在阅读滚动时重建回答或重置其位置。

**Tech Stack:** 原生浏览器模块、CSS、Node 测试、隔离 Playwright、免费 Figwright。

**Spec:** `docs/design/2026-10-27-ios-polish/COMPANION-CONTEXT.md`

## Global Constraints

- 硬截止 2026-10-27 12:00 Asia/Singapore；不付费调用模型或写真实账号数据。
- 不静默改绑已有问题、草稿或未完成提问；只选文字不改变讨论。
- 固定样章和讲解示例保持标注；不伪造用户问题或完成状态。
- 保留现有会话键、quoteIdentity 格式及阅读定位模块；只改本轮设计目录、计划和既有测试入口。

## Review Focus

- 初始占位引用与真正建立的讨论必须区分。
- 新草稿与另一段的未完成提问同时存在，不能互相覆盖。
- 只选文字和显式点解释是不同动作；后者的范围重开后仍保留。
- 切换到当前段后，旧问题及草稿可按原引用找回，状态不能被伪造。
- 半屏正文滚动或版本变化只更新提示，不能重置回答滚动、草稿或键盘焦点。

### Task 1: 入口与引用决策

**Files:** Create `prototype/companion-context.mjs`, `companion-context.test.mjs`; update `tests/ios-design-interaction.test.mjs`.

**Interfaces:** `quoteIdentity(quote)` retains the existing six-field JSON identity; `resolveCompanionContext(input)` returns mode, label, quote clone, relation and canAskCurrent. Input contains readingQuote, discussionQuote, discussionStarted, draft, question and pendingTurn. The module has no DOM/storage/model access.

- [x] Write and observe failing tests for fresh/continuing/selection/pending inputs, immutable snapshots and identity compatibility.
- [x] Implement the pure decision and run tests to pass.

### Task 2: 入口、切换与来源提示

**Files:** Modify `prototype/app.js`, `index.html`, `style.css`, regression/build scripts; create `verify-companion-context.mjs`; update work log, review and evidence.

**Interfaces:** Page starts or resumes using Task 1, persists discussionStarted, preserves old question/turn/draft provenance, and refreshes only context chrome when reading changes. A persistent navigation layer label displays the current reading version independently.

- [x] Reproduce fresh second-paragraph failure and ambiguous old-draft label before integration.
- [x] Add checks for explicit scope switching, history/draft recovery, pending requests, selection intent, layer identity and independent scroll.
- [x] Implement page lifecycle and compact controls; use short optional feedback with reduced-motion fallback.
- [x] Run the new checks, previous browser suites, pure CI entry, captures and standalone validation.
- [x] Add versioned Figma specimens, confirm file identity, export/read back the new nodes and honest navigation scope.
- [ ] Get one independent review, fix material findings with failing-then-passing checks, then deliver through sequential synchronization/CI/merge/publication gates.

## Self-review

The reading locator is consumed but unchanged. Decision logic never sees notes and cannot generate text. Existing quote identity keys remain compatible with note drafts and saved question drafts. Fixed Figma states and Web behavior remain separate evidence.
