import SwiftUI
import LeafhourCore
import PDFKit

struct ReaderContentsPanel: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    var cloud: CloudLibraryClient? = nil
    var library: OfflineLibrary? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var query = ""
    @State private var searchPresented = false
    @State private var locationRequest = 0
    @State private var readingStart: ReadingAnchor?
    @State private var ai = ContentsAISearch()
    @State private var aiMode = false
    @State private var bodyGroups: [Int: [BookSearchResult]] = [:]
    @State private var searchingBody = false
    @State private var completedQuery = ""
    @State private var locationError: String?
    private var cleanQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var isPDF: Bool { session.book.kind == .pdf }
    private var entries: [ReaderContentsEntry] {
        let all = ReaderContentsIndex.entries(chapters: session.book.chapters, kind: session.book.kind, query: "")
        guard !cleanQuery.isEmpty else { return all }
        let titles = Set(ReaderContentsIndex.entries(chapters: session.book.chapters, kind: session.book.kind, query: query).map(\.chapterIndex))
        let matching: Set<Int> = aiMode ? Set(ai.matches.map(\.chapterIndex)) : (completedQuery == cleanQuery ? Set(bodyGroups.keys) : [])
        return all.filter { aiMode ? matching.contains($0.chapterIndex) : titles.contains($0.chapterIndex) || matching.contains($0.chapterIndex) }
    }
    private var unit: String { isPDF ? "页" : "章" }
    private var currentLabel: String { isPDF ? "当前页" : "当前章节" }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section("正在读") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(session.chapter.title).font(.subheadline.weight(.medium))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("第 \(session.chapterIndex + 1) \(unit) · 共 \(session.book.chapters.count) \(unit)")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }.padding(.vertical, 4)
                    if let readingStart,
                       let index = session.book.chapters.firstIndex(where: { $0.id == readingStart.chapterID }) {
                        Button { onJump(index, readingStart) } label: {
                            Label("从正文开始", systemImage: "book.pages").frame(minHeight: 44)
                        }.accessibilityIdentifier("reader-start-body")
                    }
                }
                if searchPresented || !cleanQuery.isEmpty { searchControls }
                Section(listTitle) {
                    if entries.isEmpty {
                        Group {
                            if searchingBody || ai.running { ProgressView(aiMode ? "AI 正在查找相关原文…" : "正在搜索章节正文…") }
                            else { ContentUnavailableView.search(text: query) }
                        }.listRowSeparator(.hidden)
                    } else {
                        ForEach(entries) { entry in
                            Button { onJump(entry.chapterIndex, nil) } label: {
                                contentsRowLayout {
                                    Text(entry.title).font(.subheadline).foregroundStyle(.primary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if entry.chapterIndex == session.chapterIndex {
                                        Image(systemName: "bookmark.fill")
                                            .font(.caption).foregroundStyle(Color.leafInk)
                                            .fixedSize().accessibilityHidden(true)
                                    }
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .accessibilityLabel(entry.title)
                            .accessibilityValue(entry.chapterIndex == session.chapterIndex ? "\(currentLabel)，第 \(entry.chapterIndex + 1) \(unit)" : "第 \(entry.chapterIndex + 1) \(unit)")
                            .accessibilityIdentifier("reader-contents-entry-\(entry.chapterIndex)")
                            .listRowBackground(entry.chapterIndex == session.chapterIndex ? Color.leafInk.opacity(0.08) : Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 18, bottom: 4, trailing: 18))
                            .id(entry.id)
                            if !cleanQuery.isEmpty {
                                if aiMode {
                                    ForEach(ai.matches.filter { $0.chapterIndex == entry.chapterIndex }) { hit in
                                        sourceHit(text: hit.quote, anchor: hit.anchor, chapterIndex: hit.chapterIndex, ai: true)
                                    }
                                } else if completedQuery == cleanQuery {
                                    ForEach(bodyGroups[entry.chapterIndex] ?? []) { hit in
                                        sourceHit(text: hit.excerpt.before + hit.excerpt.match + hit.excerpt.after, anchor: hit.anchor, chapterIndex: hit.chapterIndex, ai: false, excerpt: hit.excerpt)
                                    }
                                }
                            }
                        }
                    }
                }
                if let locationError { Section { Text(locationError).font(.footnote).foregroundStyle(.secondary) } }
            }
            .listStyle(.plain)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        query = ""; searchPresented = false; locationRequest += 1
                    } label: {
                        Image(systemName: "scope").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("定位\(currentLabel)")
                    .accessibilityHint("清除目录搜索，滚动到正在阅读的位置，不改变书页")
                    .accessibilityIdentifier("reader-contents-locate-current")
                }
            }
            .task(id: locationRequest) {
                await Task.yield()
                guard !Task.isCancelled else { return }
                withAnimation(locationRequest == 0 || reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    proxy.scrollTo(session.chapter.id, anchor: .center)
                }
            }
        }
        .searchable(text: $query, isPresented: $searchPresented,
                    placement: .navigationBarDrawer(displayMode: .automatic),
                    prompt: Text(isPDF ? "输入页码，或搜索页面正文" : "搜索章节和正文"))
        .navigationTitle("目录")
        .task(id: "\(aiMode):\(cleanQuery)") { await searchBody() }
        .onChange(of: query) { _, _ in ai.stop(cloud: cloud, clear: true); locationError = nil }
        .onChange(of: aiMode) { _, _ in ai.stop(cloud: cloud, clear: true) }
        .onSubmit(of: .search) { if aiMode { runAISearch() } }
        .onDisappear { ai.stop(cloud: cloud) }
        .task(id: session.book.id) { readingStart = session.declaredReadingStart() }
    }

    private var listTitle: String {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return isPDF ? "全部页面" : "全部章节" }
        if aiMode, ai.hasCompleted, ai.submittedQuery != cleanQuery { return "上次搜索 · 找到 \(entries.count) \(unit)" }
        return "找到 \(entries.count) \(unit)"
    }
    private var searchControls: some View {
        Section {
            Picker("查找方式", selection: $aiMode) {
                Text("原文").tag(false); Text("AI 查找").tag(true)
            }.pickerStyle(.segmented).accessibilityIdentifier("reader-contents-search-mode")
            if aiMode {
                Text("描述想找的内容。AI 只查这本书，结果会放在对应章节下；每次查找使用一次普通对话点数。")
                    .font(.footnote).foregroundStyle(.secondary)
                if ai.running {
                    Button("停止查找", systemImage: "xmark.circle") { ai.stop(cloud: cloud) }.frame(minHeight: 44)
                } else {
                    Button(ai.pendingRecovery ? "核对上次搜索" : "用 AI 查找", systemImage: "sparkle.magnifyingglass") { runAISearch() }
                        .frame(minHeight: 44).disabled(cleanQuery.isEmpty).accessibilityIdentifier("reader-contents-ai-search")
                }
                if let status = ai.status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                if let error = ai.error { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
                if ai.hasCompleted {
                    Text("结果对应：" + ai.submittedQuery).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("reader-contents-result-query")
                }
                if !ai.matches.isEmpty { Text("已核对 \(ai.matches.count) 处原文 · 仅代表本次查阅范围").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
    private func runAISearch() { ai.search(cleanQuery, session: session, cloud: cloud, library: library, recovering: ai.pendingRecovery) }
    private func sourceHit(text: String, anchor: ReadingAnchor, chapterIndex: Int, ai: Bool, excerpt: SearchExcerpt? = nil) -> some View {
        Button { jumpToSource(anchor, chapterIndex: chapterIndex) } label: {
            VStack(alignment: .leading, spacing: 6) {
                if ai { Text("相关原文 · AI 查找").font(.caption2).foregroundStyle(.secondary) }
                if let excerpt {
                    (Text(excerpt.before) + Text(excerpt.match).bold() + Text(excerpt.after))
                        .font(.subheadline).foregroundStyle(.primary).lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(text).font(.subheadline).foregroundStyle(.primary).lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
                }
                Text("第 \(chapterIndex + 1) \(unit) · 第 \((session.book.chapters[chapterIndex].passages.firstIndex { $0.id == anchor.passageID } ?? 0) + 1) 段")
                    .font(.caption2).foregroundStyle(.secondary)
            }.padding(.vertical, 6).padding(.leading, 12).frame(minHeight: 44)
        }.accessibilityHint("打开这个片段在原书中的位置")
            .accessibilityIdentifier("reader-contents-hit-" + anchor.key)
    }
    private func jumpToSource(_ anchor: ReadingAnchor, chapterIndex: Int) {
        guard session.book.chapters.indices.contains(chapterIndex), session.book.chapters[chapterIndex].id == anchor.chapterID,
              let passage = session.book.chapters[chapterIndex].passages.first(where: { $0.id == anchor.passageID }) else { return }
        guard isPDF, session.state.preferences.viewMode == .source else { onJump(chapterIndex, anchor); return }
        guard let page = PDFDocument(url: session.original)?.page(at: chapterIndex), let raw = page.string,
              raw.utf16.elementsEqual(passage.text.utf16), anchor.characterOffset < raw.unicodeScalars.count else {
            locationError = "这页的文字层暂不能精确定位；可点击章节标题打开原页。"; return
        }
        let scalars = raw.unicodeScalars, start = scalars.index(scalars.startIndex, offsetBy: max(0, anchor.characterOffset))
        let offset = String(scalars[..<start]).utf16.count
        let range = (raw as NSString).rangeOfComposedCharacterSequences(for: NSRange(location: offset, length: 1))
        guard let selection = page.selection(for: range), let exact = PDFTextAnchor.make(selection: selection, page: page, chapterID: anchor.chapterID, passageID: anchor.passageID) else {
            locationError = "这页暂不能精确定位；可点击章节标题打开原页。"; return
        }
        onJump(chapterIndex, exact)
    }
    @MainActor private func searchBody() async {
        let captured = cleanQuery
        guard !aiMode else { searchingBody = false; return }
        guard !captured.isEmpty else { bodyGroups = [:]; completedQuery = ""; searchingBody = false; return }
        searchingBody = true
        do {
            try await Task.sleep(for: .milliseconds(150))
            let found = try await BookSearch.matches(in: session.book.chapters, query: captured, markdown: session.book.rendersMarkdown)
            let grouped = await Task.detached(priority: .userInitiated) { Dictionary(grouping: found, by: \.chapterIndex) }.value
            guard !Task.isCancelled, captured == cleanQuery else { return }
            bodyGroups = grouped; completedQuery = captured; searchingBody = false
        } catch { if !Task.isCancelled, captured == cleanQuery { searchingBody = false } }
    }
    private var contentsRowLayout: AnyLayout {
        if dynamicTypeSize.isAccessibilitySize { return AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) }
        return AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
    }
}

/// Own the dismissing tap so it can never reach the page-turn gesture below.
struct ReaderContentsOverlay: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    let onClose: () -> Void
    var cloud: CloudLibraryClient? = nil
    var library: OfflineLibrary? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Color.black.opacity(0.22).ignoresSafeArea()
                    .contentShape(Rectangle()).onTapGesture(perform: onClose)
                    .accessibilityLabel("收起目录").accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("reader-contents-backdrop")
                NavigationStack {
                    ReaderContentsPanel(session: session, onJump: onJump, cloud: cloud, library: library)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar(.visible, for: .navigationBar)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("收起目录", systemImage: "xmark") { onClose() }
                                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                                    .accessibilityIdentifier("reader-contents-close")
                            }
                        }
                }
                .frame(width: min(geometry.size.width - 48, typeSize.isAccessibilitySize ? 430 : 340))
                .background(Color(uiColor: .systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 12, x: 4)
                .accessibilityAction(.escape, onClose)
                .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { value in
                    if value.translation.width < -64 && abs(value.translation.height) < abs(value.translation.width) { onClose() }
                })
                .transition(.move(edge: .leading))
            }.animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: session.chapterIndex)
        }
    }
}
