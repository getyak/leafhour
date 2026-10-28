import SwiftUI
import UniformTypeIdentifiers
import LeafhourCore

struct LibraryScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.colorScheme) private var systemColorScheme
    @State private var importing = false
    @State private var info = false
    @State private var path: [String] = []
    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if model.books.isEmpty && model.jobs.isEmpty {
                    VStack(spacing: 20) {
                        Image(systemName: "leaf").font(.system(size: 52, weight: .light)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
                        Text("给自己留一页安静").font(.title2).fontWeight(.medium)
                        Text("带一本自己的书来。\n保存在这台设备，断网也能继续读。").multilineTextAlignment(.center).foregroundStyle(.secondary)
                        Button("选择一本书", systemImage: "plus") { importing = true }.buttonStyle(.borderedProminent).controlSize(.large).disabled(model.busy)
                        Text("EPUB · PDF · TXT · Markdown").font(.footnote).foregroundStyle(.secondary)
                    }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if !model.books.isEmpty {
                            Section("此设备上的书") {
                                ForEach(model.books) { book in
                                    HStack(spacing: 16) {
                                        Button { Task { await model.open(book) } } label: {
                                            HStack(spacing: 14) {
                                                BookCover(book: book)
                                                VStack(alignment: .leading, spacing: 6) {
                                                    Text(book.title).font(.headline).foregroundStyle(.primary).lineLimit(2)
                                                    if !book.author.isEmpty { Text(book.author).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                                                    Text("\(book.kind.rawValue.uppercased()) · 已保存在此设备").font(.caption).foregroundStyle(.secondary)
                                                }
                                                Spacer(minLength: 0)
                                            }.contentShape(Rectangle())
                                        }.buttonStyle(.plain).accessibilityLabel("阅读，\(book.title)")
                                        Button { path.append(book.id) } label: { Image(systemName: "info.circle").frame(width: 44, height: 44) }.buttonStyle(.borderless).accessibilityLabel("\(book.title)，书籍详情")
                                    }.padding(.vertical, 8)
                                }
                            }
                        }
                        if !model.jobs.isEmpty {
                            Section("待继续的导入") {
                                ForEach(model.jobs) { job in
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(job.filename).font(.headline)
                                        Text(job.error ?? "导入中断，原件仍保留。").font(.footnote).foregroundStyle(.secondary)
                                        Button("从原件重试", systemImage: "arrow.clockwise") { model.retry(job) }.disabled(model.busy)
                                    }.padding(.vertical, 6)
                                }
                            }
                        }
                        Section { Label("本机书房 · 尚未连接云端账号", systemImage: "iphone").font(.footnote).foregroundStyle(.secondary) }
                    }.listStyle(.insetGrouped)
                }
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationDestination(for: String.self) { id in
                if let book = model.books.first(where: { $0.id == id }) { BookDetailScreen(book: book, model: model) }
                else { ContentUnavailableView("书籍暂不可用", systemImage: "book.closed") }
            }
            .navigationTitle("我的书房")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("关于书房", systemImage: "person.crop.circle") { info = true }.labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarTrailing) { Button("导入书籍", systemImage: "plus") { importing = true }.labelStyle(.iconOnly).disabled(model.busy) }
            }
            .safeAreaInset(edge: .bottom) {
                if model.busy {
                    HStack { ProgressView(); Text(model.status).font(.footnote); Spacer(); Button("取消") { model.cancelImport() } }.padding().background(.regularMaterial)
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.epub, .pdf, .plainText, UTType(filenameExtension: "md") ?? .plainText]) { result in
                switch result { case .success(let url): model.importFile(url); case .failure(let error): model.message = error.localizedDescription }
            }
            .onOpenURL { model.importFile($0) }
            .task { await model.reload(restore: true) }
            .fullScreenCover(item: $model.reader, onDismiss: { Task { await model.reload() } }) { session in ReaderScreen(session: session, systemColorScheme: systemColorScheme) }
            .sheet(isPresented: $info) { LocalLibraryInfo() }
            .alert("书房提示", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) { Button("知道了") { model.message = nil } } message: { Text(model.message ?? "") }
        }
    }
}

struct BookCover: View {
    let book: LocalBook
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 7).fill(Color.leafInk.opacity(0.13))
            Rectangle().fill(Color.leafInk.opacity(0.15)).frame(width: 4).padding(.leading, 5)
            Image(systemName: book.kind == .pdf ? "doc.richtext" : "leaf").font(.title3).foregroundStyle(Color.leafInk).padding(12)
        }.frame(width: 58, height: 80).accessibilityHidden(true)
    }
}
struct LocalLibraryInfo: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("在此设备上") { Text("书籍、阅读位置、笔记和草稿保存在应用本机目录。导入不需要 Apple 登录，也不上传到云端。"); Text("删除应用可能移除本机数据。请用书籍详情里的导出入口保留原件和个人记录。") }
                Section("云端账号") { Text("当前尚未连接 Leafhour 云端书房。本机导入的书籍和记录尚未同步到任何云端账号。") }
                Section("阅读与来源") { Text("原文保留自己的来源版本。缺少译文时继续显示原文；扫描 PDF 保持原页，不伪造文字或翻译。") }
            }.navigationTitle("这间书房").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
