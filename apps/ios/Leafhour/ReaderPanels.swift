import SwiftUI
import UIKit
import LeafhourCore

private struct ReaderContinueReadingKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}
extension EnvironmentValues {
    var readerContinueReading: (() -> Void)? {
        get { self[ReaderContinueReadingKey.self] }
        set { self[ReaderContinueReadingKey.self] = newValue }
    }
}

struct ReaderPanelView: View {
    let panel: ReaderPanel
    @Bindable var session: ReaderSession
    let systemColorScheme: ColorScheme
    @Bindable var speech: ReaderSpeech
    @Bindable var tools: ReaderCloudTools
    let cloud: CloudLibraryClient?
    let onJump: (Int, ReadingAnchor?) -> Void
    let onCompanion: () -> Void
    @Environment(\.dismiss) private var dismiss
    private var isNoteEditor: Bool { if case .note = panel { return true }; return false }
    var body: some View {
        NavigationStack {
            Group {
                switch panel {
                case .contents:
                    ReaderContentsPanel(session: session, onJump: onJump)
                case .search: BookSearchPanel(session: session, onJump: onJump)
                case .preferences: ReaderPreferencesPanel(session: session)
                case .appearance: ReaderAppearancePanel(session: session)
                case .records: ReaderRecordsPanel(session: session, onJump: onJump)
                case .tools: ReaderMorePanel(session: session, speech: speech, tools: tools, cloud: cloud, onJump: onJump, onCompanion: onCompanion)
                case .listening: ReaderListeningPanel(session: session, speech: speech)
                case .translation: ReaderTranslationPanel(session: session, tools: tools, cloud: cloud)
                case .introduction: ReaderIntroductionPanel(session: session, tools: tools, cloud: cloud)
                case .conversation: ReaderConversationPanel(session: session, tools: tools, cloud: cloud)
                case .bookInformation: ReaderBookInformationPanel(book: session.book)
                case .note(let quote): NoteEditorPanel(quote: quote, session: session)
                case .companion(let quote):
                    ReaderConversationPanel(session: session, tools: tools, cloud: cloud, selection: quote, title: "陪我读")
                case .source(let quote):
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            Text("作者原文").font(.caption).foregroundStyle(.secondary)
                            Text(quote.text).font(.title3).textSelection(.enabled)
                            Text("\(session.book.title) · \(session.book.chapters.first { $0.id == quote.anchor.chapterID }?.title ?? "")").font(.footnote).foregroundStyle(.secondary)
                            Divider()
                            Text("原文与译文分别保留。已有译文可从阅读工具的“翻译”核对，未翻译的内容仍显示原文。").font(.subheadline).foregroundStyle(.secondary)
                        }.padding(24)
                    }.navigationTitle("核对原文")
                }
            }
            .interactiveDismissDisabled(!panel.isCompanion && (session.saving || session.saveError != nil))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                if !isNoteEditor {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(action: continueReading) {
                            Text("继续读").font(.body).frame(minHeight: 44).contentShape(Rectangle())
                        }
                    }
                }
            }
        }
        .environment(\.readerContinueReading, continueReading)
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
        .presentationBackground(Color(uiColor: .systemBackground))
    }
    private func continueReading() {
        if panel.isCompanion { dismiss() }
        else { Task { let receipt = await session.flush(); if session.isCurrent(receipt) { dismiss() } } }
    }
}
struct ReaderBookInformationPanel: View {
    let book: LocalBook
    private var sourceFormat: String {
        let format = book.cloud?.sourceFormat.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return (format.isEmpty ? book.kind.rawValue : format).uppercased()
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("书名").font(.headline)
                    Button { UIPasteboard.general.string = book.title } label: {
                        Label("复制完整书名", systemImage: "doc.on.doc").font(.body)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(Color.leafInk)
                        .accessibilityIdentifier("reader-copy-book-title")
                    Text(book.title).font(.title2).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("reader-book-full-title")
                }
                metadata("作者", value: book.author.isEmpty ? "未提供作者" : book.author)
                metadata("来源格式", value: sourceFormat)
                metadata(book.kind == .pdf ? "页数" : "章节数", value: "\(book.chapters.count)")
                metadata(book.cloud == nil ? "原始文件名" : "阅读副本文件名", value: book.originalFilename)
                    .accessibilityIdentifier("reader-book-original-filename")
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
                .textSelection(.enabled)
        }.accessibilityIdentifier("reader-book-information").navigationTitle("书籍信息")
    }
    private func metadata(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(value).font(.body).fixedSize(horizontal: false, vertical: true)
        }
    }
}
struct ReaderContentsPanel: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    @State private var query = ""
    private var chapters: [(offset: Int, element: BookChapter)] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return Array(session.book.chapters.enumerated()).filter { value.isEmpty || $0.element.title.localizedStandardContains(value) }
    }
    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    if session.book.kind == .epub {
                        Button {
                            guard let anchor = session.declaredReadingStart(),
                                  let index = session.book.chapters.firstIndex(where: { $0.id == anchor.chapterID }) else {
                                session.message = "这本书没有可用的正文起点，请从目录选择章节。"
                                return
                            }
                            onJump(index, anchor)
                        } label: {
                            Label("从正文开始", systemImage: "book.pages")
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }.accessibilityIdentifier("reader-start-body")
                    }
                    HStack {
                        Button { session.go(to: session.chapterIndex - 1) } label: {
                            Label(session.book.kind == .pdf ? "上一页" : "上一章", systemImage: "chevron.left")
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }.disabled(session.chapterIndex == 0)
                        Spacer()
                        Text("\(session.chapterIndex + 1) / \(session.book.chapters.count)").font(.subheadline.monospacedDigit())
                        Spacer()
                        Button { session.go(to: session.chapterIndex + 1) } label: {
                            Label(session.book.kind == .pdf ? "下一页" : "下一章", systemImage: "chevron.right")
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }.disabled(session.chapterIndex + 1 == session.book.chapters.count)
                    }.buttonStyle(.plain)
                    if session.book.chapters.count > 1 {
                        Slider(value: Binding(get: { Double(session.chapterIndex) }, set: { session.go(to: Int($0.rounded())) }), in: 0...Double(session.book.chapters.count - 1), step: 1)
                            .accessibilityLabel(session.book.kind == .pdf ? "页码" : "章节")
                    }
                } header: { Text("阅读位置") }
                if chapters.isEmpty { ContentUnavailableView.search(text: query) }
                Section(session.book.kind == .pdf ? "第 \(session.chapterIndex + 1) 页，共 \(session.book.chapters.count) 页" : "第 \(session.chapterIndex + 1) 章，共 \(session.book.chapters.count) 章") {
                    ForEach(chapters, id: \.element.id) { index, chapter in
                        Button { onJump(index, nil) } label: {
                            HStack(spacing: 14) {
                                Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(minWidth: 24, alignment: .leading)
                                Text(chapter.title).foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                                if index == session.chapterIndex { Image(systemName: "bookmark.fill").foregroundStyle(Color.leafInk).accessibilityHidden(true) }
                            }.frame(minHeight: 44)
                        }
                        .accessibilityLabel(chapter.title)
                        .accessibilityValue(index == session.chapterIndex ? "当前章节" : "")
                        .id(chapter.id)
                    }
                }
            }
            .task { await Task.yield(); proxy.scrollTo(session.chapter.id, anchor: .center) }
        }
        .searchable(text: $query, prompt: session.book.kind == .pdf ? "查找页码" : "搜索章节")
        .navigationTitle("目录")
    }
}
struct BookSearchPanel: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    @State private var query = ""
    private struct Request: Equatable, Sendable {
        let bookID: String
        let query: String
    }
    private enum Outcome {
        case matches(Request, [BookSearchResult])
        case failed(Request)
    }
    @State private var outcome: Outcome?
    private var request: Request { Request(bookID: session.book.id, query: query.trimmingCharacters(in: .whitespacesAndNewlines)) }
    var body: some View {
        let request = self.request
        List {
            if request.query.isEmpty { ContentUnavailableView("在整本书中找一句话", systemImage: "magnifyingglass", description: Text("本机检索全部已导入章节。扫描 PDF 可能没有可检索文字。")) }
            else if case let .matches(completed, results)? = outcome, completed == request {
                if results.isEmpty { ContentUnavailableView.search(text: request.query) }
                else {
                    Section {
                        ForEach(results) { result in
                            Button {
                                guard request == self.request else { return }
                                onJump(result.chapterIndex, result.anchor)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(session.book.chapters[result.chapterIndex].title).font(.caption).foregroundStyle(.secondary)
                                    (Text(result.excerpt.before) + Text(result.excerpt.match).bold() + Text(result.excerpt.after))
                                        .fixedSize(horizontal: false, vertical: true).foregroundStyle(.primary)
                                }.padding(.vertical, 6)
                            }
                        }
                    } header: { Text("找到 \(results.count) 段原文").accessibilityIdentifier("book-search-count") }
                }
            }
            else if case let .failed(completed)? = outcome, completed == request {
                ContentUnavailableView("暂时无法搜索", systemImage: "magnifyingglass", description: Text("请调整关键词后重试。"))
            } else { ProgressView("正在查找原文…") }
        }.searchable(text: $query, prompt: "搜索原文").navigationTitle("书内搜索")
            .task(id: request) { await load(request) }
    }
    @MainActor private func load(_ requested: Request) async {
        guard !Task.isCancelled, requested == request else { return }
        guard !requested.query.isEmpty else { outcome = nil; return }
        do {
            try await Task.sleep(for: .milliseconds(150))
            let results = try await BookSearch.matches(in: session.book.chapters, query: requested.query, markdown: session.book.rendersMarkdown)
            try Task.checkCancellation()
            guard requested == request else { return }
            outcome = .matches(requested, results)
        } catch is CancellationError {
            // Typing another query or dismissing the panel normally cancels this request.
        } catch {
            guard !Task.isCancelled, requested == request else { return }
            outcome = .failed(requested)
        }
    }
}
struct ReaderPreferencesPanel: View {
    @Bindable var session: ReaderSession
    private var defaults: ReaderPreferences { ReaderPreferences() }
    private var preview: String? {
        let passages = session.chapter.passages
        let current = passages.first { $0.id == session.currentAnchor?.passageID && !$0.heading && $0.resourcePath == nil && !$0.text.isEmpty }
        return (current ?? passages.first { !$0.heading && $0.resourcePath == nil && !$0.text.isEmpty }).map { String($0.text.prefix(120)) }
    }
    private var usesDefaultTypography: Bool {
        session.state.preferences.fontSize == defaults.fontSize && session.state.preferences.lineSpacing == defaults.lineSpacing
    }
    private func binding<T>(_ path: WritableKeyPath<ReaderPreferences, T>) -> Binding<T> {
        Binding(get: { session.state.preferences[keyPath: path] }, set: { value in var preferences = session.state.preferences; preferences[keyPath: path] = value; session.changePreferences(preferences) })
    }
    var body: some View {
        Form {
            Section {
                Picker("翻页方式", selection: binding(\.navigationMode)) {
                    Text("上下滚动").tag(ReaderNavigationMode.scroll)
                    Text("左右翻页").tag(ReaderNavigationMode.paged)
                }.pickerStyle(.segmented).accessibilityIdentifier("reader-navigation-mode")
            } header: { Text("阅读方式").foregroundStyle(Color.primary) } footer: {
                Text(session.state.preferences.navigationMode == .paged ? "向左滑动下一页，向右滑动上一页。轻点书页显示阅读工具。" : "上下滑动继续阅读，轻点书页显示阅读工具。")
            }
            if session.book.kind == .pdf {
                Section {
                    Label("PDF 保留原来的字体与排版，可在书页上双指缩放。", systemImage: "doc.richtext")
                        .font(.subheadline)
                } header: { Text("原页排版").foregroundStyle(Color.primary) }
            } else {
                if let preview {
                    Section {
                        TypographyPreview(text: preview, fontSize: session.state.preferences.fontSize, lineSpacing: session.state.preferences.lineSpacing)
                            .listRowBackground(session.state.preferences.theme == "paper" ? Color.readingPaper : Color(uiColor: .systemBackground))
                    } header: { Text("排版预览 · 原文片段").foregroundStyle(Color.primary) }
                }
                Section {
                    LabeledContent {
                        Text("\(Int(session.state.preferences.fontSize)) pt").foregroundStyle(Color.primary).monospacedDigit()
                    } label: { Text("字号").font(.body).fixedSize(horizontal: false, vertical: true) }
                    Slider(value: binding(\.fontSize), in: 16...36, step: 1)
                        .accessibilityLabel("正文字号")
                        .accessibilityValue("\(Int(session.state.preferences.fontSize)) 磅")
                    LabeledContent {
                        Text("\(Int(session.state.preferences.lineSpacing)) pt").foregroundStyle(Color.primary).monospacedDigit()
                    } label: { Text("行间距").font(.body).fixedSize(horizontal: false, vertical: true) }
                    Slider(value: binding(\.lineSpacing), in: 4...18, step: 1)
                        .accessibilityLabel("正文行间距")
                        .accessibilityValue("\(Int(session.state.preferences.lineSpacing)) 磅")
                    if usesDefaultTypography {
                        Label("当前为默认排版", systemImage: "checkmark").font(.body).foregroundStyle(Color.primary)
                    } else {
                        Button {
                            var preferences = session.state.preferences
                            preferences.fontSize = defaults.fontSize
                            preferences.lineSpacing = defaults.lineSpacing
                            session.changePreferences(preferences)
                        } label: { Text("恢复默认排版").font(.body).fixedSize(horizontal: false, vertical: true).frame(minHeight: 44) }
                    }
                } header: { Text("正文").foregroundStyle(Color.primary) } footer: {
                    Text("字号随系统大字设置继续缩放。更改会自动保存到此设备。")
                        .font(.subheadline).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Section {
                Picker("主题", selection: binding(\.theme)) { Text("清纸").tag("paper"); Text("夜读").tag("night"); Text("跟随系统").tag("system") }.pickerStyle(.segmented)
            } header: { Text("阅读纸面").foregroundStyle(Color.primary) }
            Section {
                Text("从阅读工具的“翻译”查看当前段的直译、意译和原文。切换排版不生成内容；未翻译的段落保留原文。")
                    .font(.subheadline).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
            } header: { Text("原文与译文").foregroundStyle(Color.primary) }
        }.accessibilityIdentifier("reader-preferences-form").navigationTitle("阅读设置")
    }

    struct TypographyPreview: View {
        let text: String
        let fontSize: Double
        let lineSpacing: Double
        @ScaledMetric(relativeTo: .body) private var typeScale = 1.0
        private var font: Font {
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                // Scale the semantic body font so both Dynamic Type and the
                // reader's chosen base size remain part of font resolution.
                return .system(.body, design: .serif).scaled(by: CGFloat(fontSize) / 17)
            }
            #endif
            return .system(size: fontSize * typeScale, design: .serif)
        }
        var body: some View {
            Text(text).font(font).foregroundStyle(Color.primary).lineSpacing(lineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .accessibilityIdentifier("reading-type-preview")
        }
    }
}
struct ReaderAppearancePanel: View {
    @Bindable var session: ReaderSession
    var body: some View {
        Form {
            Section {
                ForEach([("paper", "清纸", "sun.max"), ("night", "夜读", "moon"), ("system", "跟随系统", "circle.lefthalf.filled")], id: \.0) { value, title, symbol in
                    Button {
                        var preferences = session.state.preferences
                        preferences.theme = value
                        session.changePreferences(preferences)
                    } label: {
                        HStack {
                            Label(title, systemImage: symbol)
                            Spacer()
                            if session.state.preferences.theme == value { Image(systemName: "checkmark").accessibilityHidden(true) }
                        }.frame(minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).foregroundStyle(Color.primary)
                        .accessibilityAddTraits(session.state.preferences.theme == value ? .isSelected : [])
                }
            } header: { Text("阅读纸面") } footer: { Text("仅调整这本书的阅读外观。屏幕亮度可在系统控制中心调整。") }
        }.navigationTitle("外观").accessibilityIdentifier("reader-appearance-form")
    }
}
struct ReaderRecordsPanel: View {
    @Bindable var session: ReaderSession
    let onJump: (Int, ReadingAnchor?) -> Void
    @State private var editing: SelectedQuote?
    var body: some View {
        List {
            if session.state.notes.isEmpty && session.state.drafts.isEmpty {
                ContentUnavailableView("留下自己的想法", systemImage: "square.and.pencil", description: Text("长按原文选字，再选择“记笔记”。草稿自动保存在本机。"))
            }
            if !session.state.drafts.isEmpty {
                Section("未完成草稿") {
                    ForEach(session.state.drafts.values.sorted { $0.anchor.key < $1.anchor.key }, id: \.anchor.key) { draft in
                        Button { editing = SelectedQuote(anchor: draft.anchor, text: draft.quote) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(location(draft.anchor)).font(.caption).foregroundStyle(.secondary)
                                Text(draft.body.isEmpty ? "尚未写完" : draft.body).foregroundStyle(.primary).lineLimit(3)
                                Text("原文 · " + draft.quote).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                            }.padding(.vertical, 6)
                        }
                    }
                }
            }
            if !session.state.notes.isEmpty { Section {
                ForEach(session.state.notes.reversed()) { note in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(location(note.anchor)).font(.caption).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
                        Text(note.body).textSelection(.enabled)
                        Text("原文 · " + note.quote).font(.footnote).foregroundStyle(Color.primary).lineLimit(3)
                        Text(note.modifiedAt, format: .dateTime.year().month().day().hour().minute())
                            .font(.subheadline).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("修改于 \(note.modifiedAt.formatted(date: .abbreviated, time: .shortened))")
                        Button {
                            if let index = session.book.chapters.firstIndex(where: { $0.id == note.anchor.chapterID }) { onJump(index, note.anchor) }
                        } label: {
                            Label {
                                Text("回到原句").font(.body).fixedSize(horizontal: false, vertical: true)
                            } icon: { Image(systemName: "arrow.uturn.backward") }
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }.buttonStyle(.borderless)
                    }.padding(.vertical, 6)
                }
            } header: { Text("我的笔记").foregroundStyle(Color.primary) } }
        }.accessibilityIdentifier("reader-records-list").navigationTitle("我的记录")
            .sheet(item: $editing) { quote in
                NavigationStack { NoteEditorPanel(quote: quote, session: session) }
                    .presentationDetents([.large])
                    .presentationBackground(Color(uiColor: .systemBackground))
            }
    }
    private func location(_ anchor: ReadingAnchor) -> String {
        guard let chapter = session.book.chapters.first(where: { $0.id == anchor.chapterID }) else { return "原文位置暂不可用" }
        guard let index = chapter.passages.firstIndex(where: { $0.id == anchor.passageID }) else { return chapter.title }
        return chapter.title + " · 第 \(index + 1) 段"
    }
}
struct NoteEditorPanel: View {
    let quote: SelectedQuote
    @Bindable var session: ReaderSession
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var didLoad = false
    @State private var submissionID = UUID()
    @State private var showingQuote = false
    @FocusState private var editorFocused: Bool
    private enum PendingAction { case note, draft }
    @State private var pendingAction: PendingAction?
    private var noteIsPersisted: Bool { session.isNotePersisted(id: submissionID, body: text) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DisclosureGroup("作者原文", isExpanded: $showingQuote) {
                ScrollView { Text(quote.text).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 120)
            }.font(.caption).foregroundStyle(.secondary)
            if !showingQuote { Text(quote.text).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
            Divider()
            Text("我的笔记").font(.caption).foregroundStyle(Color.leafInk)
            TextEditor(text: Binding(get: { text }, set: { text = $0; session.draft(quote, text: $0) }))
                .scrollContentBackground(.hidden).scrollDismissesKeyboard(.interactively)
                .focused($editorFocused).accessibilityLabel("我的笔记正文").disabled(pendingAction != nil)
            Text(footer).font(.caption).foregroundStyle(.secondary)
        }.padding(22).navigationTitle("记下自己的想法").navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(pendingAction != nil || session.saving || session.saveError != nil)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("保存笔记") { submit(.note) }.disabled(pendingAction != nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                ToolbarItem(placement: .cancellationAction) { Button(noteIsPersisted ? "关闭" : "保留草稿") { submit(.draft) }.disabled(pendingAction != nil) }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { editorFocused = false }.accessibilityLabel("收起笔记键盘") }
            }
            .onAppear { session.noteEditorID = submissionID; if !didLoad { text = session.state.drafts[quote.anchor.key]?.body ?? ""; didLoad = true } }
            .task { await Task.yield(); editorFocused = true }
            .onDisappear { if session.noteEditorID == submissionID { session.noteEditorID = nil } }
    }
    private var footer: String {
        if case .note? = pendingAction { return "正在保存笔记…" }
        if session.saveError != nil { return "本次更改尚未全部保存，请保留此页并重试。" }
        if session.saving || pendingAction != nil { return "正在保存本机草稿…" }
        return noteIsPersisted ? "笔记已保存在此设备。" : "草稿保存在此设备，关闭后可从“我的记录”找回"
    }
    private func submit(_ action: PendingAction) {
        guard pendingAction == nil else { return }
        editorFocused = false
        pendingAction = action
        Task {
            let submitted: Bool
            switch action {
            case .note: submitted = await session.saveNote(quote, text: text, id: submissionID)
            case .draft:
                session.keepNoteDraft(quote, text: text, submissionID: submissionID)
                submitted = true
            }
            let receipt = await session.flush()
            pendingAction = nil
            if submitted && session.isCurrent(receipt) { dismiss() }
        }
    }
}
