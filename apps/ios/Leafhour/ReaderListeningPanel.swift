import SwiftUI
import LeafhourCore

struct ReaderListeningPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @State private var settings = false
    @State private var appearance = false
    @State private var followsTranscript = true
    @State private var controlsVisible = true
    @State private var activity = UUID()
    @State private var selectedLines: Set<String> = []
    @State private var rows: [ReaderListeningPassage] = []
    @State private var browsingChapterID: String?
    private var paper: Color { Color(uiColor: session.state.preferences.paperColor) }
    private var hasPlayback: Bool { speech.playing || speech.paused }
    private var chapter: BookChapter {
        session.book.chapters.first { $0.id == (browsingChapterID ?? (hasPlayback ? speech.chapterID : nil)) } ?? session.chapter
    }
    private var chapterIndex: Int { session.book.chapters.firstIndex { $0.id == chapter.id } ?? session.chapterIndex }
    private var projectionKey: String {
        "\(chapter.id):\(session.contentRevision):\(session.state.preferences.viewMode.rawValue):\(session.state.preferences.translationVariant.rawValue):\(hasPlayback ? speech.requestedLayer : "idle")"
    }
    private var activeID: String? {
        guard hasPlayback, let row = rows.first(where: { $0.id == speech.passageID }),
              row.content.sentence(at: speech.displayOffset) != nil else { return nil }
        return row.id
    }
    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height && !typeSize.isAccessibilitySize
            ZStack {
                paper.ignoresSafeArea()
                transcript.padding(.horizontal, landscape ? 56 : 24)
                if controlsVisible {
                    VStack {
                        Spacer()
                        ScrollView {
                            VStack(spacing: 12) { transport; navigation }
                                .padding(14).frame(maxWidth: 680)
                                .background(paper.opacity(0.94), in: RoundedRectangle(cornerRadius: 20))
                        }.fixedSize(horizontal: false, vertical: true).frame(maxHeight: geometry.size.height * 0.55)
                    }.padding(.horizontal, 16).padding(.bottom, 8)
                } else {
                    VStack { Spacer(); HStack { Spacer(); Button { wake() } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle()) }
                        .buttonStyle(.plain).accessibilityLabel("显示听书控制").background(paper.opacity(0.94), in: Circle()).foregroundStyle(.secondary)
                        .accessibilityIdentifier("reader-listening-reveal") }.padding(.trailing, 16) }
                }
            }.accessibilityElement(children: .contain)
                .accessibilityIdentifier(landscape ? "reader-listening-landscape" : "reader-listening-portrait")
        }
        .navigationTitle("听书").navigationBarTitleDisplayMode(.inline)
        .toolbar(controlsVisible ? .visible : .hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("声音与语速", systemImage: "slider.horizontal.3") { wake(); settings = true }
                    .accessibilityIdentifier("reader-listening-settings")
            }
        }
        .sheet(isPresented: $settings) { settingsPanel }
        .sheet(isPresented: $appearance) {
            NavigationStack {
                ReaderPreferencesPanel(session: session)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { appearance = false } } }
            }
        }
        .task(id: projectionKey) { projectChapter() }
        .task(id: "\(activity):\(speech.playing):\(settings):\(appearance):\(selectedLines.isEmpty):\(followsTranscript):\(voiceOver):\(speech.boosting)") {
            guard speech.playing, !settings, !appearance, selectedLines.isEmpty, followsTranscript, !voiceOver, !speech.boosting else { return }
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { controlsVisible = false }
        }
        .onChange(of: speech.playing) { _, playing in if !playing { wake() } }
        .onChange(of: voiceOver, initial: true) { _, enabled in
            if enabled { browsingChapterID = chapter.id; followsTranscript = false; wake() }
        }
        .onChange(of: speech.voiceID) { _, _ in speech.restartVoice() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { speech.endSpeedBoost() } }
        .onDisappear { speech.endSpeedBoost() }
    }
    private func wake() { controlsVisible = true; activity = UUID() }
    private func projectChapter() {
        let chapter = chapter, preferences = session.state.preferences
        let usesMarkdown = session.book.rendersMarkdown && (preferences.viewMode == .source || !chapter.passages.contains { session.translations[$0.id]?.text(preferences.translationVariant) != nil })
        let markdown = usesMarkdown ? MarkdownChapterLayout(book: session.book, chapter: chapter, original: session.original) : nil
        let variant: ReaderTranslationVariant? = hasPlayback ? ReaderTranslationVariant(rawValue: speech.requestedLayer) : preferences.viewMode == .translation ? preferences.translationVariant : nil
        rows = chapter.passages.enumerated().compactMap { index, passage in
            guard passage.resourcePath == nil, !passage.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return ReaderListeningPassage(chapterID: chapter.id, passage: passage, variant: variant, translation: session.translations[passage.id], comparisonVariant: preferences.translationVariant, markdown: markdown, passageIndex: index)
        }
    }
    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 32) {
                    VStack(alignment: .leading, spacing: 8) {
                        if chapter.title != session.book.title { Text(session.book.title).font(.caption).foregroundStyle(.secondary) }
                        Text(chapter.title).font(.title3.weight(.medium))
                        Text("轻点一句，从这里听 · 长按选择文字").font(.caption).foregroundStyle(.secondary)
                    }.padding(.top, 30)
                    if rows.isEmpty { ContentUnavailableView("此处暂无可朗读文字", systemImage: "text.magnifyingglass", description: Text("扫描页可返回书页继续阅读。")) }
                    ForEach(rows) { row in
                        ReaderListeningParagraph(row: row, preferences: session.state.preferences,
                            wordRange: row.id == speech.passageID && hasPlayback ? speech.spokenWordRange : nil,
                            activeSentence: row.id == speech.passageID && hasPlayback ? speech.displayOffset : nil,
                            follows: followsTranscript && selectedLines.isEmpty && !voiceOver,
                            onSeek: { offset in
                                guard selectedLines.isEmpty else { return }
                                if speech.seek(session, to: row.content.location(at: offset)) { browsingChapterID = nil; followsTranscript = true }; wake()
                            }, onSelection: { id, selected in
                                if selected { browsingChapterID = chapter.id; selectedLines.insert(id); followsTranscript = false; wake() }
                                else { selectedLines.remove(id) }
                            })
                    }
                    chapterNavigation.padding(.bottom, 260)
                }.frame(maxWidth: 680).frame(maxWidth: .infinity, alignment: .center)
            }.scrollIndicators(.hidden)
                .accessibilityIdentifier("reader-listening-transcript")
                .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { _ in browsingChapterID = chapter.id; followsTranscript = false; wake() })
                .onChange(of: rows.first?.id) { _, _ in
                    guard selectedLines.isEmpty, !voiceOver else { return }
                    if let activeID, followsTranscript { follow(proxy, activeID) }
                    else if let first = rows.first { proxy.scrollTo(first.id, anchor: .top) }
                }
                .overlay(alignment: .topTrailing) {
                    if !followsTranscript, hasPlayback, selectedLines.isEmpty {
                        Button("回到朗读", systemImage: "arrow.down.to.line") {
                            browsingChapterID = nil; followsTranscript = true; wake(); if let activeID { follow(proxy, activeID) }
                        }.font(.caption).padding(12).modifier(ReaderGlassSurface(paper: paper))
                    }
                }
        }
    }
    private func follow(_ proxy: ScrollViewProxy, _ id: String) {
        // Materialize an offscreen paragraph first; its native text rect then
        // follows the actual spoken sentence without competing scroll animations.
        proxy.scrollTo(id, anchor: .top)
    }
    private var chapterNavigation: some View {
        HStack {
            Button { changeChapter(chapterIndex - 1) } label: { Label("上一章", systemImage: "chevron.left").frame(minHeight: 44).contentShape(Rectangle()) }.disabled(chapterIndex == 0)
            Spacer()
            Button { changeChapter(chapterIndex + 1) } label: { Label("下一章", systemImage: "chevron.right").frame(minHeight: 44).contentShape(Rectangle()) }.disabled(chapterIndex + 1 >= session.book.chapters.count)
        }.font(.subheadline).frame(minHeight: 44)
    }
    private func changeChapter(_ index: Int) {
        guard session.book.chapters.indices.contains(index), selectedLines.isEmpty else { return }
        browsingChapterID = session.book.chapters[index].id; followsTranscript = false; wake()
    }
    private var navigation: some View {
        HStack {
            Button { speech.pause(); dismiss() } label: { Label("阅读", systemImage: "book").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }.accessibilityIdentifier("reader-listening-read")
            Spacer()
            Menu {
                ForEach(Array(session.book.chapters.enumerated()), id: \.element.id) { index, chapter in
                    Button(chapter.title) { changeChapter(index) }
                }
            } label: { Label("目录", systemImage: "list.bullet").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
            Spacer()
            Button {
                var prefs = session.state.preferences; prefs.listeningShowsComparison.toggle(); session.changePreferences(prefs); wake()
            } label: { Label("对照", systemImage: "text.alignleft").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                .accessibilityValue(session.state.preferences.listeningShowsComparison ? "开启" : "关闭").accessibilityIdentifier("reader-listening-comparison-toggle")
            Spacer()
            Button { wake(); appearance = true } label: { Label("排版", systemImage: "textformat").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
        }.font(.caption).buttonStyle(.plain).frame(minHeight: 44)
    }
    private var transport: some View {
        VStack(spacing: 6) {
            HStack {
                Text(hasPlayback ? "\(speech.layerTitle) · 第 \(speech.position + 1) / \(speech.count) 段" : "从当前句开始 · 系统朗读")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button { controlsVisible = false } label: { Image(systemName: "chevron.down").frame(width: 44, height: 44).contentShape(Rectangle()) }.accessibilityLabel("收起").accessibilityIdentifier("reader-listening-hide")
            }
            HStack(spacing: 12) {
                Button { speech.move(-1); wake() } label: { Image(systemName: "backward.end.fill").frame(width: 44, height: 44) }
                    .accessibilityLabel("上一段").disabled(!hasPlayback || !speech.canPrevious)
                Button {
                    if !hasPlayback, let browsingChapterID, let row = rows.first, row.content.chapterID == browsingChapterID { _ = speech.seek(session, to: row.content.location(at: 0)) }
                    else { speech.toggle(session) }; wake()
                } label: { Image(systemName: speech.playing ? "pause.fill" : "play.fill").font(.title2).frame(width: 52, height: 48) }
                    .accessibilityLabel(speech.playing ? "暂停朗读" : speech.paused ? "继续朗读" : "从当前句开始朗读").accessibilityIdentifier("reader-speech-play")
                Button { speech.move(1); wake() } label: { Image(systemName: "forward.end.fill").frame(width: 44, height: 44) }
                    .accessibilityLabel("下一段").disabled(!hasPlayback || !speech.canNext)
                Spacer(minLength: 0)
                ReaderListeningBoostButton(speech: speech, onSettings: { wake(); settings = true })
            }.buttonStyle(.plain)
            if let message = speech.message { Text(message).font(.caption).foregroundStyle(.secondary) }
        }
    }
    private var settingsPanel: some View {
        NavigationStack {
            Form {
                Section("声音与语速") {
                    ReaderSpeechSpeedControl(session: session, speech: speech)
                    Picker("朗读声音", selection: $speech.voiceID) {
                        Text("自动匹配原文语言").tag("")
                        ForEach(speech.voices, id: \.identifier) { voice in Text("\(voice.name) · \(voice.language)").tag(voice.identifier) }
                    }
                    Text("播放时长按倍速，逐步加速；松开恢复原速。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("对照与跟随") {
                    Toggle("显示段落对照", isOn: Binding(get: { session.state.preferences.listeningShowsComparison }, set: { value in
                        var prefs = session.state.preferences; prefs.listeningShowsComparison = value; session.changePreferences(prefs)
                    }))
                    Text("沿用阅读页的译法；对照开关只改变显示，不切换朗读语言。字体、字号、行距与纸面和阅读共用。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("逐句跟随", isOn: $followsTranscript)
                    Button("从当前书页重新开始", systemImage: "play.circle") { browsingChapterID = nil; speech.start(session, useSavedPosition: false); settings = false }
                        .accessibilityIdentifier("reader-speech-start-here")
                    if hasPlayback { Button("结束听书", systemImage: "stop.fill") { speech.stop(); settings = false } }
                }
                Section { Text("使用此设备的系统声音，不上传正文、不使用阅读点。后台会暂停，返回后由你继续。离线可用性取决于已安装的声音。听书不计入阅读时长。")
                    .font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle("声音与语速")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { settings = false; wake() } } }
        }.presentationDetents([.medium, .large])
    }
}

private struct ReaderListeningParagraph: View {
    let row: ReaderListeningPassage
    let preferences: ReaderPreferences
    let wordRange: NSRange?
    let activeSentence: Int?
    let follows: Bool
    let onSeek: (Int) -> Void
    let onSelection: (String, Bool) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ReaderListeningText(text: row.content.text, preferences: preferences, wordRange: wordRange,
                active: activeSentence != nil, sentenceRange: activeSentence.flatMap { row.content.sentence(at: $0) }, follows: follows,
                onSeek: onSeek, onSelection: { onSelection(row.id, $0) }).id(row.id)
            if preferences.listeningShowsComparison {
                if let comparison = row.comparison {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(row.comparisonLabel).font(.caption2).foregroundStyle(.secondary)
                        ReaderListeningText(text: comparison, preferences: preferences, secondary: true, onSelection: { onSelection(row.id + ":comparison", $0) })
                    }.padding(.leading, 12).overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.25)).frame(width: 1) }
                } else if !row.content.text.isEmpty {
                    Text("此段暂无所选译文").font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("reader-listening-missing-comparison")
                }
            }
        }
    }
}
