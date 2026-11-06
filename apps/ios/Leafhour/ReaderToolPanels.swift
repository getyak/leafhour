import SwiftUI
import AVFoundation
import LeafhourCore

/// Every pushed tool keeps a direct route back to the book. The action belongs
/// to the enclosing reader sheet, so it waits for its save receipt and dismisses
/// the whole sheet rather than merely popping this destination.
struct ReaderToolContinuation: ViewModifier {
    var identifier = "reader-tool-continue"
    @Environment(\.readerContinueReading) private var continueReading
    func body(content: Content) -> some View {
        content.toolbar {
            if let continueReading {
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: continueReading) {
                        Text("继续读").font(.body)
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }.accessibilityIdentifier(identifier)
                }
            }
        }
    }
}

struct ReaderMorePanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var library: OfflineLibrary? = nil
    var reading: ReaderReadingContent? = nil
    let onJump: (Int, ReadingAnchor?) -> Void
    let onCompanion: () -> Void
    var onAutoPage: () -> Void = {}
    var onShare: () -> Void = {}
    var onListen: () -> Void = {}
    var onBookmarks: () -> Void = {}
    var onReadingGuide: () -> Void = {}
    var onTranslation: () -> Void = {}
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var export: RecordsDocument?
    @State private var exporting = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: typeSize.isAccessibilitySize ? 2 : 3), spacing: 12) {
                    NavigationLink { BookSearchPanel(session: session, onJump: onJump).modifier(ReaderToolContinuation()) } label: { toolTile("搜索", symbol: "magnifyingglass") }.accessibilityLabel("搜索原文")
                    NavigationLink { ReaderRecordsPanel(session: session, onJump: onJump).modifier(ReaderToolContinuation()) } label: { toolTile("笔记", symbol: "square.and.pencil") }.accessibilityLabel("我的记录")
                    Button(action: onShare) { toolTile("分享", symbol: "square.and.arrow.up") }.accessibilityLabel("分享这本书").accessibilityIdentifier("reader-share-book")
                    Button(action: onTranslation) { toolTile("翻译", symbol: "character.book.closed") }
                    Button(action: onReadingGuide) { toolTile("阅读前导", symbol: "text.book.closed") }.accessibilityIdentifier("reader-guide-tool")
                    Button(action: onBookmarks) { toolTile("书签", symbol: "bookmark") }.accessibilityIdentifier("reader-bookmarks-tool")
                    Button(action: onCompanion) { toolTile("陪读", symbol: "bubble.left.and.bubble.right") }.accessibilityLabel("阅读陪读")
                    NavigationLink { ReaderPreferencesPanel(session: session, reading: reading).modifier(ReaderToolContinuation()) } label: { toolTile("排版", symbol: "textformat.size") }.accessibilityLabel("文字与纸面")
                    NavigationLink { ReaderBookTimePanel(session: session, library: library, cloud: cloud).modifier(ReaderToolContinuation()) } label: { toolTile("计时", symbol: "stopwatch") }.accessibilityLabel("阅读计时")
                    Button(action: onListen) { toolTile("听书", symbol: "headphones") }
                    NavigationLink { ReaderAppearancePanel(session: session).modifier(ReaderToolContinuation()) } label: { toolTile("纸面", symbol: "circle.lefthalf.filled") }
                    Button(action: onAutoPage) { toolTile("自动翻页", symbol: "timer") }.accessibilityIdentifier("reader-auto-page-open")
                    NavigationLink { ReaderWebToolsPanel(session: session, cloud: cloud).onAppear { speech.pause() }.modifier(ReaderToolContinuation()) } label: { toolTile("网页版", symbol: "globe") }
                        .accessibilityLabel("更多书房工具（网页版）").disabled(session.book.cloud == nil || cloud == nil)
                }.buttonStyle(.plain).padding(.vertical, 8)
                if let reading, session.state.preferences.viewMode != .source {
                    NavigationLink {
                        Form { ReaderTranslationPreparation(session: session, reading: reading) }
                            .navigationTitle("准备译文").modifier(ReaderToolContinuation())
                    } label: {
                        Label(reading.running ? "正在翻译 · \(reading.completedCount)/\(reading.totalCount)" : "随读翻译与显示方式", systemImage: "text.book.closed").frame(minHeight: 44)
                    }
                }
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                Text("带走记录").font(.caption).foregroundStyle(.secondary)
                ShareLink(item: session.original) { Label("分享此设备上的书籍文件", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                Button {
                    Task {
                        do {
                            guard await session.flushReadingTime() else { return }
                            let time = try await library?.readingTimeLedger(bookID: session.book.id).snapshots
                            export = RecordsDocument(data: try JSONEncoder().encode(RecordsBackup(book: session.book, state: session.state, readingTime: time)))
                            exporting = true
                        } catch { session.message = error.localizedDescription }
                    }
                } label: { Label("导出笔记与草稿", systemImage: "doc.text").frame(minHeight: 44) }
            }
            }.padding(20)
        }.navigationTitle("阅读工具")
            .fileExporter(isPresented: $exporting, document: export, contentType: .json, defaultFilename: "Leafhour-records") { result in
                if case .failure(let error) = result { session.message = error.localizedDescription }
            }
    }
    private func toolTile(_ title: String, symbol: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 24, weight: .regular)).foregroundStyle(Color.leafInk)
            Text(title).font(.caption).foregroundStyle(.primary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }.padding(.vertical, 18).frame(maxWidth: .infinity, minHeight: 92)
            .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
    }

}

