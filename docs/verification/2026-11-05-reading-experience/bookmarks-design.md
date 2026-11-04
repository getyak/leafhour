# R9/R10：阅读书签设计与独立测评门槛

日期：2026-11-05。范围：iPhone 原生阅读器。本文为源代码调查后的实施设计。没有修改产品代码、运行构建或执行设备验收。采用 `design-judgment` 的功能减法与时间注意模块。100 分是验收分配，当前已验证产品得分为 0/100，待验证上限为 100 分。

## 设计结论

书签保存当前页首实际可见的原文位置。下拉并松手完成添加，右上角保留一个 44pt 书签按钮。没有书签显示轮廓，有书签显示所选颜色与实心形状。点击已有书签打开轻量配置面板，可改色、命名、移除，也能进入本书书签列表。命名可留空，列表以章节和原文短句补足识别信息。书签单独保存，不能创建空笔记或向 `notes` 写特殊文本。

配置面板沿用原生 sheet：先显示当前位置，再显示带名称和选中标记的预设颜色，接着为“自定义颜色”和可选名称，最后为移除。预设为墨绿、琥珀、朱红、蓝色、紫色。名称和勾号保证不依赖颜色辨认。自定义颜色存不透明 sRGB 六位十六进制值，显示名称默认“自定义”。用户可为这个书签另写名称。控制间距和点击区域按 44pt，动态字号允许换行。正文不增加常驻浮动卡片，不因保存或改色重新排版。

下拉中只出现小书签图标与“下拉添加书签／松开添加书签”。越过阈值轻触反馈一次。松手后本地持久化成功才显示“已添加书签”，1.5 秒后收起。失败显示“书签尚未保存”与重试，保留待保存修改。减少动态开启时只换状态，无页面位移。再次添加同一位置返回已有项，不删除，不覆盖用户原色和名称。

## 当前实现证据与风险

| 来源 | 观察到的事实 | 实施要求 |
| --- | --- | --- |
| `Models.swift:37` | `ReadingAnchor` 保存 chapterID、passageID、Unicode scalar offset、PDF pageY、插图 resourceY | 直接复用源锚点，不存页数或滚动百分比来代替 |
| `Models.swift:51` | `ReadingAnchor.key` 未包含 pageY/resourceY | 书签建立自己的规范化键，避免同一 PDF 页不同位置碰撞 |
| `Models.swift:136` | `ReaderState` 只有笔记、草稿、位置、偏好等，无书签实体 | 新增独立书签集合，旧状态缺字段仍可解码 |
| `ReaderSession.swift:149,250,253` | 可见锚点立即更新；保存合并完整快照，提供 flush receipt | 使用 `currentAnchor`，保存成功依据 receipt；不靠延迟的 state.anchor |
| `TextReadingView.swift:649` | paged 模式明确关闭原生 scroll pan，保留 UIKit 选文 | 独立纵向 pan；不能只监听现有 scroll delegate |
| `ReaderTextPagination.swift:64` | 横向翻页使用独立 pan，方向比为 1.4，排除 VoiceOver、控件和链接 | 纵向方向必须互斥，并共享选文与 overlay 门禁 |
| `PDFReadingView.swift:283` | PDF 只有 fitted 状态可横翻，放大时仍由原生滚动处理 | 放大 PDF 禁止快捷下拉，保留明确按钮 |
| `OfflineLibrary.swift:441,453` | 状态位于当前 profile 的 states，按本书目录验证并原子写入 | 加入书签校验，沿用账号 profile；不另存全局 UserDefaults |
| `BookDetailScreen.swift:148` | native records 导出封装完整 ReaderState | 新字段可随本机记录导出；需回归 JSON roundtrip |
| `CloudBookSync.swift`、`app/library-backup.mjs`、`app/library-restore.mjs` | 云记录同步与完整备份没有书签实体；restore 批次显式列出各记录类型 | 本机书签不会自动进入云端完整备份，不得声称已跨设备同步或完成迁移 |

## 稳定锚点与保存接口

建议新增 `ReaderBookmark`，字段为 UUID、sourceVersion、ReadingAnchor、可选名称、颜色值、颜色显示名、createdAt、modifiedAt。`bookID` 与账号由当前 session/store 的容器确定，调用方不能传入任意账号。版本取实际本地 `book.sourceVersion`。云书另保留 `book.cloud.contentVersion`（可选），两个版本都匹配才可跳转。不要把源文件哈希与云内容版本混为一个字段。

