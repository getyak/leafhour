# R11–R15 iPhone 翻译设计与独立审阅

日期：2026-11-05。范围：iPhone 阅读翻译，及其必需的共用服务取消链路。本报告只完成源码审阅与设计，未修改产品代码，未运行构建、模型请求或真机测试。实施与最终验收由主执行者统一完成。

## 结论

采用一个显式「随读翻译」开关，范围固定为当前可见页及紧邻的两段。已有译文直接使用。窗口完成后等待真实阅读位置变化，不因任务完成自行向后推进。默认目标为 English。保留已有存档中的目标语言。原版、译文、对照使用三个可点选的小样，切换只改变显示。

取消必须沿 Swift Task、URLSession、HTTP 响应断开、服务端 AbortController、领域服务和供应商 fetch 传递，并在保存前再次检查。只有前端取消，无法满足 R12。关闭后保留不确定请求的原幂等凭证，恢复时仅核对这一段，不顺带提交新段。

本次设计用 `design-judgment` 的功能减法和时间与注意模块。主要取舍是去掉源语言选择、整章范围和重复的模式 Picker，保留目标、范围、点数及停止状态。配置即时生效，但不以动效或虚假百分比掩盖模型等待。

## 已确认的源码事实

| 位置 | 当前行为 | 对本次需求的影响 |
| --- | --- | --- |
| `ReaderPageTranslationPanel.swift` | 当前页先准备再弹窗；模式与语言在运行时禁用；提供暂停按钮 | 需改为一次显式开启及可随时停止，显示配置应可实时修改 |
| `ReaderSettingsControls.swift` | 原文与目标为两个 Picker，提供当前段和整章入口 | 与一行目标意图及有界随读不一致 |
| `BookLanguageSettings.swift` | 默认 `.zh`；中文书建议英文，其余建议中文；原语使用 NLLanguageRecognizer | 新默认必须改为 `.en`；已存设置须保留；UI 无需要求选源语言 |
| `ReadingLayers.swift` | 原版、译文、对照已独立，缺译文回退原文并标缺失；对照固定原文在前 | 可复用归属与缺译回退；补顺序与表现配置即可 |
| `ReadingTranslationPlan.make` | 当前段优先后会回到章头；旧默认覆盖当前章及下一章，最多 100 段 | 不能用于新的随读窗口；需要不回绕的规划分支 |
| `ReaderReadingContent.stop/execute` | stop 只取消 Swift Task；pending 在首次 POST 前持久化；execute 取结果后仍需要独立校验 | 保留恢复协议，在客户端发布/缓存前补运行代次及取消检查 |
| `ReaderCloudTools.perform` | 网络返回后已有 Task.checkCancellation；保存直译/意译的归属与目标 | 已挡住一部分迟到结果；不能代替服务端取消或 execute 的竞态防护 |
| `ReaderScreen.swift` | 后台、原版、语言变化会 stop；跳出原范围章节才 stop | 新窗口要处理页级位置变化、跳章、离开阅读器和账号切换 |
| `TextReadingView.swift` | TextKit 单流逐段拼接；对照原文用 secondaryLabel；签名包括模式与译文版本 | 适合上下对照；配置须进签名、字体与段落样式，不能只更新预览 |
| `server/portal.mjs` translate POST | 未绑定响应 close，也未传 signal；注解/导览已有同类 AbortController 范式 | 可沿现有范式改 translate，无需复制旧 PR 的另一条生成链 |
| `translationRequestOptions` / `library.translate` | options 白名单不接受 signal；生成前、生成后与 mutate 内已有授权检查 | 新 signal 需加入内部 options，在所有授权检查处并行检查 |
| `translation.mjs` | translator 仅收 context；fetch 使用独立 45 秒超时 | 改为第二参数 options，组合外部取消与超时；signal 不进模型 JSON |
| `credit-gate.mjs` / `billing-service.mjs` | run 已接受 signal；billing 在执行前后检查；已有 terminal receipt 与 15 分钟恢复 | 接入现有链即可，不能取消后丢弃 pending 或换新 request ID |
| `app/source-language.mjs` | 服务端只区分汉字/拉丁启发式，不能准确辨认已支持的七种源语言 | iOS 识别结果应作为内部 sourceLanguage 使用；低置信度与混合语言须有明确失败路径 |

