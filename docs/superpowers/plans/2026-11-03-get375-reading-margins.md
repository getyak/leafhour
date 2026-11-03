# 阅读旁注 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the main UI task; dispatching-parallel-agents covers independent persistence and server tasks.

**Goal:** 保留书页的旁注对话，支持消息引用与反应，改善返回响应和进度位置。

**Architecture:** 复用现有对话与草稿服务。服务端保存权威消息引用；iOS 用系统 sheet 呈现书内对话，输入状态由草稿/交互决定。

**Tech Stack:** SwiftUI, LeafhourCore, Node.js, XCTest.

**Spec:** `docs/superpowers/specs/2026-11-03-get375-reading-margins-design.md`

## Global Constraints

保留账号/书籍/私人笔记权限、原始历史、翻译独立契约。未知结果保持原请求。保留其他聊天的未提交文件。只 main 正式发布，不建预览。

## Review Focus

- 长按引用后退出/重开、未知请求重试不能串引用。
- 旧草稿与历史缺少新字段时正常恢复。
- 半屏的键盘、大字与滚动不遮挡发送或停止按钮。
- 大书返回不能丢笔记/进度，也不能等待网络同步。
- 章节不等长、PDF、缺失锚点的百分比不能冒充精确页数。

### Task 1: 旁注与消息动作

Files: `ChatConversationView.swift`, `ReaderCloudTools.swift`, `ReaderPanels.swift`, `ReaderScreen.swift`, LeafhourCore 消息引用类型及 UI 测试。

- [x] 写并执行消息引用/旧草稿兼容与原生引用流程回归。
- [x] 实现 `replyTo:{turnId,role,text}` 快照、草稿恢复和本机点赞，冻结提交与重试。
- [x] 将书内聊天改成半屏 sheet，移除全屏 Chat 导航与绑定状态，缩小问题/引文。
- [x] 阅读回复时收起输入，保留显式继续问与停止。
- [x] 构建并运行受影响原生验收。

### Task 2: 后端引用与回复方式

Files: `server/reader-chat.mjs`, `server/local-reader-chat.mjs`, `harness/chat-generator.mjs`, `app/portable-chat.mjs`, `app/reading-chat-input.mjs`, 对应 tests。

Interfaces: 请求 `replyTo:{turnId,role}`；响应保存 `replyTo:{turnId,role,text}`。

- [x] 服务端解析来源与隔离/幂等/导出回归先失败后通过。
- [x] 更新自然批注式回复指令，不裁剪已有内容。
- [x] 执行受影响 Node 测试。

### Task 3: 返回与进度

Files: ReaderSession/OfflineLibrary 保存链、`ReaderScreen.swift` 和对应 core tests。

- [x] 定位并复现慢保存的返回阻塞，保留可恢复语义。
- [x] 修复实际阻塞并验证错误恢复。
- [x] 用章节位置替代屏数，进度右下悬浮，翻页短显且选择时隐藏。
- [x] 执行 core tests 与原生构建。

### Task 4: 交付

- [x] 独立审阅完整 diff，修复重要问题。
- [ ] 保存真实测试和发布边界，同步 main 后集中提交推送，创建 PR。
- [ ] 等待 CI gate，正常合并，检查正式发布来源；提供商拒绝时停止重复尝试。
