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
                    NavigationLink { ReaderTranslationPanel(session: session, tools: tools, cloud: cloud).modifier(ReaderToolContinuation()) } label: { toolTile("翻译", symbol: "character.book.closed") }
                    NavigationLink { ReaderIntroductionPanel(session: session, tools: tools, cloud: cloud).modifier(ReaderToolContinuation()) } label: { toolTile("导读", symbol: "text.book.closed") }.accessibilityLabel("导读与摘要")
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
                        Label(reading.running ? "正在翻译 · \(reading.completedCount)/\(reading.totalCount)" : "准备或恢复本章译文", systemImage: "text.book.closed").frame(minHeight: 44)
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

struct ReaderTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    @State private var variant = "parallel"
    @State private var loadedKey: String?
    private var passage: Passage? { ReaderCloudTools.currentPassage(session) }
    private var key: String { session.chapter.id + ":" + (passage?.id ?? "") + ":" + session.translationSettings.targetLanguage.rawValue }
    private var reading: Bool { loadedKey != key || tools.loading }
    private var translation: ReaderTranslation? { loadedKey == key ? tools.translation : nil }
    private var sourceDescription: String { session.book.title + " · " + session.chapter.title }
    private var original: String {
        let text = translation?.original ?? passage?.text ?? ""
        return session.book.rendersMarkdown ? MarkdownDocument(source: text).text.trimmingCharacters(in: .whitespacesAndNewlines) : text
    }
    private func hasText(_ value: String?) -> Bool { !(value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
    var body: some View {
        List {
            ReaderBookLanguageChoices(session: session).disabled(tools.generating)
            if let passage {
                Section {
                    Text(sourceDescription).font(.footnote).foregroundStyle(.secondary)
                    Text(original).font(.system(.body, design: .serif)).lineSpacing(5).lineLimit(6).textSelection(.enabled)
                    NavigationLink {
                        ReaderExpandedTextPanel(title: "作者原文", source: sourceDescription, text: original, serif: true)
                    } label: { Label("完整阅读原文", systemImage: "arrow.up.left.and.arrow.down.right").frame(minHeight: 44) }
                } header: {
                    Text("当前段 · 作者原文")
                    if let index = session.chapter.passages.firstIndex(where: { $0.id == passage.id }) { Text("第 \(index + 1) 段") }
                }
                Section {
                    Picker("阅读方式", selection: $variant) {
                        Text("对照").tag("parallel"); Text("直译").tag("literal"); Text("意译").tag("interpretive")
                    }.pickerStyle(.segmented).accessibilityIdentifier("reader-translation-variant")
                }
                if variant != "interpretive" {
                    ReaderTranslationSection(title: "直译", text: translation?.literal, status: translation?.literalStatus, loading: reading, readFailed: tools.error != nil, localOnly: session.book.cloud == nil || cloud == nil, source: sourceDescription)
                }
                if variant != "literal" {
                    ReaderTranslationSection(title: "意译", text: translation?.interpretive, status: translation?.interpretiveStatus, loading: reading, readFailed: tools.error != nil, localOnly: session.book.cloud == nil || cloud == nil, source: sourceDescription)
                }
                if let translation, !hasText(translation.literal) || !hasText(translation.interpretive), tools.error == nil {
                    Section {
                        Button("翻译这一段", systemImage: "character.book.closed") { Task { await tools.prepare("translation", session: session, cloud: cloud) } }
                            .frame(minHeight: 44).disabled(reading || tools.generating || session.book.cloud == nil || cloud == nil)
                        Text(session.book.cloud == nil || cloud == nil ? "在书房登录并同步这本书后，可以翻译当前段落。" : "只在你确认后提交当前段落；如需阅读点，会先展示本次点数。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            } else {
                ContentUnavailableView("此页暂无可翻译文字", systemImage: "text.quote", description: Text("原书页面仍保留。选择有文字的段落后，可在这里核对译文。"))
            }
            if reading && !tools.loading && passage != nil { Section { ProgressView("正在核对已有译文…") } }
            ReaderToolStatus(tools: tools, cloud: cloud)
            if tools.error != nil && session.book.cloud != nil && cloud != nil {
                Section { Button("重新读取已有译文", systemImage: "arrow.clockwise") { Task { await load(key) } }.frame(minHeight: 44).disabled(reading || tools.generating) }
            }
        }
        .navigationTitle("这一段的译文")
        .task(id: key) { await load(key) }
        .modifier(ReaderGenerationConfirmation(tools: tools, cloud: cloud))
    }
    @MainActor private func load(_ requestedKey: String) async {
        loadedKey = nil
        await tools.loadTranslation(session, cloud: cloud)
        if !Task.isCancelled && requestedKey == key { loadedKey = requestedKey }
    }
}

private struct ReaderTranslationSection: View {
    let title: String
    let text: String?
    let status: String?
    let loading: Bool
    let readFailed: Bool
    let localOnly: Bool
    let source: String
    private var savedText: String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }
    private var review: String {
        switch status {
        case "reviewed": "已复核"
        case "draft": "草稿 · 尚未复核"
        default: "复核状态未标注"
        }
    }
    var body: some View {
        Section(title) {
            if let savedText {
                Label(review, systemImage: status == "reviewed" ? "checkmark.seal" : "doc.text")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text(savedText).font(.body).lineSpacing(5).lineLimit(8).textSelection(.enabled)
                NavigationLink {
                    ReaderExpandedTextPanel(title: title, source: source + " · 已保存的" + title + " · " + review, text: savedText)
                } label: { Label("展开阅读" + title, systemImage: "arrow.up.left.and.arrow.down.right").frame(minHeight: 44) }
            } else if loading {
                Text("正在核对已有" + title + "…").font(.body).foregroundStyle(.secondary)
            } else if readFailed {
                Text("暂时无法核对" + title).font(.body)
                Text("读取失败，暂不能确定是否已有译文。原文仍可阅读，请重试读取。").font(.subheadline).foregroundStyle(.secondary)
            } else {
                Text(localOnly ? "此设备暂无可显示的" + title : "这一段尚无" + title).font(.body)
                Text(localOnly ? "原文仍可阅读。同步这本书后，可以核对书房中已保存的译文。" : "原文仍保留；直译和意译分别保存，不会互相代替。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

private struct ReaderExpandedTextPanel: View {
    let title: String
    let source: String
    let text: String
    var serif = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(source).font(.footnote).foregroundStyle(.secondary)
                Text(text).font(.system(.body, design: serif ? .serif : .default)).lineSpacing(6).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .modifier(ReaderToolContinuation(identifier: "reader-expanded-continue"))
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
    var title = "Chat"
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
            canRemoveSource: tools.chatContext.map { $0.selection != nil } ?? (selection != nil), sourceLabel: tools.chatQuoteRemoved ? "当前段落 · 未附加选文" : tools.chatContext?.sourceLabel ?? (selection?.origin == "translation" ? "选中的译文 · 提问时引用对应原文" : selection == nil ? "引用的原文" : "选中的原文"),
            localOnly: cloud == nil,
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
