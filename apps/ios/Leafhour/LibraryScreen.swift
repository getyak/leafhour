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
    @AppStorage("leafhour.library.pins.v1") private var pinData = Data()
    @State private var selecting = false
    @State private var selectedIDs: Set<String> = []
    @State private var sharing: ShelfShareSelection?
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
    @State private var pendingAdjustments = false
    @State private var pinMigrationOwner: String?

    private var filter: LibraryShelfFilter { LibraryShelfFilter(rawValue: filterRaw) ?? .all }
    private var sort: LibraryShelfSort { LibraryShelfSort(rawValue: sortRaw) ?? .added }
    private var layout: LibraryShelfLayout { LibraryShelfLayout(rawValue: layoutRaw) ?? .grid }
    private var pinOwner: String { model.account?.id ?? "device" }
    private var pins: LibraryShelfPins { (try? JSONDecoder().decode(LibraryShelfPins.self, from: pinData)) ?? LibraryShelfPins() }
    private var pinnedIDs: Set<String> {
        let saved = pins.ids(owner: pinOwner)
        var ids = saved
        if let shelf = model.accountShelf, shelf.isAuthoritative, shelf.pinsInitialized {
            ids = Set(saved.filter { $0.hasPrefix("local:") })
            ids.formUnion(shelf.pinnedBookIDs.map { "cloud:" + $0 })
        }
        for pending in model.accountActions where !pending.conflict {
            if case .pin(let bookID, let pinned) = pending.action {
                if pinned { ids.insert("cloud:" + bookID) } else { ids.remove("cloud:" + bookID) }
            }
        }
        return ids
    }
    private var selectedItems: [LibraryShelfItem] { visibleItems.filter { selectedIDs.contains($0.id) } }
    private var selectionIsPinned: Bool { !selectedIDs.isEmpty && selectedIDs.isSubset(of: pinnedIDs) }
    private var allItems: [LibraryShelfItem] {
        LibraryPresentation.items(local: model.books, cloud: model.account == nil ? [] : model.cloudBooks, snapshot: model.accountShelf)
    }
    private var visibleItems: [LibraryShelfItem] {
        LibraryPresentation.items(local: model.books, cloud: model.account == nil ? [] : model.cloudBooks, query: query, filter: filter, sort: sort, pinnedIDs: pinnedIDs, snapshot: model.accountShelf, localActivity: model.localActivity)
    }
    private var filterBinding: Binding<LibraryShelfFilter> { Binding(get: { filter }, set: { filterRaw = $0.rawValue }) }
    private var sortBinding: Binding<LibraryShelfSort> { Binding(get: { sort }, set: { sortRaw = $0.rawValue }) }
    private var layoutBinding: Binding<LibraryShelfLayout> { Binding(get: { layout }, set: { layoutRaw = $0.rawValue }) }
    private var shelfColumns: [GridItem] {
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible(), alignment: .top)]
            : Array(repeating: GridItem(.flexible(minimum: 0), spacing: 12, alignment: .top), count: 3)
    }
    private var resumeItem: LibraryShelfItem? { model.recentShelfItem }
    private var resumeLookupKey: String { (model.account?.id ?? "device") + ":" + (resumeItem?.id ?? "") + ":" + String(describing: resumeItem?.cloud?.activityAt) }
    private var activeItem: LibraryShelfItem? { allItems.first(where: isActive) }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if !didLoad && allItems.isEmpty {
                    ProgressView("正在打开书房…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if allItems.isEmpty && (model.accountShelf?.archivedBooks.isEmpty ?? true) && model.jobs.isEmpty {
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
                            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).onSubmit { searchFocused = false }
                            .accessibilityIdentifier("library-search-field")
                        if !query.isEmpty {
                            Button { query = "" } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                    .frame(width: 44, height: 44).contentShape(Rectangle())
                            }.accessibilityLabel("清除搜索").accessibilityIdentifier("library-search-clear")
                        }
                        Button { query = ""; searching = false; searchFocused = false } label: {
                            Text("取消").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                        }.accessibilityIdentifier("library-search-cancel")
                    }.padding(.horizontal, 20).background(Color.shelfPaper)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if selecting { selectionToolbar }
                else if model.busy && activeItem == nil { activityBar }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.epub, .pdf, .plainText, UTType(filenameExtension: "md") ?? .plainText]) { result in
                switch result { case .success(let url): model.importFile(url); case .failure(let error): model.message = error.localizedDescription }
            }
            .onOpenURL { url in if url.isFileURL { model.importFile(url) } }
            .task { await model.reload(restore: true); await model.synchronize(); didLoad = true; await migrateCloudPinsIfNeeded() }
            .task(id: resumeLookupKey) { await loadResume() }
            .refreshable { await model.synchronize(); await model.reload() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.synchronize() } } }
            .onChange(of: model.account?.id) { _, _ in selecting = false; selectedIDs = []; sharing = nil }
            .onChange(of: model.accountShelf?.pinsInitialized) { _, _ in Task { await migrateCloudPinsIfNeeded() } }
            .onChange(of: visibleItems.map(\.id)) { _, ids in selectedIDs.formIntersection(Set(ids)) }
            .fullScreenCover(item: $model.reader, onDismiss: { Task { await model.reload(); await loadResume(); await model.synchronize() } }) { session in
                ReaderScreen(session: session, systemColorScheme: systemColorScheme, cloud: session.book.cloud == nil ? nil : model.cloud, library: model.library, positionConflict: model.syncIssues[session.book.id]?.positionConflict == true, resolvePosition: { useDevice in Task { await model.resolveActivePosition(useDevice: useDevice) } })
            }
            .sheet(isPresented: $info, onDismiss: { Task { await model.cancelNativeAuthentication() } }) { AccountScreen(model: model) }
            .sheet(isPresented: $pendingAdjustments) { AccountShelfPendingScreen(model: model) }
            .sheet(item: $sharing) { selection in ShelfSharePanel(selection: selection, model: model) }
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
                    Text(filter == .all ? "全部书籍" : filter.title).font(.subheadline.weight(.medium))
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.accessibilityLabel("书房范围").accessibilityValue(filter.title)
            Text("\(visibleItems.count) 本书").font(.caption).foregroundStyle(.secondary)
            if !model.accountActions.isEmpty {
                Button("待同步 \(model.accountActions.count)") { pendingAdjustments = true }.font(.caption)
            }
            Spacer(minLength: 0)
            if selecting {
                Button {
                    selectedIDs = selectedIDs.count == visibleItems.count ? [] : Set(visibleItems.map(\.id))
                } label: { Text(selectedIDs.count == visibleItems.count ? "取消全选" : "全选").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                Button { selecting = false; selectedIDs = [] } label: { Text("完成").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
            } else {
                presentationMenu.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
            }
        }.foregroundStyle(Color.primary)
    }

    private var presentationMenu: some View {
        Menu {
            Button("选择多本", systemImage: "checkmark.circle") { selecting = true; selectedIDs = [] }
            if !model.accountActions.isEmpty { Button("待同步调整（\(model.accountActions.count)）", systemImage: "arrow.triangle.2.circlepath") { pendingAdjustments = true } }
            Picker("显示方式", selection: layoutBinding) {
                ForEach(LibraryShelfLayout.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }
            Picker("排列书籍", selection: sortBinding) {
                ForEach(LibraryShelfSort.allCases, id: \.rawValue) { Text($0.title).tag($0) }
            }
            if sort == .added { Text("云端书籍沿用书房顺序") }
        } label: {
            Label("书房显示与排序", systemImage: layout == .grid ? "square.grid.3x3" : "list.bullet")
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityValue("\(layout.title)，按\(sort.title)排列")
    }

    private var listShelf: some View {
        List {
            if let item = resumeItem, filter == .all, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("继续读") { resumeCard(item) }
            }
            Section {
                if visibleItems.isEmpty { filteredEmptyState.listRowBackground(Color.clear) }
                else {
                    ForEach(visibleItems) { item in
                        LibraryShelfRow(item: item, downloadUnavailable: model.busy, isActive: isActive(item), progress: model.activityProgress, status: model.status, resource: model.coverResource(item), cancel: model.activityCanCancel ? { model.cancelImport() } : nil, selecting: selecting, selected: selectedIDs.contains(item.id), pinned: pinnedIDs.contains(item.id), select: { beginSelection(item) }, togglePin: { setPins([item.id], pinned: !pinnedIDs.contains(item.id)) }, share: { sharing = ShelfShareSelection(items: [item]) }, accountAction: model.accountShelf?.isAuthoritative == true ? { action in Task { await model.changeAccountShelf(action) } } : nil, open: { open(item) }, details: { details(item) })
                            .listRowBackground(Color.clear)
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
                if let item = resumeItem, filter == .all, query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    resumeCard(item)
                        .padding(16)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                }
                shelfHeader
                if model.syncStatus.hasPrefix("暂") { Text(model.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                if visibleItems.isEmpty { filteredEmptyState.frame(maxWidth: .infinity) }
                else {
                    LazyVGrid(columns: shelfColumns, alignment: .leading, spacing: 20) {
                        ForEach(visibleItems) { item in
                            LibraryShelfTile(item: item, downloadUnavailable: model.busy, isActive: isActive(item), progress: model.activityProgress, status: model.status, resource: model.coverResource(item), cancel: model.activityCanCancel ? { model.cancelImport() } : nil, selecting: selecting, selected: selectedIDs.contains(item.id), pinned: pinnedIDs.contains(item.id), select: { beginSelection(item) }, togglePin: { setPins([item.id], pinned: !pinnedIDs.contains(item.id)) }, share: { sharing = ShelfShareSelection(items: [item]) }, accountAction: model.accountShelf?.isAuthoritative == true ? { action in Task { await model.changeAccountShelf(action) } } : nil, open: { open(item) }, details: { details(item) })
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
        .background(.regularMaterial).accessibilityIdentifier("library-global-activity")
    }

    private func resumeCard(_ item: LibraryShelfItem) -> some View {
        Button { if item.hasCloudUpdate, let book = item.cloud { Task { await model.download(book) } } else { open(item) } } label: {
            HStack(spacing: 14) {
                if !dynamicTypeSize.isAccessibilitySize { ShelfBookCover(title: item.title, author: item.author, compact: true, resource: model.coverResource(item)) }
                VStack(alignment: .leading, spacing: 6) {
                    Text("继续读").font(.caption.weight(.semibold)).foregroundStyle(Color.leafInk)
                    Text(item.title).font(.headline).foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: dynamicTypeSize.isAccessibilitySize)
                    if let label = item.cloud?.resume?.label ?? (item.local == nil ? nil : resumeChapter) {
                        Text(label).font(.subheadline).foregroundStyle(.secondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: dynamicTypeSize.isAccessibilitySize)
                    }
                    if !item.isDownloaded || item.hasCloudUpdate { Text(item.hasCloudUpdate ? "轻点后下载新版并继续阅读" : "轻点后下载并继续阅读").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("继续阅读，\(item.title)" + (!item.isDownloaded ? "，轻点下载" : ""))
    }

    private func loadResume() async {
        let requestID = UUID()
        resumeLoadID = requestID
        let owner = model.account?.id
        guard let library = model.library else { resumeBookID = nil; resumeChapter = nil; return }
        let savedID = model.recentShelfItem?.local?.id
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
        if selecting {
            if !selectedIDs.insert(item.id).inserted { selectedIDs.remove(item.id) }
            return
        }
        if let book = item.local { Task { await model.open(book) } }
        else if let book = item.cloud { Task { await model.download(book) } }
    }

    private func details(_ item: LibraryShelfItem) {
        if let book = item.local { path.append(book.id) }
    }

    private func beginSelection(_ item: LibraryShelfItem) { selecting = true; selectedIDs.insert(item.id) }
    private func setPins(_ ids: Set<String>, pinned: Bool) {
        let cloudIDs = ids.filter { $0.hasPrefix("cloud:") }.map { String($0.dropFirst(6)) }
        let localIDs = Set(ids.filter { !$0.hasPrefix("cloud:") })
        var value = pins; value.set(localIDs, pinned: pinned, owner: pinOwner)
        if let data = try? JSONEncoder().encode(value) { pinData = data }
        Task { for id in cloudIDs { await model.changeAccountShelf(.pin(bookID: id, pinned: pinned)) } }
    }
    private func migrateCloudPinsIfNeeded() async {
        guard let shelf = model.accountShelf, shelf.isAuthoritative, !shelf.pinsInitialized, pinMigrationOwner != pinOwner else { return }
        pinMigrationOwner = pinOwner
        let available = Set(shelf.books.map(\.id)).union(shelf.archivedBookIDs)
        let hasPendingPins = model.accountActions.contains { if case .pin = $0.action { return true }; return false }
        let legacy = pins.cloudMigrationIDs(owner: pinOwner, available: available, pinsInitialized: shelf.pinsInitialized, hasPendingPins: hasPendingPins)
        for id in legacy.sorted() {
            await model.changeAccountShelf(.pin(bookID: id, pinned: true))
            if model.accountActions.contains(where: \.conflict) { break }
        }
    }
    private var selectionToolbar: some View {
        HStack(spacing: 12) {
            Text("已选 \(selectedIDs.count) 本").font(.subheadline).monospacedDigit()
            Spacer(minLength: 4)
            Button {
                setPins(selectedIDs, pinned: !selectionIsPinned)
            } label: { Label(selectionIsPinned ? "取消置顶" : "置顶", systemImage: selectionIsPinned ? "pin.slash" : "pin").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                .disabled(selectedIDs.isEmpty)
            Button { sharing = ShelfShareSelection(items: selectedItems) } label: {
                Label("分享", systemImage: "square.and.arrow.up").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.disabled(selectedItems.isEmpty)
        }.font(.subheadline).padding(.horizontal, 16).padding(.vertical, 4).background(.regularMaterial)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("library-selection-toolbar")
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
