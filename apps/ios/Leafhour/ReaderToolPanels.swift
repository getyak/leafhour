import SwiftUI
import AVFoundation
import LeafhourCore

struct ReaderMorePanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    let onJump: (Int, ReadingAnchor?) -> Void
    let onCompanion: () -> Void
    @State private var export: RecordsDocument?
    @State private var exporting = false
    var body: some View {
        List {
            Section("读这本书") {
                NavigationLink { BookSearchPanel(session: session, onJump: onJump) } label: { Label("搜索原文", systemImage: "magnifyingglass").frame(minHeight: 44) }
                NavigationLink { ReaderPreferencesPanel(session: session) } label: { Label("文字与纸面", systemImage: "textformat.size").frame(minHeight: 44) }
                NavigationLink { ReaderIntroductionPanel(session: session, tools: tools, cloud: cloud) } label: { Label("导读与摘要", systemImage: "text.book.closed").frame(minHeight: 44) }
                Button(action: onCompanion) { Label("阅读陪读", systemImage: "bubble.left.and.bubble.right").frame(minHeight: 44) }
                NavigationLink { ReaderWebToolsPanel(session: session, cloud: cloud).onAppear { speech.pause() } } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Label("更多书房工具（网页版）", systemImage: "globe")
                        Text("云端听读、讲稿、氛围和摘录等已有工具").font(.caption).foregroundStyle(.secondary)
                    }.frame(minHeight: 44)
                }.disabled(session.book.cloud == nil || cloud == nil)
            }
            Section("带走自己的记录") {
                ShareLink(item: session.original) { Label("分享此设备上的书籍文件", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                Button {
                    do {
                        export = RecordsDocument(data: try JSONEncoder().encode(RecordsBackup(book: session.book, state: session.state)))
                        exporting = true
                    } catch { session.message = error.localizedDescription }
                } label: { Label("导出笔记与草稿", systemImage: "doc.text").frame(minHeight: 44) }
            }
            Section {
                Text("轻点书页底边找回工具。滑动继续阅读时，工具会轻轻收起；长按正文仍使用系统选字。").font(.footnote).foregroundStyle(.secondary)
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
    var body: some View {
        Form {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "headphones").font(.system(size: 36, weight: .light)).foregroundStyle(Color.leafInk).accessibilityHidden(true)
                    Text(session.chapter.title).font(.headline).multilineTextAlignment(.center)
                    if speech.count > 0 { Text("第 \(speech.position + 1) / \(speech.count) 段").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                    HStack(spacing: 30) {
                        Button("上一段", systemImage: "backward.end.fill") { speech.move(-1) }.disabled(!speech.canPrevious).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        Button(speech.playing ? "暂停朗读" : speech.paused ? "继续朗读" : "从当前段开始朗读", systemImage: speech.playing ? "pause.fill" : "play.fill") { speech.toggle(session) }
                            .font(.title2).labelStyle(.iconOnly).frame(width: 60, height: 60).background(Color.leafInk.opacity(0.12), in: Circle())
                            .accessibilityIdentifier("reader-speech-play")
                        Button("下一段", systemImage: "forward.end.fill") { speech.move(1) }.disabled(!speech.canNext).labelStyle(.iconOnly).frame(width: 44, height: 44)
                    }
                    if !speech.text.isEmpty { Text(speech.text).font(.subheadline).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled) }
                }.frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            Section("声音与语速") {
                Picker("语速", selection: $speech.speed) {
                    ForEach([0.75, 1.0, 1.25, 1.5], id: \.self) { value in Text(value.formatted() + "×").tag(value) }
                }.pickerStyle(.segmented)
                Picker("朗读声音", selection: $speech.voiceID) {
                    Text("自动匹配原文语言").tag("")
                    ForEach(speech.voices, id: \.identifier) { voice in Text("\(voice.name) · \(voice.language)").tag(voice.identifier) }
                }
                if speech.playing || speech.paused { Button("结束听书", systemImage: "stop.fill") { speech.stop() } }
            }
            Section {
                Text("使用此设备的系统声音，点击播放后才开始。不上传正文，也不使用阅读点。离线可用性取决于已安装的系统声音；切到后台会暂停，回来后可继续。").font(.footnote).foregroundStyle(.secondary)
                Text("朗读当前章，从当前段开始。听书不会自动更改你正在看的位置。").font(.footnote).foregroundStyle(.secondary)
            }
            if let message = speech.message { Section { Text(message).font(.footnote).foregroundStyle(.secondary) } }
        }
        .navigationTitle("听一会儿")
        .onChange(of: speech.speed) { _, _ in speech.restartVoice() }
        .onChange(of: speech.voiceID) { _, _ in speech.restartVoice() }
    }
}

