# R5–R8 独立审阅

日期：2026-11-05。审阅对象为 `codex/reading-experience-20261105` 工作区，读取时 HEAD 为 `7f38fb01`，包含当时未提交的目录集成与取消修复。以当前源文件为准，未把较旧的 `ai-contents.diff` 当成最终代码。本审阅只写文档，没有修改产品代码、重复运行测试、启动构建或调用真实模型。

最新状态见文末“限定复审”。以下首轮结论、问题与评分保留为审阅快照。

## 两项结论（首轮快照）

**规格审阅：需要修改。** 默认前导、普通回复追问、目录全文与独立 AI 搜索均已接入。前导使用独立赞助路径，搜索目的地由当前书的真实原文验证，方向符合 R5–R8。但导览追问存在丢发送的并发路径，AI 搜索恢复没有绑定当前问题，AI 前导被写入用户提问字段，全文结果也缺少明确的命中强调与段落位置。这些问题修复前不能验收相关需求。

**代码质量审阅：需要修改。** 没有确认的 P1。当前 P2 见下文。独立搜索 worker、草稿 namespace、请求幂等恢复和严格引用验证值得保留。主要应收拢重复加载入口，并把用户问句、AI 上下文与被冻结搜索问题分别建模。没有发现通过摘要链接伪造可跳转位置的路径，也没有发现为目录搜索读取普通聊天历史或私人笔记的路径。

## P2 记录（首轮快照）

### F1：导览追问会被两次并发加载静默丢弃

位置：`apps/ios/Leafhour/ReaderPanels.swift:76-78`；`ReaderToolPanels.swift:285-289`；`ReaderCloudTools.swift:423-430`、`:311`。

触发：已登录的云书打开 AI 前导，点一个追问。点击先切换到 conversation 面板。新面板自动加载会话，点击闭包自身也调用一次 `loadConversation`。让点击链发出的 GET 先返回，面板发出的 GET 后返回。后者已替换 generation，前者直接返回，而 `loading` 仍为 true。紧接着 `sendGuideFollowUp` 的门禁失败，未发送请求，也没有向读者解释失败。

应只有一个会话准备任务。发送入口应等待该任务完成后取得发送锁，或先完成唯一加载与冻结发送，再展示聊天。建议用两个延迟不同的 GET 覆盖该顺序，断言点击只产生一个提问 POST。现有直接追问测试绕过此面板集成，不能排除本问题。

### F2：恢复旧 AI 搜索后，结果会挂在新问题下面

位置：`apps/ios/Leafhour/ContentsAISearch.swift:32-50`；`ReaderContentsPanel.swift:120`、`:142-151`。

触发：Q1 搜索已提交，停止请求返回 503，设备保留原 intent。把输入改成 Q2，再点“核对上次搜索”。恢复分支正确复用 Q1 的请求 ID 与 body，但没有恢复或展示 Q1 的问题，也不比较 Q2 与被冻结问题。Q1 完成后直接发布其 matches，界面仍显示 Q2。重启后首次发现待恢复 intent 的路径也有相同归属缺口。

旧请求应继续用同一 ID 恢复。恢复结果必须明确显示被冻结的 Q1，或放入单独的上次结果状态，不能作为 Q2 的结果呈现。现有取消测试已证明不会另发一笔 POST，但未检查恢复后问题与结果的一致性。

### F3：AI 导览正文进入了用户原话字段

位置：`apps/ios/Leafhour/ReaderCloudTools.swift:317-319`、`:522-524`、`:570`；`ChatConversationView.swift:689-709`。

触发：点导览追问。实际发送的 `body.text` 是追问加整段 `guide.text`，随后整段保存为 `ReaderConversationTurn.question`。聊天把它作为 user 消息展示、复制和分享。虽然字符串内注明了 AI 前导，数据结构仍把 AI 正文装进用户提问字段。导出或后续处理用户原话时无法可靠分离。

用户提问只保存点击的问句。导览 ID、来源版本、AI 文本应进入独立的上下文字段，并保留明确的 AI 归属。两种聊天路由都应核验该字段。正常历史回复的追问使用 `replyTo` 关联已存 assistant，已有这条归属清楚的路径。

### F4：全文结果没有显示具体命中及可读位置

位置：`apps/ios/Leafhour/ReaderContentsPanel.swift:84-85`、`:152-158`。

触发：同一章中多段正文命中同一个词。`BookSearch` 已返回 before/match/after 和精确 anchor，但面板把三者拼成一个普通 `Text`，没有强调 match，也未展示第几段或其他可读位置。读者只能看到若干相似片段，无法在点击前辨认命中处。四行截断还可能把靠后的命中文字隐藏。

