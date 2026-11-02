import SwiftUI
import LeafhourCore

final class IncomingBookFile: @unchecked Sendable {
    let url: URL
    private let scoped: Bool
    init(_ url: URL) { self.url = url; scoped = url.startAccessingSecurityScopedResource() }
    deinit { if scoped { url.stopAccessingSecurityScopedResource() } }
}

struct IncomingBookRequest: Identifiable {
    let id = UUID()
    let link: NativeBookLink?
    let file: IncomingBookFile?
    var identity: String { link?.id ?? file?.url.absoluteString ?? id.uuidString }
    init(url: URL, origin: URL) throws {
        if url.isFileURL {
            guard ["epub", "pdf", "txt", "md", "markdown"].contains(url.pathExtension.lowercased()) else { throw LibraryError.invalid("请选择 EPUB、PDF、TXT 或 Markdown 文件。") }
            link = nil; file = IncomingBookFile(url)
        } else { link = try NativeBookLink(url, origin: origin); file = nil }
    }
}

@MainActor extension LibraryModel {
    func receiveIncomingURL(_ url: URL) {
        #if DEBUG
        if Bundle.main.bundleIdentifier == "org.leafhour.selectedsource.testing", url.absoluteString == "leafhour://selected-source-acceptance",
           let input = try? SelectedSourceAcceptanceFixture.input() {
            receiveIncomingURL(input.source); return
        }
        #endif
        // ASWebAuthenticationSession owns this callback. It must not be consumed by the import router.
        if url.scheme == "com.cubxxw.reader", url.host == "auth" { return }
        do {
            let request = try IncomingBookRequest(url: url, origin: cloud.baseURL)
            guard incomingBookRequest?.identity != request.identity else { return }
            if incomingBookRequest == nil { incomingBookRequest = request }
            else if !queuedBookRequests.contains(where: { $0.identity == request.identity }) { queuedBookRequests.append(request) }
            Task {
                if let current = reader {
                    let marker = importAccountContext
                    current.finishReadingTime()
                    guard await current.flushReadingTime() else { return }
                    let receipt = await current.flush()
                    guard marker == importAccountContext, reader === current, current.isCurrent(receipt) else { return }
                    reader = nil
                }
            }
        } catch { message = error.localizedDescription }
    }
    func finishIncomingBook(_ request: IncomingBookRequest) {
        guard incomingBookRequest?.id == request.id else { return }
        incomingBookRequest = nil
    }
    func nextIncomingBook() {
        guard incomingBookRequest == nil, !queuedBookRequests.isEmpty else { return }
        incomingBookRequest = queuedBookRequests.removeFirst()
    }
    func dismissIncomingBookPresentation(presentationAvailable: Bool) {
        guard presentationAvailable, let request = incomingBookRequest else { return }
        finishIncomingBook(request)
    }
    func acceptIncomingBook(_ request: IncomingBookRequest) async throws {
        guard !busy, incomingBookRequest?.id == request.id, let owner = account?.id else { throw LibraryError.invalid("请先登录自己的书房，当前导入链接已保留。") }
        let marker = importAccountContext
        let bookID: String, passageID: String?
        switch request.link {
        case .gift(let token):
            let accepted = try await cloud.acceptBookGift(token: token, ownerID: owner)
            guard marker == importAccountContext, incomingBookRequest?.id == request.id else { return }
            bookID = accepted.bookID; passageID = nil
        case .read(let id, let passage): bookID = id; passageID = passage
        default: throw LibraryError.invalid("此链接不是可导入的书籍。")
        }
        let remote = try await cloud.readableBook(bookID: bookID, ownerID: owner)
        guard marker == importAccountContext, incomingBookRequest?.id == request.id else { return }
        await reload()
        guard marker == importAccountContext else { return }
        if let local = books.first(where: { $0.cloud?.ownerID == owner && $0.cloud?.bookID == bookID && $0.cloud?.contentVersion == remote.contentVersion }) { await open(local) }
        else { await download(remote) }
        guard marker == importAccountContext, let current = reader, current.book.cloud?.bookID == bookID else {
            throw LibraryError.invalid("书籍已在云端书房，离线副本尚未打开。请联网重试下载；已有记录仍保留。")
        }
        if let passageID, let chapter = current.book.chapters.firstIndex(where: { $0.passages.contains { $0.id == passageID } }) {
            current.go(to: chapter, anchor: ReadingAnchor(chapterID: current.book.chapters[chapter].id, passageID: passageID))
        }
        finishIncomingBook(request)
    }
}

