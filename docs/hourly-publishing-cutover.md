# GET-314 小时发布切换清单

2026-11-07，基线 `f1d0981ca332f5cfc989f6655061a977ff05b029`。[PR333](https://github.com/getyak/leafhour/pull/333)的持久控制器已合并；本次只准备独立切换候选、只读readiness与执行顺序，**不授权或执行远端保护/引用创建、seed/init/enable、调度安装、Vercel设置修改或新部署**。草稿不能在协调方审完readiness前合并。正常发布的创建、成功、同源HTTP和验收分别记账。

## 当前准确对象

| 对象 | 只读核对结果 |
| --- | --- |
| 仓库 | 公开 `getyak/leafhour`，GitHub ID `1415706040` / node `R_kgDOVGH1uA` |
| 现有发布身份 | `kubbot` / `U_kgDOB2nh3g`，既有 `gh` 为ADMIN；没有新增账号或授权 |
| 原团队 | `team_nMU4o8gjejVzBhcnMfqgUQbJ` / `3293172751nss-1526s-projects` |
| 原项目 | `prj_yGvFacR0DlnmDASXb5vfbiRpCvhD` / `leafhour`，GitHub链接repoId精确相同 |
| 正式域名 | `https://leafhour.com`，已验证、无redirect、无自定义环境或单独gitBranch绑定 |
| 现有链 | Vercel Production Branch为main，远端main的策略仅开启main；production引用、分支保护与rulesets均不存在，deploy hooks为0 |
| 唯一已批准的恢复发布 | `dpl_G1RQW9yT48MXb4adz1boGuhFmL51`，GitSource固定f1d0981/main，实际READY；不能用旧7efdf7c或另一部署替代 |
| 最新同源CI | [42320052538](https://github.com/getyak/leafhour/actions/runs/42320052538)，main/push/CI/completed/success |
| 原项目读取 | 已有缓存Vercel CLI65.12.1的正常登录，可执行控制器同形的GET读取；旧MCP403不等于CLI无权限 |

原团队已经恢复，旧Account blocked/402是恢复前事实。协调方02:09:04Z独立核对正式来源及三项静态资产精确命中f1。当前任务随后只读GET release.json也为200/f1，没有登录、书房读取或模型请求。该快照不能代替执行窗口的重新核对，也不把恢复写成小时入口已启用。

## 种子与时间下限

| f1真实事件 | UTC | 北京时间 |
| --- | --- | --- |
| 供应商createdAt | 01:49:16.792 | 09:49:16.792 |
| 供应商READY | 02:04:46.586 | 10:04:46.586 |
| 协调方独立健康锚 | 02:09:04 | 10:09:04 |
| 仅由上述健康锚计算的3660秒下限 | 03:10:04 | 11:10:04 |
| 本任务随后同源200只读观察 | 02:14:07.740435 | 10:14:07.740435 |
| 计入该更晚观察后的3660秒下限 | 03:15:07.740435 | 11:15:07.740435 |

时间均为2026-11-07。以最晚已核对事件保守起算，不能从恢复前旧7ef的创建时间、整点、最早请求或第一次失败重试起算。实际首发条件是：

`Tfirst >= max(最新有效legacy观察时间, init服务时钟, enable服务时钟) + 3660秒`。

init在健康legacy和合法种子成立后才建默认关闭库；enable在独占链检查通过后**重新**持久化完整3660秒等待。当前控制器这两个动作均保持该下限，不允许通过“早就过了一小时”缩短enable等待。新观察、迟到的旧请求、另一真实部署或晚执行只能延后，不会把03:10:04Z当成定时授权。任何sending/uncertain/accepted未收敛时，无论过多久都不发下一次。

首次种子只准 `refs/heads/production = f1d0981ca332f5cfc989f6655061a977ff05b029`，该commit自身的 `vercel.json` 禁用production，项目此时仍跟踪main。先重新验证远端main、正式来源和CI都仍为f1、无活动部署；任何一项变化就停止并更新交接记录，不改为另一个SHA继续。

seed使用现有 `ref_request` 生成一份原子 `updateRefs` 数据：main的before/after均为完整f1，production的before为40个0、after为完整f1，两项均 `force:false`。这不是执行脚本。响应未知只读核对，不重复seed；已有合法f1种子只读返回。必须另外确认该no-op main断言及production创建没有触发CI、Preview或部署；出现额外事件立即停止，不能先enable再解释。

## 严格保护提案

精确审阅数据在 [cutover-plan.json](../deploy/hourly-publisher/cutover-plan.json)。只作用字面pattern `production`，不改main、不新增用户/App/Secret：

1. 禁止force和deletion，enforce admins，restrict pushes，branch creation也受限制；唯一push actor为已有kubbot。无force/PR bypass actor。
2. requires status checks，至少要求 `CI gate` 并继承执行时main的全部required contexts；当前main没有额外保护context。严格检查开启。该分支只是经审阅main源码的发布指针，故不要求另开PR来推进它；main正常PR审查仍保留。允许已有main merge commits，不开启linear-history限制。
3. 创建后读取rule ID、所有字段、完整allowances及分页，核对没有宽泛重叠pattern或ruleset。不能因为创建失败而去掉enforce、放宽actor或使用bypass。现有ADMIN只是可用权限的证据，不是本阶段变更保护的授权。
4. 保存新建rule ID及原“无此规则”快照。若在seed之前放弃且仍无production引用，可以在单独获准后只删除本次rule；seed之后保留规则和引用，不以删除分支来回滚。

字段按[GitHub官方GraphQL定义](https://docs.github.com/en/graphql/reference/branches#createbranchprotectionruleinput)准备。实际创建前重读schema与目标，任何新权限需求都交协调方审阅，不能自行增加token权限。

## 单入口执行顺序

以下全部是待协调方开放执行窗口后的步骤。本阶段未执行。

1. 协调方冻结常规合并、CLI/API部署与其他publication writer。只读核对精确f1、最新CI、原团队/项目/域名、所有INITIALIZING/BUILDING/QUEUED分页和deploy hooks；记录可信GitHub HTTP Date与供应商事件。恢复后f1已发布，不补发它，也不以空提交制造一次发布。
2. 建并读回上述production保护。在私有专属目录准备bare mirror与现有凭据路径；不复制凭据、不新建token或hook。独立镜像不碰用户checkout。本阶段不先创建该运行目录或状态库。精确bootstrap参数随本切换PR新增，故bootstrap工具固定到已独审且该完整SHA的适用CI通过的候选，由协调方单独批准仅check-stage/seed/init；无需为先发布工具而产生另一legacy部署。远端来源始终从镜像中的f1读取，不采用候选工作树的Vercel配置；正式enable前必须证明该工具树已经包含在通过main CI的切换合并中，且未发生变化。
3. check-stage、seed和init均传 `--expected-source f1d0981ca332f5cfc989f6655061a977ff05b029`，禁止不固定来源的通用bootstrap。seed/init缺参数时在联网和创建状态前失败；CLI检查main及已有seed，seed内部再次读取stage并核对，再由同一完整SHA构造原子CAS。任何变化都停止，不能选另一已上线main继续。确认seed无额外事件后，init默认关闭的SQLite、独立witness和lock，保存其身份、来源与cooldown。已有库或witness不得覆盖。用同一用户和launchd最小PATH只读核对CLI；vc.js依赖env node，模板须填已验证Node目录。缓存CLI或工具摘要改变、消失时关闭并复核，不自动重装。
4. 协调方审阅保护、seed、inactive状态和当前切换PR的CI/独审，确认替代入口确实可用。之后才将草稿转为可合并并正常合并。差异仅将Git policy从main-only变为production-only；所有其他Vercel设置不变。该main push必须没有部署。保存实际merge SHA，等待它自己的最新main CI成功；不拿f1的CI替代它。
5. 在原项目 Settings → Environments → Production → Branch Tracking，将main改为production，域名仍归Production。此时production仍指向自身禁用production构建的f1种子；如果界面提示立即构建/另建部署、目标变化或需要新权限，先停止给协调方，不能点击试验。官方文档描述后续push触发发布，具体界面和实际无额外部署仍需读回。[Vercel官方说明](https://vercel.com/docs/git#customizing-the-production-branch)。现有MCP update_project未提供该字段，不向通用PATCH猜字段或用domain Preview绑定替代它。
6. 运行check，重新核对原项目已跟踪production、当前main的exclusive policy、保护、身份、无在途部署和仍健康的f1。当前main须是协调方已冻结并批准的切换merge SHA；如果移动，重新审阅首发对象。成功才enable，记录新的完整3660秒hold；以更晚下限为准。
7. 安装本任务唯一用户launchd项，每300秒tick。人工tick也共用同一状态库、witness和OS锁。保持其他cron、hook、直接Vercel发布或production push旁路关闭；现有身份不能作为旁路理由。首发推进至当时批准的最新合格main，保存原子CAS和唯一provider请求证据；仍旧线上f1不算首发成功。
8. 两个真实合格窗口分别保存source/最新CI、journal/witness事件、ref、provider状态、同源release.json和Production HTTP smoke。在窗口间有正常有用变更时证明中间源没有各自部署；无实际变更则等待，不造空提交凑两次。只有唯一入口真正启用且两窗口验收完成才Done。

仓库Git策略的匹配规则已核对：[任一匹配true可部署](https://vercel.com/docs/project-configuration/git-configuration)。因此保留 `"**":false`、只显式开启 `production`，不留main=true或任何Preview通配true。GitHub Production工作流只验收，不创建发布，也不新增CI写权限。

## 状态、时钟与恢复

SQLite与独立witness放同一专属非临时目录，目录700、文件600。arm先fsync witness，再SQL commit，再外部请求；每次事务核对DB inode/device及全部armed记录。锁描述符传给外部写请求子进程。主进程退出不等于请求终止，unknown不超时自动重试；远端已到目标只读确认accepted，仍在旧ref不能证明未发。

时间只来自已认证GitHub响应Date，加包含系统睡眠的连续时间；往返大于30秒、快照大于120秒、时钟倒退均fail closed。Mac不能换成不含睡眠的monotonic。最小3660秒保守覆盖Date秒精度与跨进程传输误差；该约束、同源幂等和cooldown不因disable/re-enable、失败或重启重置。

丢库、替换/原地覆盖旧库、损坏witness或回滚镜像都不走透明恢复。先disable并卸载本项调度、查清所有持锁子进程及在途请求，保留原库/witness和每次arm的远端证据，再准备独立审阅的离线恢复；不同时回滚DB与witness，不重建enabled库，不通过新目录忘记历史。新安全访问如确有必要，先提交具体目标、最小权限、用途、失效/撤销和回滚材料。

## 分阶段回滚

| 发生阶段 | 动作及边界 |
| --- | --- |
| 草稿未合并、未seed | 不合并即可，线上f1及main链无改变；没有发布器可停 |
| 已seed/init但源码未切 | 默认关闭，保留库/witness/引用/保护；main链不变；不用删ref或重建库 |
| 已合并但项目仍main | main Git已禁用，f1继续服务；不要打开另一条链来“测试”。暂停并修复readiness；若退出，用正常审阅PR恢复main-only前先确认替代入口关闭及时间下限 |
| 项目已production或发布器已enable | 先offline disable、卸载本项launchd，核清sending/uncertain/accepted；不强推、不删ref。等待所有结果和最大冷却下限，再将项目跟踪回main（source main仍禁用），读回无新部署；最后正常PR恢复main-only，此次合并才恢复旧链 |

任意回滚都不能在冷却内产生第二个真实部署；项目设置若会立即部署就停在前一步交协调方。健康f1回退目标保留，不自动promote或rollback；这两类动作也可能改变发布/域名，不能当“只读恢复”。恢复legacy表示小时限制未生效，GET-314继续In Progress。紧急打破时间窗需要用户明确要求，不能从旧额度恢复推断。

本次readiness与时间回执保存在任务永久证据目录 `get314-cutover/`；PR333的30项Python、61项Node、独审和两次六项CI证据不改写成本次重新执行。本候选的本地检查、独立审查和PR CI另记，不以它们冒称远端设置或真实窗口验收已完成。
