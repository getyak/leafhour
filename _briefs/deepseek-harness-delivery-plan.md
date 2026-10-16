# DeepSeek Harness · 实现交接

当前品牌为 Leafhour，正式网站 https://leafhour.com，唯一公开仓库为 `getyak/leafhour`。下方设计与交接保留各自日期及授权范围；当前发布与验收见 [品牌上线记录](../docs/verification/2026-10-16-leafhour-launch.md)。

2026-10-12。这是系统设计的工程拆分，供后续 PI 执行；读取不表示已完成下列功能。原有阅读服务继续作为基线，不重复生成全书。

本次体验验收已具体化为 [reading-experience-evals.md](reading-experience-evals.md) 和对应 JSON 案例。第一批代码优先满足 E00（安静阅读）、E01（准确解释）与 E02（可选探索）；E03–E05 为后续体验，完整流程尚未实现。9 类失败边界需要单独验收。案例输入属于合成测试资料，正式读者效果另行观察。

## Kernel Slice

从系统设计冻结的源码 SHA 构建同版本 SDK、CLI 和依赖。用 sdk-minimal 加显式 patch；禁用 shell 与工作目录工具，启用 Leafhour 的 policy/context/tools 插件。插件只有授权段落读取和候选提交能力，首轮不接私人评论。

完成真实 SDK 握手、模型调用与一次阅读工具往返。测试不得使用伪 Harness 命名包装普通 fetch；回执必须有官方 session/step/tool 事件。检查实际工具名单、进程退出及 Messages 请求错误。生成次数、费用与日志范围受 Host 限制。

## Reading Slice

在服务增加 prepare、事件订阅、act 与 cancel 的路由。Host 保存 Run 和幂等键，内部字段不由浏览器或模型声明。首个 compare_purposes 活动从稳定原文锚点取材，以通过结构核验的 Script 渲染到按需旁栏。

E01 的有依据解释与 E02 的 Chapter Script 使用两个受限输出契约，共用来源核验与 Run 管理。解释不强制转成游戏，探索提示/交换目的等本地动作不反复调用模型。评估器分别输出确定性检查、内容评审和真实读者观察，未运行的部分不标为 passed。

验收从网页点击“帮我理解”开始，经历真实工具调用、来源检查、读者输入和反馈，再返回同段。独立测试取消后迟到结果、刷新后恢复、供应商断流、后台切换及四种宽度；原有选择文字、评论与导出流程不可回退。

## Book & Reader Evidence

先为第一段做人工核对的地图项和反馈，再按章节增量建立 Book Map。增加 ReaderObservation 与 ReaderHypothesis 的独立格式，保留原话、证据、提示情况与更正记录。支持关闭个性化、清空派生假设和干净实例恢复。

验收地图中每条关系都能回原文，改源版本让依赖失效；AI 候选不能自动成为本人掌握的知识。已有双译继续读取，只有用户发起的改译范围进入批次队列。

## Tools & MCP

固定活动可用后扩展 xray_argument、受限 scenario_demo、translate 和章末整理。每次增加工具都声明权限、开销、版本和真实失败案例，不同时开放任意代码生成。

MCP 共用领域授权与 Run 接口，先开放有界只读资源；按书籍和数据类型授予权利。对未授权评论、跨书与撤回后的访问必须拒绝。Personal Agent 仅在用户开启后接调度与通知，暂停与限频另行验收。

## Learning & Open Release

执行 Notion Evaluation & Research 的 A/B，再做 B/C 小样本试读；记录无变化与干扰，不将界面完成作为深读成效。

公开代码前核对软件与第三方许可，提供公版示例。体验包只包含允许分享的内容，凭证、私人答案和现有整书不随代码发布。费用服务与同步均为可选，导出不依赖订阅。

## 完成回执

逐阶段记录代码版本、profile 实际组合、供应商模型、工具/来源核验、未完成项和回退路径。官方 Harness 运行、阅读界面接通、内容本人审阅和理解效果分别写明，不能互相替代。
