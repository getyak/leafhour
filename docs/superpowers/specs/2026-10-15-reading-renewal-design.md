# 循页：每天读一点，逐步读完一本书

日期：2026-10-15。名称由用户确认；设计细节由 Agent 按今夜持续、自主优化的授权决定。截止新加坡时间 09:00，先完成可验证的阅读闭环，再迭代视觉和交互。

## 目的与三种取舍

采用私人阅读空间：今日续读、一本当前在读的书、阅读日历和自己的理解记录。替代方案是把它做成打卡排行榜，或做成 AI 摘要收藏库；前者容易把数字当成果，后者会让整本阅读退后。当前目标需要阅读继续发生，工具只解决接续和难点。

官网主张为“每天读一点，读完一本想读的书”。首屏提供进入书房和公版试读两个不同目的的入口；用户回来时，书房优先呈现最近真实阅读的书与保存位置。其他书、导入、备份和 Agent 授权随需进入。

## 视觉与品牌

可见品牌为「循页 / PAGE BY PAGE」。域名、书籍标识、备份 kind、存储 key、MCP 命令和现有登录的客户端身份保持兼容，内部项目名继续 marginalia-reader。新官网学习 Ambi/Craft 的物件和环境关系，日常阅读学习 Linear/Things 的低竞争层级。参考仅表达设计推论，不声称实测原生产品。

官网使用书页、折角和自然光的出版物构图，云白表面、深墨文字和森林绿行动。标题采用有出版语义的中文衬线，本机字库回退；操作仍为清楚的无衬线。选择原生 CSS 的编辑式品牌语言，官网 dials 为 DESIGN_VARIANCE=7、MOTION_INTENSITY=4、VISUAL_DENSITY=3；日常书房 5/3/5，正文 3/2/4。动效仅服务进入层级、书页关系和操作反馈，默认正文不晃动。不引入滚动劫持或持续 WebGL 环境。

素材是专门生成的阅读环境图和书页细节，保留生成来源说明；真实产品展示来自运行中的界面或实际组件。没有虚构书、用户、成果数字。静态结构、文字对比和行动成立后才加克制动效。390、768、1440px 独立排版，44px 操作范围；深色主题和减少动效保留完整信息。

## 日常闭环

书房包含“今天接着读”的一个主入口，最近位置与一本当前书；从真实书架选择另一书也可开始。日历按月切换，选择某天看到读过哪些书、记录时段、自己的想法与问题，以及用户主动确认的章节完成。空白日期保持空白，无连续打卡惩罚。

阅读器保留目录、排版、原文/独立双译和稳定段落定位。新增阅读记录控件：用户开始一段记录，前台时累计，暂停/离开前台即停止；结束时可只保存时段，或写一句自己的理解和留给下次的问题。不强迫填写，不向模型自动提交。这些文字分别写为原有 comments/questions，保留用户归属和原段落锚点。

目录可以显式标记章节“我读完了”；整书可以由用户显式标记已读完，也可重新打开。滚动、点击下一章和到达末尾不自动完成。目标是一个可调整的每日阅读时间提示，默认 15 分钟，不承诺按速度推算掌握或结束日期。

深读帮助随需展开，提供“带一个问题开始”“用自己的话说明”“回到原文核对限定”“留下尚未解决的问题”四个行动。小说与非虚构书可以只选择适合自己的动作，不把每页变成考试。依据 Cornell 主动阅读建议形成产品设计，不声称它证明本产品会提高完成率。

## 持久数据与兼容

延伸既有按用户和书存储的个人记录，采用 schemaVersion=3。旧 schemaVersion 1/2 可以读取和恢复。新增 `readingMilestones` 数组和可选 `readingGoal`；原 comments、questions、position、readingSessions 都保留。

真实时段来源 `reader_focus`，旧 `design_preview_focus_timer` 保持原标签且不算作真实阅读时间。时段包含 id、bookId、contentVersion、startedAt、endedAt、start/end 的 chapterId 与 passageId、timeZone、sequence、status、segments 和从区间计算的 durationSeconds。segments 仅包含实际可见区间，最多 120 个，单时段跨度最多 24 小时。客户端每 30 秒以及暂停、结束、隐藏和离开时保存累积快照；服务器对同 id 的 sequence 做单调更新，过期请求不能覆盖结束状态。原始起点与归属冲突返回 409。

