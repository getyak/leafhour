# Leafhour 的唯一小时发布入口

对应 [GET-314](https://linear.app/getyak/issue/GET-314)。PR260 的 CI 分流继续保留。本补充提供可执行的控制器与切换步骤，**当前不安装调度器、不创建生产分支、不修改 Vercel 项目或 `vercel.json` 的现有 main 链**。

## 实现与权限

控制器运行在本机专属目录，使用 Python 标准库、SQLite、已有 `gh` 与 Vercel CLI 登录。Vercel 仍通过既有 Git 集成构建；控制器只把受保护的 `production` 引用推进到当前 main 的精确 SHA。它不创建 deployment token、hook、GitHub Secret 或 CI 写权限，不导出浏览器状态，不读取书籍、私人笔记或模型。

候选必须是当前 main，而且该 SHA 最新有效的 `CI` push run 已完成且成功；不从旧绿灯、PR run、其他仓库或另一个工作流取候选。main 更新但 CI 未结束时等待。普通读取只更新控制器专属 bare mirror，不接触用户现有 checkout。

引用更新使用 GitHub [`updateRefs`](https://docs.github.com/en/graphql/reference/git#updaterefs)：同一原子操作断言 main 仍等于已检查 SHA，并断言 production 仍等于持久记录的旧 SHA，`force:false`。main 的 before/after 相同，仅作为前置条件；production 才改变。已有保护规则拒绝时停止，不增加 bypass、换账号或扩大授权。种子阶段必须读回无多余 push CI、无新 Preview 或部署；若平台把 no-op 当成新 push，停止启用并重新审查入口。

## 持久门禁

`publisher.sqlite3`、独立的 `.witness` 与 `.lock` 必须放在同一个专属、非临时、权限700的目录，文件权限600，不进 Git，不存凭据。

| 状态 | 可执行的下一步 |
| --- | --- |
| 默认关闭 | status 可离线读取，tick 不联网、不推进引用 |
| prepared | 120秒租约；过期、关闭或候选变化会使旧执行者失效 |
| sending | 调用前先同步落盘，独立 witness 先于 SQLite commit 写入并 fsync |
| uncertain | 只读核对远端；不按超时、重启或新 SHA 自动重试 |
| accepted | production 引用已接受，仍需供应商成功与线上来源相同 |
| succeeded | 供应商成功，且 leafhour.com/release.json 命中该完整 SHA |
| failed / drift | 停止新请求；明确恢复原因，禁止清空历史或透明恢复旧备份 |

所有路径共用 SQLite `BEGIN IMMEDIATE`，手动执行与 launchd 没有绕过入口。服务时间来自现有登录的 GitHub 响应 Date，再累加包含系统睡眠的连续时间（macOS `CLOCK_MONOTONIC_RAW`，Linux `CLOCK_BOOTTIME`）；响应往返超过30秒、快照超过120秒、跨进程时间倒退都停止。不能用Mac上不包含系统睡眠的 `time.monotonic()` 替代。实际最小间隔为 **3660秒**，其中60秒保守覆盖跨进程响应延迟和 HTTP Date 的秒精度；因此满足滚动3600秒最多一次，不承诺整点上线。首次 enable 也有完整3660秒等待，避免与刚结束的旧 main 链相撞。

冷却时间从持久 arming 起算，并在首次确认远端已接受时延后到确认时间加3660秒。发送中、未知结果或构建中的旧任务未消除之前，不发下一次。进程死后若远端已是目标 SHA，可只读恢复 accepted；若仍是旧引用，不能据此证明请求没有在途，继续 uncertain。已经尝试的同一源不会再自动发起部署。

独立 witness 保存所有已 arming 的请求。原地覆盖旧备份和替换数据库都会被检测到；新进程也不能透明接管恢复后仍 enabled 的旧库。witness 写入与 SQL commit 之间崩溃会保守阻塞。**不得同时回滚 witness、删除状态、重建 enabled 库来恢复发布。**

CLI 持有独占 OS 文件锁，更新请求的子进程继承锁；父进程退出而子请求仍运行时，其他 CLI 仍返回 busy。磁盘丢失/损坏等离线修复需先卸载本任务调度、确认所有持锁执行者及在途请求已结束，保留原库和 witness，核对每条 arming 的远端回执，再准备独立审阅的恢复变更。结果不确定时保持关闭，不能用旧库覆盖后直接 enable。

## 启用前的具体检查

示例配置与 launchd 模板在 `deploy/hourly-publisher/`。替换所有占位符后，控制器源码固定到已正常合并且 CI 通过的版本；不要让调度器自动执行未经审阅的新 main 代码。

1. 恢复原团队的正常服务，确认静态 release.json 为200，最新已通过CI的 main 已在当前 Production，无排队/构建中部署。2026-11-07协调方提供的浏览器实查是：原团队可访问，网站/账号API为402，原因是 Fluid Active CPU 用量暂停。旧连接器/CLI403不能据此概括成没有团队权限。本任务未发送支持消息、升级、付费或更换团队。
2. 在原团队核对真实 project ID/name、GitHub仓库、Production branch=main、leafhour.com正式域名及当前来源，保存读回。配置填入这些身份和现有发布 GitHub login；凭据不放配置。确认已有 `gh` 和 Vercel CLI的只读项目/域名查询正常。若重新登录将创建新 token 或需要扩大权限，先交协调方明确授权对象和回滚方案，本控制器不会执行登录或授权。
3. 使用仓库现有权限为字面 `production` 预先配置分支保护 pattern：禁止force/deletion、enforce admins、要求 `CI gate` 及 main 的现有 required contexts，push allowance 仅现有发布用户。main保护保持原状，不新增用户、App或bypass。部署引用只复用已经进入main且CI通过的提交；若现有规则不能允许这种引用推进，不自动放宽规则。
4. 在专属状态目录创建独立 bare mirror，origin必须是唯一公开仓库。从模板准备配置、固定 Python/gh/vercel 的绝对路径，检查模板替换结果；不自动安装大套依赖。
5. 执行 `check-stage`。要求 exact main 的 Git配置仍仅开启main，production仍禁用；Vercel生产分支仍main，当前main已在线、CI成功、无在途部署、账号与保护符合。再执行一次 `seed`：只在 production 引用不存在时创建同一已在线SHA；已有合法种子只读返回。该种子commit本身禁用production部署，不能创建Preview。未知 seed 结果先只读查看引用，不重复seed。核对供应商和GitHub没有多余部署/CI。
6. 执行 `init`。它只接受上述健康 legacy 阶段和已有合法种子，创建默认关闭的库、witness及完整小时等待。新库不能在已经切换的 production 链上初始化；已有历史或witness不能被覆盖。

所有命令的形式如下；首次阶段使用 `check-stage` / `seed` / `init`，实际切换后再用 `check` / `enable` / `tick`。示例没有真实密钥：

```sh
/absolute/verified/python /pinned/controller/tools/hourly-publisher.py status \
  --config /publisher-owned/config.json --state /publisher-owned/publisher.sqlite3
```

## 单入口切换与回滚

必须在1–6项全部留下真实证据后才做，不把这份源码或合成测试当成凭据已可用。

1. 协调一个切换窗口，暂停该仓库常规合并，确认旧 main 发布完全终止，记录最后来源与时间。准备**另一份经审阅的切换PR**，将 `vercel.json.git.deploymentEnabled` 改成 `{"**":false,"production":true}`，main关闭；PR仍不开Preview。通过当前CI后合并。这个main push不请求部署；既有线上版本继续服务。
2. 等待切换提交的main CI成功。现有 Production工作流会识别小时模式，对仅main CI事件快速结束，不为每个待合并源占用30分钟runner。其production push路径保留同源smoke；与legacy组隔开，后续main CI不能取消真实发布验收。源元数据请求出现HTTP402时立即失败，不把明确的平台暂停吞成30分钟等待；其他正常排队仍有界等待。
3. 原项目 Branch Tracking 改为 `production`，域名保持原Production。修改前核对UI关于部署的实际行为；当前种子commit仍禁用production部署。若UI会额外部署或目标/权限改变，停止交协调方处理，不能以Preview试验。读回项目、分支、Git策略和无额外部署。
4. 执行 `check`，它会重新读取所有目标、规则、既有身份、当前main/最新CI、实际Git策略、无在途部署及网站健康。失败时先恢复前一阶段；**不会在准备PR中自动切断main链**。成功才 `enable`，至少等3660秒后首次tick可推进引用。
5. 用已替换并审阅的plist安装本任务唯一launchd入口，每300秒轻量tick；同一库手动tick也受门禁。不要保留第二个cron、workflow部署任务、hook或手动CLI发布旁路。
6. 两次真正符合时间窗的发布分别保存：所选main/最新CI、DB和witness事件、production引用、Vercel Production成功、同源release.json、Production HTTP smoke；在两次之间合并多个源，证明只有最新合格源发布，中间源不创建部署，PR始终无Preview。平台暂停期间只做合成验证，GET314保持IP，不能Done。

回滚先 `disable` 并卸载本任务launchd；disable不依赖网站或认证可用。保留并核对所有sending/uncertain，不能因停止进程就假定请求未发。达到现有冷却时间且无在途请求后，把项目Production Branch改回main，此时main Git仍关闭；再用正常PR恢复 `{"**":false,"main":true}`，该次合并才恢复旧main发布。不要向production强推旧SHA，或在两条链同时开启时做“测试”。恢复旧链意味着小时限制撤销，任务重新保持IP；紧急打破时间窗必须有用户明确要求。

## 失败恢复与验收界限

`recover-failure` 只处理已知供应商失败；它要求目标、身份、独占策略、最新CI与健康检查重新通过，保持已有冷却与同源幂等。没有新合格main时不会空提交或重复部署失败SHA；同源人工重发需要另行准备有界、可审阅的恢复动作，不能旁路当前锁。ref drift、unknown、丢库或旧备份恢复不属于这个命令的绕过范围。

本地验证使用临时SQLite、独立合成bare仓库、合成HTTP/命令回执和真实子进程退出。它证明控制器协议，不证明原项目当前已解除暂停、现有CLI已登录目标团队，或小时入口已启用。PR、main CI、供应商实际发布与正式来源验收分别读回。仅Leafhour这条链受此限流，其他项目仍可能消耗团队共享CPU/部署额度。
