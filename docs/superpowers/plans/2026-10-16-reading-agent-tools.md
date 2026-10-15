# 阅读 Agent 实施计划

> 使用 subagent-driven-development 执行；用户已授权完整设计、审阅、实现、PR 合并及发布。

Spec: `docs/superpowers/specs/2026-10-16-reading-agent-design.md`

目标：将自然聊天从回声评分器中分离，以当前账号的只读阅读工具支持自由对话。

全局约束：不改变原文回声；不触及其他聊天工作；保留所有权、幂等、取消、费用保护；不把真实用户书籍或秘密提交 Git。使用既有隔离 worktree `reading-conversation`，分支 `codex/reading-agent-tools`。

## Task 1：领域工具与来源

新增 `server/reading-agent-tools.mjs` 与必要的书目、网络提供器。实现 Spec 的八个工具，固定 `{definitions,execute,verify,sources,recommendations}` 接口。读取使用 library 服务捕获的 user，不开放模型身份输入。支持章节、目录、搜索分页及单段续读，精确分层引文与跨书链接，外部书目真实来源和失败状态。网络 provider 的 recordRequest 接受上层预算回调。

新增有意义的隔离测试，验证跨书、权限、搜索两层译文、分页、超长段落、读后精确引用、版本变化、外部错误与取消。测试不写云端。提交本任务后独立审阅接口和实现。

## Task 2：独立 DSH 对话运行时

新增 `harness/chat-generator.mjs`、`harness/chat-plugin.mjs`（可共享小型固定协议模块），原生 finalResponse 输出。父进程 bridge 连接 Task 1 的工具，预算覆盖主 LLM 与辅助搜索；无文件/shell 默认工具。运行目录权限及生命周期、取消和超时正确。

调整 `server/reader-chat-generator.mjs` 默认生成器，保留错误脱敏与依赖注入，传递 env 不依赖隐藏的 process.env。更新构建 NFT allowlist 和 `tools/check-reader-runtime.mjs`，确保生产 bundle 含新插件及依赖，实际离线初始化新工具。增加 bridge、预算、取消、原生无引用回答及旧回声独立性的集成测试。提交后独立审阅。

## Task 3：领域聊天与优雅界面集成

修改 `server/reader-chat.mjs` 传递当前身份捕获的工具、最近六轮跨段历史、真实 activity，验证新回答而不调用回声 schema；保留现有并发/幂等/取消。适配旧 injected generator 测试时不得掩盖新行为。回答 sourceRefs 使用真实跨书信息。

修改 `app/library-chat.mjs` 与必要的安全 Markdown 模块、样式：AI 标签、提示、建议、实际工具进度、相关书目、可读回答。立刻轮询 pending POST，避免迟到请求覆盖取消/完成；旧回答兼容，现有精致布局保留。补回归测试：真实活动并发、跨段历史、取消迟到、XSS、跨书链接和旧消息。

更新 AGENTS.md 与直接相关契约，注明用户本次授权的站内 Agent 只读账号范围；外部 MCP 授权保持原契约。记录真实验证，不将设计当验收。提交并独立审阅。

## Task 4：完整验收与交付

检查完整 diff，跑全套必要测试及公开生产构建/官方 SDK 运行时检查，独立最终审阅并修复。实际浏览器验收保持优雅浮层与安全渲染；少量真实模型用例验证问候、偏好、跨章节与推荐（受单轮预算约束）。若真实账号保存材料，先查询默认账号真实 UID；单元临时数据不写云端。

完成公开验收记录。同步 origin/main 后重新验证受影响部分，推送分支，创建 PR 并附到当前聊天，检查通过正常合并。跟踪现有生产流程并核对生产 source commit 与关键页面、运行时可用性，分别记录已合并、已发布、实际验收范围。