/// A paragraph lookup floats above the unchanged reader. It never changes viewMode.
struct ReaderTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var quote: SelectedQuote? = nil
    @State private var loadedKey: String?
    private var passage: Passage? { ReaderCloudTools.currentPassage(session, selection: quote) }
    private var key: String { (quote?.anchor.chapterID ?? session.chapter.id) + ":" + (passage?.id ?? "") + ":" + session.translationSettings.targetLanguage.rawValue }
    private var displayedText: String? {
        guard let passage else { return nil }
        if let saved = session.translations[passage.id], saved.original == passage.text {
            return saved.text(session.state.preferences.translationVariant)
        }
        guard loadedKey == key, let value = tools.translation, value.original == passage.text else { return nil }
        let text = session.state.preferences.translationVariant == .literal ? value.literal : value.interpretive
        return text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? text : nil
    }
    var body: some View {
        List {
            if let displayedText {
                Text(displayedText).font(.system(.body, design: .serif)).lineSpacing(6)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    .listRowSeparator(.hidden).accessibilityIdentifier("reader-paragraph-translation-text")
            } else if let passage {
                if loadedKey != key || tools.loading { ProgressView().accessibilityLabel("正在读取译文") }
                else {
                    Text("这一段暂无译文").foregroundStyle(.secondary)
                    ReaderBookLanguageChoices(session: session).disabled(tools.generating)
                    Button("翻译此段", systemImage: "character.book.closed") {
                        Task { await tools.prepare("translation", session: session, cloud: cloud, selection: quote) }
                    }.frame(minHeight: 44).disabled(tools.generating || session.book.cloud == nil || cloud == nil)
                        .accessibilityIdentifier("reader-paragraph-translation-prepare")
                }
                if let error = tools.error {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Button("重试", systemImage: "arrow.clockwise") { Task { await load(key) } }.disabled(tools.loading || tools.generating)
                }
                if tools.generating { ProgressView().accessibilityLabel("正在翻译此段") }
                if let retry = tools.retry {
                    Button("核对上次结果", systemImage: "arrow.clockwise") { Task { await tools.perform(retry, cloud: cloud) } }.disabled(tools.generating || tools.loading)
                }
                // Keep the selected passage alive while its asynchronous lookup runs.
                Color.clear.frame(height: 0).accessibilityHidden(true).id(passage.id)
            } else { ContentUnavailableView("此处没有可翻译文字", systemImage: "text.quote") }
        }.listStyle(.plain).scrollContentBackground(.hidden)
            .navigationTitle("译文").accessibilityIdentifier("reader-paragraph-translation")
            .task(id: key) { await load(key) }
            .onChange(of: tools.translation?.literal) { _, _ in cacheTranslation() }
            .onChange(of: tools.translation?.interpretive) { _, _ in cacheTranslation() }
            .modifier(ReaderGenerationConfirmation(tools: tools, cloud: cloud))
    }
    @MainActor private func load(_ requested: String) async {
        loadedKey = nil
        await tools.loadTranslation(session, cloud: cloud, selection: quote)
        guard !Task.isCancelled, requested == key else { return }
        loadedKey = requested; cacheTranslation()
    }
    @MainActor private func cacheTranslation() {
        guard loadedKey == key, let passage, let value = tools.translation, value.original == passage.text else { return }
        session.updateTranslations([passage.id: value.readingCopy(targetLanguage: session.translationSettings.targetLanguage)])
    }
}

