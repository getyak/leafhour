import SwiftUI
import LeafhourCore

struct ReaderPanelView: View {
    let panel: ReaderPanel
    @Bindable var session: ReaderSession
    let systemColorScheme: ColorScheme
    let onJump: (Int, ReadingAnchor?) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Group {
                switch panel {
                case .contents:
                    List(Array(session.book.chapters.enumerated()), id: \.element.id) { index, chapter in
                        Button { onJump(index, nil) } label: {
                            HStack { Text(chapter.title).foregroundStyle(.primary); Spacer(); if index == session.chapterIndex { Image(systemName: "bookmark.fill").foregroundStyle(Color.leafInk) } }.frame(minHeight: 44)
                        }
                    }.navigationTitle("目录")
                case .search: BookSearchPanel(session: session, onJump: onJump)
                case .preferences: ReaderPreferencesPanel(session: session)
                case .records: ReaderRecordsPanel(session: session, onJump: onJump)
                case .note(let quote): NoteEditorPanel(quote: quote, session: session)
                case .source(let quote):
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            Text("作者原文").font(.caption).foregroundStyle(.secondary)
                            Text(quote.text).font(.title3).textSelection(.enabled)
                            Text("\(session.book.title) · \(session.book.chapters.first { $0.id == quote.anchor.chapterID }?.title ?? "")").font(.footnote).foregroundStyle(.secondary)
                            Divider()
                            Text("此导入未附直译或意译。保留原文，没有生成替代译文。").font(.subheadline).foregroundStyle(.secondary)
                        }.padding(24)
                    }.navigationTitle("核对原文")
                }
            }
            .interactiveDismissDisabled(session.saving || session.saveError != nil)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("继续读") { Task { await session.flush(); if session.saveError == nil { dismiss() } } } } }
        }
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
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
            let results = try await BookSearch.matches(in: session.book.chapters, query: requested.query)
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
    @ScaledMetric(relativeTo: .body) private var typeScale = 1.0
    private var defaults: ReaderPreferences { ReaderPreferences() }
    private var preview: String? {
        let passages = session.chapter.passages
        let current = passages.first { $0.id == session.state.anchor?.passageID && !$0.heading && $0.resourcePath == nil && !$0.text.isEmpty }
        return (current ?? passages.first { !$0.heading && $0.resourcePath == nil && !$0.text.isEmpty }).map { String($0.text.prefix(600)) }
    }
    private var usesDefaultTypography: Bool {
        session.state.preferences.fontSize == defaults.fontSize && session.state.preferences.lineSpacing == defaults.lineSpacing
    }
    private func binding<T>(_ path: WritableKeyPath<ReaderPreferences, T>) -> Binding<T> {
        Binding(get: { session.state.preferences[keyPath: path] }, set: { value in var preferences = session.state.preferences; preferences[keyPath: path] = value; session.changePreferences(preferences) })
    }
    var body: some View {
        Form {
            if session.book.kind == .pdf {
                Section("原页排版") {
                    Label("PDF 保留原来的字体与排版，可在书页上双指缩放。", systemImage: "doc.richtext")
                        .font(.subheadline)
                }
            } else {
                if let preview {
                    Section {
                        Text(preview)
                            .font(.system(size: session.state.preferences.fontSize * typeScale, design: .serif))
                            .lineSpacing(session.state.preferences.lineSpacing)
                            .lineLimit(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: 140 * typeScale, alignment: .topLeading)
                            .padding(.vertical, 8)
                            .accessibilityIdentifier("reading-type-preview")
                            .listRowBackground(session.state.preferences.theme == "paper" ? Color.readingPaper : Color(uiColor: .systemBackground))
                    } header: { Text("排版预览 · 当前原文") }
                }
                Section {
                    LabeledContent("字号", value: "\(Int(session.state.preferences.fontSize)) pt").monospacedDigit()
                    Slider(value: binding(\.fontSize), in: 16...36, step: 1)
                        .accessibilityLabel("正文字号")
                        .accessibilityValue("\(Int(session.state.preferences.fontSize)) 磅")
                    LabeledContent("行间距", value: "\(Int(session.state.preferences.lineSpacing)) pt").monospacedDigit()
                    Slider(value: binding(\.lineSpacing), in: 4...18, step: 1)
                        .accessibilityLabel("正文行间距")
                        .accessibilityValue("\(Int(session.state.preferences.lineSpacing)) 磅")
                    Button("恢复默认排版") {
                        var preferences = session.state.preferences
                        preferences.fontSize = defaults.fontSize
                        preferences.lineSpacing = defaults.lineSpacing
                        session.changePreferences(preferences)
                    }.disabled(usesDefaultTypography)
                } header: { Text("正文") } footer: { Text("字号随系统大字设置继续缩放。更改会自动保存到此设备。") }
            }
            Section("阅读纸面") {
                Picker("主题", selection: binding(\.theme)) { Text("清纸").tag("paper"); Text("夜读").tag("night"); Text("跟随系统").tag("system") }.pickerStyle(.segmented)
            }
            Section("原文与译文") { Text("此书由本机文件导入。未附直译、意译或缓存讲解，不会在切换排版时调用模型。").font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("阅读设置")
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
                            VStack(alignment: .leading, spacing: 8) { Text(draft.body.isEmpty ? "尚未写完" : draft.body).foregroundStyle(.primary).lineLimit(3); Text("原文 · " + draft.quote).font(.footnote).foregroundStyle(.secondary).lineLimit(2) }.padding(.vertical, 6)
                        }
                    }
                }
            }
            Section("我的笔记") {
                ForEach(session.state.notes.reversed()) { note in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(note.body).textSelection(.enabled)
                        Text("原文 · " + note.quote).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                        Button("回到原句", systemImage: "arrow.uturn.backward") {
                            if let index = session.book.chapters.firstIndex(where: { $0.id == note.anchor.chapterID }) { onJump(index, note.anchor) }
                        }.font(.footnote)
                    }.padding(.vertical, 6)
                }
            }
        }.navigationTitle("我的记录")
            .sheet(item: $editing) { quote in NavigationStack { NoteEditorPanel(quote: quote, session: session) }.presentationDetents([.medium, .large]) }
    }
}
struct NoteEditorPanel: View {
    let quote: SelectedQuote
    @Bindable var session: ReaderSession
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var didLoad = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("作者原文").font(.caption).foregroundStyle(.secondary)
            Text(quote.text).font(.subheadline).foregroundStyle(.secondary).lineLimit(4).textSelection(.enabled)
            Divider()
            Text("我的笔记").font(.caption).foregroundStyle(Color.leafInk)
            TextEditor(text: Binding(get: { text }, set: { text = $0; session.draft(quote, text: $0) })).scrollContentBackground(.hidden).accessibilityLabel("我的笔记正文")
            Text(session.saveError != nil ? "记录尚未写入本机，请保留此页并重试保存。" : (session.saving ? "正在保存本机草稿…" : "草稿保存在此设备，关闭后可从“我的记录”找回")).font(.caption).foregroundStyle(.secondary)
        }.padding(22).navigationTitle("记下自己的想法")
            .interactiveDismissDisabled(session.saving || session.saveError != nil)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("保存笔记") { session.saveNote(quote, text: text); Task { await session.flush(); if session.saveError == nil { dismiss() } } }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                ToolbarItem(placement: .cancellationAction) { Button("保留草稿") { Task { await session.flush(); if session.saveError == nil { dismiss() } } } }
            }
            .onAppear { if !didLoad { text = session.state.drafts[quote.anchor.key]?.body ?? ""; didLoad = true } }
    }
}
