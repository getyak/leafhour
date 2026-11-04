# 去AI味 · 前后对比报告



/tmp/leafhour-bookmarks-presentation-before.md → docs/verification/2026-11-05-reading-experience/bookmarks-presentation-fix.md



标记约定：<del>删除线</del> = 被改掉/删掉的原文；<ins>下划线</ins> = 改后的新文字；指标表 ↓/↑ = 相对人类参考的改善/恶化。



## 一、指标前后对比



| 指标 | 改前 | 改后 | 变化 | 人类参考 |
|---|---|---|---|---|
| 不是A而是B 对举 | 0.0 | 0.0 | → | ≈0.22 |
| 结论提示冒号 | 0.0 | 0.0 | → | ≈0.08 |
| 密集并列 | 8.982 | 8.982 | → | ≈1.78 |
| 前置定语长 | 0.0 | 0.0 | → | ≈0.1 |
| 句长起伏 | 0.564 | 0.564 | → | 人类≈0.54 / AI≈0.46 |
| 节长参差 | — | — | → | 人类≈0.83 / AI≈0.31 |
| 分节密度 | 1.497 | 1.497 | → | 人类≈0.32 / AI≈1.26 |
| 相邻句同构 | 28.57 | 28.57 | → | 人类≈5.52 / AI≈8.71 |
| 三连同构(粗筛) | 0.0 | 0.0 | → | 人类≈0.41 / AI≈0.84 |
| 换词多样性 | 686 | 686 | → | 人类≈143 / AI≈227 |
| 破折号（指纹） | 0.0 | 0.0 | → | Opus 狂用 +0.95 / GPT 少用 −0.54，方向相反分模型看 |
| 分号（指纹） | 5.988 | 0.0 | → | GPT 指纹 δ+0.80；Opus 无差 |
| 引号（指纹） | 2.994 | 2.994 | → | Opus 偏少 δ−0.67，报告用不改 |

↓/↑ = 向人类参考方向改善/恶化；指纹行不判方向。参考值=270 对同题配对实测人类中位（每千字或 CV 值），见 RESEARCH.md。

## 语义层判读（会话内模型按实验判据逐条判断）

四项在 270 对配对语料统计显著；同义重命名为单模型判据（弱一档）。判据见 references/semantic-criteria.md。

### 同义重命名（段级）（7 条：0组 7）


### 衔接方式（段间接口）（6 条：明确承接 3，有关但转换突然 3）

最长连环 3 个接口；≥6 为 AI 特征，人类中位 2。

- **明确承接**（置信:中）`bookmarks-presentation-fix.md:5`　本轮修正这个行为，不把它列为可接受的验收限制 → ReaderBookmark.presentation 可选保存译法、目标语言、完整已核验译文的 SHA-256、UTF-16 偏移与阅读模板　理由：逐条核对相邻接口；从数据及交互转到Markdown修复、测试与责任记录，最长明确承接3接口。
- **明确承接**（置信:中）`bookmarks-presentation-fix.md:7`　旧源文书签缺少 presentation 仍能解码，原文、译文及不同译文页分别匹配 → App 使用 ReaderBookmarkCapture　理由：逐条核对相邻接口；从数据及交互转到Markdown修复、测试与责任记录，最长明确承接3接口。
- **明确承接**（置信:中）`bookmarks-presentation-fix.md:9`　仅有原文锚点的旧添加接口遇到真实译文会明确拒绝，避免漏接接口后继续保存假精确位置 → goToBookmark 先核对原文版本、目标语言、译法与译文指纹，再切回保存模板，通过 session 内的瞬时请求恢复到译文实际字　理由：逐条核对相邻接口；从数据及交互转到Markdown修复、测试与责任记录，最长明确承接3接口。

### 冒号分类（1 条：引语或人物发言 1）



## 二、分级问题清单（改前检测）



### B 级 · 建议改（模型逐条筛选后处理）

**顿号并列≥3** 6 处

- `bookmarks-presentation-fix.md:5`　tation` 可选保存译法、目标语言、完整已核验译文的 SHA-2
- `bookmarks-presentation-fix.md:9`　kmark` 先核对原文版本、目标语言、译法与译文指纹
- `bookmarks-presentation-fix.md:11`　保留父执行加入的对照字号、透明度、间距与 source spa
- `bookmarks-presentation-fix.md:13`　覆盖长译文跨页分别保存、切换模板后精确返回、译文变化拒跳
- `bookmarks-presentation-fix.md:15`　碰 ReaderScreen、ReaderPanels、Models 或其他 Age
- `bookmarks-presentation-fix.md:15`　发布、迁移 UI、云同步与真机体验仍各自验收


C 级（结构/节奏）见指标表；F 指纹见表内指纹行；比喻贴切度只能人审；本轮默认保留。用户主动要求时再列出相关原句供判断。



## 三、前后对照（改后稿全文，改动处标记）



# 译文书签精确定位与 Markdown 缺译修复

2026-11-05。独立审阅确认：只保存源段落开头会合并长译文的不同分页，并让后续页误显示已收藏。本轮修正这个行为，不把它列为可接受的验收限制。

`ReaderBookmark.presentation` 可选保存译法、目标语言、完整已核验译文的 SHA-256、UTF-16 偏移与阅读模板。原文 `ReadingAnchor` 保留真实源段落，不推测中英字符对应。去重同时比较原文版本与展示位置。旧源文书签缺少 presentation 仍能解码，原文、译文及不同译文页分别匹配。

App 使用 `ReaderBookmarkCapture`。TextReadingView 新增 `onBookmarkCapture`，原回调继续兼容原文与 PDF。可见范围的 `.capture` 给显式按钮及配置面板使用。译文范围保存实际展示区间，不能用 `[0,0]` 匹配原文书签。仅有原文锚点的旧添加接口遇到真实译文会明确拒绝，避免漏接接口后继续保存假精确位置。

`goToBookmark` 先核对原文版本、目标语言、译法与译文指纹，再切回保存模板，通过 session 内的瞬时请求恢复到译文实际字符。请求绑定 navigationID<del>；</del><ins>。</ins>晚到的译文变化会拒绝该请求并恢复此前的原文位置与模板。列表预览也核对译文，变化或未就绪时直接标“待核对”，不会按相似百分比跳转。目标语言尚未加载时不自动生成译文。

保留父执行加入的对照字号、透明度、间距与 source span 优先恢复。完整 Markdown 仍走既有格式化路径<del>；</del><ins>。</ins>缺译文时增加“译文尚未准备 · 原文”非作者状态。记录 `markdownDisplayPrefix`，源文与展示偏移转换同步补偿。状态行不进入 span、引用或原文锚点。对照样式经 Markdown 原生格式化接口生效，不显示裸 Markdown 语法。

本轮先补 Core 测试，再实现接口。新增3项 Core 测试，总计20项<del>；</del><ins>。</ins>App新增3项，总计6项。覆盖长译文跨页分别保存、切换模板后精确返回、译文变化拒跳、目标语言与源版本不匹配、旧记录解码，以及 Markdown 状态与格式化引用映射。按父执行约定没有自行启动 Swift 编译、App 测试或真机验收，等待统一结果。接口缺失导致的编译红不能算行为红<del>；</del><ins>。</ins>本记录不据源代码自评95分。

本轮提交包含父执行此前未提交的 TextReadingView 样式整合，已获其明确授权。未触碰 ReaderScreen、ReaderPanels、Models 或其他 Agent 未完成文件。ReaderSession 的瞬时字段与 translationSettings 改动由对应作者协调提交。发布、迁移 UI、云同步与真机体验仍各自验收。