本次审阅的旧 PR #273 分支含 `LeafhourCore/ReaderAutomaticTranslation.swift` 与 `server/reading-translation.mjs`。可借鉴身份快照、运行代次和保留幂等凭证的方式。其 current/next 循环会遍历章节，停止也未完整传至供应商，不符合本次范围。不要整支合入，也不要恢复其旧 textMode 数据模型。

## 交互与状态

翻译面板首先显示一行可编辑目标，例如「翻译成 English」。默认内容为 English，支持「英文」「English」「en」「翻译成日语」等明确表达。空白提交、多个目标、「随便一种」与未支持语言提示修改。支持范围沿用中文、英文、日文、韩文、法文、德文、西班牙文，不用模型猜测用户想要哪一种。源语言由本机识别，不展示必填选择。检测为与目标相同时提示「原文已是 English，请修改目标语言」，不自动换成中文。

目标下方为原版、译文、对照三个真实文字小样，每项至少 44 点触控区域，文字标签常驻，选中状态可被 VoiceOver 读取。译文小样使用已缓存的当前段。没有译文时显示原文与「译文尚未准备」。示意线条不能冒充已生成译文。点击模板保留稳定锚点，不触发报价或生成。运行期间模板仍可修改。

对照展开「原文在前／译文在前」两种小样。再提供原文相对字号、原文颜色强调程度及段间距。它们使用同一份 preferences 驱动预览和实际 TextKit 正文。iPhone 采用上下排列。横屏仍保持可读的单流，不在本次重写双列选文和锚点逻辑。直译与意译沿用独立版本控件，并保留 AI 草稿或已校订状态。

用户首次开启时展示一次具体范围与计点说明：「从当前页开始，准备本页和紧邻两段；每段最多 1 点，逐段核对报价。移动到新页后，按同一窗口继续。关闭即停止。」展示当前窗口的段数与最大点数，单段报价仍逐次校验，不再每段确认。计点价或模型策略变化超出已同意范围时停止并提示重新开启。

运行状态按实际事件显示：正在核对范围、正在翻译当前段、当前范围已准备、正在停止、已停止、停止结果待核对、失败可重试。范围已完成后静止等待，不能通过「下一步」自动扩大窗口。进度只表示本次有界窗口，不显示整书翻译百分比。

面板右上角叉在运行中明确标为「停止翻译并关闭」，先撤销当前运行代次，再取消网络与后续队列。停止请求未获可靠回执时显示「已停止后续翻译，当前请求待核对」，不能仅凭 Task.cancel 就显示供应商已经停止。关闭后翻译开关为关。返回前台或重新开书不自动重启。用户再次开启才允许规划新窗口。

## 窗口与生命周期

新增随读窗口规划器，与旧 page/chapter 恢复协议分开。输入为 owner、book、contentVersion、chapterID、真实可见 passageIDs、目标语言和运行代次。输出按原书顺序排列的有限 passageIDs。可见页尚未稳定或不可核对时不提交。图片、标题、空白及没有可核对文本的扫描页不进入窗口。

默认当前可见页加紧邻两段。建议另设总段数与字节硬上限，防止极小字号或异常分页令「一页」变成无界请求。可先沿用最多 100 段的恢复结构上限，但实际随读窗口上限应更小，例如 12 段。超过时只取从当前锚点向下的前缀并提示范围截断。不得取章头补齐，不得用段数不足为由抓整章或下一章。紧邻两段可止于当前章结尾，用户实际进入下一章后重建窗口。

每次最多一个在途生成。每提交一段前重新核对当前可见窗口、身份、版本、前台状态、开关和目标。不在最新窗口内的未提交段立即丢弃。可见位置变化允许替换窗口，不能在旧窗口跑完后接着遍历后续段。程序恢复锚点和异步译文重排不能被当成用户已阅读到新页，避免产生自触发的整书推进。

普通继续翻页重算窗口。跳章、关闭、离开阅读器、后台、账号变化、源版本变化及目标语言修改使当前运行失效并取消。切换到原版保留已有缓存，但停止本轮生成，且再次点译文模板不自动开启。字体、对照顺序与间距只重排本地内容，不构成新的生成授权。

完整译文跳过且不重计点。部分译文或译文对应另一份原文时停止该段并提示核对，沿用服务端不覆盖保护。运行上下文仅发送当前段和必需邻段，不包含整章、私人笔记或书内指令所要求的额外资料。

