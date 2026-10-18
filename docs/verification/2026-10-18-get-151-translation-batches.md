# GET-151 分批翻译工程切片 · 验收记录（2026-10-18）

设计已冻结：[规格](../superpowers/specs/2026-10-18-get-151-translation-batches.md) · [计划](../superpowers/plans/2026-10-18-get-151-translation-batches.md) · 行为说明：[分批翻译与断点恢复](../translation-batches.md) · 原任务：[GET-151](https://linear.app/getyak/issue/GET-151/在用户启动后分批翻译全书并支持断点恢复)。本文记录委派工作树内的实现与本机验证；独立 review、完整 verify:deploy、当前提交 CI、合并与发布 smoke 由父任务执行，最终状态以 issue 的交付评论与关联 PR 为准。

## 本次交付

- `tools/translation-batch.mjs`：薄 CLI，默认演练；实际执行要求 `--execute` 与 `--max-requests 1..20`；会话仅取自 `LEAFHOUR_SESSION`，不接受密码或命令行令牌；退出码 0/1/2 区分完成、停止与用法错误。
- `tools/lib/translation-batch.mjs`：计划器（按章节/来源顺序，排除卷首、附录、元数据标题、中文原文、齐备/部分/已复核译文并逐条报告）、来源指纹与绑定（账号+来源+书+原文版本+有序段落ID与原文哈希）、私有原子检查点（0700/0600、临时文件改名、拒绝符号链接与绑定变化、执行锁+崩溃锁回收）、有界传输（仅 HTTPS/回环 HTTP，拒绝 userinfo/路径/查询/片段与重定向，响应限长，逐段传输协议+快照校验）、串行运行器（每次请求前重读实际状态，失败/未知即停不自动循环，恢复时按服务器实际译文对账，SIGINT 停止后续请求且不声称撤销）。
- `server/translation-batch.mjs` + `server/library-service.mjs` + `server/portal.mjs`：`translate(user,id,passageId,options={})` 与既有路由增加可选 `contentVersion`；来源版本不符在任何模型请求之前拒绝（409）；保存前重读来源与归属（来源更新 409 / 书籍删除 404，不重建旧书、不发布过期译文层）；不覆盖已复核译文与生成期间并发新增/变化的版本；旧的无版本调用行为不变。
- 测试：`tests/translation-batch.test.mjs`（12）、`tests/translation-batch-http.test.mjs`（12）、`tests/translation-batch-cli.test.mjs`（4）、`tests/library-translation-safety.test.mjs`（5），全部为合成数据，无真实账号、无付费调用。
- 文档与发布清单：`docs/translation-batches.md`、本记录、计划勾选、`release-files.json` 新增 6 个文件（验证与 superpowers 文档按发布策略保持不发布）。

## 实现前的 RED（先失败后实现）

1. `node --test tests/translation-batch.test.mjs`：`Error [ERR_MODULE_NOT_FOUND] Cannot find module .../tools/lib/translation-batch.mjs`，12/12 失败（功能模块不存在）。
2. `node --test tests/library-translation-safety.test.mjs`：4/5 失败——3 项 `Missing expected rejection`（缺 expected contentVersion/来源竞态/删除竞态护栏），1 项并发保留失败（护栏未实现）。
3. `node --test tests/translation-batch-http.test.mjs tests/translation-batch-cli.test.mjs`：`SyntaxError: The requested module '../tools/lib/translation-batch.mjs' does not provide an export named 'createTransport'`，CLI 断言失败（传输/运行器/CLI 未实现）。

实现过程中另有 4 处由测试暴露并修复的真实缺陷：`reconcileEntries` 用 `null` 当章节类型导致对账不生效；检查点锁在父目录不存在时 ENOENT；源竞态 HTTP 用例误断言书文件为空（改为断言译文层）；大书传输用例的段落计数口径（makeBook 拆分与自动分节）。

## 真实验证（本机，合成数据）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/translation-batch.test.mjs tests/translation-batch-http.test.mjs tests/translation-batch-cli.test.mjs` | 28/28 通过（契约 verify） |
| `node --test tests/library-translation-safety.test.mjs` | 5/5 通过 |
| `node --test tests/*.test.mjs`（全套） | 1297 项：1296 通过、0 失败、1 跳过（仅 Linux 的 Node 许可证检查在 macOS 跳过） |
| `node --test tests/release.test.mjs` | 5/5 通过（含发布快照的相对导入闭包检查） |
| `node tools/release-policy.mjs` | 通过：540 个软件文件，私有历史与数据排除 |
| `git diff --check` | 干净 |

覆盖的验收点（全部经真实本机 HTTP + 隔离合成书房，无真实供应商）：演练零 POST/零写入/零生成；显式有界串行执行与顺序正确；>3MB 大书走既有分段传输协议并按快照校验；崩溃后按服务器实际译文对账、不重复生成；失败记录稳定 ID/原因后停止、可重试且不自动循环；账号/来源/书/原文版本绑定不匹配拒绝（含真实双账号会话）；来源在生成前（409、零模型调用）与生成后/两次请求之间（409 或 `source-changed` 停止）失效，旧书不重建、过期译文不发布；部分译文与已复核译文跳过并报告、永不覆盖、不以单侧补齐；检查点并发执行拒绝、原子私有、符号链接与绑定变化拒绝、内容不含令牌/原文/译文；重定向、超大响应、超时按 `redirect-refused`/`oversized-response`/`timeout` 诚实拒绝；Ctrl-C 停止后续请求且不声称退款或撤销。

## 仍未完成 / 不在本次范围

- **用户明确批准的实际全书内容与付费调用范围仍未取得**，本次没有发起任何真实模型调用，也没有任何全书生成。
- **人工复核（reviewed）、术语一致性、来源页校对仍未完成**；所有生成结果保持 `draft`，生成齐备不等于已审阅。GET-151 保持开启，本工程切片不关闭该 issue。
- 父任务交付门禁：独立 Codex review、修复确认的 P0/P1、完整 `verify:deploy`（父任务在 review 后运行一次）、当前提交 CI、正常合并与发布 smoke。
- 无 UI 变化、无新依赖、无调度任务、无 Linear/GitHub 写入或提交。

## 独立审查后的修复

原委派版本虽有 1,296 项本机通过，独立 review 仍重现 2 项 P1（未初始化锁被抢占、版本化 POST 覆盖已有单份草稿）及 7 项 P2。父任务接手，新增 9 项回归先得到 0/9 通过，再修复上述边界；另增加 reservation 等待期间新增草稿、相同文本的并发元数据更新和真实子进程 CLI 脱敏回归。

修复包含：锁生命周期短 guard 串行化及 nonce/inode 归属检查，未知锁保守拒绝；已有目录权限不修改、全祖先与独立普通文件检查；服务端初始和预留后再次检查版本化批处理条件；所有检查点条目按实际服务端状态对账；固定错误消息；分段的总量/快照/规范 base64/严格前进与终止检查；预检返回后再次检查取消信号；只有匹配原文与两份完整译文的回执才记为 saved，提交后不确定响应记为 unknown。此处不声称最终 review 或最终全套验证已经通过，其结果由交付评论补记。
