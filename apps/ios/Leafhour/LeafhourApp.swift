import SwiftUI
import UIKit
import Network
import LeafhourCore

@main
struct LeafhourApp: App {
    @State private var model = VideoAcceptanceFixture.makeModelIfRequested() ?? LibraryModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            LeafhourRootScreen(model: model).tint(.leafInk)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    model.setSessionActivityForeground(phase == .active)
                }
                .simultaneousGesture(TapGesture().onEnded { model.recordSessionActivity() })
                .simultaneousGesture(DragGesture(minimumDistance: 12).onEnded { _ in model.recordSessionActivity() })
        }
    }
}

extension Color {
    static let leafFill = Color(red: 0.24, green: 0.40, blue: 0.31)
    static let leafInk = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 181.0 / 255, green: 205.0 / 255, blue: 189.0 / 255, alpha: 1)
            : UIColor(red: 0.24, green: 0.40, blue: 0.31, alpha: 1)
    })
    static let shelfPaper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 0.07, alpha: 1) : UIColor(red: 0.985, green: 0.981, blue: 0.965, alpha: 1)
    })
    static let readingPaper = Color(red: 0.97, green: 0.96, blue: 0.92)
}

extension ReaderPreferences {
    /// Read the system appearance outside the reader's presentation overrides.
    func colorScheme(following system: ColorScheme) -> ColorScheme {
        theme == "system" ? system : (ReaderPaper(rawValue: theme)?.isDark == true ? .dark : .light)
    }
}

enum AccountRecordsState: Equatable {
    case idle
    case loading
    case ready
    case partial(String)
    case cached(String)
    case failed(String)
    var isLoading: Bool { self == .loading }
    var hasSnapshot: Bool {
        switch self {
        case .ready, .partial, .cached: true
        default: false
        }
    }
}

@MainActor @Observable
final class LibraryModel {
    @ObservationIgnored private var chatWorkspaces: [String: ReaderCloudTools] = [:]
    func conversationTools(bookID: String) -> ReaderCloudTools {
        let key = (account?.id ?? "device") + ":" + bookID
        if let tools = chatWorkspaces[key] { return tools }
        let tools = ReaderCloudTools(); chatWorkspaces[key] = tools; return tools
    }
    var books: [LocalBook] = []
    var localArchivedIDs: Set<String> = []
    var cloudBooks: [CloudShelfBook] = []
    var accountShelf: CloudShelfSnapshot?
    var accountActions: [PendingAccountShelfAction] = []
    var localActivity: [String: Date] = [:]
    private var lastOpenedLocalID: String?
    var jobs: [ImportJob] = []
    var duplicateRequest: DuplicateImportRequest?
    var importActivity: LibraryImportActivity?
    var message: String?
    var busy = false
    var status = ""
    var activeBookID: String?
    var activityProgress: Double?
    var activityCanCancel = false
    var syncing = false
    var syncStatus = ""
    var account: CloudAccount?
    private(set) var readingJournalRevision: UInt = 0
    var reader: ReaderSession? {
        didSet {
            guard oldValue !== reader else { return }
            if oldValue != nil && reader == nil { readingJournalRevision &+= 1 }
            openingMaintenance?.cancel()
            if let owner = readerOwnership, owner.bookID == oldValue?.book.id {
                readerOwnership = nil
                Task { await owner.sync.releaseReadingBook(owner.bookID, token: owner.token) }
            }
        }
    }
    var incomingBookRequest: IncomingBookRequest?
    var queuedBookRequests: [IncomingBookRequest] = []
    var importAccountContext: UUID { contextID }
    var summary: CloudJSON = .null
    var notebookEntries: [CloudJSON] = []
    var notebookCursor: String?
    var notebookState: AccountRecordsState = .idle
    var summaryState: AccountRecordsState = .idle
    private var summaryRequested = false
    private var summaryRefreshRequested = false
    private var summaryWorkerID: UUID?
    @ObservationIgnored private var summaryWorker: Task<Void, Never>?
    private var notebookIncomplete = false
    var syncIssues: [String: CloudSyncMetadata] = [:]
    var nativeAuthenticating = false
    var nativeAuthStatus: NativeAuthenticationStatus?
    var linkedIdentities: [CloudLinkedIdentity] = []
    var nativeAuthMessage: String?
    let cloud: CloudLibraryClient
    @ObservationIgnored private let foregroundSessionActivity: ForegroundSessionActivity
    private(set) var library: OfflineLibrary?
    private var sync: CloudBookSync?
    private var root: URL?
    private var importTask: Task<Void, Never>?
    private var downloadTask: Task<Void, Never>?
    private var downloadOperationID: UUID?
    private var didRestoreAccount = false
    private var lastSuccessfulSync: (owner: String, date: Date)?
    private let persistCredential: Bool
    private var contextID = UUID()
    private var openingBookID: String?
    private struct ReadingOwnership { let bookID: String; let token: UUID; let sync: CloudBookSync }
    @ObservationIgnored private var readerOwnership: ReadingOwnership?
    @ObservationIgnored private var openingMaintenance: Task<Void, Never>?
    private var migratingBookIDs: Set<String> = []
    private var syncRequested = false
    @ObservationIgnored private var shelfSyncTask: Task<Void, Never>?
    @ObservationIgnored private var shelfSyncContext: UUID?
    @ObservationIgnored private var shelfSnapshotGeneration: UInt = 0
    private var reloadID = UUID()
    private var nativeOperationID = UUID()
    @ObservationIgnored private weak var activeNativeBrowser: NativeProviderAuthentication?
    @ObservationIgnored private var networkMonitor: NWPathMonitor?

