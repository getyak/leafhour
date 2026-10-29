import SwiftUI
import UIKit
import Network
import LeafhourCore

@main
struct LeafhourApp: App {
    @State private var model = LibraryModel()
    var body: some Scene {
        WindowGroup { LibraryScreen(model: model).tint(.leafInk) }
    }
}

extension Color {
    static let leafFill = Color(red: 0.24, green: 0.40, blue: 0.31)
    static let leafInk = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 181.0 / 255, green: 205.0 / 255, blue: 189.0 / 255, alpha: 1)
            : UIColor(red: 0.24, green: 0.40, blue: 0.31, alpha: 1)
    })
    static let readingPaper = Color(red: 0.97, green: 0.96, blue: 0.92)
}

extension ReaderPreferences {
    /// Read the system appearance outside the reader's presentation overrides.
    func colorScheme(following system: ColorScheme) -> ColorScheme {
        theme == "night" ? .dark : (theme == "paper" ? .light : system)
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
    var books: [LocalBook] = []
    var cloudBooks: [CloudShelfBook] = []
    var jobs: [ImportJob] = []
    var message: String?
    var busy = false
    var status = ""
    var activeBookID: String?
    var activityProgress: Double?
    var activityCanCancel = false
    var syncing = false
    var syncStatus = ""
    var account: CloudAccount?
    var reader: ReaderSession?
    var summary: CloudJSON = .null
    var notebookEntries: [CloudJSON] = []
    var notebookCursor: String?
    var notebookState: AccountRecordsState = .idle
    var summaryState: AccountRecordsState = .idle
    private var notebookIncomplete = false
    var syncIssues: [String: CloudSyncMetadata] = [:]
    let cloud: CloudLibraryClient
    private(set) var library: OfflineLibrary?
    private var sync: CloudBookSync?
    private var root: URL?
    private var importTask: Task<Void, Never>?
    private var downloadTask: Task<Void, Never>?
    private var downloadOperationID: UUID?
    private var didRestore = false
    private var didRestoreAccount = false
    private let persistCredential: Bool
    private var contextID = UUID()
    private var openingBookID: String?
    @ObservationIgnored private var networkMonitor: NWPathMonitor?

    init(root: URL? = nil, cloud: CloudLibraryClient? = nil, credential: CloudCredential? = nil) {
        persistCredential = cloud == nil
        let saved = credential ?? (cloud == nil ? AccountCredentialStore.read() : nil)
        self.cloud = cloud ?? CloudLibraryClient(credential: saved)
        self.account = saved?.account
        do {
            let base = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Leafhour", isDirectory: true)
            self.root = base
            try configureLibrary()
        } catch { message = error.localizedDescription }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await self?.synchronize() }
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility)); networkMonitor = monitor
    }
    deinit { networkMonitor?.cancel() }
    private func configureLibrary() throws {
        guard let root else { return }
        let scope: LibraryScope
        if let account {
            guard let id = UUID(uuidString: account.id) else { throw LibraryError.invalid("账号标识无效，未打开其他书房。") }
            scope = .account(id)
        } else { scope = .device }
        let value = try OfflineLibrary(root: root, scope: scope)
        library = value; sync = CloudBookSync(client: cloud, library: value)
    }
    func reload(restore: Bool = false) async {
        if !didRestoreAccount {
            didRestoreAccount = true
            do {
                let restored = try await cloud.restore()
                if restored != account {
                    contextID = UUID(); account = restored
                    books = []; cloudBooks = []; syncIssues = [:]; syncing = false; syncStatus = ""
                    notebookEntries = []; notebookCursor = nil; notebookIncomplete = false; notebookState = .idle
                    summary = .null; summaryState = .idle
                    try configureLibrary()
                }
                if persistCredential { try AccountCredentialStore.write(await cloud.savedCredential()) }
            } catch { syncStatus = account == nil ? "可先在本机阅读，联网后登录书房。" : "暂时离线，已保留此账号的书籍与记录。" }
        }
        guard let library else { return }
        let marker = contextID
        do {
            let local = try await library.books(), imports = try await library.jobs().filter { $0.phase != .complete }
            guard marker == contextID else { return }
            books = local; jobs = imports
            if account != nil, let data = try await library.cloudView("shelf") { cloudBooks = try CloudJSON.decode(data)["books"].array.compactMap(CloudShelfBook.init(json:)) }
            for book in books where book.cloud != nil { syncIssues[book.id] = try await library.cloudMetadata(book.id) }
            if restore && !didRestore {
                didRestore = true
                if let id = try await library.lastOpenedBook(), let book = books.first(where: { $0.id == id }) { await open(book) }
            }
        } catch { message = error.localizedDescription }
    }
    func signIn(email: String, password: String, code: String? = nil) async throws {
        guard !busy, reader == nil, openingBookID == nil else { throw LibraryError.invalid("请先回到书房，再切换账号。") }
        let user: CloudAccount
        if let code { user = try await cloud.verifyCode(email: email, code: code) }
        else { user = try await cloud.signIn(email: email, password: password) }
        if persistCredential { try AccountCredentialStore.write(await cloud.savedCredential()) }
        contextID = UUID(); account = user; books = []; cloudBooks = []; syncIssues = [:]; notebookEntries = []; notebookCursor = nil; notebookState = .idle; notebookIncomplete = false; summary = .null; summaryState = .idle; didRestore = true
        try configureLibrary(); await reload(); await synchronize()
    }
    func signOut() async {
        guard !busy, reader == nil, openingBookID == nil else { message = "正在打开书籍，请先回到书房，等待本机保存完成后再退出。"; return }
        do {
            if persistCredential { try AccountCredentialStore.write(nil) }
            contextID = UUID(); account = nil; books = []; cloudBooks = []; syncIssues = [:]; notebookEntries = []; notebookCursor = nil; notebookState = .idle; notebookIncomplete = false; summary = .null; summaryState = .idle
            await cloud.signOut(); try configureLibrary(); await reload()
            syncStatus = "已退出，账号书籍与记录保留在各自的离线空间。"
        } catch { message = error.localizedDescription }
    }
    func synchronize() async {
        guard let account, let library, let sync, !syncing else { return }
        let marker = contextID; syncing = true; syncStatus = "正在同步书房…"
        defer { if marker == contextID { syncing = false } }
        do {
            let shelf = try await cloud.shelf(ownerID: account.id)
            guard marker == contextID else { return }
            cloudBooks = shelf
            let rows = shelf.map { CloudJSON.object(["bookId": .string($0.id), "contentVersion": .string($0.contentVersion), "title": .string($0.title), "author": .string($0.author)]) }
            try await library.cacheCloudView("shelf", data: CloudJSON.encode(["books": .array(rows)]))
            var errors: [String] = []
            for book in books where book.cloud != nil {
                do { try await sync.synchronize(book.id, pull: reader == nil && openingBookID != book.id) }
                catch { errors.append(error.localizedDescription) }
                guard marker == contextID else { return }
                syncIssues[book.id] = try await library.cloudMetadata(book.id)
            }
            syncStatus = errors.first ?? syncIssues.values.compactMap(\.lastError).first ?? "书房已同步"
            if reader == nil { await reload() }
        } catch { if marker == contextID { syncStatus = "暂未同步：\(error.localizedDescription) 本机书籍与更改仍保留。" } }
    }
    func download(_ remote: CloudShelfBook, openAfter: Bool = true, refresh: Bool = false) async {
        guard !busy, let account, let library, let sync else { return }
        if !refresh, let existing = books.first(where: { $0.cloud?.bookID == remote.id && $0.cloud?.contentVersion == remote.contentVersion }) { if openAfter && reader == nil && openingBookID == nil { await open(existing) }; return }
        let marker = contextID, operation = UUID()
        downloadOperationID = operation
        busy = true; activeBookID = remote.id; activityProgress = nil; activityCanCancel = true
        status = "正在下载《\(remote.title)》…"
        defer {
            if downloadOperationID == operation {
                downloadTask = nil; downloadOperationID = nil
                if marker == contextID { busy = false; activeBookID = nil; activityProgress = nil; activityCanCancel = false }
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
                do { try await sync.synchronize(book.id) }
                catch { syncStatus = "正文已保存，笔记与位置稍后同步。" }
                guard marker == contextID else { return }
                await reload()
                status = Task.isCancelled ? "下载已停止，完整保存的副本仍可阅读。" : "正文和已有译文已保存在此设备"
                if openAfter && !Task.isCancelled && reader == nil && openingBookID == nil { await open(book) }
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
    private func loadNotebook(more: Bool, account: CloudAccount, library: OfflineLibrary, marker: UUID) async {
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
            notebookEntries = more ? notebookEntries + notebook["entries"].array : notebook["entries"].array
            notebookCursor = notebook["nextCursor"].string
            notebookIncomplete = (more && notebookIncomplete) || !notebook["failed"].array.isEmpty
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
    private func loadReadingSummary(account: CloudAccount, library: OfflineLibrary, marker: UUID) async {
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
    func upload(_ book: LocalBook) async {
        guard let account, let library, !busy, book.cloud == nil else { return }
        let marker = contextID; busy = true; status = "正在上传原件到自己的书房…"
        activeBookID = book.id; activityCanCancel = false; activityProgress = nil
        defer { if marker == contextID { busy = false; activeBookID = nil; activityCanCancel = false; activityProgress = nil } }
        do {
            let source = try await library.originalURL(book.id), attributes = try FileManager.default.attributesOfItem(atPath: source.path)
            guard let size = attributes[.size] as? NSNumber, size.int64Value <= 20 * 1024 * 1024 else { throw LibraryError.invalid("当前云端上传上限为 20 MB。本机原件与记录已保留，可继续离线阅读。") }
            let bytes = try Data(contentsOf: source, options: .mappedIfSafe)
            let result = try await cloud.uploadOriginal(bytes, filename: book.originalFilename, ownerID: account.id)
            guard marker == contextID, let id = result["bookId"].string, let version = result["contentVersion"].string else { throw LibraryError.invalid("上传回执不完整，请重新同步书架核对。") }
            busy = false
            await synchronize()
            await download(CloudShelfBook(id: id, title: book.title, author: book.author, contentVersion: version), openAfter: false)
            guard let target = books.first(where: { $0.cloud?.bookID == id && $0.cloud?.contentVersion == version }) else {
                message = "原件已上传，正文副本尚未下载完成。本机笔记与草稿仍保留，请同步书房后重试下载。"; return
            }
            let sourceState = try await library.state(book.id), targetState = try await library.state(target.id)
            let migration = CloudUploadMigration.remap(source: book, state: sourceState, destination: target, destinationState: targetState)
            try await library.saveState(migration.state, bookID: target.id)
            if let sync { try await sync.synchronize(target.id) }
            await reload()
            message = migration.unresolvedCount == 0
                ? "原件、可核对的笔记与阅读位置已加入云端书房。原来的本机书与记录仍保留。"
                : "原件已上传，能核对原句的记录已同步；还有 \(migration.unresolvedCount) 条引用需要核对，已完整保留在原来的本机书中。"
        } catch { if marker == contextID { message = "尚未完成上传：\(error.localizedDescription)" } }
    }
    func importFile(_ url: URL) {
        guard !busy, let library else { return }
        busy = true; status = "正在保留原件并处理书籍…"; activityCanCancel = true; activeBookID = nil; activityProgress = nil
        let marker = contextID
        importTask = Task {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() }; busy = false; importTask = nil; activityCanCancel = false }
            do {
                let book = try await library.importFile(url)
                await reload()
                if marker == contextID && !Task.isCancelled && reader == nil && openingBookID == nil { await open(book) }
            }
            catch is CancellationError { status = "导入已取消，原件仍保留，可稍后重试。"; await reload() }
            catch { message = error.localizedDescription; await reload() }
        }
    }
    func cancelImport() {
        guard activityCanCancel else { return }
        importTask?.cancel(); downloadTask?.cancel()
    }
    func retry(_ job: ImportJob) {
        guard !busy, let library else { return }
        busy = true; status = "正在从保留的原件重试…"; activityCanCancel = true; activeBookID = nil; activityProgress = nil
        let marker = contextID
        importTask = Task {
            defer { busy = false; importTask = nil; activityCanCancel = false }
            do {
                let book = try await library.retry(job.id)
                await reload()
                if marker == contextID && !Task.isCancelled && reader == nil && openingBookID == nil { await open(book) }
            }
            catch is CancellationError { status = "导入已取消，原件仍保留，可稍后重试。"; await reload() }
            catch { message = error.localizedDescription; await reload() }
        }
    }
    func open(_ book: LocalBook) async {
        guard let library, openingBookID == nil else { return }
        let marker = contextID
        openingBookID = book.id
        defer { openingBookID = nil }
        if let current = reader {
            let receipt = await current.flush()
            guard marker == contextID, current.isCurrent(receipt) else { return }
        }
        do {
            let verified = try await library.book(book.id)
            guard marker == contextID else { return }
            guard verified.cloud?.ownerID == nil || verified.cloud?.ownerID == account?.id else { throw LibraryError.invalid("这本书不属于当前账号。") }
            if let identity = verified.cloud, reader == nil, let sync {
                do { try await sync.synchronize(book.id) }
                catch let error as CloudRequestError where error.status == 401 || error.status == 403 { throw error }
                catch { /* Offline content remains readable; pending sync is recorded on disk. */ }
                guard marker == contextID, await cloud.activeAccount()?.id == identity.ownerID else { return }
            }
            let state = try await library.state(book.id)
            guard marker == contextID else { return }
            let original = try await library.originalURL(book.id)
            guard marker == contextID else { return }
            let folder = try await library.bookDirectory(book.id)
            guard marker == contextID else { return }
            try await library.setLastOpenedBook(book.id)
            guard marker == contextID else { return }
            let store: any ReaderStateStore = verified.cloud != nil && sync != nil ? CloudReaderStateStore(library: library, sync: sync!) : library
            reader = ReaderSession(book: verified, state: state, original: original, directory: folder, library: store)
        } catch { if marker == contextID { message = "暂时无法打开这本书：\(error.localizedDescription) 可在书籍详情中校验或修复。" } }
    }
}