`ReaderState.bookmarks` 首次使用可选数组，读取时 `nil` 视为空。或者采用明确的 `decodeIfPresent` 自定义解码，不能假定带默认值的非可选数组会自动兼容旧 JSON。颜色只接收 `#[0-9A-Fa-f]{6}`；名称去除首尾空白，最多 80 个字符。无效颜色回退到有名称的默认色，恶意锚点不得进入当前集合。

最小接口建议：

```swift
// ReaderSession：返回值必须区分已有、已保存、保存失败及无效位置。
func addBookmark(at snapshot: BookmarkCapture) async -> BookmarkSaveResult
func updateBookmark(id: UUID, color: BookmarkColor, name: String?) async -> BookmarkSaveResult
func removeBookmark(id: UUID) async -> BookmarkSaveResult
func goToBookmark(id: UUID) -> BookmarkNavigationResult
var bookmarks: [ReaderBookmark] { get }
```

`BookmarkCapture` 在开始手势时冻结 session owner、navigationID、当前原文版本、模式和锚点。提交前再次核对。换书、跳章、换账号、排版变化、失去前台或浮层开启均取消本次手势。未知位置显示按钮不可用原因，不能悄悄保存章节首段。按钮操作同样先从真实阅读器抓取可见锚点。

去重键由原文版本和稳定位置组成：文字使用 chapterID/passageID/Unicode scalar offset；PDF 另包含规范化 pageY；插图包含 resourceY。PDF pageY 先按页面 bounds 限制并取整为 PDF point，插图 resourceY 取千分位。手势期间锚点冻结，重复松手复用同一项。两次独立、确实不同的页内位置可以保存。不能使用随机 UUID 作为唯一去重依据。新项持久化只合并本次书签，不回滚期间到来的笔记、位置或其他书签修改。

当前位置标识先匹配规范化的当前锚点。从列表跳转时按同一个保存锚点显示对应书签。需补充 viewport 范围匹配，确保字体变大后保存点仍在当前可见页时可以识别。现有 `ReaderVisiblePage` 只有完整段落 ID，不含段内可见范围。不能仅凭同 passageID 就认为长段落每一页都有此书签。最小范围事件包含第一可见源锚点与末端源锚点，PDF 使用实际 pageY 区间。多书签同页时按钮表示最接近页首的一项，面板列出本页全部项。

版本不符的旧书签保留并标记“原文版本已变化”，不跳到相似百分比，不迁移为新章节首段，也不阻止当前版本新书签保存。`saveState` 对旧版本项校验结构，对当前版本项校验书章与范围。无法确认的迁移需要独立处理。

## 手势冲突规则

| 模式 | 可以开始的条件 | 完成条件与取消 |
| --- | --- | --- |
| 文字 paged | 独立单指 vertical pan，从正文可读区域开始；初始向下且 y 速度大于 x 的 1.4 倍 | 下拉 72pt 且 y 位移大于 x 的 1.6 倍，松开才保存；回到 56pt 以下撤销 armed 状态 |
| 文字 scroll | 开始拖动时已经处于真实章节顶部，contentOffset ≤ -adjustedContentInset.top + 1；所载 textWindow 没有 previousAnchor | 使用原生 scroll pan 的越界位移观察，超出顶部 72pt 后松手保存；从中部滚到顶部的同一次拖动不触发 |
| PDF paged | pageIsFitted、无 nativePageTurn/翻页动画，独立 vertical pan | 同 paged 阈值；缩放手势或放大立即取消 |
| PDF scroll | 仅真实滚动文档顶部的 overscroll，拟合比例；不得把每张可见 PDF 页的顶部当作容器顶部 | 同 scroll 开始锁定与松手条件；中部普通下滚不触发 |

共同门禁：当前没有选文、选文手柄拖动、长按等待、原生编辑菜单、链接触摸、UIControl、多指手势、打开中的 overlay/sheet、翻页/恢复/排版任务；阅读区域 active 且 view/window/session 仍一致。VoiceOver 开启时不接管纵向手势，使用“添加当前位置书签” custom action 和 44pt 按钮。新增 custom action 要合并现有上一屏/下一屏，不能覆盖。

