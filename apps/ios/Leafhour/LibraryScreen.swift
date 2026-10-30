import SwiftUI
import UniformTypeIdentifiers
import LeafhourCore

struct LibraryScreen: View {
    @Bindable var model: LibraryModel
    @Environment(\.colorScheme) private var systemColorScheme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("leafhour.library.filter") private var filterRaw = LibraryShelfFilter.all.rawValue
    @AppStorage("leafhour.library.sort") private var sortRaw = LibraryShelfSort.added.rawValue
    @AppStorage("leafhour.library.layout") private var layoutRaw = LibraryShelfLayout.grid.rawValue
    @State private var searching = false
    @FocusState private var searchFocused: Bool
    @State private var importing = false
    @State private var info = false
    @State private var path: [String] = []
    @State private var query = ""
    @State private var didLoad = false
    @State private var resumeBookID: String?
    @State private var resumeChapter: String?
    @State private var resumeLoadID = UUID()
    @State private var resumeOwnerKey: String?

    private var filter: LibraryShelfFilter { LibraryShelfFilter(rawValue: filterRaw) ?? .all }
    private var sort: LibraryShelfSort { LibraryShelfSort(rawValue: sortRaw) ?? .added }
    private var layout: LibraryShelfLayout { LibraryShelfLayout(rawValue: layoutRaw) ?? .grid }
    private var allItems: [LibraryShelfItem] {
        LibraryPresentation.items(local: model.books, cloud: model.account == nil ? [] : model.cloudBooks)
    }
    private var visibleItems: [LibraryShelfItem] {
        LibraryPresentation.items(local: model.books, cloud: model.account == nil ? [] : model.cloudBooks, query: query, filter: filter, sort: sort)
    }
    private var filterBinding: Binding<LibraryShelfFilter> { Binding(get: { filter }, set: { filterRaw = $0.rawValue }) }
    private var sortBinding: Binding<LibraryShelfSort> { Binding(get: { sort }, set: { sortRaw = $0.rawValue }) }
    private var layoutBinding: Binding<LibraryShelfLayout> { Binding(get: { layout }, set: { layoutRaw = $0.rawValue }) }
    private var shelfColumns: [GridItem] {
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible(), alignment: .top)]
            : [GridItem(.adaptive(minimum: 136, maximum: 220), spacing: 20, alignment: .top)]
    }
    private var resumeBook: LocalBook? {
        guard resumeOwnerKey == (model.account?.id ?? "device") else { return nil }
        return model.books.first(where: { $0.id == resumeBookID })
    }
    private var resumeLookupKey: String { (model.account?.id ?? "device") + ":" + model.books.map(\.id).joined(separator: ",") }
    private var activeItem: LibraryShelfItem? { allItems.first(where: isActive) }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if !didLoad && allItems.isEmpty {
                    ProgressView("正在打开书房…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if allItems.isEmpty && model.jobs.isEmpty {
                    emptyLibrary
                } else if layout == .list {
                    listShelf
                } else {
                    gridShelf
                }
            }
            .background(Color.shelfPaper)
            .navigationDestination(for: String.self) { id in
                if let book = model.books.first(where: { $0.id == id }) { BookDetailScreen(book: book, model: model) }
                else { ContentUnavailableView("书籍暂不可用", systemImage: "book.closed") }
            }
            .navigationTitle("我的书房")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(model.account == nil ? "登录书房" : "我的账号", systemImage: model.account == nil ? "person.crop.circle" : "person.crop.circle.fill") { info = true }
                        .labelStyle(.iconOnly)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("搜索书房", systemImage: "magnifyingglass") { searching.toggle(); searchFocused = searching }
                        .labelStyle(.iconOnly)
                    Button("导入书籍", systemImage: "plus") { importing = true }.labelStyle(.iconOnly).disabled(model.busy)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if searching {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("书名或作者", text: $query).focused($searchFocused)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
                            .accessibilityIdentifier("library-search-field")
                        Button("取消") { query = ""; searching = false; searchFocused = false }.frame(minHeight: 44)
                    }.padding(.horizontal, 20).background(Color.shelfPaper)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.busy { activityBar }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.epub, .pdf, .plainText, UTType(filenameExtension: "md") ?? .plainText]) { result in
                switch result { case .success(let url): model.importFile(url); case .failure(let error): model.message = error.localizedDescription }
            }
            .onOpenURL { url in if url.isFileURL { model.importFile(url) } }
            .task { await model.reload(restore: true); didLoad = true; await model.synchronize() }
            .task(id: resumeLookupKey) { await loadResume() }
            .refreshable { await model.synchronize(); await model.reload() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.synchronize() } } }
            .fullScreenCover(item: $model.reader, onDismiss: { Task { await model.reload(); await loadResume(); await model.synchronize() } }) { session in
                ReaderScreen(session: session, systemColorScheme: systemColorScheme, cloud: session.book.cloud == nil ? nil : model.cloud, library: model.library)
            }
            .sheet(isPresented: $info, onDismiss: { Task { await model.cancelNativeAuthentication() } }) { AccountScreen(model: model) }
            .alert("书房提示", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
                Button("知道了") { model.message = nil }
            } message: { Text(model.message ?? "") }
        }
    }

    private var shelfHeader: some View {
        HStack(spacing: 12) {
            Menu {
                Picker("书房范围", selection: filterBinding) {
                    ForEach(LibraryShelfFilter.allCases, id: \.rawValue) { Text($0.title).tag($0) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(filter == .all ? "全部书籍" : "已下载").font(.subheadline.weight(.medium))
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.accessibilityLabel("书房范围").accessibilityValue(filter.title)
            Text("\(visibleItems.count) 本书").font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            presentationMenu.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
        }.foregroundStyle(Color.primary)
    }

    private var presentationMenu: some View {
        Menu {
            Picker("显示方式", selection: layoutBinding) {
                ForEach(LibraryShelfLayout.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }
            Picker("排列书籍", selection: sortBinding) {
                ForEach(LibraryShelfSort.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }
            if sort == .added { Text("云端书籍沿用书房顺序") }
        } label: {
            Label("书房显示与排序", systemImage: layout == .grid ? "square.grid.2x2" : "list.bullet")
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityValue("\(layout.title)，按\(sort.title)排列")
    }

    private var listShelf: some View {
        List {
            if let book = resumeBook, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("继续读") { resumeCard(book) }
            }
            Section {
                if visibleItems.isEmpty { filteredEmptyState.listRowBackground(Color.clear) }
                else {
                    ForEach(visibleItems) { item in
                        LibraryShelfRow(item: item, downloadUnavailable: model.busy, isActive: isActive(item), progress: model.activityProgress, status: model.status, resource: model.coverResource(item), open: { open(item) }, details: { details(item) })
                    }
                }
            } header: { shelfHeader.textCase(nil) }
            if !model.jobs.isEmpty { Section("待继续的导入") { importRows } }

        }
        .listStyle(.plain).scrollContentBackground(.hidden)
        .accessibilityIdentifier("library-shelf-list")
    }

    private var gridShelf: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let book = resumeBook, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    resumeCard(book)
                        .padding(16)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                }
                shelfHeader
                if model.syncStatus.hasPrefix("暂") { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                if visibleItems.isEmpty { filteredEmptyState.frame(maxWidth: .infinity) }
                else {
                    LazyVGrid(columns: shelfColumns, alignment: .leading, spacing: 24) {
                        ForEach(visibleItems) { item in
                            LibraryShelfTile(item: item, downloadUnavailable: model.busy, isActive: isActive(item), progress: model.activityProgress, status: model.status, resource: model.coverResource(item), open: { open(item) }, details: { details(item) })
                        }
                    }
                }
                if !model.jobs.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("待继续的导入").font(.headline)
                        importRows
                    }
                    .padding().frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(20)
        }
        .accessibilityIdentifier("library-shelf-grid")
    }

    @ViewBuilder private var filteredEmptyState: some View {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView {
                Label("没有找到这本书", systemImage: "magnifyingglass")
            } description: {
                Text(filter == .downloaded ? "试试其他书名、作者，或在全部书籍中查找。" : "试试其他书名或作者。")
            } actions: {
                Button("清除搜索") { query = "" }
                if filter == .downloaded { Button("查看全部书籍") { filterRaw = LibraryShelfFilter.all.rawValue } }
            }
        } else {
            ContentUnavailableView {
                Label("还没有离线书籍", systemImage: "arrow.down.circle")
            } description: {
                Text("从全部书籍中下载一本，断网也能继续读。")
            } actions: {
                Button("查看全部书籍") { filterRaw = LibraryShelfFilter.all.rawValue }
            }
        }
    }

    private var emptyLibrary: some View {
        VStack(spacing: 20) {
            Image(systemName: "leaf").font(.system(size: 52, weight: .light)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
            Text(model.syncing ? "正在同步书房" : "给自己留一页安静").font(.title2).fontWeight(.medium)
            if model.syncing { ProgressView() }
            Text(model.account == nil ? "带一本自己的书来。\n保存在这台设备，断网也能继续读。" : "登录后，网页与 iOS 共用自己的书房。\n同步书房，或导入一本书。")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("选择一本书", systemImage: "plus") { importing = true }
                .buttonStyle(.borderedProminent).tint(.leafFill).foregroundStyle(.white).controlSize(.large).disabled(model.busy)
            Text("EPUB · PDF · TXT · Markdown").font(.footnote).foregroundStyle(.secondary)
            if model.account == nil {
                Button("登录并同步自己的书房", systemImage: "person.crop.circle") { info = true }
            } else {
                Button("同步书房", systemImage: "arrow.triangle.2.circlepath") { Task { await model.synchronize() } }.disabled(model.syncing)
                if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center) }
            }
        }
        .padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var importRows: some View {
        ForEach(model.jobs) { job in
            VStack(alignment: .leading, spacing: 8) {
                Text(job.filename).font(.headline)
                Text(job.error ?? "导入中断，原件仍保留。").font(.footnote).foregroundStyle(.secondary)
                Button("从原件重试", systemImage: "arrow.clockwise") { model.retry(job) }.disabled(model.busy)
            }.padding(.vertical, 6)
        }
    }

    private var libraryFooter: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(model.account?.email ?? "本机书房", systemImage: model.account == nil ? "iphone" : "person.crop.circle").font(.footnote).foregroundStyle(.secondary)
            if !model.syncStatus.isEmpty { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
            if model.account != nil { Button("我的笔记与阅读记录", systemImage: "books.vertical") { info = true } }
        }
        .padding(.vertical, 8)
    }

    private var activityBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                if let item = activeItem { Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1) }
                if let progress = model.activityProgress {
                    ProgressView(value: min(1, max(0, progress))).accessibilityLabel("书籍处理进度")
                }
                HStack(spacing: 8) {
                    if model.activityProgress == nil { ProgressView().controlSize(.small) }
                    Text(model.status).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if model.activityCanCancel {
                Button { model.cancelImport() } label: {
                    Text("取消").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityIdentifier("library-activity-cancel")
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(.regularMaterial)
    }

    private func resumeCard(_ book: LocalBook) -> some View {
        Button { Task { await model.open(book) } } label: {
            HStack(spacing: 14) {
                if !dynamicTypeSize.isAccessibilitySize { BookCover(book: book, resource: model.coverResource(book)) }
                VStack(alignment: .leading, spacing: 6) {
                    Text("继续读").font(.caption.weight(.semibold)).foregroundStyle(Color.leafInk)
                    Text(book.title).font(.headline).foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: dynamicTypeSize.isAccessibilitySize)
                    if let resumeChapter {
                        Text(resumeChapter).font(.subheadline).foregroundStyle(.secondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: dynamicTypeSize.isAccessibilitySize)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("继续阅读，\(book.title)" + (resumeChapter.map { "，" + $0 } ?? ""))
    }

    private func loadResume() async {
        let requestID = UUID()
        resumeLoadID = requestID
        let owner = model.account?.id
        guard let library = model.library else { resumeBookID = nil; resumeChapter = nil; return }
        let savedID = try? await library.lastOpenedBook()
        guard !Task.isCancelled, owner == model.account?.id, resumeLoadID == requestID else { return }
        guard let savedID, let book = model.books.first(where: { $0.id == savedID }) else {
            resumeBookID = nil; resumeChapter = nil; return
        }
        let state = try? await library.state(book.id)
        guard !Task.isCancelled, owner == model.account?.id, resumeLoadID == requestID else { return }
        resumeOwnerKey = owner ?? "device"
        resumeBookID = book.id
        resumeChapter = state?.anchor.flatMap { anchor in book.chapters.first(where: { $0.id == anchor.chapterID })?.title }
    }

    private func isActive(_ item: LibraryShelfItem) -> Bool {
        guard model.busy, let id = model.activeBookID else { return false }
        return item.local?.id == id || (!item.isAdditionalVersion && (item.cloud?.id == id || item.local?.cloud?.bookID == id))
    }

    private func open(_ item: LibraryShelfItem) {
        if let book = item.local { Task { await model.open(book) } }
        else if let book = item.cloud { Task { await model.download(book) } }
    }

    private func details(_ item: LibraryShelfItem) {
        if let book = item.local { path.append(book.id) }
    }
}

struct BookCover: View {
    let book: LocalBook
    var resource: BookCoverResource? = nil
    var body: some View {
        ShelfBookCover(title: book.title, author: book.author, compact: true, resource: resource).frame(width: 58, height: 80)
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
