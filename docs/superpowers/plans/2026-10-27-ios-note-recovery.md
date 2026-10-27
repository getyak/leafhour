# Leafhour 笔记草稿与撤销 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从记录找回笔记草稿，保存可撤销，原引用与讨论不被改写。

**Architecture:** 新纯模块解析已有六字段草稿键并执行保守的保存撤销。页面持有编辑/回程与短暂撤销凭据，沿用现有记录和通知，不改续读或陪读上下文模块。

**Tech Stack:** 浏览器模块、CSS、Node测试、隔离Playwright、免费Figwright。

**Spec:** `docs/design/2026-10-27-ios-polish/NOTE-RECOVERY.md`

## Global Constraints

- 硬截止2026-10-27 12:00 Asia/Singapore，预留CI/发布时间；仅固定公版样章、隔离合成状态。
- 不改sessionStorage键或sourceVersion；原文、两译文、讲解、笔记独立归属。
- 不读私人笔记、不写真实书房、不付费模型、不站外消息；Figma保留旧设计。

## Review Focus

- 重开或从记录恢复另一段的草稿，不能改写当前讨论的问题/草稿/原引用。
- 草稿键为选句范围或坏数据时，不能补造错误出处或清空旧数据。
- 保存撤销若遇到同句新草稿或保存内容变化，不能覆盖任一份文字。
- 保存、撤销、返回在半屏讨论与记录两种来源下都保留正确回程和阅读位置。
- 通知替换、计时到点、聚焦与连续保存时不能撤销另一条笔记或藏掉正在操作的按钮。

### Task 1: 纯草稿与撤销规则

**Files:** Create prototype/note-recovery.mjs and note-recovery.test.mjs; modify tests/ios-design-interaction.test.mjs.
**Interfaces:** readNoteDrafts(drafts,{passages,version}) → verified entries {key,quote,text}; actual paragraph/layer text validates ranges and quotation; undoNoteSave({notes,drafts,receipt}) → status/notes/drafts; quoteIdentity retains existing format.

- [ ] Write failing tests: full/partial quote, invalid keys, no fake timestamps, immutability, exact save undo, conflict and repeat undo.
- [ ] Implement only these rules and verify all calculation tests.

### Task 2: 记录入口、正确回程与保存反馈

**Files:** prototype/app.js, style.css, index.html; create verify-note-recovery.mjs; update build/hash entry, README/WORKLOG and exports.
**Interfaces:** draft rows open note preview with independent quote and records return frame; save generates exact note ID and short-lived undo receipt; undo reopens restored note while preserving current discussion.

- [ ] Reproduce missing draft entry and missing undo before integration.
- [ ] Add isolated checks for refresh recovery, quote/layer identity, reading/discussion/records return, conflict, consecutive saves, focus/expiry and narrow/night/reduced motion.
- [ ] Implement conditional draft section, return label and8秒可操作反馈；no new navigation tab.
- [ ] Run new checks, four related prior note/preview checks and baseline11; rebuild captures/vectors/standalone without rerunning unrelated gestures/reading.
- [ ] Add versioned Figma three-state flow, confirm file/nodes then export/read back.
- [ ] One fresh whole-branch review; fix material findings RED→GREEN, no second review; sequential sync/validation/CI/merge/publication gates.
