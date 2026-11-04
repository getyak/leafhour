# iOS 书籍打开提速方案（R3 / R4）

日期：2026-11-05。分析基线：公开主线 `11a89b3b`。本报告只做源码核查与方案设计。产品代码未改，构建未启动，也没有访问真实账号或调用模型。下列历史测量保留原来的日期与范围，当前提交的运行结果须由主任务补齐。

## 判断

R3 应补齐“本地已可读，上传与同步可以继续”的入口和状态。现有普通本地导入已经不依赖云端。现有缓存书打开也已经先显示本地正文，再做全包校验与云端记录同步。不能把这两条路径当成尚未实现。

目前仍有两段明确的等待：首次云端下载在整本收齐、离线包保存和记录同步完成后才打开。显式上传在拿到回执后又串行同步书架，下载整本云端阅读副本后再迁移记录。上传中的本地书没有独立的“继续本机阅读”完成状态。

R4 的显示窗口已经存在，通常为 24,000 个 UTF-16 单位、最多 160 段。当前不会把一部长篇的全部正文交给 TextKit 排版。剩余工作是让磁盘读取与解码按窗口工作，长段偏移处理和译文读取也须有界。只改成异步任务，仍然整本解码，不能算完成 R4。

建议先完成 R3 的小改动和可测量的 R4 窗口优化。如果大书的首屏指标仍不达标，再启用本地分段派生缓存。首次云端“按段即可读”需要完整的版本与缓存契约，不能把现有整本下载拆几个请求后就标为离线完成。

## 现有证据

以下路径与行号按分析基线记录。代码说明执行顺序，不能代替当前设备时延测量。

| 路径 | 事实与影响 | 代码位置 |
| --- | --- | --- |
| 普通本地导入 | `importFile → startImport → OfflineLibrary.importFile`；完成后 `activity.finish(book:)`，用户点击“阅读”。没有调用 `upload()`，也不自动打开 | `LeafhourApp.swift:631–677`；`LibraryImportActivity.swift:35–38,74–77` |
| 书架打开 | `item.local` 存在即调用 `open(local)`，只有云端项才调用 `download(remote)` | `LibraryScreen.swift:412–419` |
| 已缓存书打开 | `readingOpening → ReaderSession → reader = session` 后才启动 `openingMaintenance`，其内依次全包校验和 `sync.synchronize(pull:false)` | `LeafhourApp.swift:693–756` |
| 首次云端下载 | `downloadReadingCopy → importCloud → sync.synchronize → reload → open`；即使正文已落盘，挂起的 `/records` 仍可延迟这一入口 | `LeafhourApp.swift:338–374` |
| 显式上传 | 回执保留后，`synchronize → download(openAfter:false) → migrateUploadedRecords → synchronize`；本机与云端是两份书及两套段落坐标 | `LeafhourApp.swift:523–615`；`CloudUploadMigration.swift:10–12` |
| 冷开本地副本 | 首次验证整个 `book.json` 和 `source.*` 的哈希，再经 `indexedBook` 获取完整 `LocalBook`。索引缓存未命中时 `Disk.read` 全量读入并解码 | `OfflineLibrary.swift:253–284,410–418`；`FileIO.swift:27–38` |
| 热开缓存 | 同一进程内复用解码结果，比较 device/inode/size/mtime/ctime。当前 reading cache 最多保留四份，超限清空；不是跨进程持久缓存 | `OfflineLibrary.swift:42–47,268–284`；`FileIO.swift:8–23` |
| 首屏布局 | `TextReadingView.updateContent` 建立 `ReadingTextWindow`，只为该窗口生成 attributed text 和分页 | `TextReadingView.swift:133–139,166–264,672–680` |
| 超长单段 | 窗口显示受限，但先建立整个段落的 `SourceTextOffsets`；非 BMP 长段还扫描全段生成检查点。目标段落查找也线性扫描本章 | `ReadingTextWindow.swift:21–50`；`SourceTextOffsets.swift:17–37` |
| 译文刷新 | 全包校验后 `readingTranslations` 仍调用全包 `book()`，全量解码 `cloud-content.json`；主线程 `updateTranslations` 扫描各章核对原句 | `OfflineLibrary.swift:597–608`；`ReaderReadingContent.swift:36–59`；`ReaderSession.swift:64–82` |
| 进度索引 | `ReaderProgressIndex` 已在 detached utility task 生成，仍遍历全书；不会直接阻塞 session 发布，但会竞争 CPU/内存 | `ReaderScreen.swift:311–317`；`ReaderProgressIndex.swift:13–22` |