客户端失败时在原有按账户和书隔离的本机空间保留最多 20 条待发送快照。重试成功只移除已确认的同 id/sequence；迟到响应不移除更新的快照。账户切换后不写入另一账户，不把访客草稿自动迁入已登录账户。访客仍可阅读，只有明确显示的本机记录能力可以用于访客；云日历需登录。

里程碑是用户事件：chapter_read、chapter_reopened、book_finished、book_reopened，带 id、时间、归属和需要时的 chapterId。语义事件在同一记录的原子修改中追加，重试幂等；当前状态由事件导出。目标包含 minutes（5-120 的整数）和 updatedAt。导出恢复包含这些数据，不依赖服务订阅，旧备份补默认空集合，不伪造历史。

日历由既有书目和个人记录聚合：查询 YYYY-MM 和 IANA timeZone。按用户时区分日，跨午夜区间正确拆分，多个设备/标签页重叠区间在当日总时长中去重。每书时长保留其估计口径，日总时长不是盲目加总。注记数和章节标记与时间分开；时长、读完和理解不互相推断。月返回真实每天和每书的摘要，单日详细记录最多 20 条，正文/私人全书不会进入日历响应。

## 边界与接口

`server/reading-activity.mjs`：验证时段与里程碑，构建日历、目标与完成状态。`createLibraryService` 新增 saveReadingSession(user,bookId,input)、recordReadingMilestone(user,bookId,input)、setReadingGoal(user,bookId,input)、readingActivity(user,{month,timeZone})，沿用原子文件写入和 Supabase 文档 CAS。

HTTP 新增 GET `/api/library/activity?month=YYYY-MM&timeZone=...`；每书 POST `/reading-sessions`、`/reading-milestones`、`/reading-goal`，所有写入沿用请求来源和账户检查。Agent 的 activity 仍单独授权、只读，不增加活动写权限。响应和导出按归属隔离。

`app/reading-clock.mjs` 负责可测试的前台区间状态，`app/reading-outbox.mjs` 负责幂等待发送，`app/reading-session.js` 连接真实阅读器控件与生命周期。`app/reading-calendar.mjs` 构建月网格，`app/reading-dashboard.mjs` 连接书房展示与真实 API。日历的加载、空白、错误和旧请求完成均有明确状态。

## 验收

必要测试包含日历跨日与夏令时、时段验证/乱序/重试、多实例写入和账户隔离、隐藏暂停、待发送迟到确认、旧备份兼容和新实例恢复。原有完整测试与构建保留通过。真实流程从选择书、开始记录、暂停、写自己的话、日历查看、原段落返回、刷新持久化到导出恢复；测试数据在独立账户/本机实例中标明。

视觉分别验收官网、书房、日历、正文、深读/结束面板及登录；在窄屏和桌面检查文字、焦点、触摸范围、溢出、减少动效与两种主题。记录真正取得的截图和操作结果，不把自评分当成用户效果，也不宣称真实手机或屏幕阅读器已通过。

上线使用现有受控公开源码与部署镜像，在测试和独立复核后创建可查看的改动，再验证生产部署、原链接、登录与真实日历链路。原始工作区不动。无付费采购、全书生成、主动通知或额外安全权限。

## 依据

用户提供的 Ambi 深度拆解与六款产品比较是本轮设计输入，保存于私有附件，不进入公开镜像。当前 [Ambi](https://www.ambi.ai/en)、[Craft](https://www.craft.do/)、[Linear 设计复盘](https://linear.app/now/behind-the-latest-design-refresh)、[Things 官方说明](https://culturedcode.com/things/features/) 已读取。深读动作参考 [Cornell 阅读方法](https://lsc.cornell.edu/how-to-study/reading-strategies/textbook-reading-systems/)。
