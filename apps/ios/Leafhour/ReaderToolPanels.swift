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
    @State private var export: RecordsDocument?
    @State private var exporting = false
    var body: some View {
        List {
            ReaderTimeControls(session: session)
            Section("读这本书") {
                Button(action: onAutoPage) { Label("自动翻页", systemImage: "timer").frame(minHeight: 44) }
                    .accessibilityIdentifier("reader-auto-page-open")
                NavigationLink { BookSearchPanel(session: session, onJump: onJump).modifier(ReaderToolContinuation()) } label: { Label("搜索原文", systemImage: "magnifyingglass").frame(minHeight: 44) }
                NavigationLink { ReaderTranslationPanel(session: session, tools: tools, cloud: cloud).modifier(ReaderToolContinuation()) } label: { Label("翻译", systemImage: "character.book.closed").frame(minHeight: 44) }
                if let reading, session.state.preferences.viewMode != .source {
                    NavigationLink {
                        Form { ReaderTranslationPreparation(session: session, reading: reading) }
                            .navigationTitle("准备译文").modifier(ReaderToolContinuation())
                    } label: {
                        Label(reading.running ? "正在翻译 · \(reading.completedCount)/\(reading.totalCount)" : "准备或恢复本章译文", systemImage: "text.book.closed").frame(minHeight: 44)
                    }
                }
                NavigationLink { ReaderRecordsPanel(session: session, onJump: onJump).modifier(ReaderToolContinuation()) } label: { Label("我的记录", systemImage: "square.and.pencil").frame(minHeight: 44) }
                NavigationLink { ReaderPreferencesPanel(session: session, reading: reading).modifier(ReaderToolContinuation()) } label: { Label("文字与纸面", systemImage: "textformat.size").frame(minHeight: 44) }
                NavigationLink { ReaderIntroductionPanel(session: session, tools: tools, cloud: cloud).modifier(ReaderToolContinuation()) } label: { Label("导读与摘要", systemImage: "text.book.closed").frame(minHeight: 44) }
                Button(action: onCompanion) { Label("阅读陪读", systemImage: "bubble.left.and.bubble.right").frame(minHeight: 44) }
                NavigationLink { ReaderWebToolsPanel(session: session, cloud: cloud).onAppear { speech.pause() }.modifier(ReaderToolContinuation()) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Label("更多书房工具（网页版）", systemImage: "globe")
                        Text("云端听读、讲稿、氛围和摘录等已有工具").font(.caption).foregroundStyle(.secondary)
                    }.frame(minHeight: 44)
                }.disabled(session.book.cloud == nil || cloud == nil)
            }
            Section("带走自己的记录") {
                Button(action: onShare) { Label("分享这本书", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                    .accessibilityIdentifier("reader-share-book")
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
            Section {
                Text("轻点书页找回工具，再轻点可收起。长按正文仍使用系统选字；翻页方式可在阅读设置中更改。").font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("阅读工具")
            .fileExporter(isPresented: $exporting, document: export, contentType: .json, defaultFilename: "Leafhour-records") { result in
                if case .failure(let error) = result { session.message = error.localizedDescription }
            }
    }
}

struct ReaderListeningPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Environment(\.dismiss) private var dismiss
    private var chapterTitle: String {
        let id = speech.playing || speech.paused ? speech.chapterID : speech.hasResumePosition(session) ? session.state.listeningPosition?.chapterID : nil
        return session.book.chapters.first { $0.id == id }?.title ?? session.chapter.title
    }
    var body: some View {
        Form {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "headphones").font(.system(size: 36, weight: .light)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
                    Text(chapterTitle).font(.headline).multilineTextAlignment(.center)
                    if speech.count > 0 { Text("\(speech.layerTitle) · 本书第 \(speech.position + 1) / \(speech.count) 段").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                    HStack(spacing: 30) {
                        Button { speech.move(-1) } label: {
                            Label("上一段", systemImage: "backward.end.fill").labelStyle(.iconOnly)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }.disabled(!speech.canPrevious)
                        Button { speech.toggle(session); if speech.playing { dismiss() } } label: {
                            Label(speech.playing ? "暂停朗读" : speech.paused ? "继续朗读" : speech.hasResumePosition(session) ? "继续上次朗读" : "从当前句开始朗读", systemImage: speech.playing ? "pause.fill" : "play.fill")
                                .font(.title2).labelStyle(.iconOnly).frame(width: 60, height: 60)
                                .background(Color.leafInk.opacity(0.12), in: Circle()).contentShape(Circle())
                        }.accessibilityIdentifier("reader-speech-play")
                        Button { speech.move(1) } label: {
                            Label("下一段", systemImage: "forward.end.fill").labelStyle(.iconOnly)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }.disabled(!speech.canNext)
                    }.buttonStyle(.plain)
                    if !speech.activeSentence.isEmpty { Text(speech.activeSentence).font(.subheadline).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled) }
                }.frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            Section("声音与语速") {
                ReaderSpeechSpeedControl(session: session, speech: speech)
                Picker("朗读声音", selection: $speech.voiceID) {
                    Text("自动匹配原文语言").tag("")
                    ForEach(speech.voices, id: \.identifier) { voice in Text("\(voice.name) · \(voice.language)").tag(voice.identifier) }
                }
                if speech.playing || speech.paused { Button("结束听书", systemImage: "stop.fill") { speech.stop() } }
                if speech.playing || speech.paused {
                    Toggle("跟随朗读", isOn: $speech.following)
                }
                if speech.playing || speech.paused || speech.hasResumePosition(session) {
                    Button("从当前书页重新开始", systemImage: "play.circle") { speech.start(session, useSavedPosition: false); if speech.playing { dismiss() } }
                        .accessibilityIdentifier("reader-speech-start-here")
                }
            }
            Section {
                Text("使用此设备的系统声音，点击播放后才开始。不上传正文，也不使用阅读点。离线可用性取决于已安装的系统声音；切到后台会暂停，回来后可继续。").font(.footnote).foregroundStyle(.secondary)
                Text("从当前可见句开始，逐句高亮并接续后文。滚动、翻页或选字后暂时停止跟随，点“回到朗读”即可返回。暂停后保留播放位置。").font(.footnote).foregroundStyle(.secondary)
            }
            if let message = speech.message { Section { Text(message).font(.footnote).foregroundStyle(.secondary) } }
        }
        .navigationTitle("听一会儿")
        .onChange(of: speech.voiceID) { _, _ in speech.restartVoice() }
    }
}

struct ReaderTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    @State private var variant = "parallel"
    @State private var loadedKey: String?
    private var passage: Passage? { ReaderCloudTools.currentPassage(session) }
    private var key: String { session.chapter.id + ":" + (passage?.id ?? "") }
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
    private var source: String {
        let value = tools.chatContext?.selection?.text ?? tools.chatContext?.original ?? selection?.text ?? ReaderCloudTools.currentPassage(session)?.text ?? "此页暂无可引用的文字。"
        let selected = tools.chatContext.map { $0.selection != nil } ?? (selection != nil)
        return session.book.rendersMarkdown && !selected ? MarkdownDocument(source: value).text.trimmingCharacters(in: .whitespacesAndNewlines) : value
    }
    var body: some View {
        ChatConversationView(tools: tools, cloud: cloud, title: title, bookTitle: session.book.title,
            source: source, sourceLabel: tools.chatContext?.sourceLabel ?? (selection?.origin == "translation" ? "选中的译文 · 提问时引用对应原文" : selection == nil ? "引用的原文" : "选中的原文"),
            localOnly: session.book.cloud == nil || cloud == nil,
            load: {
                if let identity = session.book.cloud { await tools.restoreConversationDraft(identity: identity, library: library) }
                await tools.loadConversation(session, cloud: cloud, selection: selection)
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