## 最小取消接口

沿用 `/api/library/books/:id/translate`，不增设隐式自动翻译服务。路由创建 AbortController，`res.once('close', onClose)` 在响应未结束时 abort，finally 移除监听。将同一 signal 传给 `creditGate.run` 和 `library.translate`。服务端检测到已断开后不再写响应。

`translationRequestOptions` 新增仅供服务内部传递的 signal，验证其 AbortSignal 形态。`library.translate` 在入队前、reserve 后、供应商返回后以及最终保存前调用统一守卫。守卫先检查 signal，再检查 authorizeGeneration。调用改为 `translator(context, {signal})`，不把 signal 放入 context，避免序列化给模型。`createTranslator` 组合外部 signal 与 45 秒超时，检查取消先于 recordProviderDispatch，并将取消原因正确记录为取消，保留真实使用量。不承诺供应商免除已经发生的成本。

客户端 stop 必须同步增加 generation 并撤销开关，再 Task.cancel。execute 在每个 await 后，尤其在 completed.append、persist、cache、session.updateTranslations 之前检查 generation、Task.isCancelled、身份、版本和目标。旧任务 defer 仅能清理自己的 task/running 状态，不能覆盖新任务状态。网络取消后的 URLError.cancelled 应映射为停止状态。

HTTP 断开可把取消传到供应商请求，但连接断开后客户端无法在同一响应中得到终态确认。最小版本保留 pending，重新连接时通过原请求与可信账单回执核对，核对不得继续新段。若产品需要立即确认停止，另加按 owner/book/requestID 查询的只读状态或显式取消入口。不能把账单余额变化或客户端计时当作取消回执。

## 保存提交点与计费恢复

取消的可执行定义须写清：取消先于服务器保存提交点，则结果不得保存、发布或加入离线缓存。保存提交点已完成后才收到取消，保留已完成译文并核对相同请求的点数。已确认完成的结果不能因断网被描述成已撤销。

当前 local rawMutate 在 callback 后还有 mkdir、writeFile、rename，hosted store 同样存在网络持久化边界。因此仅在 mutate callback 开头检查 signal，还不能覆盖保存期间发生的取消。实现时应把最终守卫放到实际提交前，或使取消与保存通过同一任务状态及存储事务竞争。测试需延迟实际存储提交来验证。已进入不能撤销的提交阶段须返回真实结果，不应只在 billing 的最后 signal 检查中释放预留而留下未结算的译文。若本轮只完成常见路径，应将这个窄竞态列为未验收，不能写 R12 完整通过。

每段先把 request ID、报价、body、owner、目标语言与 contentVersion 落入 pending，再 POST。取消只移除明确从未提交的 intent。已提交或不确定的 intent 保留原 ID。恢复只读取或核对原段，不为同一未知请求新建 ID。只有可信 terminal receipt（released/cancelled/reversed/not_started）允许后续显式新尝试。认证失败、429、超时和连接中断均不能证明未生成或未计点。

已有 `result_saved`/settled 与持久译文 generationReceipt 的恢复规则必须保留。`billing.enabled == false` 也要依赖 signal 阻止迟到保存，不能因为没有账单守卫而继续写译文。同一账号其他客户端的成功结果可正常同步，但不能被当前已撤销运行冒充为其成功。

## 最小文件与测试清单

| 文件/接口 | 必需改动 | 对应验收 |
| --- | --- | --- |
| `LeafhourCore/BookLanguageSettings.swift` 及语言测试 | 默认 en，保存旧目标，自然语言目标解析与低置信度错误 | R13 |
| `LeafhourCore/ReadingLayers.swift`、`Models.swift` 及解码 | 新随读窗口；对照顺序/字号/间距配置；旧存档缺字段有默认 | R11、R14、R15 |
| `ReaderPageTranslationPanel.swift`、`ReaderSettingsControls.swift` | 单目标输入、三模板、显式开启/停止、一次范围/点数说明 | R11–R15 |
| `ReaderReadingContent.swift`、`ReaderScreen.swift` | 一个在途请求、可见页驱动、generation、后台/离开/跳章停止、pending-only 恢复 | R11、R12 |
| `ReaderCloudTools.swift`、必要时 `CloudLibraryClient.swift` | 取消映射、原请求恢复、迟到回执检查，不破坏普通对话 | R12 |
| `TextReadingView.swift`、必要时 PDF 文本路径 | 同一配置实时作用正文与预览，签名失效/重排后恢复稳定锚点 | R14、R15 |
| `server/portal.mjs`、`translation-batch.mjs`、`library-service.mjs`、`translation.mjs` | close→signal→provider，最终保存守卫，保留版本与权限检查 | R12 |
| `credit-gate.mjs`、`billing-service.mjs`、本地/hosted 存储 | 仅在验证出保存/结算竞态时做必需修正，不新建账本协议 | R12 |