以上 iOS 应用文件位于 `apps/ios/Leafhour/`，核心文件位于 `apps/ios/LeafhourCore/Sources/LeafhourCore/`。

现有 native-copy v1 是整本压缩快照：先把所有压缩 part 拼成 Data，完整解压和解码，验证快照后返回。1 MiB 分包解决传输限制，没有实现首段先读。旧路径也要遍历所有章节，遇到超大章再收齐该章所有 part。见 `CloudNativeCopy.swift:7–42`、`CloudBookSync.swift:122–195`。`OfflineLibrary.importCloud:561–595` 又组装整本 source 字符串，写入 source、book 与 cloud-content 并全包验证。这些操作在 actor 上执行，不等于全部在主线程，但仍可能让打开和保存排队。

## 既有验证及其边界

| 证据 | 已记录结果 | 本报告采用的结论 |
| --- | --- | --- |
| [11 月 3 日 reader-first 验收](../2026-11-03-lazy-reader/README.md) | Mac Debug 合成 TXT 9,236,888 bytes / 32,000 段：旧 `book()` 107.9 ms、重复原件验证 106.2 ms；新冷 critical pass 13.61 ms、热 critical pass 0.552 ms | 既有实现确实缩短了本地准备路径；不能当作当前 iPhone 的首屏数字 |
| 同一历史记录 | held `/records` 用例由不出现 reader 改为 reader 发布约 9.5 ms；后续返回不覆盖新位置和笔记 | 缓存书的先本地后同步已有回归。首次 `download()` 仍需补同类测试 |
| [11 月 2 日大 TXT 验收](../2026-11-02-large-native-text-opening.md) | 230,392 段真实授权样本，首窗口 9,935 UTF-16；TextKit 初始构造/布局约 0.023–0.121 s | 证明当时已有有界排版。排除了导入、磁盘加载与校验，不能换算成完整打开时延 |
| 当前测试源码 | `ReaderOpeningTests` 有篡改、过期回执、账号边界、资源延后验证及恢复快照；`ReaderOpeningAppTests` 有 held records；`ReadingTextWindowTests` 有 230,000 段和 Unicode 长段 | 这些是现有用例，当前任务尚未执行，不计作本轮通过 |

本报告没有查阅上述真实书样本。后续复验默认继续使用临时目录、合成文本和 `URLProtocol` 隔离传输。真实账号持久验收若需要，由主任务按 AGENTS.md 先核对测试身份，另记证据。

## R3：本地优先的最小改动

### 本地完成与云端完成分别呈现

沿用本地导入完成后手动点击阅读的行为。上传是用户已经发起的独立任务，进度区保留“正在上传 / 待重试”，同时允许读已验证的本机书。不要在上传完成后自动换成云端书，也不要给本地段落直接附上云端段落身份。

`LibraryImportActivity` 应保存 `readableLocalBookID`，与传输是否运行分开。视图在上传运行期间也可提供“继续阅读”，调用现有 `open(localBook)`。`busy` 只限制冲突的上传/导入操作，不能顺带禁用已有本地阅读。失败时保留本地书与原件，并留下上传 intent 和重试入口，文字说明“本机可读，云端待同步”。普通导入仍不得自动增加云端上传。

上传完成后的迁移必须等源书和目标书都不在活跃阅读中。当前代码只检查云端目标书是否正在打开或阅读（`LeafhourApp.swift:573–577`）。允许上传中读源书后，还必须防止迁移期间漏掉新笔记和新位置。最小安全做法是记录 receipt、保持迁移待办，用户回书架并完成本地 flush 后再执行现有迁移。现有严格原文匹配和 unresolved 记录继续保留，不删除源书。

### 已落盘的云端副本先打开

`download()` 在 `importCloud` 原子发布后先更新本地书架，再打开正文。把前置 `sync.synchronize(book.id)` 移到已经存在的 session maintenance / 后台同步路径。`reload()` 只为更新书架时，优先插入刚返回的已验证 `book`，避免为了呈现这一份副本重新解码全部书架。

这一步只消除正文落盘后的记录等待，首次整本网络下载仍然存在。打开后发现远端位置，沿用显式位置选择。不直接替换 live session 的 anchor、notes 或 drafts。原有 contextID、owner、session identity、reading token、operationID 检查均保留。

推荐最小接口与职责：

