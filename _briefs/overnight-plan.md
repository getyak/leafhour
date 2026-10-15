# 旁读完整链路实施计划

**Goal:** 让新读者从官网进入自己的书房，上传并阅读文本，按需翻译，供自己的 Agent 授权访问。
**Architecture:** 保留现有阅读器与私人样书，新增按用户隔离的 LibraryService 和入口适配；MCP 通过同一 HTTP 领域入口，不持有第二份记录。
**Tech Stack:** Node 22+、原生 HTML/CSS/JS、PDF.js、Nodemailer、官方 MCP SDK。
**Spec:** `_briefs/overnight-improvement.md`。
**Execution:** 当前会话直接实现，用户已授权自主设计与持续改进。

## Review Focus

匿名或另一个用户猜到 bookId；PDF 伪扩展名、超限和扫描件；不完整模型结果；撤回或过期的 Agent 授权；进度和笔记跨书或跨账户串联。

## Task 1 — 书房领域服务

- [x] 新增 `tests/library.test.mjs`，验证文件解析、私人隔离、公版访问、记录幂等、授权撤回及迁移。
- [x] 验证新测试失败，再实现 `server/library-service.mjs`、`server/document-import.mjs` 与公开目录。
- [x] 单独运行领域测试，再运行现有测试。

## Task 2 — 账户与网页入口

- [x] 新增 `tests/portal.test.mjs`，验证首页、匿名边界、验证码过期/错误/重放、隔离上传与跨来源保护。
- [x] 实现 `server/email-auth.mjs`、`server/portal.mjs`，挂载 `server/server.mjs`；新增 `app/home.html`、`app/portal.css`、`app/portal.js`。
- [x] 调整 `app/reader.js` 和 `app/experiences.js` 按书访问；本地草稿按书与身份隔离。
- [x] 浏览器验收官网、书房和文件上传，检查窄屏。

## Task 3 — 有界翻译与 MCP

- [x] 增加独立双译、并发限制、模型失败和邻段范围实现；独立译文、模型失败及邻段范围已测试。并发边界另补测试。
- [x] 实现 `server/translation.mjs` 与阅读段落翻译入口。
- [x] 实现 `server/mcp.mjs`，用官方 SDK client 真实握手、读取并测试撤回令牌。
- [x] 全量测试、实际 PDF/文本链路、构建校验和独立代码审阅；记录真实验收及后续事件。
