# GET-147 阅读时间口径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 用户已授权本聊天连续直接执行；不等待通用设计审批。Codex 实现后开启未参与实现的独立 Codex sub-agent review。

**Goal:** 让读者按明确口径记录、暂停和带走自己的前台估计、主动专注及手动补记时间，重叠不重复累计。

**Architecture:** 复用现有 reading clock、owner/book 队列、领域记录 CAS、备份校验和日历的区间并集。新增严格来源策略及手动记录小模块，不另建数据库、不启动自动追踪、不改变模型或 MCP 授权。现有 reader_focus 保留原义，旧预览数据继续排除。

**Tech Stack:** Node22 / 原生 ES modules / HTML CSS / node:test；现有 Supabase 托管存储与 Vercel 发布。

**Spec:** [原 issue](https://linear.app/getyak/issue/GET-147/记录能暂停口径清楚的阅读与专注时间)、[_briefs/private-library-architecture.md](../../../_briefs/private-library-architecture.md) 阅读时间段落，以及下方固定标准。

## Global Constraints

- 基线 `4cce4020bb7f1720eea77a2ea2207019aebb9823`，独立 worktree / branch `codex/get-147-reading-time`；与其他聊天的 PDF PR80 独立，合并前重同步。
- 原 issue 六项验收全部覆盖；无排行榜、掌握证明、虚构学习成果、后台计时、Agent 访问计时或付费模型请求。
- 测试前 storage audit；只跑 Web/宿主测试，串行复用工具，不启动 Simulator。正式证据存本聊天 issues/GET-147，可重建产物登记在 `/private/tmp/ai-test-get-147-reading-time.gKAnJx`。
- 默认生产账号 test@cubxxw.com，执行前核实真实 UID；只改明确命名合成书，保护其他书。凭据不进源码、日志与证据。
- 设计/标准先冻结，相关红绿测试、独立 review、当前 head 全 CI 与构建、正常合并、真实生产验收后才 Done。

## 事实、方案比较与选择

基线可控时间/记录/备份/队列相关 50 项通过，日志 baseline-tests.log。现有 clock 仅产出 reader_focus；normalizeReadingSession 拒绝估计与手动来源；calendar 只读 reader_focus；UI 只有开始/暂停，没有口径选择/补记入口。已有 visibility/focus/freeze/pagehide、5秒采样断档、30秒 checkpoint、跨页独占 session key、sequence 防重、跨设备区间并集与时区拆日，保留而不重写。

仅改文案不能让来源可核对；默认自动追踪会擅增记录并与现有明确开始的契约冲突；增加平行计时/数据库会重复恢复与去重逻辑。选择在现有记录上扩展严格来源，并由用户每次明确选择开始。新增前台估计也不默认开启。

### 固定设计决定

1. 来源仅 `reader_focus` 主动专注、`reader_estimate` 前台估计、`manual` 手动补记（自报）。共享纯模块 `reading-time-policy.mjs` 提供 `isReadingTimeSource`、`readingTimeSourceLabel`、`ESTIMATE_IDLE_MS=120000` 及固定说明。缺失来源旧客户端仍归 reader_focus；design_preview_focus_timer 保留可恢复但不进入正式统计，agent/未知来源拒绝，不重新贴可信标签。
2. clock.start 新增可选 source，仅接受两种实时来源；一轮不能中途换来源。默认仍主动专注。主动专注只要求前台可见且窗口聚焦、明确未暂停，不要求滚动或鼠标证明思考；前台估计 2 分钟没有可信键盘/指针/滚动操作即在截止时暂停估计，恢复前台操作才从恢复时重新计。任何隐藏/失焦/手动暂停都不计；活动不会解除用户主动暂停。5秒采样断档取最后已观察时间，24小时/120段上限及单调时间仍有效。
3. estimate 的可信活动由 DOM isTrusted 事件触发 clock.activity；1秒 view 仅观察不当作用户操作。页面返回不补算隐藏/闲置区间。异常退出可能不触发 pagehide，只保留已同步/本机 checkpoint，不能宣称零丢失或推断中断期间仍在阅读。
4. normalizeReadingSession 输出实际 source，仍从 segments 计算时长、核对书/版本/真实锚点/时区/边界。manual 只能 finished、sequence1、单个正区间且恰好等于开始/结束，最长24小时、结束不得晚于服务端 now；不接受声称的 duration 或修改来源。manual 同ID完全相同幂等，改变时间/锚点/区间409，不拼接成新手动时长；自动记录继续原 sequence 单调合并规则。
5. 手动补记在阅读工具内独立对话框，明确自报、当前书及锚点、设备时区和最多24小时。开始/结束 datetime-local 由设备本地时间转带偏移实际时刻，逐字段回读校验拒绝不存在的日期/DST时刻；同名重复时间按设备所选偏移并显示提交的实际时刻供核对。打开时暂停实时记录，关闭不自动恢复。提交前冻结ID和内容，通过现有 own-session queue/outbox持久化再请求；丢应答/失败保留原ID重试，已冻结字段禁改。刷新由既有队列续传；未提交输入关闭/刷新会丢失，界面明说。存储失败的冻结手动记录仍留内存，可重试及既有另存恢复入口，不冒充已存本机/书房。
6. 日历/月总数取所有认可来源、所有书/设备的实际区间并集。新增 `sourceDurationSeconds` 三项分别按该来源的区间并集；每书同样提供。分来源之间可能重叠，因此不可直接相加，UI明确解释；日历明细每条展示来源、实际开始结束时间/时区及原文链接。总时长不证明理解。用户评论/问题/读完标记保持独立，Agent只读和无来源预览不增加时间。
7. 备份 validate / retained pending / clean restore merge 使用同一来源和严格校验；多来源真实记录完整往返，未知/损坏包整包拒绝且不部分写入，源ID冲突409。旧 reader_focus、旧队列/备份/ending 保持兼容。新的来源不导出权限/密钥，不扩大外部MCP写入口。
8. UI口径选择只对新一轮生效，进行中/暂停时禁用并标出被冻结来源。不同状态文案区分估计闲置与用户暂停；结束回执保留来源。390/768/1440和紧凑视口原生 select、时间输入、键盘焦点、错误恢复、dialog滚动验收。新模块加入 release-files；无新增依赖。

## 实现前固定验收 T1–T9

| ID | 场景与期望 | 验证方法 | 失败条件 |
|---|---|---|---|
| T1 | focus默认/旧请求仍focus；estimate/manual保留真实来源；agent/未知/来源冲突拒绝且旧数据不变 | 严格normalize、正式服务/HTTP与旧格式回归 | 新来源全被改成focus、坏输入部分写入或旧预览变可信 |
| T2 | focus前台静止思考10分钟正常累计；estimate无操作120秒截止，操作后仅从当下继续；用户pause不会被活动自动解除 | 可控时间clock，真实UI入口/状态 | 要求滚动才算专注、估计无限计或补算闲置 |
| T3 | 两实时来源隐藏/失焦/冻结/pagehide/暂停期间不计；5秒采样中断不补算；重复结束与恢复不重复 | clock+coordinator/生命周期集成与正式浏览器失焦 | 后台持续计、突然补算、丢旧区间或重开旧finished |
| T4 | manual明确自报/时区/锚点，严格正单区间<=24h且非未来；时间不真实/顺序错误拒绝；相同ID幂等、改内容409 | shared helper、实际存储/HTTP、真实表单 | 冒充观察时间、非法日期/DST归一化、重复叠加或坏锚点 |
| T5 | 重叠focus10分+estimate10分（重叠5分）+manual10分（再重叠5分），总20分，各来源10分；多书/设备同规则，跨午夜/DST真实耗时拆分 | 手算expected的calendar与service测试 | 总30分、来源丢失、跨日/时区错误、每日明细不可核对 |
| T6 | 手动失败/丢ACK/存储失败保留同ID冻结请求；owner/book队列隔离、刷新续传；内存数据可另存；成功回执真实 | controller+outbox真实存储/服务、浏览器失败恢复 | 新ID重试、先报保存、字段变更覆盖待确认数据或漏掉内存快照 |
| T7 | 三来源备份/未同步导出/干净实例恢复语义一致；旧focus/preview兼容；坏包整体拒绝，Agent内容只读无时段 | clean restore与真实存储快照、HTTP拒绝、相关回归 | 少来源、错误合并、跨账号读取、Agent访问增时 |
| T8 | 发送/计时入口清楚说明各口径、2分钟闲置、前后台暂停、自报与总/分来源重叠；390/768/1440无溢出，键盘可完成选择/补记/错误恢复，原文锚点不丢 | 正式渲染截图/DOM宽度/原生键盘、integration | 藏说明、无标签select、状态虚报、统计宣称掌握 |
| T9 | 未实施者独立Codex review，P0/P1修复复核；准确head全部CI/构建后正常merge，实际生产source/业务/默认账号及数据清理合格才Done | reviewer、CI/merge/deploy/API/UI/Linear读回 | 自审、旧head绿灯、未部署/未验收就关闭、真实模型调用或修改其他用户书籍 |

## Review Focus

- 页面隐藏前后的采样和estimate闲置截止同时发生，不能重开截止后的区间（Task1 clock边界用例）。
- manual ACK丢失后改输入或再次点击，必须继续原冻结ID（Task2真实outbox/controller和UI用例）。
- 客户端本地日期遇DST空洞或设备时区与记录不同，不悄悄挪动用户填写时间（Task2严格转换与时区测试）。
- 同ID跨来源/恢复包冲突，不能在旧source分支漏掉normalizer（Task1/2领域restore负例）。
- 分来源合计超过去重总数时界面仍解释得通，时间不替代掌握或用户主动读完（Task3重叠明细与真实截图）。

## Task 1：来源、实时钟表与统计/恢复契约

**Files:** Create app/reading-time-policy.mjs; Modify reading-session-record.mjs, reading-clock.mjs, reading-journey.mjs, library-backup.mjs, reading-retained-backup.mjs, server/reading-activity.mjs, server/library-service.mjs; tests/reading-time-sources.test.mjs + related existing tests.

**Interfaces:** `isReadingTimeSource(value)`; `readingTimeSourceLabel(value)`；clock.start({...,source='reader_focus'})、clock.activity()、view().source/idle；calendar day/book/month.sourceDurationSeconds严格三个键。

- [ ] 先写source保留、manual严格区间/身份冲突、focus静思/estimate闲置恢复、三来源手算重叠和恢复失败红测，确认因缺功能而失败。
- [ ] 最小实现共享策略、normalizer和clock；更新calendar/journey/备份与恢复分支。
- [ ] 运行新增及原clock/activity/calendar/queue/pending/restore相关测试，预期全通过；保留red/green日志并提交。

## Task 2：手动补记与实时口径 UI

**Files:** Create app/reading-manual.mjs; Modify app/reading-session.js, app/index.html, app/reading-session.css；tests/reading-manual.test.mjs、正式UI integration。

**Interfaces:** `manualReadingSession({id,book,anchor,timeZone,startedAt,endedAt},now)`严格转成manual snapshot；`localReadingTimestamp(local)`逐字段回读；`createManualReadingAction({build,own,enqueue,flush,confirmed})`的submit(input)/pending()/retry()冻结请求，confirmed成功后才释放pending。调用方把所有内存pending并入已有恢复包。

- [ ] 先写真实转换与outbox持久化/丢ACK/存储失败/重复输入的失败测试。
- [ ] 实现小模块和现有UI绑定，口径select/说明/手动dialog/键盘标签/错误回执；estimate可信活动与原生命周期合用。
- [ ] 运行相关UI integration与领域测试；确认新模块不包含时钟/DOM测试专用API；提交。

## Task 3：日历可核对明细、说明与交付

**Files:** Modify app/reading-dashboard.mjs, release-files.json, README.md；Create docs/reading-time.md, docs/verification/2026-10-17-get-147-reading-time.md；正式证据在本聊天目录。

**Interfaces:** 消费Task1 sourceDurationSeconds及明细source，显示三来源标签和区间；总数和分来源都用既有分钟显示函数。

- [ ] 新增真实日历渲染检查；实现来源分项/来源标签/时间明细与总数关系说明，公开运行及恢复边界文档。
- [ ] 正式服务合成书验收三种来源、失败/重试、恢复与owner隔离；390/768/1440及紧凑视口/键盘截图；0模型调用。
- [ ] 独立Codex review完整diff/固定标准/测试，修复并复核；准确提交全部CI构建正常合并后按现有发布流程验生产，Done读回和精确产物清理。

## 参考与边界

已在实现当日核对 [Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)、[pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)、[datetime-local](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local)：可见和聚焦是不同信号，后台计时会被节流，关闭事件不能保证总发生；datetime-local不含时区。因此继续结合现有信号/采样、有限checkpoint和显式设备时区，不把页面打开当作实际阅读证明。不新增依赖或另建计时服务。