| 文件 | 改动责任 | 可审阅契约 |
| --- | --- | --- |
| `LeafhourApp.swift` | 本地读入口、下载落盘即打开、上传任务与迁移时序 | `open(local)` 无网络 await；上传结果不会自动替换当前 session；源/目标任一活跃时延后迁移 |
| `LibraryImportActivity.swift` | 分离 readable 与 transfer 状态 | `readableLocalBookID: String?` 可与 `isRunning == true` 同时存在；重试延用已有 intent |
| `LibraryScreen.swift` / 书架行 | 上传中仍能读本地副本，状态可收起 | 阅读、取消上传及重试是独立操作；点击阅读不取消传输 |
| `CloudUploadIntent.swift` | 复用持久回执与幂等 ID | 暂存 migration pending 状态或从未 finish 的回执恢复；重试不重复建书 |
| `ReaderOpeningAppTests.swift` | 隔离挂起网络 | download 已落盘时 records 永不返回也有正文；上传失败/进行中仍能读源书；迟到迁移不覆盖新记录 |

## R4：从有界排版补到有界数据准备

### 先做窗口内工作

保留当前 `ReadingTextWindow` 及其 canonical ID/Unicode scalar anchor。把本章 passageID → ordinal、每段 scalar/UTF-16 长度和长段稀疏偏移检查点在导入或后台建立，按 sourceVersion 缓存。窗口创建不能再为一个数十 MiB 的段落重建全段 offsets。切片保留同一 passageID 与 `sourceScalarStart/sourceUTF16Start`，不把视觉片段冒充新段落。

译文缓存读取增加窗口范围：`readingTranslations(bookID:passageIDs:targetLanguage:)`，只返回对应的、原句一致的两种译文及各自状态。磁盘未分段前，该接口仍可能全量解码，必须记为过渡方案。不能仅靠输出条数证明 I/O 已有界。后台结果只更新当前窗口相关 revision。选择文字、页翻转和排版恢复时继续用现有延迟更新机制。

初始窗口可先采用约 12,000 UTF-16 / 80 段，邻窗提前准备。这是待测参数。现有 24,000 / 160 是基线，只有首屏、后续滑动及 VoiceOver 均改善才更改默认值。双语视图还要统计实际 attributed text 长度，原文预算不能代表中英两层总布局量。

### 本地分段派生缓存

如果上述变更仍不能满足首屏指标，新增与旧 `book.json` 并存的 `reader-cache`。它是可重建的阅读投影。原件和 state 不变，书、章、段落的稳定 ID 与导出格式也不变。旧书首次建立缓存在后台执行，原路径仍可读。构建失败不能要求用户删除原书或清空记录。

建议数据结构：

```text
ReaderCacheKey = (profile, localBookID, sourceVersion, canonicalIndexDigest, formatVersion)
ReaderCatalog = book metadata + chapter metadata + counts + segment descriptors
SegmentDescriptor = chapterID + ordinal range + passage IDs/ranges + sha256 + bytes
ReaderSegment = original source slices + canonical offsets + translation metadata
ReaderOpenSnapshot = catalog + ReaderState + requested window + verification receipt
WindowRequest = key + ReadingAnchor + direction + UTF16/passages budget + navigation generation
```

catalog 不装全书原文。若单章 230,000 段，不能把一整章当作一个 segment。若单段超长，也应分片保存，但所有片段继续指向原来的 passageID 与原始 offset。段落到 segment 的定位索引需分层/分页，避免把 300,000 个字符串键放进首屏 catalog。目录只需章节元数据，搜索、导出和 Agent 工具按需使用完整内容接口。

需要显式的 `ReaderDocumentDescriptor` 与窗口加载状态。当前 `ReaderSession.book` 是含全书段落的不可变 `LocalBook`。给未加载章塞空数组，会让目录和进度误判为空章，也影响听读、搜索与 Agent。因此先抽出 session 的 metadata/current-window 访问，再让内容提供器支持 `loadWindow`，不能沿用一个看似完整的 LocalBook 隐藏缺失正文。

```swift
protocol ReaderContentStore: Sendable {
    func openSnapshot(_ key: ReaderCacheKey, anchor: ReadingAnchor?) async throws -> ReaderOpenSnapshot
    func loadWindow(_ request: ReaderWindowRequest) async throws -> ReaderWindowResult
    func verifyRemainder(_ receipt: ReaderOpenReceipt) async throws
}
```

首个落地版本继续在冷开前校验完整原件，分段缓存只减少 index 解码与内存。这保留当前 source/index 先验契约，但读取原件仍与整本大小相关，不能宣称首屏已与书大小无关。若测量证明原件哈希成为主要成本，再单独设计“逐段授权显示、全原件延后核验”的格式与恢复事务。不能直接删除 `verifyFile(source)`。本次最小方案不降低现有篡改检测。