struct ReaderIntroductionPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    @State private var didLoad = false
    var body: some View {
        List {
            if !tools.introduction.isEmpty {
                Section(tools.introductionOrigin) {
                    Text(.init(tools.introduction)).font(.body).lineSpacing(5).textSelection(.enabled)
                }
            } else if !didLoad || tools.loading {
                if !tools.loading { ProgressView("正在读取已有导读…") }
            } else if tools.error != nil {
                ContentUnavailableView("暂时无法读取导读", systemImage: "wifi.exclamationmark", description: Text("请重试读取已有内容。读取失败不代表这本书没有导读。"))
            } else {
                ContentUnavailableView(session.book.cloud == nil || cloud == nil ? "此设备暂无可显示的导读" : "暂无已保存的导读", systemImage: "text.book.closed", description: Text("这里显示书中已有的简介或已经保存的开篇导读。打开面板不会生成内容。"))
            }
            ReaderToolStatus(tools: tools, cloud: cloud)
            if didLoad && tools.error != nil {
                Section { Button("重新读取已有导读", systemImage: "arrow.clockwise") { Task { await load() } }.disabled(tools.loading || tools.generating) }
            }
        }.navigationTitle("导读与摘要")
            .task { await load() }
    }
    @MainActor private func load() async {
        didLoad = false
        await tools.loadIntroduction(session, cloud: cloud)
        if !Task.isCancelled { didLoad = true }
    }
}

struct ReaderConversationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var selection: SelectedQuote? = nil
    var library: OfflineLibrary? = nil
    var title = "旁注"
    var readingGuide: ReadingGuideController? = nil
    var autoLoad = true
    @State private var initialSelectionAttached = false
    private var source: String {
        let localSelection = tools.chatQuoteRemoved ? nil : selection
        let value = tools.chatContext?.selection?.text ?? tools.chatContext?.original ?? localSelection?.text ?? ReaderCloudTools.currentPassage(session, selection: selection)?.text ?? "此页暂无可引用的文字。"
        let selected = tools.chatContext.map { $0.selection != nil } ?? (localSelection != nil)
        return session.book.rendersMarkdown && !selected ? MarkdownDocument(source: value).text.trimmingCharacters(in: .whitespacesAndNewlines) : value
    }
    var body: some View {
        ChatConversationView(tools: tools, cloud: cloud, title: title, bookTitle: session.book.title,
            source: source, sourceChapter: tools.chatContext?.chapterTitle ?? session.chapter.title,
            canRemoveSource: tools.chatContext.map { $0.selection != nil } ?? (selection != nil), sourceLabel: tools.chatQuoteRemoved ? "" : tools.chatContext?.sourceLabel ?? (selection?.origin == "translation" ? "选中的译文 · 提问时引用对应原文" : selection == nil ? "引用的原文" : "选中的原文"),
            localOnly: cloud == nil, isMarginalNote: true, readingGuide: readingGuide,
            onGuideFollowUp: { item in
                guard let actual = readingGuide?.guide else { return }
                await tools.sendGuideFollowUp(item, guide: actual, cloud: cloud)
            }, autoLoad: autoLoad,
            load: {
                if let identity = session.book.cloud { await tools.restoreConversationDraft(identity: identity, library: library) }
                let attach = !initialSelectionAttached && selection != nil
                initialSelectionAttached = true
                await tools.loadConversation(session, cloud: cloud, selection: selection, attachSelection: attach)
            },
            send: { await tools.prepare("conversation", session: session, cloud: cloud, selection: selection) })
    }
}

struct ReaderToolStatus: View {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    var body: some View {
        if tools.loading || tools.generating { Section { ProgressView(tools.generating ? "正在处理这次请求…" : "正在读取已有内容…") } }
        if let error = tools.error { Section { Text(error).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) } }
        if let retry = tools.retry {
            Section { Button("重试查看本次结果", systemImage: "arrow.clockwise") { Task { await tools.perform(retry, cloud: cloud) } }.disabled(tools.generating || tools.loading) }
        }
    }
}
struct ReaderGenerationConfirmation: ViewModifier {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    func body(content: Content) -> some View {
        content.alert(tools.consent?.title ?? "本次请求", isPresented: Binding(get: { tools.consent != nil }, set: { if !$0 { tools.consent = nil } }), presenting: tools.consent) { intent in
            Button("确认提交") { Task { await tools.perform(intent, cloud: cloud) } }
            Button("继续读", role: .cancel) { tools.consent = nil }
        } message: { intent in Text(intent.explanation) }
    }
}
