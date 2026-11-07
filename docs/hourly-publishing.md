# Leafhour 的唯一小时发布入口

[GET-314](https://linear.app/getyak/issue/GET-314) 保持 In Progress。PR260 的 CI 分流与 PR333 的默认关闭控制器已经交付；当前 Draft 准备两阶段切换，**尚未启用小时限流**。执行顺序、精确对象、未知结果、保守设置下限和退出步骤见[两阶段切换清单](hourly-publishing-cutover.md)。

先经审阅和 CI 合并 production-only Git 策略，让 main 停止自动部署，原健康版本继续服务；普通 main 合并可继续积累。旧请求全部收敛后，分别固定当前 main M、健康 legacy L/deployment D；不再要求 M==live 或全局冻结 main 一小时。bootstrap 不要求新 M CI 完成，真实发布始终要求当时最新 main 的最新同源成功 CI。

## 控制器

Python 标准库、单一 SQLite、独立 witness 和 OS 锁运行在专属目录，复用既有 gh/Vercel CLI 登录。只有 GitHub 原子 `updateRefs` 能推进生产指针；不创建 Vercel 部署 token/hook/CI 写权限，不读取书籍、笔记或模型。Vercel 仍通过既有 Git 集成构建，GitHub Production 工作流只验收。

| 操作 | 约束 |
| --- | --- |
| check-stage / init | 必须显式 `--expected-main M --expected-legacy-source L --legacy-deployment D`；main exclusive、原项目跟踪 main、无 seed、L/D 实际健康、旧请求终态；init 默认关闭 |
| seed | 已有同一初始化库；先持久化 M/L/D 意图，再原子 main M→M、production 0→L，force=false。M 关 main，L 关 production，不生成 Preview |
| reconcile-seed | 只读；ref=L 且 inventory 相同才确认，空 ref 永久 unknown，不重发 |
| tracking-intent / tracking-confirm | 前者先持久化意图；实际 Save 由获准的协调方执行；后者核对原项目 production 跟踪和无新增请求。尚未实测的设置副作用保留 init+3660 下限 |
| first enable | 三 pin、全部 legacy/bootstrap 结果已收敛、原独占链成立；重新建立完整3660秒 hold，M CI 可 pending |
| tick | 到期才选当前 main；同 SHA 最新 CI 成功、二次预检、no-force CAS、无旁路/迟到请求；无变化不发布 |
| disable / status | 可离线；保留历史、冷却和未知操作 |
| recover-failure | 只处理已知 provider failure；不清除 unknown、来源幂等或既有冷却 |

`init` 必须早于 seed，从而 seed 请求未知时也有可恢复的持久意图。L/D 和初始全量 provider inventory 在 DB 与 witness 中固定；已有库或 witness 不覆盖，不能把新 main 或新线上版本悄悄选作另一个 legacy。每次重要阶段完整分页核对部署；空队列不能掩盖 pending/missing 的旧 main 请求 receipt。运行期预检和临发前重核旧 GitHub receipt，重新 missing/pending 时持久冻结。迟到旧链、外来、重复部署或历史 receipt 消失都会阻塞后续发布。offline status 显示固定 legacy/deployment 与持久操作状态/时间，unknown 可读且不输出 payload。

main 与 production 的 [GitHub updateRefs 原子断言](https://docs.github.com/en/graphql/reference/git#updaterefs)同属一笔事务，任一 beforeOid 不符就不修改其他 ref；真实请求未知时仍不能凭空 ref 推断拒绝。本版本不按异常文字猜服务端确定拒绝，也不自动重试 seed；短暂 main CAS 竞争需要确切回执和独审离线恢复，保留原 witness。

## 状态、时间与资源

专属非临时目录700，DB/witness/lock 文件600。所有状态事务使用 `BEGIN IMMEDIATE`；外部写请求之前 fsync witness 并提交 SQL。每次事务核对 DB inode/device、immutable handover 和所有 armed 记录。旧库原地覆盖、换文件、丢 witness、intent 缺失都 fail closed；禁止同时回滚 DB/witness 或重建 enabled 库。

runtime 保留 prepared 120秒 lease、sending/uncertain/accepted 只读协调、同源只尝试一次、provider success 与同源 public release 分开验收。发送未知不能按超时、重启或新 SHA 重发；父进程退出时，继承 OS 锁的请求子进程仍保护入口。所有 sending/unknown/accepted 未闭合前不发下一次。

服务时间来自现有认证 GitHub HTTP Date，加含系统睡眠的连续时间（macOS CLOCK_MONOTONIC_RAW，Linux CLOCK_BOOTTIME）。往返超过30秒、快照超过120秒或时间倒退停止。最小窗口 **3660秒** 保守覆盖 Date 秒精度和跨进程延迟，满足滚动3600秒最多一次，不承诺整点。enable 总是重新建立完整 hold；首次 accepted 也延长至观察时刻+3660。disable/re-enable、失败、重启不缩短。

`deploy/hourly-publisher/` 提供无凭据配置、launchd 模板和 review-only 计划。控制器工具固定经审阅的完整来源，不自动跟随 main。现有 vc.js 依赖 env node，模板必须填已验证 Node 目录，并用相同用户/最小 PATH 只读验证；CLI 变化或消失时停止，不能自动重装/登录。仅安装一个每300秒 tick 的入口；不保留第二个 cron、hook 或 CLI 发布旁路。

本轮只执行有界离线宿主检查，不做大构建/UI/账号/模型调用。实际部署、同源 HTTP 与两个真实窗口分别记账；无有用变更则等待，不为空提交或重复部署制造验收。只有全部完成才 Done。
