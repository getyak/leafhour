# GET-352 sharing and import task review

日期：2026-11-01。范围：`NativeBookSharing.swift`、`SharedBookImport.swift`、Core `BookSharing.swift`、书房 URL 接收与 Web gift 改动。对照本次设计与执行计划，只读审阅当前源码；未运行测试、未接触真实账号。

## 当前结论

本范围当前没有确认的未解决 P0/P1/P2。以下原 P2 已按当前源码复核关闭；本次没有运行 Core 或原生测试，测试执行结果由集中验证记录提供。

## 已修复项

### [P2 · 已修复] 已归档书籍被误判为没有访问权限

原位置：`apps/ios/Leafhour/SharedBookImport.swift` 的预览和确认路径。

触发：登录后归档一本仍然有权阅读的公版书，再打开有效的 `leafhour://read?book=<该书标识>`。预览只查询活跃书架，找不到就显示“当前账号没有此书的访问权限”，并禁用确认；即使该书已有完整本机副本，也无法从链接打开。

依据：`CloudBookSync.swift:105` 的 `shelf` 调用 `/api/library?view=books`；`server/library-service.mjs:280` 明确从这个列表排除归档项。然而 `server/library-service.mjs:113` 的逐书授权读取仍返回公版书，归档没有撤销阅读权限。确认路径同样把活跃书架成员作为授权依据，因此只修预览仍不够。

修复读回：预览 `SharedBookImport.swift:152` 与确认 `:69` 都已改为 `cloud.readableBook`。`BookSharing.swift:92` 只向当前 owner 的 `/api/library/books/<id>/reading-manifest` 发 GET，并检查回执 book ID；不依赖活跃书架，也不调用恢复归档或其他书架写操作。原有账号 context 与请求 ID 检查保留。`BookSharingTests.testAnArchivedBookIsAuthorizedByItsManifestWithoutRestoringOrListingTheShelf` 用实际 URLSession/URLProtocol 边界限制请求方法和路径。

### 已修复：赠书匿名预览保留可注入传输，同时隔离账号信息

`CloudLibraryClient.swift:53` 复制传入配置，清空额外 headers、Cookie storage、credential storage 和 cache，再保存为公开预览配置；`BookSharing.swift:109` 由它创建独立 session，并继续使用拒绝重定向的 delegate。测试 URLProtocol 被保留，公开预览不复用账号 session。`baseURL` 为 immutable `nonisolated let`，没有引入可变来源或账号状态的跨 actor 读取。

新增的 `BookSharingTests` 覆盖实际传输边界：匿名 GET 不携带 Cookie、owner 或 Authorization；创建、接收、收回均为显式 POST 并携带当前 owner/session；正在接收时退出账号后，旧 generation 的回执被 409 拒绝。这些用例验证生产 client 的请求与结果，不以独立伪实现替代 client。

### 已修复：入站 sheet 的临时隐藏不会消费待处理链接

`LibraryScreen.swift` 在 reader、账号或其他 sheet 遮住入口时向 sheet 暴露 nil，但 setter 仅调用带 `presentationAvailable` 检查的 `dismissIncomingBookPresentation`。`SharedBookImport.swift:53` 在暂不可展示时保留 pending；`BookShareCardTests` 已增加此条件下请求 ID 不变的断言。

## Review readback

未确认 P0/P1。长选区卡片保留完整 grapheme，超过卡片上限时明确提供完整文字路径；赠书预览采用隔离、无 Cookie、拒绝重定向的请求，写操作复用 owner 校验；Web 原生入口只生成经过验证的 gift token 意图，不自动收书。

审阅期间重新读取到 `NativeShareContent.attribution` 已加入原文、译法、偏移和实际选文比对。此前发现的“选区冻结后套用后台新译文的校订状态”已在当前源码修正，未列为未解决 finding。

剩余验证边界：以上为源码和测试内容的只读复核，不代表这些测试已由本 reviewer 执行，也不代表 iPad 分享弹层、外部 App 接收、真实服务器上的归档书导入或真机导入已经验收。
