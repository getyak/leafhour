# GET-314 两阶段小时发布切换

当前是 **source/offline/Draft PR 准备阶段**。本轮不合并 main、不建真实保护或引用、不执行真实 init/seed/enable、不安装调度、不改 Vercel 设置、不创建部署。执行窗口由协调方审阅最新候选、适用 CI、独审和现场状态后单独开放。

## 为什么分两阶段

先把经审查、当前提交 CI 通过的 PR 正常合并，使 `vercel.json.git.deploymentEnabled` 为 `{"**":false,"production":true}`。main 后续合并不再自动发布，原健康部署继续服务。随后收敛旧请求，建立唯一发布器。普通 main 合并可以继续；停止的是旁路部署、直接 production push、重复调度、hook 和 CLI/API 发布。

旧方案要求 main 与线上完全相同，并在任何 main 移动后重新等待整小时；正常合并会使它不断失效，现已替换。另一个可行顺序是先全部关闭、再用第二个 PR 开启 production，但会多一次切换、审查与 CI，因此不采用。关闭 main 之前必须已有本候选的可审阅实现、验证、回滚步骤和健康旧版证据；不要求先执行 seed 或初始化，否则又回到旧循环。

[Vercel Git 配置](https://vercel.com/docs/project-configuration/git-configuration)按提交自身的配置决定触发；任一匹配的 true 都允许部署。main-off 合并的 main 仅匹配 false；当前分支候选不会因 PR 推送创建 Preview。最终仍须读取该合并之后的实际 provider 记录，证明没有新增请求，不能把本地策略测试写成平台实测。

## 精确身份与两种 pin

| 对象 | 固定身份 |
| --- | --- |
| 仓库 | 公开 `getyak/leafhour`，ID `1415706040`，node `R_kgDOVGH1uA` |
| 原团队 | `team_nMU4o8gjejVzBhcnMfqgUQbJ` / `3293172751nss-1526s-projects` |
| 原项目 | `prj_yGvFacR0DlnmDASXb5vfbiRpCvhD` / `leafhour` |
| 正式域名 | `https://leafhour.com`，已验证、无重定向、无自定义环境或 Preview 绑定 |
| 现有发布身份 | `kubbot` / `U_kgDOB2nh3g`；复用既有 gh/Vercel 登录，不新增授权 |
| M | 操作时明确批准的**当前 main 完整 SHA**，已包含 main-off，配置只开 production |
| L/D | 旧链全部收敛后明确固定的**最后健康 legacy SHA / 实际 READY deployment ID** |

M 可以不同于 L。init 保存不可透明更改的 L/D、完整 provider inventory 和当时 M；以后正常 main 前进只需明确传入新的 M，不重建库、不跟随新线上来源改 L。L 必须是 M 的祖先，自身禁用 production 构建，自己的 main/push CI 最新有效 run 成功，D 的 team/project/repoId/GitSource/ref=main/source/Production/READY 全部精确匹配，正式 release、首页和匿名 session 健康。

bootstrap 和首次 enable 都不要求 M 已上线或它的 CI 已完成。main-off PR 自己仍须合并前门禁通过；固定控制器的工具树必须已经经审阅进入 main。**真正 tick/push 始终只接受当时最新 main 的最新同源成功 CI**，不能退而发布旧绿灯。这里省掉的是非发布动作对新 main CI 的不必要依赖。

## 旧请求必须先收敛

执行时完整分页读取原项目的全部部署，不把空的 BUILDING/QUEUED 列表等同于全量完成。任何缺字段、未知状态、分页异常、INITIALIZING/BUILDING/QUEUED 都阻塞。核对 L 以及从 L 到 M 的 first-parent 主线中曾允许 main 部署的提交：最新对应 Vercel receipt 必须终态；missing/pending 也阻塞，即使当前 active 列表为空。

协调方还须关闭已有操作记录中的每项已知未知结果，核对 provider 请求和 GitHub receipt；API 列表不能证明未记录的外部请求不存在。旧请求未闭合时不能 init/enable，不能把“又过一小时”当成结论。init 保存完整终态 inventory；seed、Branch Tracking 及首次 enable 前必须完全相同。之后 runtime 在预检及临发前还会重核旧 GitHub receipt，任何重新 missing/pending 都持久冻结；只接受本库已 arming 的 production 源产生的唯一新 provider receipt；迟到的旧链、外来或重复部署、历史 receipt 消失/变化都会冻结，不自动接纳新 legacy。

## 可执行顺序

以下步骤均待协调方开放执行窗口，本轮只准备源码。

1. 审阅最新 Draft PR、独审和该完整 head 的适用 CI；只正常合并 main-off PR。保持原健康部署服务。读取合并 SHA 的配置、Production 工作流与实际 provider 记录，确认 main-off 合并没有发布请求。普通 main 合并继续积累有用变更，不造空提交。
2. 等待旧链所有在途与已知未知结果收敛，选择并明确批准 L/D 和当前 M。重新检查原团队/项目/域名、repoId、deploy hooks=0、CI 和公共健康。不能直接沿用历史 f1/857/a0a 快照或把最新 main 自动当作 L。
3. 创建并读回字面 `production` 保护：禁止 force/delete、enforce admins、restrict pushes/creations、只允许现有 kubbot、至少要求 `CI gate` 并继承 main 全部 required contexts，严格 checks，无 bypass。发布指针不要求另开 PR，main 正常审查不变。核对完整 allowances、重叠规则/rulesets；权限失败不放宽规则。
4. 准备专属非临时 bare mirror/config，使用已验证现有 CLI 的绝对路径和 launchd 最小 PATH。执行 `check-stage --expected-main M --expected-legacy-source L --legacy-deployment D`。项目仍跟踪 main、main 已 exclusive、production ref 不存在、L/D 健康且旧请求全收敛才可继续。
5. **先 init，后 seed。** 相同三个参数执行 init，创建默认关闭的单一 SQLite/witness/lock。已有 DB/witness、已存在 ref、项目已跟踪 production 都拒绝初始化；不迁移旧 enabled 库，不换目录忘记历史。init 不发送 Git/Vercel 写请求。
6. 相同明确 pin 执行 seed。先再次核对，再把 M/L/D 的意图 fsync 到 witness、提交 SQL，最后发送一笔原子请求：`main M→M`、`production 0→L`，两项均 `force:false`。M 自身关 main，L 自身关 production，因此两条 Git 分支都不构建。GitHub [updateRefs 原子契约](https://docs.github.com/en/graphql/reference/git#updaterefs)保证任一断言失败就不修改其他 ref。真实执行后还要读回无额外同源 CI、Preview 或 provider 请求。
7. seed 回包丢失/报错时仅 `reconcile-seed`。ref=L 且 inventory 未变可确认；ref 空仍是 unknown，ref 异常则冻结。再次 seed 也只读 reconcile，不能重发。没有按错误字符串猜“明确拒绝”的自动恢复：即使 main CAS 竞争大概率未写，也须服务端确切拒绝证据和独审的离线恢复；原 intent/witness 保留。此保守边界只影响极短 CAS 竞争窗口，不要求冻结 main 一小时。
8. 记录 `tracking-intent` 后，在原项目 Settings → Environments → Production → Branch Tracking 只 Save 为 production，域名仍归 Production，**不点击 Deploy**。目前只有[官方后续 push 语义](https://vercel.com/docs/git#customizing-the-production-branch)，尚无本次真实操作无副作用回执；因此 tracking-intent 暂保留 init 的 3660 秒保守设置副作用下限。它不是要求 main==live、冻结 main 合并或让 seed 等一小时。若后续确切 UI/平台证据证明纯元数据且无请求，再经审阅移除这一单项下限；不能自行略过。界面如要求立即构建、新权限或目标变化，停在 Save 前交协调方。unknown 不重做 Save。
9. `tracking-confirm` 使用明确的当前 M 和固定 L/D，只读确认原项目已跟踪 production、ref=L、旧版公共健康、inventory 未变，且原 tracking intent 存在。额外或未知结果不能靠计时闭合。所有 legacy/bootstrap 结果收敛后，first enable 同样传三 pin，**重新持久化完整 3660 秒 hold**。M 的 CI 可继续运行；hold 不能从 init 或历史创建时间扣除。
10. 安装唯一用户 launchd，每300秒 tick；手动 tick 共用同一库/witness/锁，固定工具源码不自动跟随 main。到期后只选当时最新 main，要求该 SHA 最新 CI 成功，二次预检和原子 CAS。主线继续前进则这次不发布旧源。不得另开 cron/hook/workflow/CLI 发布链。
11. 两个真实合格窗口各保存 main/CI、journal/witness、ref、唯一 provider 请求、READY、同源 release 和 Production HTTP smoke。正常有用变更在窗口间积累，只发布最新合格源；没有变更就等待，不空提交凑数。只有单入口启用且两窗口真实验收完成才关闭 GET-314。

init 无发布副作用，seed 两个 source policy 都关闭对应分支，因此不套用旧的全局 legacy+一小时 bootstrap 等待。Branch Tracking 尚无真实无副作用证据，单独保守处理；真正发布一定在所有结果闭合后的 enable+3660 之后。任何意外真实请求都会冻结并重新核算发布下限，不能用 enable 后的 hold 补救此前意外发布。

## 持久状态与恢复

单库保留 immutable handover 和 seed/tracking 各自的 uncertain/confirmed 操作。offline status 显示固定 legacy/deployment 和每个操作的状态/请求时间，不隐藏持久 unknown，也不输出请求 payload。意图先写独立 witness 并 fsync，再 SQL commit，再允许外部操作；恢复旧 DB、换 inode、改 L/D、删 witness、重复 arm 均拒绝。unknown 跨小时/重启保持，所有入口共用 OS 锁；写请求子进程继承锁，父进程退出不代表请求终止。

runtime 原有幂等、事务、120秒 lease、3660秒最小窗口、authenticated Date + suspend-aware continuous clock、latest-main CI、no-force CAS 和 provider/public-source 验收保留。disable 离线，不清除 cooldown、intent、ref 或未知结果。丢库/旧备份恢复须先停唯一调度、核对持锁子进程和全部请求、保留原证据，再准备独审的离线恢复；绝不透明重建 enabled 库。

## 分阶段退出

| 阶段 | 退出方式 |
| --- | --- |
| main-off 未合并 | 不合并；本次没有远端修改 |
| main-off 已合并但未 init | 原健康版继续服务，待发布 main 可继续积累；不为恢复自动发布临时打开旁路 |
| 已 init/seed、尚未启用 | 保持 disabled，保留库/witness/引用/保护及操作意图；unknown 只读收敛 |
| 已跟踪 production/enable | 先 offline disable、卸载本任务调度，核清 sending/uncertain/accepted 与所有操作；保留状态 |
| 确定恢复旧链 | 所有请求收敛且最大有效发布锚+3660后，先将项目跟回仍禁用 main 的来源，读回无新请求；最后正常审查 PR 恢复 main-only。该合并可能发布，不能在冷却内执行 |

不强推、不删 production、不 promote/rollback 试验、不新增凭据或付费。恢复旧链意味着小时限制不再生效，GET-314 保持 In Progress。

## 历史事实与验收边界

2026-11-07 旧链 f1 部署 `dpl_G1RQW9yT48MXb4adz1boGuhFmL51` created 01:49:16.792Z；外部 PR339 的 857 部署 `dpl_ZA7XWokuCiq3P9PaDgQsE2MDiLFv` created 02:46:07.869Z，间隔 **3411.077秒**；外部 PR331 的 a0a 部署 `dpl_FdeerEi2WrCjhB5XSPE8cURw1scQ` created 03:01:17.306Z，间隔 **909.437秒**。它们发生在小时入口未启用时，不是成功限流证据。f1/857 的旧健康观察、旧时间下限和 fdc3 候选 CI 都是历史，不能复用为新执行授权。

离线测试只证明协议和策略。provider/HTTP 无请求读回、Branch Tracking 实测、唯一调度、两个真实窗口均未完成。当前阶段不做真实账号/书房/模型/UI 验收。
