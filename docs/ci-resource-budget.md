# PR 检查与正式发布的资源约定

关联：[GET-314](https://linear.app/getyak/issue/GET-314/reduce-pr-builds-and-vercel-deployment-waste)。

2026-10-29 用户要求减少 PR 消耗，并选定「合并后集中发布，每小时最多一次」。本批先落地可在仓库完成的 CI 分流和部署失败检测；集中发布的外部配置状态单独记录。

## CI 分流

工作流每次仍创建一个完整的 CI run。轻量 `changes` job 在不安装 npm 依赖的情况下运行分类、部署失败、README/SECURITY 多语言与 MCP 文档契约测试，检查所有工作流语法，然后输出以下计划：

| 改动 | Web 测试与部署包构建 | 原生宿主测试与 iOS 构建 | 离线公版来源检查 | iOS 发布契约 |
| --- | --- | --- | --- | --- |
| 根目录说明、`docs/**/*.md`、`_briefs/**/*.md` | 跳过 | 跳过 | 跳过 | 跳过 |
| `app/`、`api/`、`server/`、`harness/`、普通 Node 测试、`docs/copy/` | 执行 | 跳过 | 跳过 | 跳过 |
| `apps/ios/`、原生 vendor 校验工具 | 跳过 | 执行 | 跳过 | 执行 |
| `scripts/ios/`、iOS Node/Python 测试 | 跳过 | 跳过 | 跳过 | 执行 |
| `catalog/`、公版 Python 解析器及测试、解析器依赖 | 执行 | 跳过 | 执行 | 跳过 |
| 未知路径、共享依赖、发布清单、CI 配置或无法比较的提交 | 执行 | 执行 | 执行 | 执行 |

多个范围取并集，`docs/copy/` 优先于文档规则。删除和重命名前后的路径都参与计算；文件名以 NUL 分隔，不能变成 shell 指令。PR 比较本次合并结果与目标父提交；main push 比较该事件的 before/after，取不到范围时全测。

`CI gate` 使用 `if: always()`，检查计划是否有效，以及所有适用任务是否成功。必需任务被跳过、失败或取消都会失败。不要把整个工作流用 `paths` 跳过，否则 required check 可能一直 pending。原有 job 名称保留，方便继续使用已有保护规则；新增规则优先要求 `CI gate`，不得只要求轻量 planner。

PR 先做受影响检查和审阅，再集中推送一个可交付批次。保留同一 PR 旧 run 的自动取消；只有新改动或明确的外部临时故障才重跑。此批不移除 Vercel 内部测试，也不复用其他提交的测试结论。

## 每小时集中发布的启用条件

**小时入口尚未启用。** 两阶段先正常合并经审阅且CI通过的production-only策略PR，关闭main自动部署，原健康版继续服务，普通main合并继续积累；旧请求与unknown全收敛后，分别固定main M与健康legacy L/D，先init再持久seed，切换原项目Branch Tracking并启用唯一入口。详见[两阶段切换清单](hourly-publishing-cutover.md)。本轮只做源码、离线检查和Draft准备，尚未执行真实切换；PR Preview保持关闭。Vercel 的 Ignored Build Step 发生在部署创建后，取消的构建仍计入部署额度，因此不能用它模拟配额控制。[官方 Git 配置](https://vercel.com/docs/project-configuration/git-configuration)、[Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step)。

启用时需要满足以下条件：

1. 在实际所属团队核对 Leafhour 项目、正式域名、生产分支与当前发布源，保留恢复入口。
2. 建立唯一的集中发布入口。每小时取最新已通过同提交 CI 的 main，持久记录成功来源和最近一次尝试；无新提交、已有发布进行中、距离上次尝试不足 60 分钟时不请求部署。时钟小时边界不能替代滚动 60 分钟限制。
3. main-off合并前先备齐可审阅的替代实现、适用CI、独审和回滚；合并后再执行关闭态初始化及明确双pin的非发布seed。M无需等于live或在bootstrap完成CI；真实发布只选最新main且其CI成功。全部旧请求和bootstrap结果闭合后enable另建3660秒hold，不能叠加另一发布链。
4. 提供商限额或权限失败要记录并停止重复请求。手动执行与自动调度使用相同互斥和时间限制；紧急例外需用户明确指定。
5. 部署创建、发布成功、`release.json` 命中来源提交、线上验收分别记录。后续 main 更新不能冒充本次已发布来源。

每小时限制只约束 Leafhour 这条发布链，不能保证同一 Vercel 账号的其他项目不会消耗共享日额度。GitHub 定时任务也可能延迟，不能保证整点上线。

2026-10-29连接器/旧CLI的403及11月7日早先CPU暂停均保留为历史。原团队现已恢复，已有CLI可读取原项目；经批准的唯一修复部署 `f1d0981…` 已READY，独立正式来源读回命中它。小时入口仍未启用，不能继续把旧配额/403当当前原因，也不能因恢复创建第二次同源部署。补充实现采用持久控制器与受保护的生产引用，详见 [小时发布入口](hourly-publishing.md)和[精确切换清单](hourly-publishing-cutover.md)。随后外部PR339/331触发旧链的3411.077秒与909.437秒间隔，均是未限流的历史。f1不再作为可直接执行的seed pin；旧PR338/fdc3绿灯也不是新候选的验证。本轮准备两阶段源码与Draft材料，尚未操作远端链。

## Production 等待

Production工作流按同源Git策略选择入口：legacy模式验证成功的main push CI；小时模式只验证production push，main CI事件便宜结束。它只验证，不创建部署。遇到Vercel明确的 `failure` / `error` 立即失败；HTTP402同样立即失败；尚在排队则保留有界等待。读取status的GitHub token只发往固定GitHub API，不跟随重定向，不发给正式站或status中的target URL。没有该token的本地smoke保留原有行为。

## 验证记录

本地使用合成仓库和 HTTP 响应验证路径分类、重命名/删除、未知范围回退、失败门禁和实际 smoke 入口的快速失败；既有匿名边界与发布清单测试继续运行。工作流通过固定版本 `actionlint v1.7.12`。PR/main CI 和外部启用结果以对应提交的实际 run 与 Linear 记录为准；此文不代表原生、正式站或 TestFlight 已验收。