保留 excerpt 的结构来强调真实命中，并从当前章节的实际段落计算位置标签。AI 结果也应给出可读位置。点击仍使用原 anchor，不能根据展示行号重建位置。

## 已核对的边界

- 前导在 `ReaderScreen` 独立 task 中准备，未加入正文打开 await 链。设备取样在后台完成，最多 6 段、6000 scalar、18000 编码字节；扫描无文字返回明确错误。服务端取样范围按实际发送文本计算，云书重新核验版本，取消后不保存迟到结果。
- `/api/library/reading-guide` 经会话身份检查，进入 `funding=sponsored`、`feature=reading-guide`，没有普通聊天报价或扣点入口。缓存服务按 owner/source/book/version/locale/policy 隔离，设备落盘还受账号书房目录检查。服务端无模型配置时返回不可用，没有静默切为普通付费聊天。
- 普通回复的追问同步取得发送锁，冻结问题与父回复；`preserveComposer` 保留文字、录音和消息引用，不把旧音频附到追问。失败、取消和流式片段没有可点建议。旧历史可从真实回答派生建议。
- AI 搜索使用独立 worker 和 `contents-search:` 草稿，提交前清空 turns，首次请求 history 为空。当前下载快照走本机只读 relay，云端书身份不扩大读取范围。未确认取消保留 ID/body；只有明确的同 ID cancelled 或尚未提交的 404 才退休设备请求。
- `ContentsSourceIndex` 核验 book/source/contentVersion、local-device、original、真实 chapter/passage 和字面 Unicode quote。没有偏移时拒绝重复引句；显式偏移仍重新核对原文。摘要、外链和模型标题不会成为导航目标。
- 原版 PDF 点击由当前 `PDFPage.string`、有效 UTF-16 range 和真实 selection 生成 pageY；文字层不符时拒绝精确定位并说明可点章节打开原页。当前尚无真实 PDF 点击验收证据。

此前发现的“`x < y` 或 URL 回答让追问少于三条”已在当前 `ChatFollowUps.swift` 增加安全的最终三条回退，并预滤 URL。此处已静态复核修复。新增回归的运行结果由统一验证补齐，不把旧 Core 日志当成该修复已通过。

## 证据与评分

评分按总规格的功能 30、交互 25、性能 25、边界与可访问性 20 分。下表只计已经观察到的自动化证据。静态可见的路径不代替设备操作，未测项不补分。这里的分数是已验证小计，不能解释为产品最终质量分，也不能据此宣称达到 95。

| 需求 | 功能 /30 | 交互 /25 | 性能 /25 | 边界与可访问性 /20 | 已验证小计 | 仍待验证上限 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R5 每书前导 | 18 | 0 | 0 | 12 | 30/100 | 70 |
| R6 三个追问 | 12 | 8 | 0 | 6 | 26/100 | 74 |
| R7 目录全文 | 14 | 0 | 0 | 8 | 22/100 | 78 |
| R8 目录 AI 搜索 | 14 | 6 | 0 | 10 | 30/100 | 70 |

R5 得分来自取样/无文字 Core 测试、Node 服务与 HTTP 身份/赞助/缓存/取消夹具，以及 App 版本缓存测试。R6 得分来自常规三条/去重/锚点 Core 测试，App 延迟发送、双击、草稿与语音保留测试。未把本轮新修 fallback 算入通过。R7 计真实章节顺序、标题/PDF页码、本机正文与标量锚点测试。没有目录画面和真实 PDF 落点得分。R8 计严格 sourceRefs 的 Core 测试和三项 App 搜索协议测试，未计真实模型语义质量或恢复问题绑定。

已只读核对 `/tmp/leafhour-reading-experience-20261105/core-integrated.log`：384 项执行、2 项既有夹具跳过、0 失败。ReadingGuideTests 四项和 ContentsSourceTests 五项通过。Node 137 项通过来自实施记录与主任务提供的结果，本审阅未重复运行。`features-native-v3.log` 中本领域三个 ContentsSearchAppTests、direct-follow-up、snapshot namespace、guide cache 均已显示 passed。同次全量运行存在其他测试失败，不能称整个 App 回归通过。该日志所编译快照早于本轮后续修复。

还需补齐真实模型的导览与追问质量、真实语义检索、窄屏/横屏/大字/VoiceOver、真实 PDF selection 跳转和大型书搜索/冷开性能。没有真机、生产部署或 TestFlight 验收证据。当前 P2 修复后须按受影响范围验证，再重新给出规格与代码结论。

## 限定复审

