# 阅读氛围 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session, then request one fresh whole-change review.

**Goal:** 在现有书页提供四套可切换风景和可分别控制的音乐、环境声。

**Architecture:** 独立的 atmosphere-state 管理偏好与播放策略，atmosphere-audio 管理 Web Audio，reader-atmosphere 连接面板、CSS 与现有朗读事件。沿用当前工作区以保留尚未提交的听读集成；改动前已备份相关文件至 local/atmosphere-qa/baseline。

**Tech Stack:** 原生 HTML/CSS/JavaScript，Web Audio，现有 Node 测试与服务。

**Spec:** docs/superpowers/specs/2026-10-15-reading-atmospheres-design.md

## Global Constraints

- 正文原文、路径、稳定 ID 与译文不修改。
- 不自动播放，不调用模型，不部署或提交其他未完成工作。
- 背景声音与朗读分别管理，朗读中背景音量乘 0.18。
- 场景、声音与偏好本地运行，环境声许可独立记录。

## Review Focus

- 快速开始后立刻暂停，晚到资源不能重新出声。
- 播放中快速切主题，只保留最后选择的音景。
- 两路音量均为零、或一种资源失败，状态必须与真实输出一致。
- 窄屏、夜读和旁注打开后，正文与控制仍可读可操作。
- 页面隐藏、刷新或朗读开始后，播放行为符合明确意图。

### Task 1: 偏好与播放策略

**Files:** app/atmosphere-state.mjs, tests/atmosphere.test.mjs

- [x] 写失败测试，覆盖未知主题、非法音量、静音、朗读压低与静态场景。
- [x] 运行确认失败，实施 normalizeAtmosphere、atmosphereMix 与 createAtmosphereSession。
- [x] 验证迟到播放、快速切换和停止行为。

### Task 2: 本地风景与声音

**Files:** app/assets/atmospheres/*, app/atmosphere-audio.mjs, app/assets/atmospheres/NOTICE.md, server/server.mjs

- [x] 登记素材来源、许可与加工过程，下载并验证实际资源。
- [x] 实现延迟初始化、音乐编排、环境声缓冲、淡入淡出、资源失败与清理。
- [x] 增加本地资源路由测试，验证不开放任意路径。

### Task 3: 主题界面与集成

**Files:** app/reader-atmosphere.js, app/reader-atmosphere.css, app/index.html, app/reader-audio.js

- [x] 实现四场景预览、纸面选项、独立音量、动态开关与播放状态。
- [x] 连接朗读压低、页面隐藏暂停、按账户与书籍保存偏好。
- [x] 验证选择文字、切换主题和已有阅读设置不丢位置。

### Task 4: 验收与交付

- [x] 全套测试与静态构建；真实浏览器检查各尺寸和声音控制。
- [x] 独立复核本次差异，修复有证据的问题。
- [x] README 与 local/atmosphere-qa 中记录实际验收，打开本机结果。

## Execution ledger

- 基线：152 个测试通过，0 失败。
- Ruling: 直接在当前工作区实施；已有听读集成尚未提交，新工作树不会包含它。备份后以新增模块和最小插入集成，避免重建或覆盖。
- Ruling: 采用本机原创合成音乐，避免订阅与第三方播放器成为阅读前提。真实环境录音独立署源。
- Task 1: complete。参数、压低策略、取消与切换竞态均先失败再通过。
- Task 2: complete。本地四张照片与五路 32 秒环境声已解码核验，静态资源与任意路径拒绝测试通过。
- Task 3: complete。四主题均在真实浏览器进入 playing；音量可独立归零，刷新静音，选文与换主题位置核对通过。
- Task 4: complete。独立审核发现的旁注纸面与加载期间静音问题已修复并复核；8 项定向测试通过。320、390、768、1440px 无横向溢出，夜读及低动态偏好通过。最终全套 164 项测试通过，构建成功。详细证据及验收边界见 _briefs/reading-atmospheres-verification.md，日志见 local/atmosphere-qa/。