    init(root: URL? = nil, cloud: CloudLibraryClient? = nil, credential: CloudCredential? = nil, monitorNetwork: Bool = true) {
        persistCredential = cloud == nil
        let saved = credential ?? (cloud == nil ? AccountCredentialStore.read() : nil)
        let client = cloud ?? CloudLibraryClient(credential: saved)
        self.cloud = client
        foregroundSessionActivity = ForegroundSessionActivity(client: client)
        self.account = saved?.account
        do {
            let base = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Leafhour", isDirectory: true)
            self.root = base
            try configureLibrary()
        } catch { message = error.localizedDescription }
        guard monitorNetwork else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await self?.synchronize() }
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility)); networkMonitor = monitor
    }
    deinit { networkMonitor?.cancel() }
    func setSessionActivityForeground(_ active: Bool) {
        foregroundSessionActivity.setForeground(active)
        if active { recordSessionActivity() }
    }
    /// Network recovery and background synchronization deliberately never call this.
    func recordSessionActivity() {
        guard foregroundSessionActivity.isForeground, let owner = account?.id else { return }
        let marker = contextID
        Task { @MainActor [weak self] in
            guard let self, marker == self.contextID, owner == self.account?.id else { return }
            // This receipt changes no offline data or sync-success state. A failed
            // attempt remains subject to the client's cooldown until real activity.
            _ = try? await self.foregroundSessionActivity.record(ownerID: owner)
        }
    }
    private func resetBookActivity() {
        shelfSyncTask?.cancel(); shelfSyncTask = nil; shelfSyncContext = nil; syncRequested = false
        resolveDuplicate(nil)
        importTask?.cancel(); downloadTask?.cancel()
        importTask = nil; downloadTask = nil; downloadOperationID = nil
        importActivity = nil; migratingBookIDs = []; busy = false
        activeBookID = nil; activityCanCancel = false; activityProgress = nil; status = ""
    }
    private func configureLibrary() throws {
        localArchivedIDs = []
        guard let root else { return }
        let scope: LibraryScope
        if let account {
            guard let id = UUID(uuidString: account.id) else { throw LibraryError.invalid("账号标识无效，未打开其他书房。") }
            scope = .account(id)
        } else { scope = .device }
        let value = try OfflineLibrary(root: root, scope: scope)
        library = value; sync = CloudBookSync(client: cloud, library: value)
    }
    func reload(loadShelf: Bool = true) async {
        var changedScope = false
        if !didRestoreAccount {
            didRestoreAccount = true
            let marker = contextID
            do {
                let restored = try await cloud.restore()
                guard marker == contextID else { return }
                if restored?.id != account?.id {
                    changedScope = true
                    contextID = UUID(); resetBookActivity(); account = restored
                    books = []; cloudBooks = []; accountShelf = nil; accountActions = []; localActivity = [:]; syncIssues = [:]; syncing = false; syncStatus = ""
                    notebookEntries = []; notebookCursor = nil; notebookIncomplete = false; notebookState = .idle
                    resetReadingSummary()
                    linkedIdentities = []; nativeAuthStatus = nil; nativeAuthMessage = nil
                    try configureLibrary()
                } else if restored != account { account = restored }
                if persistCredential { try AccountCredentialStore.write(await cloud.savedCredential()) }
            } catch {
                if marker == contextID { syncStatus = account == nil ? "可先在本机阅读，联网后登录书房。" : "暂时离线，已保留此账号的书籍与记录。" }
            }
        }
        if loadShelf || changedScope { await loadCachedShelf() }
    }
    /// Presents this profile's durable shelf without waiting on authentication.
    func loadCachedShelf() async {
        guard let library else { return }
        let marker = contextID, owner = account?.id, request = UUID(), snapshotGeneration = shelfSnapshotGeneration
        reloadID = request
        do {
            let local = try await library.books(), imports = try await library.jobs().filter { $0.phase != .complete }
            let opened = try await library.lastOpenedBook()
            let archivedIDs = try await library.localArchivedBookIDs()
            var snapshot: CloudShelfSnapshot?
            var pending = accountActions
            var warning: String?
            do {
                if let owner, let data = try await library.cloudView("shelf") { snapshot = try CloudShelfSnapshot(cacheData: data, ownerID: owner) }
            } catch { warning = "此设备的书架缓存暂时无法读取，已保留文件。请联网重试同步。" }
            if let owner {
                do { pending = try await library.accountActions(ownerID: owner) }
                catch { warning = error.localizedDescription }
            }
            var events: [String: Date] = [:]
            for book in local { if let event = try? await library.state(book.id).lastActivityAt { events[book.id] = event } }
            var issues: [String: CloudSyncMetadata] = [:]
            for book in local where book.cloud != nil { issues[book.id] = try? await library.cloudMetadata(book.id) }
            guard marker == contextID, owner == account?.id, request == reloadID else { return }
            if books != local { books = local }
            if localArchivedIDs != archivedIDs { localArchivedIDs = archivedIDs }
            if jobs != imports { jobs = imports }
            if lastOpenedLocalID != opened { lastOpenedLocalID = opened }
            if localActivity != events { localActivity = events }
            if syncIssues != issues { syncIssues = issues }
            if accountActions != pending { accountActions = pending }
            if let snapshot, snapshotGeneration == shelfSnapshotGeneration { publishAccountShelf(snapshot, fromCache: true) }
            if let warning, message == nil { message = warning }
        } catch { if marker == contextID, request == reloadID { message = error.localizedDescription } }
    }
    /// Keep identical observations quiet and fence cache reads that predate a network receipt.
    @discardableResult
    private func publishAccountShelf(_ snapshot: CloudShelfSnapshot, fromCache: Bool = false) -> Bool {
        guard snapshot.ownerID == account?.id else { return false }
        if !fromCache { shelfSnapshotGeneration &+= 1 }
        let changed = accountShelf != snapshot
        if changed { accountShelf = snapshot }
        if cloudBooks != snapshot.books { cloudBooks = snapshot.books }
        return changed
    }
    func signIn(email: String, password: String, code: String? = nil) async throws {
        guard !nativeAuthenticating, !busy, reader == nil, openingBookID == nil else { throw LibraryError.invalid("请先回到书房，再切换账号。") }
        let user: CloudAccount
        if let code { user = try await cloud.verifyCode(email: email, code: code) }
        else { user = try await cloud.signIn(email: email, password: password) }
        try await adoptSignedInAccount(user)
    }
    private func adoptSignedInAccount(_ authenticated: CloudAccount) async throws {
        let previousContext = contextID
        let canonical = try await cloud.restore(), credential = await cloud.savedCredential()
        guard let user = canonical, user.id == authenticated.id, credential?.account.id == authenticated.id,
              previousContext == contextID else { throw CancellationError() }
        if persistCredential { try AccountCredentialStore.write(credential) }
        contextID = UUID(); resetBookActivity(); account = user; books = []; cloudBooks = []; accountShelf = nil; accountActions = []; localActivity = [:]; syncIssues = [:]; notebookEntries = []; notebookCursor = nil; notebookState = .idle; notebookIncomplete = false; syncing = false
        let adoptedContext = contextID
        resetReadingSummary()
        linkedIdentities = []
        try configureLibrary()
        recordSessionActivity()
        await reload()
        guard contextID == adoptedContext, account?.id == user.id else { throw CancellationError() }
        // Authentication is complete. Shelf transfer continues in the existing
        // session-fenced synchronizer without keeping the login form busy.
        let marker = adoptedContext
        Task { [weak self] in
            guard let self, self.contextID == marker else { return }
            await self.synchronize()
        }
    }
    func saveDisplayName(_ name: String) async throws {
        guard let owner = account?.id else { throw LibraryError.invalid("请先登录。") }
        let marker = contextID
        let saved = try await cloud.saveDisplayName(name, ownerID: owner)
        let credential = await cloud.savedCredential()
        guard marker == contextID, account?.id == owner, credential?.account.id == owner else { throw CancellationError() }
        if persistCredential { try AccountCredentialStore.write(credential) }
        account = saved
    }
    func loadAuthenticationOptions() async {
        let marker = contextID, owner = account?.id
        do {
            let status = try await cloud.nativeAuthenticationStatus()
            guard marker == contextID, owner == account?.id else { return }
            nativeAuthStatus = status
            nativeAuthMessage = status.available ? nil : "当前书房版本尚未开放 Apple 与 Google 登录，可以继续使用邮箱。"
            if let owner, status.available {
                let identities = try await cloud.linkedIdentities(ownerID: owner)
                guard marker == contextID, owner == account?.id else { return }
                linkedIdentities = identities
            }
        } catch { if marker == contextID { nativeAuthMessage = "暂时无法核对登录方式，请联网后刷新。" } }
    }
    func authenticate(provider: NativeOAuthProvider, browser: NativeProviderAuthentication) async throws {
        guard !nativeAuthenticating, !busy, openingBookID == nil,
              nativeAuthStatus?.available == true, nativeAuthStatus?.providers.contains(provider) == true else { throw LibraryError.invalid("这个登录方式暂不可用，请稍后重试或使用邮箱。") }
        let mode: NativeOAuthMode = account == nil ? .signIn : .link
        guard mode == .link || reader == nil else { throw LibraryError.invalid("请先回到书房再登录。") }
        let operation = UUID(), marker = contextID, owner = account?.id
        nativeOperationID = operation; nativeAuthenticating = true; nativeAuthMessage = nil; activeNativeBrowser = browser
        defer { if nativeOperationID == operation { nativeAuthenticating = false; activeNativeBrowser = nil } }
        var flowID: UUID?
        do {
            let flow = try await cloud.beginNativeOAuth(provider: provider, mode: mode)
            flowID = flow.id
            guard nativeOperationID == operation, marker == contextID, owner == account?.id else { await cloud.cancelNativeOAuth(flowID: flow.id); throw CancellationError() }
            let callback = try await browser.authenticate(flow)
            guard nativeOperationID == operation, marker == contextID, owner == account?.id else { await cloud.cancelNativeOAuth(flowID: flow.id); throw CancellationError() }
            let persistence: (@Sendable (CloudCredential) throws -> Void)?
            if persistCredential {
                persistence = { @Sendable (credential: CloudCredential) throws -> Void in
                    try AccountCredentialStore.write(credential)
                }
            } else { persistence = nil }
            let user = try await cloud.completeNativeOAuth(flowID: flow.id, callbackURL: callback, persist: persistence)
            guard nativeOperationID == operation, marker == contextID, owner == account?.id else { throw CancellationError() }
            if mode == .link {
                guard user.id == owner else { throw LibraryError.invalid("关联回程的账号已变化，原书房仍保留。") }
                let canonicalProfile = try await cloud.restore(), credential = await cloud.savedCredential()
                guard let canonical = canonicalProfile, canonical.id == owner, credential?.account.id == owner,
                      nativeOperationID == operation, marker == contextID, owner == account?.id else { throw CancellationError() }
                if persistCredential { try AccountCredentialStore.write(credential) }
                account = canonical // Preserve the account profile rather than replacing it with provider metadata.
                nativeAuthMessage = "登录方式已关联到这间书房。"
            } else { try await adoptSignedInAccount(user) }
            await loadAuthenticationOptions()
        } catch {
            if let flowID { await cloud.cancelNativeOAuth(flowID: flowID) }
            else if nativeOperationID == operation { await cloud.cancelNativeOAuth() }
            if nativeOperationID == operation {
                nativeAuthMessage = error is CancellationError ? (mode == .link ? "已关闭登录窗口。本次关联尚未确认，可以刷新登录方式查看。" : "已关闭登录窗口。") : error.localizedDescription
            }
            throw error
        }
    }
    func cancelNativeAuthentication() async {
        nativeOperationID = UUID(); nativeAuthenticating = false
        activeNativeBrowser?.cancel(); activeNativeBrowser = nil
        await cloud.cancelNativeOAuth()
    }
    func signOut() async {
        guard !busy, reader == nil, openingBookID == nil else { message = "正在打开书籍，请先回到书房，等待本机保存完成后再退出。"; return }
        do {
            await cancelNativeAuthentication()
            if persistCredential { try AccountCredentialStore.write(nil) }
            contextID = UUID(); resetBookActivity(); account = nil; books = []; cloudBooks = []; accountShelf = nil; accountActions = []; localActivity = [:]; syncIssues = [:]; notebookEntries = []; notebookCursor = nil; notebookState = .idle; notebookIncomplete = false; linkedIdentities = []; nativeAuthStatus = nil; syncing = false
            resetReadingSummary()
            await cloud.signOut(); try configureLibrary(); await reload()
            syncStatus = "已退出，账号书籍与记录保留在各自的离线空间。"
        } catch { message = error.localizedDescription }
    }
    func synchronize(force: Bool = false) async {
        guard account != nil, library != nil else { return }
        let marker = contextID
        if let task = shelfSyncTask, shelfSyncContext == marker {
            if force { syncRequested = true }
            await task.value
            return
        }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.synchronizeOnce(force: force)
            while self.contextID == marker, !Task.isCancelled, self.syncRequested {
                self.syncRequested = false
                await self.synchronizeOnce(force: true)
            }
            if self.shelfSyncContext == marker {
                self.shelfSyncTask = nil; self.shelfSyncContext = nil
            }
        }
        shelfSyncContext = marker; shelfSyncTask = task
        await task.value
    }
    private func synchronizeOnce(force: Bool) async {
        guard let account, let library, let sync else { return }
        let needsRetry = !accountActions.isEmpty || syncIssues.values.contains { $0.lastError != nil || $0.readingTimeError != nil || !$0.noteErrors.isEmpty }
        let hasNewActivity = books.contains { book in
            guard let activity = localActivity[book.id], book.cloud != nil else { return false }
            return activity > (syncIssues[book.id]?.lastSyncedActivityAt ?? .distantPast)
        }
        if !force, !needsRetry, !hasNewActivity, let lastSuccessfulSync,
           lastSuccessfulSync.owner == account.id, Date().timeIntervalSince(lastSuccessfulSync.date) < 30 { return }
        let marker = contextID; syncing = true; syncStatus = "正在同步书房…"
        defer {
            if marker == contextID {
                syncing = false
            }
        }
        do {
            let shelf = try await cloud.accountShelf(ownerID: account.id)
            guard marker == contextID else { return }
            publishAccountShelf(shelf)
            try await library.cacheCloudView("shelf", data: shelf.cacheData())
            if shelf.isAuthoritative { await drainAccountActions(ownerID: account.id, library: library, marker: marker) }
            var errors: [String] = []
            for book in books where book.cloud != nil {
                do { try await sync.synchronize(book.id, pull: reader == nil && openingBookID != book.id) }
                catch { errors.append(error.localizedDescription) }
                guard marker == contextID else { return }
                let metadata = try await library.cloudMetadata(book.id)
                if syncIssues[book.id] != metadata { syncIssues[book.id] = metadata }
            }
            if books.contains(where: { $0.cloud != nil }) {
                let refreshed = try await cloud.accountShelf(ownerID: account.id)
                guard marker == contextID else { return }
                publishAccountShelf(refreshed)
                try await library.cacheCloudView("shelf", data: refreshed.cacheData())
            }
            syncStatus = errors.first ?? accountActions.first?.error ?? syncIssues.values.compactMap(\.lastError).first ?? (accountActions.isEmpty ? "书房已同步" : "书架调整待同步")
            lastSuccessfulSync = (account.id, Date())
            readingJournalRevision &+= 1
            if reader == nil { await loadCachedShelf() }
        } catch { if marker == contextID { syncStatus = "暂未同步：\(error.localizedDescription) 本机书籍与更改仍保留。" } }
        if marker == contextID, summaryRequested || summary != .null || summaryState.hasSnapshot {
            await loadReadingSummary(account: account, library: library, marker: marker)
        }
    }
    func download(_ remote: CloudShelfBook, openAfter: Bool = true, refresh: Bool = false, holdBusy: Bool = false) async {
        guard !busy || holdBusy, let account, let library, let sync else { return }
        if !refresh, let existing = books.first(where: { $0.cloud?.bookID == remote.id && $0.cloud?.contentVersion == remote.contentVersion }) { if openAfter && reader == nil && openingBookID == nil { await open(existing) }; return }
        let marker = contextID, operation = UUID()
        downloadOperationID = operation
        busy = true; activeBookID = remote.id; activityProgress = nil; activityCanCancel = true
        status = "正在下载《\(remote.title)》…"
        defer {
            if downloadOperationID == operation {
                downloadTask = nil; downloadOperationID = nil
                if marker == contextID { busy = holdBusy; activeBookID = nil; activityProgress = nil; activityCanCancel = false }
            }
        }
        let work = Task { @MainActor [self] in
            do {
                try Task.checkCancellation()
                let copy = try await cloud.downloadReadingCopy(remote, ownerID: account.id) { [weak self] progress in
                    await MainActor.run {
                        guard let self, self.contextID == marker, self.downloadOperationID == operation else { return }
                        self.activityProgress = progress.totalChapters > 0 ? progress.fraction : nil
                        self.status = progress.completedChapters == progress.totalChapters
                            ? "《\(remote.title)》已接收全部章节，正在核对完整性…"
                            : "正在下载《\(remote.title)》· \(progress.completedChapters) / \(progress.totalChapters) 章"
                    }
                }
                try Task.checkCancellation()
                guard marker == contextID else { return }
                status = "正在保存《\(remote.title)》的离线副本…"
                let book = try await library.importCloud(copy, replaceExisting: refresh)
                // Once the verified package has been published, cancellation cannot undo it.
                activityCanCancel = false
                guard marker == contextID else { return }
                if let index = books.firstIndex(where: { $0.id == book.id }) { books[index] = book }
                else { books.insert(book, at: 0) }
                status = Task.isCancelled ? "下载已停止，完整保存的副本仍可阅读。" : "正文和已有译文已保存在此设备"
                if openAfter {
                    // Opening owns its deferred record sync. Never put /records
                    // between an atomically published source and its first page.
                    if !Task.isCancelled && reader == nil && openingBookID == nil { await open(book) }
                } else if !Task.isCancelled {
                    // Upload migration needs the existing remote records before
                    // merging, but the local shelf entry is already readable.
                    do { try await sync.synchronize(book.id) }
                    catch { syncStatus = "正文已保存，笔记与位置稍后同步。" }
                }
            } catch {
                guard marker == contextID else { return }
                if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
                    status = "下载已取消，已有副本与云端原件仍保留。"
                } else { message = "下载尚未完成：\(error.localizedDescription) 已有副本与原件仍保留。" }
                await reload()
            }
        }
        downloadTask = work
        await withTaskCancellationHandler { await work.value } onCancel: { work.cancel() }
    }
    func loadAccountRecords(more: Bool = false) async {
        guard let account, let library else { return }
        let marker = contextID
        if more {
            await loadNotebook(more: true, account: account, library: library, marker: marker)
        } else {
            async let notes: Void = loadNotebook(more: false, account: account, library: library, marker: marker)
            async let reading: Void = loadReadingSummary(account: account, library: library, marker: marker)
            _ = await (notes, reading)
        }
    }
    func loadNotebookRecords(more: Bool = false, refresh: Bool = false) async {
        guard let account, let library else { return }
        if !more && !refresh && (notebookState.hasSnapshot || !notebookEntries.isEmpty || notebookCursor != nil) { return }
        await loadNotebook(more: more, account: account, library: library, marker: contextID, preservePages: refresh)
    }
    private func loadNotebook(more: Bool, account: CloudAccount, library: OfflineLibrary, marker: UUID, preservePages: Bool = false) async {
        guard marker == contextID, !notebookState.isLoading, !more || notebookCursor != nil else { return }
        let previous = notebookState
        let hadSnapshot = previous.hasSnapshot || !notebookEntries.isEmpty || notebookCursor != nil
        let requestedCursor = more ? notebookCursor : nil
        notebookState = .loading
        do {
            let query = "?limit=12" + (requestedCursor.map { "&cursor=" + CloudJSON.component($0) } ?? "")
            let data = try await cloud.data(path: "/api/library/notebook" + query, ownerID: account.id)
            try Task.checkCancellation()
            let notebook = try CloudJSON.decode(data)
            guard case .array = notebook["entries"], notebook["nextCursor"] == .null || notebook["nextCursor"].string != nil else { throw LibraryError.invalid("返回的笔记记录暂时无法读取。") }
            guard marker == contextID else { return }
            let incoming = notebook["entries"].array
            if preservePages, hadSnapshot {
                let ids = Set(incoming.compactMap { $0["book"]["bookId"].string })
                notebookEntries = incoming + notebookEntries.filter { !ids.contains($0["book"]["bookId"].string ?? "") }
                notebookCursor = notebookCursor ?? notebook["nextCursor"].string
            } else if more {
                let ids = Set(incoming.compactMap { $0["book"]["bookId"].string })
                notebookEntries = notebookEntries.filter { !ids.contains($0["book"]["bookId"].string ?? "") } + incoming
                notebookCursor = notebook["nextCursor"].string
            } else { notebookEntries = incoming; notebookCursor = notebook["nextCursor"].string }
            notebookIncomplete = ((more || preservePages) && notebookIncomplete) || !notebook["failed"].array.isEmpty
            notebookState = notebookIncomplete ? .partial("部分书籍的记录暂未读取，当前列表可能不完整。请重试读取笔记。") : .ready
            let snapshot: [String: CloudJSON] = ["entries": .array(notebookEntries), "nextCursor": notebookCursor.map(CloudJSON.string) ?? .null, "incomplete": .bool(notebookIncomplete)]
            do { try await library.cacheCloudView("notebook", data: CloudJSON.encode(snapshot)) }
            catch { if marker == contextID { notebookState = .partial("最新笔记已读取，但此设备暂未保存离线副本。请联网时重试。") } }
        } catch {
            guard marker == contextID else { return }
            if Task.isCancelled || error is CancellationError { notebookState = previous; return }
            if hadSnapshot {
                notebookState = .cached(more ? "下一页暂未读取，已载入的内容和翻页位置仍保留。\n" + error.localizedDescription : "暂时无法更新，当前保留此前载入的笔记记录。\n" + error.localizedDescription)
            } else if let data = try? await library.cloudView("notebook"), let cached = try? CloudJSON.decode(data), case .array = cached["entries"] {
                guard marker == contextID else { return }
                notebookEntries = cached["entries"].array; notebookCursor = cached["nextCursor"].string
                notebookIncomplete = cached["incomplete"] == .bool(true)
                notebookState = .cached("暂时无法更新，当前显示此账号此前保存的笔记记录。" + (notebookIncomplete ? "部分书籍记录仍待核对。" : "") + "\n" + error.localizedDescription)
            } else {
                guard marker == contextID else { return }
                notebookState = .failed("此设备没有可显示的离线笔记记录。读取失败不代表书房里没有笔记。\n" + error.localizedDescription)
            }
        }
    }
    private func resetReadingSummary() {
        summaryWorker?.cancel(); summaryWorker = nil; summaryWorkerID = nil
        summaryRequested = false; summaryRefreshRequested = false
        summary = .null; summaryState = .idle
    }
    private func loadReadingSummary(account: CloudAccount, library: OfflineLibrary, marker: UUID) async {
        guard marker == contextID else { return }
        summaryRequested = true; summaryRefreshRequested = true
        if let worker = summaryWorker { await worker.value; return }
        let id = UUID(); summaryWorkerID = id
        // The worker outlives an individual sheet task. A foreground refresh
        // during an older response sets one dirty bit and joins its follow-up.
        let worker = Task { @MainActor [weak self] in
            guard let self else { return }
            while self.contextID == marker, self.summaryWorkerID == id,
                  self.summaryRefreshRequested, !Task.isCancelled {
                self.summaryRefreshRequested = false
                await self.fetchReadingSummary(account: account, library: library, marker: marker)
            }
            if self.contextID == marker, self.summaryWorkerID == id { self.summaryWorker = nil; self.summaryWorkerID = nil }
        }
        summaryWorker = worker
        await worker.value
    }
    private func fetchReadingSummary(account: CloudAccount, library: OfflineLibrary, marker: UUID) async {
        guard marker == contextID, !summaryState.isLoading else { return }
        let previous = summaryState, hadSnapshot = summary != .null
        summaryState = .loading
        do {
            let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM"; formatter.locale = Locale(identifier: "en_US_POSIX")
            let query = "?month=" + formatter.string(from: Date()) + "&timeZone=" + CloudJSON.component(TimeZone.current.identifier)
            let data = try await cloud.data(path: "/api/library/reading-summary" + query, ownerID: account.id)
            try Task.checkCancellation()
            let value = try CloudJSON.decode(data)
            guard case .array = value["books"], value["allTime"]["durationSeconds"].number != nil else { throw LibraryError.invalid("返回的阅读记录暂时无法读取。") }
            guard marker == contextID else { return }
            summary = value; summaryState = .ready
            do { try await library.cacheCloudView("summary", data: data) }
            catch { if marker == contextID { summaryState = .partial("最新阅读记录已读取，但此设备暂未保存离线副本。请联网时重试。") } }
        } catch {
            guard marker == contextID else { return }
            if Task.isCancelled || error is CancellationError { summaryState = previous; return }
            if hadSnapshot { summaryState = .cached("暂时无法更新，当前保留此前载入的阅读记录。\n" + error.localizedDescription) }
            else if let data = try? await library.cloudView("summary"), let cached = try? CloudJSON.decode(data), case .array = cached["books"], cached["allTime"]["durationSeconds"].number != nil {
                guard marker == contextID else { return }
                summary = cached; summaryState = .cached("暂时无法更新，当前显示此账号此前保存的阅读记录。\n" + error.localizedDescription)
            } else {
                guard marker == contextID else { return }
                summaryState = .failed("此设备没有可显示的离线阅读记录，请重试读取。\n" + error.localizedDescription)
            }
        }
    }
    func resolvePosition(_ book: LocalBook, useDevice: Bool) async {
        guard reader == nil, openingBookID == nil, let sync else { return }
        let marker = contextID
        openingBookID = book.id
        defer { openingBookID = nil }
        do { try await sync.resolvePosition(book.id, useDevice: useDevice); if marker == contextID { await reload() } }
        catch { if marker == contextID { message = error.localizedDescription } }
    }
    func resolveActivePosition(useDevice: Bool) async {
        guard let current = reader, let library, let sync else { return }
        let marker = contextID
        let receipt = await current.flush()
        guard marker == contextID, current.isCurrent(receipt) else { return }
        do {
            try await sync.resolvePosition(current.book.id, useDevice: useDevice)
            guard marker == contextID, reader === current else { return }
            syncIssues[current.book.id] = try await library.cloudMetadata(current.book.id)
            if !useDevice {
                let state = try await library.state(current.book.id)
                guard marker == contextID, reader === current else { return }
                current.state = state
                if let anchor = state.anchor, let index = current.book.chapters.firstIndex(where: { $0.id == anchor.chapterID }) { current.go(to: index, anchor: anchor) }
            }
        } catch { if marker == contextID { current.message = error.localizedDescription } }
    }
    func upload(_ book: LocalBook) async {
        guard let account, let library, !busy, book.cloud == nil else { return }
        let marker = contextID; busy = true; status = "正在上传原件到自己的书房…"
        let activity = LibraryImportActivity(filename: book.originalFilename)
        activity.allowReading(book); importActivity = activity
        activeBookID = book.id; activityCanCancel = false; activityProgress = nil
        defer { if marker == contextID { busy = false; migratingBookIDs = []; activeBookID = nil; activityCanCancel = false; activityProgress = nil } }
        do {
            let source = try await library.originalURL(book.id), attributes = try FileManager.default.attributesOfItem(atPath: source.path)
            let limit = CloudOriginalUploadPolicy.maximumBytes(filename: book.originalFilename)
            guard let size = attributes[.size] as? NSNumber, size.int64Value <= limit else { throw LibraryError.invalid("此格式的云端上传上限为 \(limit / 1024 / 1024) MB。本机原件与记录已保留，可继续离线阅读。") }
            let read = Task.detached(priority: .utility) { try Task.checkCancellation(); return try Data(contentsOf: source, options: .mappedIfSafe) }
            let bytes = try await withTaskCancellationHandler { try await read.value } onCancel: { read.cancel() }
            var intent = try await library.pendingUpload(book.id, ownerID: account.id, sourceVersion: book.sourceVersion)
            if intent == nil {
                var policy = DuplicateImportPolicy.keep
                if let duplicate = try await cloud.duplicateOriginal(bytes, ownerID: account.id) {
                    guard marker == contextID else { return }
                    guard let choice = await chooseDuplicate(title: duplicate["title"].string ?? book.title) else { activity.stop(cancelled: true, message: "已取消上传"); return }
                    guard marker == contextID else { return }
                    policy = choice
                    if choice == .keep { activity.finish(book: book); message = "已保留云端原书，本机书籍与记录也仍保留。"; return }
                }
                intent = try await library.beginUpload(book.id, ownerID: account.id, sourceVersion: book.sourceVersion, policy: policy)
            }
            guard var transaction = intent, marker == contextID else { return }
            let duplicatePolicy = transaction.policy
            if transaction.bookID == nil {
                let result = try await cloud.uploadOriginal(bytes, filename: book.originalFilename, ownerID: account.id, duplicatePolicy: transaction.policy, operationID: transaction.operationID) { [weak self, weak activity] phase in
                    await MainActor.run {
                        guard let self, self.contextID == marker else { return }
                        switch phase {
                        case .preparing: activity?.showStatus("正在准备上传…")
                        case .sending: activity?.showStatus("正在上传原件…")
                        case .processing: activity?.showStatus("原件已传送，正在整理云端书籍…")
                        }
                    }
                }
                guard marker == contextID, let id = result["bookId"].string, let version = result["contentVersion"].string else { throw LibraryError.invalid("上传回执不完整，请重新同步书架核对。") }
                transaction = try await library.retainUploadReceipt(transaction, localBookID: book.id, bookID: id, contentVersion: version)
            }
            guard let id = transaction.bookID, let version = transaction.contentVersion else { throw LibraryError.invalid("上传恢复回执不完整。") }
            func migrationNeedsReaderToClose(_ targetID: String?) -> Bool {
                let ids = Set([book.id] + (targetID.map { [$0] } ?? []))
                return reader.map { ids.contains($0.book.id) } == true || openingBookID.map { ids.contains($0) } == true
            }
            func deferMigration() {
                activity.stop(cancelled: false, message: "本机可继续阅读 · 阅读记录待迁移")
                message = "原件已上传，本次未迁移个人记录。请回到书房后重试上传，继续同步最新笔记、草稿和阅读位置；原件不会重复上传。"
            }
            let existingTargetID = books.first { $0.cloud?.bookID == id && $0.cloud?.contentVersion == version }?.id
            if duplicatePolicy != .new, migrationNeedsReaderToClose(existingTargetID) { deferMigration(); return }
            activity.showStatus("云端正文已就绪，正在同步阅读副本…")
            await synchronize()
            await download(CloudShelfBook(id: id, title: book.title, author: book.author, contentVersion: version), openAfter: false, holdBusy: true)
            guard marker == contextID else { return }
            guard let target = books.first(where: { $0.cloud?.bookID == id && $0.cloud?.contentVersion == version }) else {
                activity.stop(cancelled: false, message: "原件已上传，阅读副本待同步")
                message = "原件已上传，正文副本尚未下载完成。本机笔记与草稿仍保留，请同步书房后重试下载。"; return
            }
            if duplicatePolicy != .new, migrationNeedsReaderToClose(target.id) { deferMigration(); return }
            if duplicatePolicy == .new {
                try await library.finishUpload(transaction, localBookID: book.id)
                activity.finish(book: target)
                message = "已作为新书加入云端，阅读记录独立保存。"
                return
            }
            // Reserve both identities before the next actor hop. A reader
            // cannot begin between the source snapshot and migration commit.
            migratingBookIDs = [book.id, target.id]
            let sourceState = try await library.state(book.id)
            let pendingTime = try await library.readingTimeLedger(bookID: book.id).pending
            guard marker == contextID else { return }
            let migration = try await library.migrateUploadedRecords(source: book, sourceState: sourceState, destination: target, readingTime: pendingTime)
            guard marker == contextID else { return }
            for row in migration.readingTimeSnapshots {
                if try await library.readingTimeLedger(bookID: target.id).pending.count >= 20 {
                    if let sync { try await sync.synchronize(target.id) }
                    guard marker == contextID else { return }
                    guard try await library.readingTimeLedger(bookID: target.id).pending.count < 20 else {
                        throw LibraryError.invalid("已有阅读时段尚未同步，请联网后重试上传。完整历史仍保留在原来的本机书中。")
                    }
                }
                try await library.retainReadingTime(row, bookID: target.id)
                guard marker == contextID else { return }
            }
            if let sync { try await sync.synchronize(target.id) }
            guard marker == contextID else { return }
            let pendingReadingTime = try await library.readingTimeLedger(bookID: target.id).pending.count
            await reload()
            guard marker == contextID else { return }
            if pendingReadingTime > 0 {
                activity.finish(book: target)
                message = "原件已加入云端书房，还有 \(pendingReadingTime) 个阅读时段待同步。完整历史、笔记与草稿仍保留在原来的本机书中。"
                return
            }
            if migration.unresolvedCount == 0 { try await library.finishUpload(transaction, localBookID: book.id) }
            activity.finish(book: target)
            if migration.unresolvedCount > 0 {
                message = "原件已上传，能核对原句的记录已同步；还有 \(migration.unresolvedCount) 条引用需要核对，已完整保留在原来的本机书中。"
            }
        } catch {
            if marker == contextID {
                activity.stop(cancelled: false, message: "尚未完成上传：\(error.localizedDescription)")
                message = "尚未完成上传：\(error.localizedDescription)"
            }
        }
    }
    func chooseDuplicate(title: String) async -> DuplicateImportPolicy? {
        await withCheckedContinuation { continuation in
            duplicateRequest = DuplicateImportRequest(title: title, completion: { continuation.resume(returning: $0) })
        }
    }
    func resolveDuplicate(_ choice: DuplicateImportPolicy?) {
        let request = duplicateRequest; duplicateRequest = nil; request?.completion(choice)
    }
    func importFile(_ url: URL) {
        guard !busy, let library else { return }
        let access = IncomingBookFile(url), marker = contextID
        busy = true
        Task {
            do {
                let existing = try await library.duplicate(for: url)
                guard marker == contextID else { return }
                let choice: DuplicateImportPolicy
                if let existing {
                    guard let selected = await chooseDuplicate(title: existing.title) else { busy = false; return }
                    choice = selected
                } else { choice = .keep }
                guard marker == contextID else { return }
                busy = false
                let operationID = UUID()
                startImport(filename: url.lastPathComponent) { library, progress in
                    defer { withExtendedLifetime(access) {} }
                    return try await library.importFile(url, duplicatePolicy: choice, operationID: operationID, progress: progress)
                }
            } catch {
                if marker == contextID { busy = false; message = error.localizedDescription }
            }
        }
    }
    private func startImport(filename: String, operation: @escaping @Sendable (OfflineLibrary, @escaping @Sendable (ImportProgress) -> Void) async throws -> LocalBook) {
        guard !busy, let library else { return }
        let activity = LibraryImportActivity(filename: filename)
        importActivity = activity
        busy = true; status = "正在保留原件…"; activityCanCancel = true; activeBookID = nil; activityProgress = nil
        let marker = contextID
        importTask = Task {
            defer {
                if marker == contextID { busy = false; importTask = nil; activityCanCancel = false; activityProgress = nil }
            }
            do {
                let book = try await operation(library) { [weak activity] update in
                    Task { @MainActor in activity?.receive(update) }
                }
                guard marker == contextID else { return }
                // Publication is complete. A late cancellation cannot undo it.
                activityCanCancel = false
                await reload()
                guard marker == contextID else { return }
                if !books.contains(where: { $0.id == book.id }) { books.insert(book, at: 0) }
                activity.finish(book: book)
            } catch {
                guard marker == contextID else { return }
                activity.stop(cancelled: Task.isCancelled || error is CancellationError, message: error.localizedDescription)
                await reload()
            }
        }
    }
    func cancelImport() {
        guard activityCanCancel else { return }
        importTask?.cancel(); downloadTask?.cancel()
    }
    func retry(_ job: ImportJob) {
        startImport(filename: job.filename) { library, progress in
            try await library.retry(job.id, progress: progress)
        }
    }
    func open(_ book: LocalBook) async {
        guard let library, openingBookID == nil else { return }
        guard !migratingBookIDs.contains(book.id) else { message = "正在同步这本书的个人记录，完成后即可打开。其他书籍仍可阅读。"; return }
        let marker = contextID
        openingBookID = book.id
        defer { openingBookID = nil }
        if let current = reader {
            current.finishReadingTime()
            guard await current.flushReadingTime() else { return }
            let receipt = await current.flush()
            guard marker == contextID, current.isCurrent(receipt) else { return }
        }
        let token = UUID(), sync = self.sync
        var presented = false
        if let sync { await sync.claimReadingBook(book.id, token: token) }
        defer { if !presented, let sync { Task { await sync.releaseReadingBook(book.id, token: token) } } }
        do {
            let opening = try await library.readingOpening(book.id), verified = opening.book
            guard marker == contextID else { return }
            guard verified.cloud?.ownerID == nil || verified.cloud?.ownerID == account?.id else { throw LibraryError.invalid("这本书不属于当前账号。") }
            syncIssues[book.id] = try await library.cloudMetadata(book.id)
            try await library.setLastOpenedBook(book.id)
            guard marker == contextID else { return }
            let store: any ReaderStateStore = verified.cloud != nil && sync != nil ? CloudReaderStateStore(library: library, sync: sync!) : library
            guard marker == contextID, !Task.isCancelled else { return }
            let session = ReaderSession(book: verified, state: opening.state, original: opening.original, directory: opening.directory,
                                        library: store, preferencesStore: library, preparation: opening.preparation)
            reader = session
            if let sync { readerOwnership = ReadingOwnership(bookID: book.id, token: token, sync: sync) }
            presented = true
            openingMaintenance = Task { [weak self, weak session] in
                // Let the published local reader reach presentation before
                // unrelated package work and cloud requests begin.
                await Task.yield()
                guard let self, let session else { return }
                do {
                    try await library.verifyReadingOpening(opening)
                    guard !Task.isCancelled, marker == self.contextID, self.reader === session else { return }
                    session.completePackageVerification()
                } catch is CancellationError { return }
                catch {
                    guard !Task.isCancelled, marker == self.contextID, self.reader === session else { return }
                    let failure = error.localizedDescription
                    // Freeze the exact live snapshot before the actor hop so a
                    // late viewport/note callback cannot alter recovery work.
                    session.failPackageVerification(failure)
                    var retained = false
                    do { try await library.retainReaderOpeningRecovery(session.openingRecoverySnapshot, opening: opening); retained = true }
                    catch { /* Keep the exact session in memory; repair UI offers an export before exit. */ }
                    guard marker == self.contextID, self.reader === session else { return }
                    session.failPackageVerification(failure, recoveryRetained: retained)
                    return
                }
                guard let identity = verified.cloud, let sync, marker == self.contextID, self.reader === session,
                      await self.cloud.activeAccount()?.id == identity.ownerID else { return }
                do { try await sync.synchronize(book.id, pull: false) }
                catch { /* The durable outbox and sync metadata retain offline/auth failures. */ }
                guard !Task.isCancelled, marker == self.contextID, self.reader === session,
                      await self.cloud.activeAccount()?.id == identity.ownerID else { return }
                if let metadata = try? await library.requireDeferredPositionChoice(book.id) {
                    guard marker == self.contextID, self.reader === session else { return }
                    self.syncIssues[book.id] = metadata
                }
            }
        } catch { if marker == contextID { message = "暂时无法打开这本书：\(error.localizedDescription) 可在书籍详情中校验或修复。" } }
    }

    var recentShelfItem: LibraryShelfItem? {
        let items = LibraryPresentation.items(local: books, cloud: cloudBooks, snapshot: accountShelf, localArchivedIDs: localArchivedIDs, pendingActions: accountActions)
        let candidates = items.map { item in ReadingRecency.Candidate(id: item.id, activityAt: ReadingRecency.maximum([item.cloud?.activityAt, item.local.flatMap { localActivity[$0.id] }])) }
        guard let recent = ReadingRecency.latest(candidates) else {
            guard let lastOpenedLocalID else { return nil }
            return items.first { $0.local?.id == lastOpenedLocalID }
        }
        return items.first { $0.id == recent.id }
    }
    /// Reuses the durable account queue; a bulk change drains only once.
    func changeShelfVisibility(_ items: [LibraryShelfItem], archived: Bool) async {
        guard let library, !busy else { return }
        let marker = contextID
        var accountArchived = accountShelf?.archivedBookIDs ?? []
        for pending in accountActions where !pending.conflict {
            switch pending.action {
            case .archive(let id): accountArchived.insert(id)
            case .restore(let id): accountArchived.remove(id)
            default: break
            }
        }
        // An older downloaded copy can also be hidden by its account book's
        // archive. Recovering that copy must recover the account entry too.
        let cloudIDs = Set(items.filter {
            !$0.isAdditionalVersion || (!archived && $0.accountBookID.map { accountArchived.contains($0) } == true)
        }.compactMap(\.accountBookID))
        let localIDs = Set(items.filter { $0.isAdditionalVersion || $0.accountBookID == nil }.compactMap { $0.local?.id })
        do {
            if !cloudIDs.isEmpty {
                guard let owner = account?.id, let shelf = accountShelf, shelf.isAuthoritative else {
                    throw LibraryError.invalid("请先连接书房，读取此账号的最新书架。")
                }
                for id in cloudIDs.sorted() {
                    guard marker == contextID else { return }
                    try await library.enqueueAccountAction(ownerID: owner, action: archived ? .archive(bookID: id) : .restore(bookID: id), baseRevision: shelf.revision)
                }
                guard marker == contextID else { return }
                accountActions = try await library.accountActions(ownerID: owner)
            }
            guard marker == contextID else { return }
            if !localIDs.isEmpty { try await library.setLocalArchived(localIDs, archived: archived) }
            guard marker == contextID else { return }
            localArchivedIDs = try await library.localArchivedBookIDs()
            if !cloudIDs.isEmpty { await synchronize() }
        } catch { if marker == contextID { message = error.localizedDescription } }
    }
    func changeAccountShelf(_ action: AccountShelfAction) async {
        guard let owner = account?.id, let library, let shelf = accountShelf, shelf.isAuthoritative else { message = "请先连接书房，读取此账号的最新书架。"; return }
        let marker = contextID
        do {
            try await library.enqueueAccountAction(ownerID: owner, action: action, baseRevision: shelf.revision)
            guard marker == contextID else { return }
            accountActions = try await library.accountActions(ownerID: owner)
            await synchronize()
        } catch { if marker == contextID { message = error.localizedDescription } }
    }
    func retryAccountShelf(_ action: PendingAccountShelfAction) async {
        guard let owner = account?.id, action.ownerID == owner, let library else { return }
        let marker = contextID
        do {
            let latest = try await cloud.accountShelf(ownerID: owner)
            guard marker == contextID, latest.isAuthoritative else { return }
            publishAccountShelf(latest)
            try await library.cacheCloudView("shelf", data: latest.cacheData())
            try await library.retryAccountAction(action.id, ownerID: owner, baseRevision: latest.revision)
            accountActions = try await library.accountActions(ownerID: owner)
            await synchronize()
        } catch { if marker == contextID { message = error.localizedDescription } }
    }
    func discardAccountShelf(_ action: PendingAccountShelfAction) async {
        guard let owner = account?.id, action.ownerID == owner, let library else { return }
        let marker = contextID
        do {
            try await library.discardAccountAction(action.id, ownerID: owner)
            guard marker == contextID else { return }
            accountActions = try await library.accountActions(ownerID: owner)
        } catch { if marker == contextID { message = error.localizedDescription } }
    }
    private func drainAccountActions(ownerID: String, library: OfflineLibrary, marker: UUID) async {
        do {
            guard !(try await library.accountActions(ownerID: ownerID)).isEmpty else { return }
            while let pending = try await library.accountActions(ownerID: ownerID).first(where: { !$0.conflict }) {
                guard marker == contextID else { return }
                do {
                    let revision = try await cloud.performAccountAction(pending)
                    guard marker == contextID else { return }
                    try await library.acknowledgeAccountAction(pending, revision: revision)
                } catch {
                    guard marker == contextID else { return }
                    try await library.failAccountAction(pending, conflict: (error as? CloudRequestError)?.status == 409, message: error.localizedDescription)
                    break
                }
            }
            guard marker == contextID else { return }
            accountActions = try await library.accountActions(ownerID: ownerID)
            let latest = try await cloud.accountShelf(ownerID: ownerID)
            guard marker == contextID else { return }
            publishAccountShelf(latest)
            try await library.cacheCloudView("shelf", data: latest.cacheData())
        } catch { if marker == contextID { syncStatus = "书架调整仍保存在此设备：" + error.localizedDescription } }
    }
}
