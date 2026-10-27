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
                HStack(spacing: 18) { BookCover(book: book); VStack(alignment: .leading, spacing: 8) { Text(book.title).font(.title3).bold(); Text(book.author).foregroundStyle(.secondary); Text("\(book.chapters.count) \(book.kind == .pdf ? "页" : "章") · \(book.kind.rawValue.uppercased())").font(.footnote).foregroundStyle(.secondary) } }.padding(.vertical, 12)
                Button("继续阅读", systemImage: "book") { Task { await model.open(book) } }
            }
            Section("离线文件") {
                Label("原件已保存在此设备", systemImage: "iphone")
                Text(integrity).font(.footnote).foregroundStyle(.secondary)
                Button("校验整本书", systemImage: "checkmark.shield") { check(repair: false) }.disabled(checking)
                Button("从本机原件修复", systemImage: "arrow.clockwise") { check(repair: true) }.disabled(checking)
                Button("重新选择原始文件修复", systemImage: "doc.badge.arrow.up") { replacingOriginal = true }.disabled(checking)
                if checking { ProgressView("正在检查全部章节和文件…") }
                Text("校验包含原件、全部章节索引及资源。修复保留阅读位置、笔记与草稿；若原件本身损坏，需要重新选择原始文件。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("带走自己的书与记录") {
                if let original { ShareLink(item: original) { Label("导出原件", systemImage: "square.and.arrow.up") } }
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
            Section("来源与归属") {
                Text(book.originalFilename)
                LabeledContent("原文版本", value: String(book.sourceVersion.prefix(19))).font(.footnote)
                Text("本机书房，尚未同步到云端账号。原文、个人笔记与草稿分别保留。此导入未附译文，也未生成 AI 回答。").font(.footnote).foregroundStyle(.secondary)
            }
        }
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