复审日期同为 2026-11-05。读取时 HEAD 为 `cde04593`，另含父任务尚未提交的面板与目录修复。仅复核 F1–F4 和 R6 兜底，不扩展扫描，没有运行测试或构建。

| 项目 | 复审状态 | 对应修复与证据 |
| --- | --- | --- |
| F1 重复加载及冷启动草稿 | 已闭合 | `ReaderCloudTools.swift:195-200` 的 `prepareGuideConversation` 统一 configure、云书草稿恢复、draftError/既有 retry 保护及唯一加载。`ReaderPanels.swift:80-82` 调用该入口，`ReaderScreen.swift:679-681` 核对仍在前台导览后展示 `autoLoad=false` 的聊天。冷启动文字/语音/未确认请求恢复及预加载不重复读取的两项 App 回归已通过 |
| F2 Q1/Q2 搜索归属 | 已闭合 | `ContentsAISearch.swift:35`、`:84-87` 从原 intent 的完整固定 prompt 提取被冻结的问题。`ReaderContentsPanel.swift:130` 标“上次搜索”，`:149-151` 显示“结果对应 Q1”。`testRecoveryKeepsTheFrozenQuestionSeparateFromNewInputAndReusesItsRequest` 已通过，并断言恢复后仍对应 Q1，POST 总数仍为 1 |
| F3 AI 正文混入用户提问 | 已闭合 | `1d6ecb4f` 将用户 `text` 保持为点击问句，单独发送严格的 `guideContext` 引用。服务端从当前 owner 的缓存解析 AI 快照，独立保存、进入模型输入和备份恢复。`ChatConversationView.swift:692-698` 分开展示 AI 导览与用户原话。Node 四项归属/报价 hash/导出恢复/两路发送测试及 App 归属、草稿语音保留测试均通过 |
| F4 命中强调与位置 | 已闭合 | `ReaderContentsPanel.swift:162-164` 对真实 `excerpt.match` 加粗，`:168-169` 从当前章节的 passages 以 passageID 查真实序号，显示“第 N 章 · 第 M 段”。同章多个段首命中已有不同位置标签，不再把段内偏移当章内位置。该显示修复已静态复核，最新 UI 运行尚未结束 |
| R6 比较符/URL 兜底 | 已闭合 | `7f38fb01` 先取安全的真实回答或问题短语，最终用三个不同的澄清问句补齐。`ReadingGuideTests.swift:19-42` 覆盖比较符、URL、代码、emoji、长词与空白，核对恰好三条、稳定 ID 和原回答不变。新增两项回归已在本轮 Core 日志通过 |

F1 在第一次复审中发现的云书首次进入缺口也已补齐。`ReaderGuideContextTests.swift:37-48` 由 previous 实例保存文字和语音，再用新的实例调用实际入口 helper，验证冷启动恢复。`:68-72` 还核对已有 pending 的冻结 body、文字和语音原样恢复。现有 retry 不会被新的导览问题替换，草稿读取失败也会保留错误。

限定范围内的规格审阅结论改为“此前发现均已闭合，运行验收仍按证据分项记录”。代码质量结论改为“原 F1–F4 与 R6 兜底修复通过复核，无遗留 P1/P2”。本结论只覆盖这些修复，不扩展为整套阅读功能、真实模型质量或真机验收通过。

本轮已只读核对三份完整日志：`core-review-fixed.log` 为 400 项、2 项跳过、0 失败。`features-native-v4.log` 为 411 项、2 项跳过、0 失败并显示 `TEST SUCCEEDED`。`/tmp/leafhour-guide-context-followup-node.log` 为 134 项通过、0 失败、0 跳过。本段提到的针对性测试均在日志中找到通过记录。前两份日志位于 `/tmp/leafhour-reading-experience-20261105/`。这些结果取代首轮 App 全量仍有失败的旧状态。

`experience-ui.log` 随后显示本领域两项模拟器 UI 通过。`testContentsSearchPlacesBodyHitsUnderTheirRealChapter` 完成正文命中与点击返回，`testReadingGuideShowsThreeDirectFollowUpsAndKeepsThemAfterAnAnswer` 完成三追问入口与回答后恢复。该轮整体为 `TEST FAILED`，不能称全部 UI 通过。后续 `experience-ui-fixed.log` 中 ReaderGuideContextTests 两项通过，其 App 部分共 12 项通过，整体显示 `TEST SUCCEEDED`。这份日志补充了冷启动草稿恢复的真实自动化证据。

最后一次读取 `experience-final-ui.log` 时同域新 UI 与冷启动回归仍在运行，未将其记为通过。首轮评分表保留为当时的已验证小计，本次不把新的协议或模拟器测试换算成真机、真实模型质量、PDF 落点或性能分，也不补写 95 分。