横向 pan 与纵向 pan 用方向阈值互斥。不设置互相 require-to-fail 形成死锁。选文与双击/长按先于书签，单指下拉不取消 UIKit 正文触摸。scroll 模式观察原生 pan 状态和 overscroll，不创建抢占滚动的第二个 pan。每个触摸序列只提交一次，`cancelled`/`failed` 永不保存。

## 最小改动文件与交付边界

| 文件 | 责任 |
| --- | --- |
| Core `ReaderBookmarks.swift`（新增）与 `Models.swift` | 独立实体、颜色、规范化键、兼容解码、版本校验 |
| Core `ReaderSession.swift`、`OfflineLibrary.swift` | 幂等增改删、持久化 receipt、锚点及账号容器校验、稳定跳转 |
| App `ReaderBookmarkGestureHandler.swift`（新增） | 纯状态机与 UIKit vertical pan 适配、冻结 capture、门禁、清理 |
| App `TextReadingView.swift`、`PDFReadingView.swift` | 手势适配、真实顶部判定、精确 viewport 与源锚点回报、可访问性动作 |
| App `ReaderScreen.swift`、`ReaderBookmarkPanel.swift`（新增）、目录 overlay 文件 | 右上角按钮、状态反馈、颜色/名称、列表与跳转 |
| App `ReaderToolPanels.swift`、`BookDetailScreen.swift` | 导出入口文案包含书签，完整 state 导出与恢复记录不丢字段 |
| Core tests 与 App gesture tests | 下表的模型、持久化、冲突状态机与 UI 验证 |

本轮最小实现可明确为本机书签。本机 records 导出的 JSON 必须可完整解码恢复书签，导出后以新隔离库验证锚点与颜色。当前没有观察到 native records 导入 UI，不能把 Codable roundtrip 写成用户已完成新实例恢复。若交付要求包含网页版完整书房备份或跨设备，需另补服务书签实体、账号授权路由、`CloudBookSync`、完整备份校验、restore 批次及来源版本迁移；完成这条链之前界面应明确书签保存在此设备。不得借用 notes、comments 或 readingMilestones 夹带书签。

## 100 分独立测评门槛

每个格子按实际通过的证据记分。未知、仅编译和仅源代码推断均为 0。允许报告待验证上限。R9、R10 分别填写同一四维表，不把合并总分代替每项得分。

| 维度 | 分值 | 必须出现的证据 |
| --- | --- | --- |
| 功能 | 30 | 文字/PDF 各模式添加与精确返回 10；重复添加及原名称颜色不变 5；改色/自定义色/名称/移除 5；冷启动后数据仍在及导出解码到隔离库 10 |
| 交互 | 25 | 横翻、选文、滚动、overlay 各 20 次不误触 10；72pt/回撤/松手/取消状态机 5；44pt 入口与本书列表跳转 5；失败重试和轻量反馈不挡正文 5 |
| 性能 | 25 | 20 次下拉 p95 主线程每帧新增处理 < 2ms、无可见重排 8；新增/改色到本地完成 p95 < 150ms（1000 书签合成库）7；列表首屏 p95 < 100ms、可滚动 5；新功能对正文首屏 p95 增量 < 20ms，明确测量设备和样本 5 |
| 边界与可访问性 | 20 | 账号 A/B/设备库互不出现书签及切账号取消 5；原文版本过期/损坏锚点/保存失败/kill 后重开 5；VoiceOver、动态字号、减少动态、深浅主题 5；长段落、插图、扫描 PDF、PDF 放大/旋转、横屏 5 |

数据越权、保存到错误位置、过期版本仍跳转、选文或普通下滚误触均为阻断项，即使累计达到 95 也不验收。性能数值是本设计的目标值，尚无实测。真机手势与 VoiceOver 必须单列。模拟器通过不能替代真机。

最小自动化：旧 JSON 缺 bookmarks；书签 Codable roundtrip；同锚点并发添加幂等；PDF/resource 锚点不同不碰撞；Unicode scalar 与 UTF-16 区分；颜色校验；改色失败不丢其他状态；过期版本保留但拒绝跳转；账号切换取消迟到完成；手势八种结束状态及所有门禁；原文/译文模式切换仍指向原文；长段落 viewport 匹配。

文案交付按 `lieflat-less-ai-tone` 检测并复核。规则清单、接口、路径与数值保持原样。构建与产品验收由主执行统一进行，本文未宣称任何测试通过。
