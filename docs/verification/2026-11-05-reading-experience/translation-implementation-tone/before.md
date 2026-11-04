# R11–R15 iPhone 翻译实施交接

日期：2026-11-05。此模块完成翻译状态、设置界面与 Core 数据模型的本地实现。共用服务取消链由主执行者另行提交，ReaderScreen、ReaderPanels 与 TextReadingView 的接入也由主执行者完成。本文不代表已发布或真机验收。

## 已实现范围

`ReadingTranslationScope.following` 固定当前真实可见页及紧邻的最多两段，止于本章，每个窗口最多 12 段。窗口保持原书顺序，拒绝无序、重复、跨章及不连续的可见 ID。已缓存译文跳过后不会从更后面补段。页首之前的原文不会因本轮计划回绕进入范围。

规划器只解析实际窗口涉及的 Markdown 段落，不为取三段先解析整章。每个待提交段落限制 4,000 个 Unicode scalar，邻近原文 JSON 不超过 24 KiB，超过时明确失败并保留原文。完整译文跳过，部分译文及原文错配沿用拒绝覆盖规则。

`ReaderReadingContent` 提供显式启动、可见页跟随与停止 API。每次仅一个执行任务，下一窗口先取消并等待上一任务退出。身份、源版本、原件 URL、目标语言、session navigationID 和运行代次在异步边界核对。停止同步撤销开启状态，取消 Swift Task 及其 URLSession 请求。旧任务不能写入新任务的状态。未确认 POST 保留原 body、request ID、报价和计费凭证。

恢复模式只核对旧段，恢复成功后关闭随读状态，等待再次显式开启。它不会在恢复旧段后提交新页。真实阅读 marker 未变化时，译文到达或排版变化调用 follow 也不会扩窗。进入后台或原版会关闭开关。真实跳章只撤销旧窗口，保留用户已开启的开关；新章必须同时取得新用户 marker 与有效当前页，才可提交。

新默认目标为 English，已有存档中的目标保留。`ReadingTargetIntent.parse` 仅接受明确的七种目标语言及常见别名，不调用模型解析，不选择另一个目标代替歧义输入。原文识别沿用本机 NaturalLanguage 和已存设置，UI 不再要求源语言选择。相同源/目标显示修改提示，不自动改成中文。

面板使用原版、译文、对照三个真实缓存文字小样，切换只写偏好。无译文显示原文与缺失状态。对照可设置原文/译文顺序，并实时修改原文比例、深浅和段间距。Core ReadingLayers 已按顺序输出独立层。TextReadingView 的实际样式由主执行者接入下列偏好。

## 父模块接入

### ReaderScreen

显式按钮调用：

```swift
await reading.startFollowing(session, cloud: cloud, library: library,
    page: visiblePage, userNavigationID: readingUserNavigationID)
```

可见页稳定后调用：

```swift
await reading.follow(session, cloud: cloud, library: library,
    page: visiblePage, userNavigationID: readingUserNavigationID)
```

`readingUserNavigationID` 只在真实用户翻页或滚动完成时换 UUID。不能使用 contentRevision、layoutRevision、字体变化或译文触发的重排作为 marker。当前 page 不可核对时 follow 等待下次有效快照，不因此提前抓整章。ReaderPageTranslationPanel 新增可选 userNavigationID 参数，需传入同一 marker。

离开阅读器、账号变化、后台和叉关闭时调用 `reading.stopFollowing()`。跳章调用 `enteredChapter`，仅取消旧窗口；不能因为章节变化重新调用完整 stop。现有 `setForeground` 已接入关闭。`reading.requestFollowingPreparation` 绑定到展示 `.pageTranslation`，离开时清空。它取代旧设置页的整章按钮；旧 prepare/confirm 接口保留用于既有明确单段或恢复调用。

ReaderPageTranslationPanel 自带「停止翻译并关闭」叉按钮。面板另有「返回阅读」，可保留用户已显式开启的随读状态。若外层还保留通用叉按钮，其 pageTranslation 分支也必须调用 stopFollowing，不能绕过取消。