自动化先用合成文本和受控假供应商，不请求真实付费模型。需要的测试按行为组织：

- 窗口从章中开始只向下，最多本页加两段；章尾不回绕；窗口完成无阅读事件时请求数不增长；译文异步插入不能自行扩大窗口；快速翻页时只提交最新窗口。
- 关闭、跳章、退后台和账号变化会取消在途 URLSession；旧任务迟到不得更新正文或缓存，也不得清掉新任务的 loading。复用带 stopLoading 记录的 URLProtocol，另测服务端真实 socket 断开。
- HTTP socket 断开后假供应商观察到 signal.aborted；假供应商忽略 abort 并迟到返回时存储保持无译文；服务端 active/reserve 锁在 finally 释放，后续合法请求可执行。
- 在供应商返回前、授权检查后、存储等待中及账本结算阶段分别取消；核对 overlay、generationReceipt、ledger 与 pending 一致。启用与关闭 billing 各测一遍。
- 请求返回前断网、已保存后丢响应、取消回执丢失、服务重启、terminal receipt 恢复均沿原 request ID；恢复不自动推进第二段，成功结果不重复计点。
- 新书默认 en，已存 ja/zh 保留；中文/English/en/日语等解析正确；模糊或多目标拒绝；源目标相同不自动改写；混合/短文本检测失败不会猜目标。
- 三模板只写 preferences，无 quote/POST；缺译回退原文；切换直译/意译保持独立归属；真实 TextKit 字体、顺序和段落样式随配置改变，锚点和原文/译文选文来源保持正确。

模拟器再记录 320/375/390/430 点宽、横屏、最大辅助字号、深浅主题、VoiceOver 和减少动态。正文测试至少覆盖 TXT、Markdown、可提取 PDF 与扫描 PDF。扫描 PDF 保留原页，不伪造可翻译文本。测量开启开关、停止按钮和配置变化至本地可见反馈的耗时，并记录主线程最慢布局，模型耗时单列。

## 评分与未知边界

评分只给已实际验证的行为。此次仅做源码设计，未运行测试或设备验收，不能将方案完整度计入产品通过分。

| 需求 | 功能 /30 | 交互 /25 | 性能 /25 | 边界与可访问性 /20 | 已验证分 | 待验证上限 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R11 显式有界随读 | 0 | 0 | 0 | 0 | 0/100 | 100 |
| R12 真正取消 | 0 | 0 | 0 | 0 | 0/100 | 100 |
| R13 一行目标语言 | 0 | 0 | 0 | 0 | 0/100 | 100 |
| R14 三模板 | 0 | 0 | 0 | 0 | 0/100 | 100 |
| R15 实时对照配置 | 0 | 0 | 0 | 0 | 0/100 | 100 |

实施审阅时按功能30、交互25、性能25、边界20逐项赋分，并记录测试命令、结果、截图与耗时。目标95，未测不得补分。取消只挡UI、持续无界生成、译文错配或读取越权属于阻断，不能用其他分数抵消。

尚待实际验证的边界包括 Vercel 响应 close 对客户端 URLSession 取消的传播、供应商对 abort 的网络行为、保存提交点竞态、本地与 hosted 写入的一致性、复杂语言检测以及真机大字/选文。静态方案不能证明这些已通过。生产、TestFlight 和真机验收继续单独记录。

## 依据与文案复核

源码依据为本工作区当前文件，旧 PR 仅作对照。未读取真实账号书籍或私人记录。Swift 取消的协作语义参考项目设计所引的 [Swift 并发文档](https://docs.swift.org/latest/documentation/the-swift-programming-language/concurrency/)。本报告的取消传递与保存竞态判断来自上述实际调用链。

中文文案按已授权的 `lieflat-less-ai-tone` 流程检测并最小复核。检测记录存同目录的 `translation-design-tone/`。文件路径、代码标识与英文样本保持原样。