文件责任划分：`OfflineLibrary` 管理派生缓存原子发布、校验、回退与 key。新增 `ReaderContentStore` 只提供有界数据。`ReaderSession` 管理加载状态与导航代次。`TextReadingView` 接收窗口并保留 native selection/restore。`ReaderReadingContent` 只取当前窗口与邻窗译文。`ReaderProgressIndex` 使用预计算长度。`Models.swift` 保留旧 Codable 数据契约，新增 descriptor 不改写旧段落 ID。

### 首次云端分段读取后续阶段

优先复用当前 `reading-manifest` 与 chapter endpoint 的账号检查。增补不可变 window manifest、段落范围及快照标识，响应至少携带 owner-bound request、bookID、contentVersion、snapshotID、chapterID、passageID/range 和摘要。现有 `readingChapter` 只有整章及传输 part，仍不足以保证巨章首屏有界。需要 Web 领域服务与 iOS 一起实现，不能从另一个内容版本拼接下一窗。

缓存状态明确为“本页可读 / 部分已保存 / 全书离线可读”。仅当前窗校验成功不能显示整本已下载。断网遇到未缓存页保留当前页及 anchor，给局部重试。不要回书架、跳回开头或显示空白段。每个窗口原子写入、按 snapshot 重用，失败只重试缺失窗，版本改变保留旧缓存并要求重新选择版本。

## 异步加载保持位置

每个请求捕获 `(profile, owner, bookID, sourceVersion, snapshotID, sessionID, navigationID, requested anchor)`。响应写入缓存前核对账号/版本，更新可见内容前再次核对 session 与导航代次。过期结果可保留在匹配的缓存中，不能操作当前视口。

后台预取只填充内容，不调用 `session.go`、不改 `navigationID`、不写阅读进度。实际跨窗只由用户滚动/翻页、显式跳转或已有听读跟随触发。恢复以原 passageID 和 Unicode scalar offset 为准，位置数据绝不用窗口百分比或窗口内行号替代。

插入上方内容或补齐译文前保存原锚点与视口内纵坐标，布局后恢复到同一源位置。用户选字、拖动或页翻转未结束时暂缓可见替换。失败时当前窗口继续可读，重试不创建新 session。取消、返回和账号切换后，旧回调不能重建 reader。全包校验失败继续使用现有冻结/恢复快照/导出流程，绝不把未核实的 live state 写回 canonical records。

## 测量方案

`reader != nil` 只代表 session 发布。首屏结束点必须对应目标锚点的真实正文。此时布局和位置恢复均已完成，视图可见且可响应滚动/翻页。只有骨架或书名、仍在显示 loading spinner，以及触发 `onAppear`，均不能替代这一事件。

建议按一次打开 operationID 记录单调时钟阶段：`tap → actor queue entered → critical verification → index decode/cache hit → session published → window built → text laid out → anchor restored → first readable frame`。首帧用 TextReadingView 恢复完成并进入下一显示帧的同代回调，PDF 路径单独从目标页绘制/恢复完成记录。日志只包含合成 fixture 标识、byte/passages 数及耗时，不保存正文、账号凭据或带访问权限的 URL。

数据侧记录读取/哈希/解码字节数与解码段数，布局侧记录 attributed UTF-16 长度和 window/pagination build 次数。另记主线程长任务及峰值内存，并核对缓存命中和直到首屏的网络请求。用户已开始阅读后发生的全书校验和译文刷新单列，不能藏在总时延之外却不测其卡顿。

| 场景 | 95+ 候选门槛，须实测后决定是否通过 |
| --- | --- |
| 本地热开 | tap → 可读首帧 p95 ≤ 350 ms |
| 进程冷开后点书 | 小书与 24 MiB 级合成大书均 p95 ≤ 1 s；另报应用启动至书架时间 |
| 当前窗已缓存且断网 | 本地首屏门槛不因 records、认证恢复或网络超时延长 |
| 首次远端书 | 固定网络夹具下只依赖 manifest + 目标窗，不依赖无关章节或 records；另报真实网络等待 |
| 后续跨窗 | 预取命中 p95 ≤ 100 ms；未命中有可理解的局部加载/重试，源位置不变 |
| 主线程与内存 | 当前首屏/跨窗不出现 ≥100 ms 主线程连续工作；固定窗口时内存随正文总量的增长显著低于旧路径，完整记录数值，不能只报“未崩溃” |