### TextReadingView

| 偏好 | 默认与范围 | 实际渲染接入 |
| --- | --- | --- |
| `parallelOrder` | sourceFirst / translationFirst | ReadingLayers 已排序，不在 renderer 再交换 |
| `parallelSourceScale` | 1，0.8…1.2 | 对照中的原文字号乘该值，标题及单独原版不受影响 |
| `parallelSourceOpacity` | 0.8，0.7…1 | 对照原文的颜色强调程度，译文保持正常正文色 |
| `parallelSpacing` | 20，8…40 | 同段双层间距及对照段间距保持一致 |

把以上字段纳入渲染失效签名，重排后恢复稳定原文锚点或已支持的译文视口偏移。原文/译文 span 的 provenance、选文偏移和当前 translationVariant 保持独立。旧存档缺字段时使用默认，未知顺序值回退原文在前，数值解码有有限范围归一化。持久保存校验若单独维护字段白名单，也需同步验证这些范围。

### 其他共同改动

按主执行者要求，Models.swift 仅额外增加 `ReaderState.bookmarks: [ReaderBookmark]? = nil`。ReaderBookmark 类型与行为由书签模块提供。没有修改 ReaderSession、OfflineLibrary、项目文件或服务端。

新 App 测试 `TranslationFollowingAppTests.swift` 需主执行者通过现有 xcodegen 流程注册。ReadingLayersAppTests 的合成夹具显式保留英文→中文设置，继续验证旧中文译文。其他旧夹具若依赖 targetLanguage 缺省代表中文，应显式指定目标，不放松生产数据的语言隔离。

## 验证记录

红测先放任务草稿，等待 Task2 的编译结束后才移入正式 Core 测试目录。主执行者实际运行红测 exit 1，原因是 `.following`、ReadingTargetIntent 与新偏好接口尚不存在，日志为 `/tmp/leafhour-reading-experience-20261105/translation-core-red.log`。这是接口缺失导致的编译红，没有将其表述成已执行的默认语言断言失败。

主执行者统一 Core 测试已实际通过：384 项，2 项跳过，0 失败；新增 TranslationFollowingTests 的 7 项均通过，日志为 `/tmp/leafhour-reading-experience-20261105/core-integrated.log`。跳过项没有计作通过。

本模块的 Swift 文件已统一运行 `swiftc -frontend -parse`，退出 0。精确文件的 `git diff --check` 通过。这两项不代表类型检查、App 构建或设备交互已通过。遵照主执行者的资源安排，未自行启动 xcodebuild 或并行 Core 编译。

Core 测试覆盖：有界窗口与章尾、可见 ID 拒绝、缓存不扩窗、原文/邻文超限、12 段硬上限、English 默认及旧目标保留、自然语言解析、对照顺序与独立译法、缺译回退和偏好解码边界。App 测试使用真实 CloudLibraryClient 和受控 URLProtocol，验证未开启不会提交、关闭取消 transport、pending 保留相同 body，恢复只处理原段，以及跨章保留开关但必须有新用户 marker 和有效可见页。它不请求真实模型，不向真实账号写数据。

主执行者的 native green、入口整合画面、性能与设备结果尚待回填。Core 算法测试结果已单独记录；产品操作验收分仍待接入后的独立审阅，未据此补写95分。合并、线上、TestFlight、真机和95分目标不能由 parse 或设计审阅代替。

## 未验边界

Vercel 对 URLSession 断开的传播及真实供应商 abort 行为，需要服务端与生产验收。iOS 主线程重排耗时、最大辅助字号、VoiceOver、横屏、扫描 PDF、复杂语言识别和选文恢复尚未实测。只读恢复继续沿既有可信计费回执，不把连接取消误称为已确认退款。

服务端保存提交点与取消的并发处理已由主执行者另行实现，其真实证据不在本模块的 parse 结果中。本模块只负责发送取消和拒绝失效运行的迟到结果。
