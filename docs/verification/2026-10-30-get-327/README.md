# GET-327：阅读性能与可靠性验证

关联任务：[GET-327](https://linear.app/getyak/issue/GET-327)。开发基线为公开仓库 `getyak/leafhour` 的 `d64cfd895076169a5b05a6003f6a04bc6515355f`（`d64cfd8`）。本记录写于 2026-10-30，描述当前工作树的实现与本地证据；最终提交、CI、合并和正式发布结果以关联 Linear 中的实际读回为准。

本轮修复了 Web 上传轮询、搜索摘要、分片取消及阅读交互中的问题，也修复了 iOS 云同步丢失后续请求、笔记精确位置回退和位置冲突选择失效的问题。实现沿用现有模块和数据格式。

## Web 改动

| 问题与触发条件 | 实现后的行为 | 主要文件 |
| --- | --- | --- |
| PDF 任务等待同意、失败或待复核时，页面仍持续轮询；隐藏页面也继续请求。 | 仅页面可见且任务处于 `preparing`、`running`、`publishing` 时自动轮询。显式处理任务后恢复轮询，返回前台时重新读取状态。原有账号与操作版本校验继续阻止旧响应覆盖新操作。 | `app/book-upload-controller.mjs` |
| 当前书搜索的早命中结果，仍将整段原文分割并保存为 grapheme 数组，只为展示短摘要。 | 按迭代器截取摘要窗口，保留匹配前最多 36 个 grapheme 和最多 180 个展示 grapheme。原文字符、组合字、emoji 及省略号边界保持一致。规范化搜索本身仍需扫描文本。 | `app/palette-book.mjs` |
| 正文转为分片传输后，取消外层读取没有传给后续分片。 | 每次分片读取携带原来的 `AbortSignal`，取消后不再发送下一片请求。 | `app/reader-api.mjs` |
| 保存高亮或延迟加载注解完成时，用户已经取消选文、移动或聚焦别处，旧回执仍可能打开卡片并抢回焦点。 | 高亮保存仍接纳持久化回执；打开卡片另行校验当前交互意图，并在模块加载、注解读取等异步边界再次校验。用户主动重新打开同一高亮仍可进入注解。 | `app/reader-highlights.mjs`、`app/reader-annotations.mjs` |
| 译文或个人记录刷新重建笔记表单，可能打断正在输入的草稿、焦点或选区。 | 当前段落、标签和草稿范围未变时复用同一个表单和 textarea，仅更新记录列表；记录 composition 状态，避免刷新覆盖正在组合输入的内容。面板已经处于正确位置时不重复移动 DOM。 | `app/reader.js` |
| 键盘展开工具条时，header 和 hub 在 visibility 过渡起点就调用 focus，Chrome 拒绝；顶部唤醒按钮隐藏自身后还会原生退焦到 body。 | 共享有界 paint 交接，只在真实可见且可用时聚焦；用户新操作、关闭、隐藏和卸载取消。顶部按钮仅在无新事件的原生隐藏退焦时保留原意图，元素 blur 不再误当窗口失焦。 | `app/reader-immersion.mjs`、`app/reading-hub.mjs`、`app/reading-toolbar.mjs` |
| 固定本地化片段使用 inline style，其排版规则可能被现有 CSP 拒绝。 | 将这些固定样式移到共享样式表的 `.ui-inline` 类，保留字体、颜色和文本流继承；隐藏节点继续保持隐藏，CSP 未放宽。 | `app/index.html`、`app/reader-atmosphere.js`、`app/typography.css` |

## iOS 改动

`CloudBookSync.swift` 按书保留一个同步 worker。旧快照上传期间的新 push 请求合并为后续一轮；push 期间请求 pull 会提升后续轮次，已在执行的相同 pull 则由调用方共享。worker 自身负责移除运行标记，位置冲突解决在等待后重新检查该书是否空闲，避免多个等待者同时开始写入。

请求失败不会触发 worker 自动重试排队中的工作。笔记请求原本会将部分错误记入 `noteErrors` 后正常返回，独立审阅发现这会让新 drain 误判为成功并再次发送同一笔记。现在同步结果明确报告是否可继续 drain，保留当前轮的逐条错误处理与位置同步行为，失败内容继续留在本机 outbox，等待后续显式或调度触发。

云端评论没有字符偏移时，同 ID、同章节段落、同引用内容且属于已核对正文版本的本机笔记，保留范围有效的 Unicode scalar 偏移。引用或段落改变时不复用旧偏移。首次从云端取得且没有精确位置的笔记仍保守定位到段首。

选择“本机位置”现在要求本机存在阅读锚点，并强制以已知云端 revision 进行一次 CAS 提交。即使用户已经回到上次同步的位置，也不会误入 pull 分支采用云端位置。提交确认前保留冲突、云端位置与 revision；核对失败后，本机位置仍待同步，后续可重试。重复处理已经解决的冲突不会再次提交位置。

## 本地验证

| 验证层 | 当前结果 | 证据范围 |
| --- | --- | --- |
| 改动前宿主基线 | 62 项通过，0 失败；基线 Web 构建通过。 | 选文、阅读对话、阅读工作区和书房等既有测试。 |
| 新回归的失败证据 | 已先取得行为失败，再完成修复。 | 原生覆盖运行中追加笔记与位置、push 升级 pull、Unicode 笔记偏移、位置冲突选择及 GET/POST 失败；POST 同时覆盖 503 和网络丢回执。 |
| Swift Core 全套 | 105 项通过，0 失败，其中 `CloudSyncTests` 23 项。 | macOS 宿主运行的 Core 测试，使用临时书房和 URLProtocol 隔离响应。 |
| Web 定向回归 | 上传控制器、轮询、搜索摘要和分片读取 25 项通过；CSP 相关回归 35 项通过。 | 确定性逻辑与模拟时钟、网络边界测试。另比较 256 组 Unicode 和摘要边界输入，与基线结果一致。 |
| 实际浏览器中的源码及编译阅读页 | 1440 px / `en`、390 px / `zh-Hans` 两组均通过下述 4 条流程；报告中 CSP 与 console error 列表均为空。 | 本机源码和编译产物、隔离身份、公版正文和合成异步事件；未运行线上正式发布。 |
| 完整本机部署门禁 | `21e1422` 上的复验命令退出 0：4342 项通过、0 失败、1 项跳过；运行时打包、Web 构建和公开发布包校验全部通过。 | 使用锁定依赖、真实 Vale/textlint、隔离 PostgreSQL 14.24；唯一跳过为 Linux x64 专用的 Node 许可证篡改负向用例，Mac 不适用。后续验收脚本变更另跑定向回归，最新提交仍须 PR CI。 |
| iOS 应用构建 | arm64 iOS Simulator Debug 构建成功，签名关闭，`-jobs 2`。 | 使用 `dev-ios-session run` 排队执行，仅构建，未安装或运行真机。 |
| PR CI、合并、正式发布及线上读回 | 见关联 Linear 的同提交读回。 | 本机测试和构建不代表这些阶段已完成。 |

两种浏览器尺寸分别验证了：

1. 阅读正文可用，没有横向溢出或遮挡；本地化片段按预期继承排版，原先隐藏的片段保持隐藏。
2. 译文和已保存记录事件发生后，textarea 仍为同一个 DOM 节点，焦点、选区和正在组合输入的草稿保持，记录列表正常刷新。
3. 延迟的真实高亮 HTTP POST 回执仍被本地接纳；取消原选文并聚焦别处后，不重新打开旧卡片或抢回焦点。
4. 用户通过当前选文主动重新打开同一高亮时，注解卡片仍可打开。

完整门禁中三组真实 PostgreSQL 检查均执行，包括账本并发保留、订阅周期及年度/月度并发开通；没有使用外部数据库。构建得到 928 个运行时文件（9.0 MB），公开资源与来源提交检查通过。

composition 验证采用浏览器合成事件，不等同于操作系统中文输入法、实际键盘或真机输入验收。浏览器通过也不代表线上服务、VoiceOver 或其他辅助技术已验收。

## 工具条的真实键盘复验

后续实际跨平台执行发现了产品焦点交接早于 CSS visibility 可见帧的问题，不能仅修改观察器。使用同一套 `DOM.focus` + trusted Enter/Escape CDP 输入复现并修复；真实源码页面重新验证主 pill→目录、书籍信息打开与 Escape 还焦、顶部唤醒，以及可选 hub 样式不可用时的 header 回退，结果通过，页面与网络错误为空。主 Agent 最终 114 项定向回归通过，同时覆盖隐藏、关闭、新输入、新焦点、窗口失焦和卸载；最终完整门禁与最新 CI 继续分别记录。

## 合成性能观察

在 Node `v22.23.2` 下，以 8 个早命中段落、每段 5007 字符进行 7 次本机采样，搜索中位耗时从 **8.268 ms** 降到 **0.380 ms**。这是针对摘要分段与分配开销的合成场景，不是浏览器端到端延迟、真实书库平均值或生产性能承诺。更大的段落另作压力边界观察，不能据此推算日常阅读收益。

正式本机原始记录位于本次隔离产物目录中的 `web-performance/benchmark.json`。浏览器报告为 `browser-interactions4/report.json`，Core 结果为 `core-final.log`，完整门禁为 `verify-deploy-final.log`；失败阶段分别记录在 `ios-red.log`、`ios-green.log`（含追加位置回归的失败证据）和 `ios-post-red2.log`。这些是本机会话产物，未作为真实用户运行数据提交到仓库。

可在仓库根目录复现定向 Web 测试：

```sh
node --test tests/book-upload-controller.test.mjs tests/book-upload-polling.test.mjs tests/palette-book-performance.test.mjs tests/reader-api-transfer.test.mjs tests/reader-highlight-intent.test.mjs tests/reader-note-refresh.test.mjs
```

原生 Core 全套由统一 iOS 会话串行调度。先将 `LEAFHOUR_TEST_ARTIFACT` 设置为本次隔离产物目录，再将 scratch 放入其中：

```sh
dev-ios-session run -- swift test --package-path apps/ios/LeafhourCore --scratch-path "$LEAFHOUR_TEST_ARTIFACT/swift-core"
```

## 跨平台 CI 补充

首次 PR 检查还发现旧首页验收合同和 Windows 字节转换问题；已在同一任务中修复。进一步按真实封面及书名节点更新书房合同，并在原有 4 秒边界内观察 dialog 关闭和焦点归还的完整结果；32 项组合回归通过，永久不还焦仍会失败。冷字体、真实字体使用和失败时拒绝通过的检查仍保留。Android SDK 包损坏发生在产品测试前，未修改或跳过该门禁。具体证据与阶段边界见 [CI 补充记录](platform-ci-followup.md)。

## 审阅与交付边界

各实现由其他 Agent 交叉审阅，确认的问题均先补回归；笔记 POST 局部吞错导致重复提交的问题由独立审阅发现并修复。最终变更已交叉复核；同提交 CI 与正式发布结果在关联 Linear 读回。

本轮本地验证使用隔离模拟数据，没有调用真实模型、生成译文或修改真实账号书籍与记录。现有数据归属、账号隔离、稳定段落 ID、原文与两种译文的区分、兼容存储标识保持原有契约。TestFlight、物理 iPhone、真实账号跨设备同步与生产发布均没有在本记录中标记为通过。
