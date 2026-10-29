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

@MainActor @Observable
final class LibraryModel {
    var books: [LocalBook] = []
    var cloudBooks: [CloudShelfBook] = []
    var jobs: [ImportJob] = []
    var message: String?
    var busy = false
    var status = ""
    var syncing = false
    var syncStatus = ""
    var account: CloudAccount?
    var reader: ReaderSession?
    var summary: CloudJSON = .null
    var notebookEntries: [CloudJSON] = []
    var notebookCursor: String?
    var syncIssues: [String: CloudSyncMetadata] = [:]
    var nativeAuthenticating = false
    var nativeAuthStatus: NativeAuthenticationStatus?
    var linkedIdentities: [CloudLinkedIdentity] = []
    var nativeAuthMessage: String?
    let cloud: CloudLibraryClient
    private(set) var library: OfflineLibrary?
    private var sync: CloudBookSync?
    private var root: URL?
    private var importTask: Task<Void, Never>?
    private var didRestore = false
    private var didRestoreAccount = false
    private let persistCredential: Bool
    private var contextID = UUID()
    private var openingBookID: String?
    private var nativeOperationID = UUID()
    @ObservationIgnored private weak var activeNativeBrowser: NativeProviderAuthentication?
    @ObservationIgnored private var networkMonitor: NWPathMonitor?

    init(root: URL? = nil, cloud: CloudLibraryClient? = nil, credential: CloudCredential? = nil, monitorNetwork: Bool = true) {
        persistCredential = cloud == nil
        let saved = credential ?? (cloud == nil ? AccountCredentialStore.read() : nil)
        self.cloud = cloud ?? CloudLibraryClient(credential: saved)
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
                if restored != account { account = restored; try configureLibrary() }
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
        guard !nativeAuthenticating, !busy, reader == nil, openingBookID == nil else { throw LibraryError.invalid("请先回到书房，再切换账号。") }
        let user: CloudAccount
        if let code { user = try await cloud.verifyCode(email: email, code: code) }
        else { user = try await cloud.signIn(email: email, password: password) }
        if persistCredential { try AccountCredentialStore.write(await cloud.savedCredential()) }
        try await adoptSignedInAccount(user)
    }
    private func adoptSignedInAccount(_ user: CloudAccount) async throws {
        contextID = UUID(); account = user; books = []; cloudBooks = []; syncIssues = [:]; notebookEntries = []; notebookCursor = nil; summary = .null; didRestore = true; syncing = false
        linkedIdentities = []
        try configureLibrary(); await reload(); await synchronize()
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
                account = user // Same UID: preserve library, reader, notes, drafts and the current sync context.
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
            contextID = UUID(); account = nil; books = []; cloudBooks = []; syncIssues = [:]; notebookEntries = []; summary = .null; linkedIdentities = []; nativeAuthStatus = nil; syncing = false
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
        if !refresh, let existing = books.first(where: { $0.cloud?.bookID == remote.id && $0.cloud?.contentVersion == remote.contentVersion }) { if openAfter { await open(existing) }; return }
        let marker = contextID; busy = true; status = "正在下载全部章节…"
        defer { if marker == contextID { busy = false } }
        do {
            let copy = try await cloud.downloadReadingCopy(remote, ownerID: account.id)
            guard marker == contextID else { return }
            let book = try await library.importCloud(copy, replaceExisting: refresh)
            try await sync.synchronize(book.id)
            await reload(); if openAfter { await open(book) }
            status = "正文和已有译文已保存在此设备"
        } catch { if marker == contextID { message = "下载尚未完成：\(error.localizedDescription) 已有副本与原件仍保留。"; await reload() } }
    }
    func loadAccountRecords(more: Bool = false) async {
        guard let account, let library else { return }
        let marker = contextID
        do {
            let cursor = more ? notebookCursor.map { "?limit=12&cursor=" + CloudJSON.component($0) } : "?limit=12"
            let data = try await cloud.data(path: "/api/library/notebook" + (cursor ?? "?limit=12"), ownerID: account.id)
            let notebook = try CloudJSON.decode(data)
            guard marker == contextID else { return }
            notebookEntries = more ? notebookEntries + notebook["entries"].array : notebook["entries"].array
            notebookCursor = notebook["nextCursor"].string
            try await library.cacheCloudView("notebook", data: CloudJSON.encode(["entries": .array(notebookEntries)]))
            let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM"; formatter.locale = Locale(identifier: "en_US_POSIX")
            let query = "?month=" + formatter.string(from: Date()) + "&timeZone=" + CloudJSON.component(TimeZone.current.identifier)
            let summaryData = try await cloud.data(path: "/api/library/reading-summary" + query, ownerID: account.id)
            guard marker == contextID else { return }
            summary = try CloudJSON.decode(summaryData); try await library.cacheCloudView("summary", data: summaryData)
        } catch {
            guard marker == contextID else { return }
            if notebookEntries.isEmpty, let data = try? await library.cloudView("notebook") { notebookEntries = (try? CloudJSON.decode(data)["entries"].array) ?? [] }
            if let data = try? await library.cloudView("summary") { summary = (try? CloudJSON.decode(data)) ?? .null }
            syncStatus = "当前显示已缓存的记录；联网后可重新同步。"
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
        defer { if marker == contextID { busy = false } }
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
        busy = true; status = "正在保留原件并处理书籍…"
        importTask = Task {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() }; busy = false; importTask = nil }
            do { let book = try await library.importFile(url); await reload(); await open(book) }
            catch is CancellationError { status = "导入已取消，原件仍保留，可稍后重试。"; await reload() }
            catch { message = error.localizedDescription; await reload() }
        }
    }
    func cancelImport() { importTask?.cancel() }
    func retry(_ job: ImportJob) {
        guard !busy, let library else { return }
        busy = true; status = "正在从保留的原件重试…"
        importTask = Task {
            defer { busy = false; importTask = nil }
            do { let book = try await library.retry(job.id); await reload(); await open(book) }
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