@MainActor struct IncomingBookImportPanel: View {
    let request: IncomingBookRequest
    @Bindable var model: LibraryModel
    @State private var gift: BookGift?
    @State private var remote: CloudShelfBook?
    @State private var loading = false
    @State private var working = false
    @State private var error: String?
    @State private var accountSheet = false
    @State private var startedFile = false
    var body: some View {
        NavigationStack {
            Form {
                if let file = request.file {
                    Section("将导入的文件") { Label(file.url.lastPathComponent, systemImage: "doc.text").textSelection(.enabled) }
                    Section {
                        Text(model.account == nil ? "文件与阅读记录保存在此设备的本机书房。" : "文件保存在当前账号的设备书房，不会自动上传。")
                        Button("导入到此设备") { model.importFile(file.url); model.finishIncomingBook(request) }.disabled(model.busy || model.library == nil)
                    }
                } else {
                    if loading { ProgressView("正在核对书籍…") }
                    if let gift {
                        Section("一份赠书") {
                            Text(gift.title).font(.title3.weight(.medium))
                            if !gift.author.isEmpty { Text(gift.author).foregroundStyle(.secondary) }
                            Text("来自 " + gift.sender).font(.footnote).foregroundStyle(.secondary)
                            if !gift.message.isEmpty { Text(gift.message).textSelection(.enabled) }
                        }
                        Section("将加入你的书房") {
                            Text(gift.includeTranslations ? "整本书已提取的原文、已有的编辑注解与术语，以及分享时已有的译文；不包含原始文件、对方的私人笔记、草稿或阅读记录。" : "整本书已提取的原文与已有的编辑注解、术语；不包含译文、原始文件、对方的私人笔记、草稿或阅读记录。")
                            Text("已有同一版本时会复用，保留你自己的笔记和阅读位置。").font(.footnote).foregroundStyle(.secondary)
                        }
                    } else if let remote {
                        Section("将打开的书籍") { Text(remote.title).font(.title3.weight(.medium)); if !remote.author.isEmpty { Text(remote.author) } }
                        Section { Text("打开当前账号可访问的正文阅读副本。这不提供原始文件，也不会导入其他人的阅读记录。") }
                    }
                    Section {
                        if model.account == nil {
                            Button("登录后加入我的书房") { accountSheet = true }.disabled(loading)
                            Text("登录期间会保留这条链接，登录后由你继续导入。").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Button { Task { await accept() } } label: {
                                HStack { Text(working ? "正在加入书房…" : gift == nil ? "打开并下载阅读副本" : "加入我的书房"); if working { ProgressView() } }
                            }.disabled(loading || working || model.busy || (gift == nil && remote == nil)).accessibilityIdentifier("shared-book-import-confirm")
                        }
                        if let email = model.account?.email { Text("加入 " + email + " 的书房").font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.secondary); Button("重试核对") { Task { await load() } }.disabled(loading || working) } }
            }.navigationTitle("在 Leafhour 中打开").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("稍后") { model.finishIncomingBook(request) }.disabled(working || startedFile && model.busy) } }
                .interactiveDismissDisabled(working || startedFile && model.busy)
                .task(id: model.account?.id) { await load() }
                .onChange(of: model.busy) { _, busy in if startedFile && !busy { model.finishIncomingBook(request) } }
                .sheet(isPresented: $accountSheet, onDismiss: { Task { await model.cancelNativeAuthentication() } }) { AccountScreen(model: model) }
        }
    }
    private func load() async {
        guard !loading, request.file == nil else { return }
        let owner = model.account?.id
        loading = true; error = nil
        defer { loading = false }
        do {
            switch request.link {
            case .gift(let token): gift = try await model.cloud.bookGift(token: token)
            case .read(let id, _):
                guard let owner else { return }
                let book = try await model.cloud.readableBook(bookID: id, ownerID: owner)
                guard owner == model.account?.id else { return }
                remote = book
            default: break
            }
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
    private func accept() async {
        guard !working else { return }
        working = true; error = nil
        defer { working = false }
        do { try await model.acceptIncomingBook(request) }
        catch { self.error = error.localizedDescription }
    }
}