这些是项目候选验收线，不是已测结果或 Apple 官方标准。每档至少 20 次，冷/热分组，固定设备、系统、Release/Debug、网络、缓存状态与源版本。报 p50/p95/max 和失败数。模拟器与物理 iPhone 分表。清理的只能是隔离夹具缓存。当前没有本轮耗时与内存数据。

## 必须覆盖的测试

| 范围 | 隔离用例与断言 |
| --- | --- |
| 本地与上传 | TXT/Markdown/EPUB/PDF 导入完成即可手动读；云上传挂起或失败仍能读源书；普通导入不额外发上传请求；上传重试沿用 intent，无重复书 |
| 下载与记录 | 挂起 `/records`，已落盘的副本仍有可读首帧；云端迟到位置只提示冲突；新笔记、草稿、位置和时段保持 |
| 大书 | 32,000 与 230,000 段、单章巨量段、数十 MiB 单段、中/英/emoji/组合字符；首、中、尾锚点；窗口预算及 offset 连续无漏字 |
| 磁盘缓存 | 冷进程、热进程、四本以上切换、catalog/segment 失效与构建中断；保留旧 canonical 包；派生缓存缺失可回退且记录耗时 |
| 断网重试 | 已缓存窗继续读，未缓存窗只局部失败；同 request/snapshot 重试；恢复网络后不跳位置；部分缓存不标全书离线 |
| 续读与交互 | 中段 scalar offset 冷重启、目录跳转、快速往返章、旋转/字号/中英切换；相同源锚点及屏内位置恢复；选字期间异步译文/预取不破坏系统菜单 |
| 版本与账号 | A→B 切换、旧 session 回调、同书不同 contentVersion、相同大小/mtime 的篡改、替换 index、过期 receipt；不能混窗、串账号或覆盖旧记录 |
| 恢复与内容 | 缺失/损坏非当前资源延后失败仍能导出 live recovery；修复/重启后保留；缺译文保留原文，直译/意译及 reviewed 状态独立；图片与 PDF 走自身坐标 |

应扩展现有 `ReaderOpeningTests`、`ReaderOpeningAppTests`、`ReadingTextWindowTests`、`ReaderPaginationTests`、`ReaderViewportTests`、`ReaderResourcePositionTests`、`CloudNativeCopyTests`、`CloudDownloadProgressTests` 和 `CloudUploadMigrationTests`。新增性能记录必须连到可读首帧回调。Core 的计时打印只作为阶段诊断。构建执行由主任务遵守 `apps/ios/README.md` 的 `dev-storage-guard` 与 `dev-ios-session` 共享资源约定。

## 100 分评分法

权重按用户要求冻结。每个子项先给证据，再给分。源码与测试是否存在单独记录，通过结果再按历史、本轮和物理设备区分。未知项不发放对应分数，也不改分母把未测项目排除。当前仅完成分析，不给运行体验总分。

| 维度 | 分值 | 子项 |
| --- | ---: | --- |
| 功能 | 30 | 本地导入/上传中可读 8；缓存书断网打开 6；首次远端目标窗先读 6；完整内容与两种译文忠实保留 5；续读到原位置 5 |
| 交互 | 25 | 状态与可读/部分离线区分 5；失败可重试且当前页保留 5；异步加载与排版不跳位置 8；选字/翻页/VoiceOver/大字号可用 7 |
| 性能 | 25 | 本地热开门槛 6；冷开大书门槛 7；首屏数据准备有界且没有 records 依赖 5；跨窗/主线程/内存门槛 7 |
| 边界 | 20 | 账号/书/版本隔离 6；稳定 ID 与 Unicode offsets 5；取消/迟到响应/修复与恢复 5；版本替换和本地→云端迁移不丢记录 4 |

每个子项达到全部指定条件才得满分。存在可复现缺陷按受影响场景占比扣分，评分表附具体用例与原始结果。总分达到 95+ 还要求四个维度分别至少 28/30、23/25、23/25、18/20，且没有未关闭的严重问题。账号越界、混合版本、漏正文、丢笔记/草稿、不可恢复地跳位置或伪称全书已离线均为阻断，体验不得判为通过，总分封顶 85。

真机、实际 VoiceOver、Release 大书冷开与内存压力没有证据时，分别保留其交互/性能分为未验证。模拟器结果不能自动补齐。实现、当前本地验证、合并、发布及手机安装另列状态。本报告不以方案完整度换取体验分数。
