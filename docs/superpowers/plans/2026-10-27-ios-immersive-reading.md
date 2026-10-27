# Leafhour 沉浸与意图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现GET-272/273/274的纯读、边界唤醒、长按选区和按需半屏，不改变上下文归属。
**Architecture:** 纯意图/按压模块决定状态与时限；页面绑定原生Range、边缘按钮与进度。正文几何固定，Chrome只覆盖显隐。现有阅读锚点、讨论/笔记规则复用。
**Tech Stack:** 原生浏览器模块/CSS、Node、隔离Playwright；无新依赖或模型。
**Spec:** `docs/design/2026-10-27-ios-immersion/README.md`

## Global Constraints

- 此前定时任务保持删除；本轮为用户新的单次请求。
- 现有sourceVersion/sessionStorage不改；只选字不改已有讨论，原文/两译/讲解/笔记独立。
- 无付费模型、真实数据写入、私人笔记或站外消息；不把Web当原生iPhone验收。

## Review Focus

- 工具显隐、进度调整和面板开合不能使原文字坐标/续读锚点意外跳动。
- 手机短按、移动、取消、多指以及桌面选区不能触发错误菜单或吞掉复制。
- 半屏中长按新的引用时只保留一种主意图，仍不丢讨论/笔记草稿与回程。
- 隐藏工具不能残留可点按/可Tab误入的幽灵控件；显式键盘唤醒也不能被计时器藏掉。
- 关闭面板后的焦点不能重新唤醒底栏；旧草稿/未完成提问不能被新阅读段落改绑。

### Task 1: 可验证的意图与按压规则
**Files:** create prototype/reading-intent.mjs, reading-intent.test.mjs; update tests/ios-design-interaction.test.mjs.
**Interfaces:** initialIntent(), transitionIntent(state,event,now), startHold/moveHold/holdReady; constants3000ms/420ms/8px. No DOM/data/model access.
- [x] RED tests: exclusive states, timeout/pin, read/close, nonprimary/moved/cancelled presses and exact thresholds.
- [x] Minimal rules, GREEN and ledger.

### Task 2: 纯读布局与原生选择入口
**Files:** prototype/app.js/index.html/style.css; add verify-immersion.mjs; adapt relevant existing drivers and hash/build entries.
**Interfaces:** edge wake top/progress separately, fixed safe reading viewport, progress slider, mobile armed long-press/nativeRange and desktop selection, one surface intent; panel close pure and reading focus, optional suspended return frame.
- [x] Capture current10秒/继续读1秒/4anchors baseline (already observed).
- [x] RED browser checks for pure geometry, exclusivity, tap/hold/pan, adjusted ranges, progress, keyboard and source/copy preservation.
- [x] Implement UI bindings, preserve native selection and all data ownership.
- [x] Run new checks and affected prior regression suites, update snapshots/standalone. Only broaden if changes/failures justify.

### Task 3: 真实画面与交付
**Files:** design docs, diagrams, captures and verification; existing prototype exports/bundle.
- [x] Review actual normal/narrow/night/large/reduced states and complete requested eval.
- [ ] One fresh whole-branch review; fix material issues RED→GREEN, no re-review.
- [ ] Sequential target sync/revalidation/current-head CI/normal merge; verify main/production exact source. No preview, force push or automation restart.