struct ReaderTranslationPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    @State private var variant = "parallel"
    private var key: String { session.chapter.id + ":" + (ReaderCloudTools.currentPassage(session)?.id ?? "") }
    var body: some View {
        List {
            Section {
                Picker("阅读方式", selection: $variant) { Text("对照").tag("parallel"); Text("直译").tag("literal"); Text("意译").tag("interpretive") }.pickerStyle(.segmented)
            }
            if let translation = tools.translation {
                if variant == "parallel" {
                    Section("作者原文") {
                        Text(session.book.rendersMarkdown ? MarkdownDocument(source: translation.original).text.trimmingCharacters(in: .whitespacesAndNewlines) : translation.original)
                            .textSelection(.enabled).font(.system(.body, design: .serif))
                    }
                }
                if variant != "interpretive" {
                    Section(translation.literalStatus == "reviewed" ? "直译 · 已复核" : "直译 · 草稿") {
                        if let text = translation.literal { Text(text).textSelection(.enabled) }
                        else { Text("这一段还没有直译。原文仍保留。").foregroundStyle(.secondary) }
                    }
                }
                if variant != "literal" {
                    Section(translation.interpretiveStatus == "reviewed" ? "意译 · 已复核" : "意译 · 草稿") {
                        if let text = translation.interpretive { Text(text).textSelection(.enabled) }
                        else { Text("这一段还没有意译。原文仍保留。").foregroundStyle(.secondary) }
                    }
                }
                if !translation.hasBoth {
                    Section {
                        Button("翻译这一段", systemImage: "character.book.closed") { Task { await tools.prepare("translation", session: session, cloud: cloud) } }
                            .frame(minHeight: 44).disabled(tools.loading || tools.generating || session.book.cloud == nil || cloud == nil)
                        Text(session.book.cloud == nil ? "在书房登录并同步这本书后，可以翻译当前段落。" : "只在你确认后提交当前段落；如需阅读点，会先展示本次点数。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            } else if !tools.loading { ContentUnavailableView("这一页还没有可翻译文字", systemImage: "text.quote") }
            ReaderToolStatus(tools: tools, cloud: cloud)
        }.navigationTitle("这一段的译文")
            .task(id: key) { await tools.loadTranslation(session, cloud: cloud) }
            .modifier(ReaderGenerationConfirmation(tools: tools, cloud: cloud))
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
                ContentUnavailableView(session.book.cloud == nil || cloud == nil ? "此设备尚未保存导读" : "暂无已保存的导读", systemImage: "text.book.closed", description: Text("这里显示书中已有的简介或已经保存的开篇导读。打开面板不会生成内容。"))
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
    var title = "阅读陪读"
    @State private var didLoad = false
    @State private var sourceExpanded = false
    @FocusState private var questionFocused: Bool
    private struct LatestTurn: Equatable {
        let id: String
        let status: String
        let answer: String?
    }
    private var latestTurn: LatestTurn? {
        tools.turns.last.map { LatestTurn(id: $0.id, status: $0.status, answer: $0.answer) }
    }
    private var source: String {
        let value = selection?.text ?? ReaderCloudTools.currentPassage(session)?.text ?? "此页暂无可引用的文字。"
        return session.book.rendersMarkdown && selection == nil ? MarkdownDocument(source: value).text.trimmingCharacters(in: .whitespacesAndNewlines) : value
    }
    private var canAsk: Bool {
        !tools.loading && !tools.generating && tools.conversationAvailable && !tools.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    DisclosureGroup(isExpanded: $sourceExpanded) {
                        Text(source).font(.body).lineSpacing(4).textSelection(.enabled).padding(.top, 6)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(selection == nil ? "正在读的原文" : "作者原文").font(.caption).foregroundStyle(.secondary)
                            if !sourceExpanded { Text(source).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                        }
                    }
                    .tint(Color.leafInk)
                    .padding(14)
                    .background(Color.leafInk.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    ForEach(tools.turns) { turn in ReaderConversationTurnView(turn: turn) }
                    conversationStatus
                    if session.book.cloud != nil {
                        Button("刷新已有对话", systemImage: "arrow.clockwise") { Task { await load() } }
                            .font(.subheadline).frame(minHeight: 44).disabled(tools.loading || tools.generating)
                    }
                    Color.clear.frame(height: 1).id("reader-conversation-bottom")
                }.padding(16)
            }
            .accessibilityIdentifier("reader-conversation-history")
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .onChange(of: latestTurn) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("reader-conversation-bottom", anchor: .bottom) }
            }
            .onChange(of: tools.error) { _, value in
                if value != nil { proxy.scrollTo("reader-conversation-bottom", anchor: .bottom) }
            }
            .onChange(of: tools.generating) { _, value in
                if value { proxy.scrollTo("reader-conversation-bottom", anchor: .bottom) }
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("收起键盘") { questionFocused = false }
            }
        }
        .task { await load() }
        .modifier(ReaderGenerationConfirmation(tools: tools, cloud: cloud))
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("写下此刻的问题", text: $tools.question, axis: .vertical)
                    .font(.body).lineLimit(1...3).focused($questionFocused)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Color.leafInk.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("reader-question")
                    .layoutPriority(1)
                Button { Task { await tools.prepare("conversation", session: session, cloud: cloud, selection: selection) } } label: {
                    Label("向陪读提问", systemImage: "paperplane.fill").labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(Color.leafInk).disabled(!canAsk)
                .accessibilityIdentifier("reader-question-send")
            }
            if !questionFocused {
                Text(session.book.cloud == nil || cloud == nil ? "同步这本书后可继续提问；输入中的文字会保留。" : tools.scope == "library" ? "可查阅自己的书房与网络，不读取私人笔记。" : "围绕这本书继续聊，不读取私人笔记。")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }
    @ViewBuilder private var conversationStatus: some View {
        if tools.generating { ProgressView("陪读正在回答…") }
        else if tools.loading || !didLoad { ProgressView(didLoad ? "正在准备本次提问…" : "正在读取已有对话…") }
        else if tools.turns.isEmpty && tools.error == nil {
            VStack(alignment: .leading, spacing: 8) {
                if session.book.cloud == nil || cloud == nil {
                    Label("同步后继续聊", systemImage: "books.vertical").font(.headline)
                    Text("在书房登录并同步这本书后，可以找回已有对话。现在仍可写下问题。").font(.subheadline).foregroundStyle(.secondary)
                } else if tools.conversationAvailable {
                    Text("从正在读的这段开始").font(.headline)
                    Text("写下一个问题，陪读会围绕这本书回应。").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Label("陪读暂时不可用", systemImage: "bubble.left.and.exclamationmark.bubble.right").font(.headline)
                    Text("可以刷新已有对话后再试。输入的问题会保留。").font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        if let error = tools.error {
            VStack(alignment: .leading, spacing: 7) {
                Label("暂时无法完成", systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Color.leafInk)
                Text(error).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
            }.accessibilityIdentifier("reader-conversation-error")
        }
        if let retry = tools.retry {
            Button("重试查看本次结果", systemImage: "arrow.clockwise") { Task { await tools.perform(retry, cloud: cloud) } }
                .frame(minHeight: 44).disabled(tools.generating || tools.loading)
        }
    }
    @MainActor private func load() async {
        didLoad = false
        await tools.loadConversation(session, cloud: cloud, selection: selection)
        if !Task.isCancelled { didLoad = true }
    }
}

private struct ReaderConversationTurnView: View {
    let turn: ReaderConversationTurn
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("我的提问").font(.caption).foregroundStyle(.secondary)
            Text(turn.question).font(.body).textSelection(.enabled)
            Divider()
            if let answer = turn.answer {
                Label("AI 陪读", systemImage: "sparkle").font(.caption).foregroundStyle(Color.leafInk)
                Text(.init(answer)).font(.body).lineSpacing(4).textSelection(.enabled)
            } else {
                Label(turn.status == "running" ? "回答还在处理中" : "这次回答未完成，问题已保留", systemImage: turn.status == "running" ? "clock" : "exclamationmark.circle")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.leafInk.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityIdentifier("reader-conversation-turn-" + turn.id)
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
private struct ReaderGenerationConfirmation: ViewModifier {
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    func body(content: Content) -> some View {
        content.alert(tools.consent?.title ?? "本次请求", isPresented: Binding(get: { tools.consent != nil }, set: { if !$0 { tools.consent = nil } }), presenting: tools.consent) { intent in
            Button("确认提交") { Task { await tools.perform(intent, cloud: cloud) } }
            Button("继续读", role: .cancel) { tools.consent = nil }
        } message: { intent in Text(intent.explanation) }
    }
}
