import SwiftUI
import UniformTypeIdentifiers
import LeafhourCore

struct BookDetailScreen: View {
    let book: LocalBook
    @Bindable var model: LibraryModel
    @State private var original: URL?
    @State private var integrity = "等待校验"
    @State private var checking = false
    @State private var exporting = false
    @State private var replacingOriginal = false
    @State private var export: RecordsDocument?
    var body: some View {
        List {
            Section {
                HStack(spacing: 18) { BookCover(book: book, resource: model.coverResource(book)); VStack(alignment: .leading, spacing: 8) { Text(book.title).font(.title3).bold(); Text(book.author).foregroundStyle(.secondary); Text("\(book.chapters.count) \(book.kind == .pdf ? "页" : "章") · \(book.kind.rawValue.uppercased())").font(.footnote).foregroundStyle(.secondary) } }.padding(.vertical, 12)
                Button("继续阅读", systemImage: "book") { Task { await model.open(book) } }
            }
            Section("离线文件") {
                Label(book.cloud == nil ? "原件已保存在此设备" : "正文与已有译文已下载", systemImage: "iphone")
                Text(integrity).font(.footnote).foregroundStyle(.secondary)
                Button("校验整本书", systemImage: "checkmark.shield") { check(repair: false) }.disabled(checking)
                if let identity = book.cloud {
                    Button("重新下载正文与已有译文", systemImage: "icloud.and.arrow.down") {
                        Task { await model.download(CloudShelfBook(id: identity.bookID, title: book.title, author: book.author, contentVersion: identity.contentVersion), openAfter: false, refresh: true) }
                    }.disabled(model.busy)
                } else {
                    Button("从本机原件修复", systemImage: "arrow.clockwise") { check(repair: true) }.disabled(checking)
                    Button("重新选择原始文件修复", systemImage: "doc.badge.arrow.up") { replacingOriginal = true }.disabled(checking)
                }
                if checking { ProgressView("正在检查全部章节和文件…") }
                Text(book.cloud == nil ? "校验包含原件、全部章节索引及资源。修复保留阅读位置、笔记与草稿；若原件本身损坏，需要重新选择原始文件。" : "此处保存的是完整文字阅读副本，保留原段落与引用。上传的 EPUB、PDF 及图片原件仍在云端；阅读副本不冒充原件。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("带走自己的书与记录") {
                if let original { ShareLink(item: original) { Label(book.cloud == nil ? "导出原件" : "导出正文阅读副本", systemImage: "square.and.arrow.up") } }
                Button("导出我的笔记与草稿", systemImage: "doc.text") {
                    Task {
                        guard let library = model.library else { return }
                        do {
                            let state = try await library.state(book.id)
                            export = RecordsDocument(data: try JSONEncoder().encode(RecordsBackup(book: book, state: state)))
                            exporting = true
                        } catch { model.message = error.localizedDescription }
                    }
                }
            }
            if let identity = book.cloud {
                Section("云端同步") {
                    Label("已连接自己的书房", systemImage: "checkmark.icloud")
                    Text("笔记与阅读位置先保存在设备，联网后同步。草稿仍保留在此设备。").font(.footnote).foregroundStyle(.secondary)
                    if let issue = model.syncIssues[book.id], let error = issue.lastError { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    if model.syncIssues[book.id]?.positionConflict == true {
                        Button("从云端位置继续") { Task { await model.resolvePosition(book, useDevice: false) } }
                        Button("使用此设备的位置") { Task { await model.resolvePosition(book, useDevice: true) } }
                    }
                    Button("同步此账号", systemImage: "arrow.triangle.2.circlepath") { Task { await model.synchronize() } }.disabled(model.syncing)
                    Link("在网页查看原件与完整书房", destination: URL(string: "https://leafhour.com/library")!)
                    Text("原件格式 · " + identity.sourceFormat.uppercased()).font(.footnote).foregroundStyle(.secondary)
                }
            } else if model.account != nil {
                Section("上传到自己的书房") {
                    Text("这本书目前只保存在此设备。上传会把原件加入当前登录账号；本机记录仍保留在原书中。").font(.footnote).foregroundStyle(.secondary)
                    Button("上传原件到我的书房", systemImage: "icloud.and.arrow.up") { Task { await model.upload(book) } }.disabled(model.busy)
                }
            }
            Section("来源与归属") {
                Text(book.originalFilename)
                LabeledContent("原文版本", value: String(book.sourceVersion.prefix(19))).font(.footnote)
                Text(book.cloud == nil ? "此设备的原件、个人笔记与草稿分别保留。导入不会自动生成译文或 AI 回答。" : "此账号的原文阅读副本、已有译文与个人笔记分别保留。只有主动选择翻译或对话才会生成新的内容。").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("book-details-list")
        .navigationTitle("书籍详情").navigationBarTitleDisplayMode(.inline)
        .task { original = try? await model.library?.originalURL(book.id) }
        .fileImporter(isPresented: $replacingOriginal, allowedContentTypes: [.epub, .pdf, .plainText, UTType(filenameExtension: "md") ?? .plainText]) { result in
            switch result {
            case .failure(let error): integrity = error.localizedDescription
            case .success(let url):
                guard let library = model.library else { return }
                checking = true
                Task {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() }; checking = false }
                    do { _ = try await library.repair(book.id, usingOriginal: url); integrity = "整本文件已修复，个人记录保留"; await model.reload() }
                    catch { integrity = error.localizedDescription }
                }
            }
        }
        .fileExporter(isPresented: $exporting, document: export, contentType: .json, defaultFilename: "Leafhour-records") { result in
            if case .failure(let error) = result { model.message = error.localizedDescription }
        }
    }
    private func check(repair: Bool) {
        guard let library = model.library else { return }
        checking = true
        Task {
            defer { checking = false }
            do {
                if repair { _ = try await library.repair(book.id) }
                _ = try await library.verify(book.id)
                integrity = "整本文件校验通过，可离线阅读"
            } catch { integrity = "尚不能确认完整离线：\(error.localizedDescription)" }
        }
    }
}
struct RecordsBackup: Encodable {
    let format = "leafhour-native-records-v1"
    let bookID: String
    let sourceVersion: String
    let title: String
    let state: ReaderState
    init(book: LocalBook, state: ReaderState) { bookID = book.id; sourceVersion = book.sourceVersion; title = book.title; self.state = state }
}
struct RecordsDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct ShelfShareSelection: Identifiable {
    let id = UUID()
    let items: [LibraryShelfItem]
}

struct ShelfSharePanel: View {
    let selection: ShelfShareSelection
    @Bindable var model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @State private var files: [URL] = []
    @State private var folder: URL?
    @State private var preparing = true
    @State private var error: String?
    var body: some View {
        NavigationStack {
            List {
                Section("将分享的书籍") {
                    ForEach(selection.items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).font(.subheadline.weight(.medium))
                            if !item.author.isEmpty { Text(item.author).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
                Section {
                    ShareLink(item: selection.items.map(\.shareText).joined(separator: "\n\n")) {
                        Label("分享书籍信息", systemImage: "square.and.arrow.up")
                    }
                    if preparing { ProgressView("正在准备书籍文件") }
                    else if !files.isEmpty {
                        ShareLink(items: files) { Label("分享书籍文件", systemImage: "doc") }
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                } footer: {
                    Text("书籍信息只含书名与作者。本机原件按原格式分享，云端阅读副本只导出原文 TXT；不包含私人笔记、草稿与阅读记录。")
                }
            }
            .navigationTitle("分享本书").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task { await prepareFiles() }
            .onDisappear { if let folder { try? FileManager.default.removeItem(at: folder) } }
        }
    }
    private func prepareFiles() async {
        let owner = model.account?.id
        defer { preparing = false }
        guard let library = model.library, selection.items.allSatisfy(\.isDownloaded) else {
            error = "下载到此设备后，可以分享书籍文件。"; return
        }
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Leafhour-share-" + selection.id.uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            folder = directory
            var result: [URL] = []
            for (index, item) in selection.items.enumerated() {
                try Task.checkCancellation()
                guard let book = item.local else { continue }
                if book.cloud == nil { result.append(try await library.originalURL(book.id)) }
                else {
                    guard book.chapters.flatMap(\.passages).contains(where: { $0.resourcePath == nil && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                        throw LibraryError.invalid("此副本没有可分享的原文，请从网页导出原件。")
                    }
                    let file = directory.appendingPathComponent("Leafhour-book-\(index + 1).txt")
                    try Data(item.sourceShareText.utf8).write(to: file, options: .atomic)
                    result.append(file)
                }
            }
            try Task.checkCancellation()
            guard owner == model.account?.id else { return }
            files = result
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
}
