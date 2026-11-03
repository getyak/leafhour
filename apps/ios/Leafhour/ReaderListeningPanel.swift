import SwiftUI
import LeafhourCore

private enum ListeningSheet: String, Identifiable {
    case settings, contents, appearance, typography, comparison
    var id: String { rawValue }
}

/// The original player structure: identity, sentence stage, comparison, transport.
/// The shared functional bar is independent of the selectable text surface.
struct ReaderListeningPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: ListeningSheet?
    @State private var followsTranscript = true
    @State private var browsedAway = false
    @State private var controlsVisible = true
    @State private var controlsFocused = false
    @State private var activity = UUID()
    @State private var selectedLines: Set<String> = []
    @State private var rows: [ReaderListeningPassage] = []
    @State private var browsingChapterID: String?
    @State private var visiblePassageID: String?
    @State private var comparisonPassageID: String?
    @State private var requestedScrollID: String?
    @State private var chosenStartAnchor: ReadingAnchor?
    @State private var expandedComparison: (label: String, text: String)?
    @State private var followRevision = UUID()
    @State private var selectionDismissalID = UUID()
    private var paper: Color { Color(uiColor: session.state.preferences.paperColor) }
    private var hasPlayback: Bool { speech.playing || speech.paused }
    private var chapter: BookChapter {
        session.book.chapters.first { $0.id == (browsingChapterID ?? (hasPlayback ? speech.chapterID : idleResumePosition?.chapterID)) } ?? session.chapter
    }
    private var chapterIndex: Int { session.book.chapters.firstIndex { $0.id == chapter.id } ?? session.chapterIndex }
    private var projectionKey: String {
        "\(chapter.id):\(session.contentRevision):\(session.state.preferences.viewMode.rawValue):\(session.state.preferences.translationVariant.rawValue):\(hasPlayback ? speech.requestedLayer : "idle")"
    }
    private var idleResumePosition: ReaderListeningPosition? {
        guard !hasPlayback, browsingChapterID == nil, speech.hasResumePosition(session) else { return nil }
        return session.state.listeningPosition
    }
    private var activeID: String? { hasPlayback ? rows.first { $0.id == speech.passageID }?.id : nil }
    private var focusID: String? {
        if hasPlayback { return activeID }
        let candidate = chosenStartAnchor?.passageID ?? idleResumePosition?.passageID
            ?? (browsingChapterID == nil ? session.currentAnchor?.passageID : nil)
        return rows.first(where: { $0.id == candidate })?.id ?? rows.first?.id
    }
    private func idleOffset(_ row: ReaderListeningPassage) -> Int {
        if let saved = idleResumePosition, saved.passageID == row.id { return row.content.spokenOffset(at: saved.utf16Offset) }
        let anchor = chosenStartAnchor ?? (browsingChapterID == nil ? session.currentAnchor : nil)
        guard row.content.layer == "original", let anchor, anchor.passageID == row.id else { return 0 }
        return row.content.spokenOffset(at: SourceTextOffsets(row.content.source).utf16Offset(forScalarOffset: anchor.characterOffset))
    }
    private var comparisonRow: ReaderListeningPassage? {
        let id = comparisonPassageID ?? focusID ?? visiblePassageID ?? session.currentAnchor?.passageID
        return rows.first { $0.id == id } ?? rows.first
    }
    private var hasComparison: Bool { comparisonRow?.comparison != nil }
    private var canLocate: Bool { hasPlayback && (browsedAway || !selectedLines.isEmpty) }
    private func chapterTarget(_ delta: Int) -> String? {
        guard delta == -1 || delta == 1 else { return nil }
        if hasPlayback { return speech.chapterID(adjacentTo: chapter.id, delta: delta) }
        var index = chapterIndex + delta
        while session.book.chapters.indices.contains(index) {
            let candidate = session.book.chapters[index]
            if candidate.passages.contains(where: { $0.resourcePath == nil && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { return candidate.id }
            index += delta
        }
        return nil
    }
    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            ZStack {
                paper.ignoresSafeArea()
                if landscape {
                    HStack(alignment: .top, spacing: 24) {
                        ScrollView {
                            VStack(spacing: 12) {
                                identity
                                if controlsVisible { transport; commonBar } else { reveal }
                            }.padding(.vertical, 10)
                        }.frame(width: min(typeSize.isAccessibilitySize ? 340 : 280, geometry.size.width * (typeSize.isAccessibilitySize ? 0.44 : 0.36)))
                        VStack(spacing: 0) {
                            transcript
                            comparison(maxHeight: min(125, geometry.size.height * 0.34))
                        }
                    }.padding(.horizontal, 24)
                } else if typeSize.isAccessibilitySize || geometry.size.height < 560 {
                    ScrollView {
                        portraitPlayer(comparisonHeight: min(140, geometry.size.height * 0.23), stageHeight: max(200, min(300, geometry.size.height * 0.4)))
                    }.simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { _ in pauseFollowing() })
                } else {
                    portraitPlayer(comparisonHeight: min(155, geometry.size.height * 0.23), stageHeight: nil)
                }
            }.accessibilityElement(children: .contain)
                .accessibilityIdentifier(landscape ? "reader-listening-landscape" : "reader-listening-portrait")
        }
        .navigationTitle("听书").navigationBarTitleDisplayMode(.inline)
        .toolbar(controlsVisible ? .visible : .hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if hasPlayback {
                    Button("结束听书", systemImage: "xmark") { speech.stop(); wake() }
                        .accessibilityIdentifier("reader-listening-stop")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button("声音与语速", systemImage: "slider.horizontal.3") { wake(); sheet = .settings }
                    .accessibilityIdentifier("reader-listening-settings")
            }
        }
        .sheet(item: $sheet) { destination in sheetContent(destination) }
        .task(id: projectionKey) { projectChapter() }
        .task(id: "\(activity):\(speech.playing):\(sheet?.id ?? ""): \(selectedLines.isEmpty):\(followsTranscript):\(voiceOver):\(speech.boosting):\(controlsFocused)") {
            guard speech.playing, sheet == nil, selectedLines.isEmpty, followsTranscript, !voiceOver, !speech.boosting, !controlsFocused else { return }
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { controlsVisible = false }
        }
        .onChange(of: controlsVisible) { _, _ in followRevision = UUID() }
        .onChange(of: speech.playing) { _, playing in
            if !playing { wake() }
            else if selectedLines.isEmpty && !voiceOver { chosenStartAnchor = nil; resumeFollowing() }
        }
        .onChange(of: visiblePassageID) { _, id in
            if !followsTranscript, selectedLines.isEmpty, let id { comparisonPassageID = id }
        }
        .onChange(of: voiceOver, initial: true) { _, enabled in
            if enabled { browsingChapterID = chapter.id; followsTranscript = false; wake() }
        }
        .onChange(of: speech.voiceID) { _, _ in speech.restartVoice() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { speech.endSpeedBoost() } }
        .onDisappear { speech.endSpeedBoost() }
    }
    private func portraitPlayer(comparisonHeight: CGFloat, stageHeight: CGFloat?) -> some View {
        VStack(spacing: 0) {
            identity.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 12)
            if let stageHeight { transcript.frame(height: stageHeight).padding(.horizontal, 26) }
            else { transcript.frame(minHeight: 120).padding(.horizontal, 26) }
            comparison(maxHeight: comparisonHeight).padding(.horizontal, 26)
            if controlsVisible {
                VStack(spacing: 10) { transport; commonBar }.padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
            } else { reveal.padding(.horizontal, 20).padding(.bottom, 8) }
        }
    }
    private func pauseFollowing() { browsingChapterID = chapter.id; browsedAway = true; followsTranscript = false; wake() }
    private func wake() { controlsVisible = true; activity = UUID() }
    private func resumeFollowing() {
        guard selectedLines.isEmpty, !voiceOver else { return }
        browsingChapterID = nil; comparisonPassageID = nil; browsedAway = false; followsTranscript = true; followRevision = UUID()
    }
    private func locatePlayback() {
        guard hasPlayback, let passageID = speech.passageID, speech.chapterID != nil else { return }
        // Locate changes the viewport only. The speech callback remains the
        // owner of its actual chapter, layer, sentence, speed and audio cursor.
        selectedLines.removeAll(); selectionDismissalID = UUID()
        browsingChapterID = nil; comparisonPassageID = nil; chosenStartAnchor = nil; browsedAway = false
        requestedScrollID = passageID; followsTranscript = true; followRevision = UUID(); wake()
    }
    private func moveChapter(_ delta: Int) {
        guard selectedLines.isEmpty, let target = chapterTarget(delta) else { return }
        if hasPlayback {
            guard speech.selectChapter(target) else { wake(); return }
            browsingChapterID = nil; comparisonPassageID = nil; chosenStartAnchor = nil; browsedAway = false
            requestedScrollID = speech.passageID
            resumeFollowing(); wake()
        } else if let index = session.book.chapters.firstIndex(where: { $0.id == target }) { changeChapter(index) }
    }
    private var identity: some View {
        HStack(spacing: 12) {
            Group {
                if let cover = speech.bookCoverImage { Image(uiImage: cover).resizable().scaledToFit() }
                else { Image(systemName: "book.closed").font(.system(size: 24, weight: .ultraLight)).foregroundStyle(Color.leafInk).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.primary.opacity(0.035)) }
            }.frame(width: 42, height: 54).clipShape(RoundedRectangle(cornerRadius: 5)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(session.book.title).font(.system(.headline, design: .serif).weight(.regular)).lineLimit(2)
                if chapter.title != session.book.title { Text(chapter.title).font(.caption).foregroundStyle(.secondary).lineLimit(2).accessibilityIdentifier("reader-listening-chapter-title") }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityElement(children: .contain).accessibilityIdentifier("reader-listening-identity")
    }
    private var reveal: some View {
        HStack { Spacer(); Button { wake() } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle()) }
            .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("显示听书控制").accessibilityIdentifier("reader-listening-reveal") }
            .frame(minHeight: 52)
    }
    private func projectChapter() {
        let chapter = chapter, preferences = session.state.preferences
        let usesMarkdown = session.book.rendersMarkdown && (preferences.viewMode == .source || !chapter.passages.contains { session.translations[$0.id]?.text(preferences.translationVariant) != nil })
        let markdown = usesMarkdown ? MarkdownChapterLayout(book: session.book, chapter: chapter, original: session.original) : nil
        let variant: ReaderTranslationVariant? = hasPlayback ? ReaderTranslationVariant(rawValue: speech.requestedLayer)
            : idleResumePosition.map { ReaderTranslationVariant(rawValue: $0.layer) } ?? (preferences.viewMode == .translation ? preferences.translationVariant : nil)
        rows = chapter.passages.enumerated().compactMap { index, passage in
            guard passage.resourcePath == nil, !passage.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return ReaderListeningPassage(chapterID: chapter.id, passage: passage, variant: variant, translation: session.translations[passage.id], comparisonVariant: preferences.translationVariant, markdown: markdown, passageIndex: index)
        }
    }
    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    if rows.isEmpty { ContentUnavailableView("此处暂无可朗读文字", systemImage: "text.magnifyingglass", description: Text("扫描页可返回书页继续阅读。")) }
                    ForEach(rows) { row in
                        let current = row.id == speech.passageID && hasPlayback
                        let idle = !hasPlayback && row.id == focusID
                        ReaderListeningText(text: row.content.text, preferences: session.state.preferences,
                            wordRange: current ? speech.spokenWordRange : nil,
                            active: current || idle,
                            sentenceRange: current ? row.content.sentence(at: speech.displayOffset) : idle ? row.content.sentence(at: idleOffset(row)) : nil,
                            follows: followsTranscript && selectedLines.isEmpty && !voiceOver,
                            followRevision: followRevision,
                            selectionDismissalID: selectionDismissalID,
                            onSeek: { offset in
                                guard selectedLines.isEmpty else { return }
                                if speech.seek(session, to: row.content.location(at: offset)) { chosenStartAnchor = nil; resumeFollowing() }; wake()
                            }, onSelection: { selected in
                                if selected { browsingChapterID = chapter.id; comparisonPassageID = row.id; selectedLines.insert(row.id); browsedAway = true; followsTranscript = false; wake() }
                                else { selectedLines.remove(row.id) }
                            }).id(row.id)
                    }
                }.scrollTargetLayout().padding(.vertical, 24).frame(maxWidth: 680).frame(maxWidth: .infinity)
            }.scrollIndicators(.hidden).scrollPosition(id: $visiblePassageID, anchor: .center)
                .accessibilityIdentifier("reader-listening-transcript")
                .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { _ in pauseFollowing() })
                .onChange(of: rows.first?.id) { _, _ in
                    guard selectedLines.isEmpty else { return }
                    if let target = requestedScrollID, rows.contains(where: { $0.id == target }) { proxy.scrollTo(target, anchor: .top); requestedScrollID = nil }
                    else if voiceOver { return }
                    else if let focusID, followsTranscript { proxy.scrollTo(focusID, anchor: .top) }
                    else if let first = rows.first { proxy.scrollTo(first.id, anchor: .top) }
                }
                .onChange(of: requestedScrollID) { _, id in if let id, rows.contains(where: { $0.id == id }) { proxy.scrollTo(id, anchor: .top); requestedScrollID = nil } }
                .onChange(of: followsTranscript) { _, follows in if follows, let focusID { proxy.scrollTo(focusID, anchor: .top) } }
                .onChange(of: activeID) { _, id in
                    if followsTranscript, selectedLines.isEmpty, !voiceOver, let id { proxy.scrollTo(id, anchor: .top) }
                }
        }
    }
    @ViewBuilder private func comparison(maxHeight: CGFloat) -> some View {
        if session.state.preferences.listeningShowsComparison, let row = comparisonRow, let text = row.comparison {
            VStack(alignment: .leading, spacing: 4) {
                Divider()
                HStack {
                    Text(row.comparisonLabel).font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Button("展开") { expandedComparison = (row.comparisonLabel, text); wake(); sheet = .comparison }.font(.caption).frame(minWidth: 44, minHeight: 44).buttonStyle(.plain).foregroundStyle(.secondary)
                }
                ScrollView {
                    ReaderListeningText(text: text, preferences: session.state.preferences, selectionDismissalID: selectionDismissalID, secondary: true, onSelection: { selected in
                        let key = row.id + ":comparison"
                        if selected { selectedLines.insert(key); browsingChapterID = chapter.id; comparisonPassageID = row.id; browsedAway = true; followsTranscript = false; wake() }
                        else { selectedLines.remove(key) }
                    }).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: max(40, maxHeight - 52))
            }.frame(maxHeight: maxHeight).accessibilityElement(children: .contain).accessibilityIdentifier("reader-listening-comparison-region")
        }
    }
    private var commonBar: some View {
        ReaderBottomBar(paper: paper, mode: .listening, chapterAccessibilityValue: chapter.title,
            onContents: { wake(); sheet = .contents },
            onRead: { speech.pause(); dismiss() }, onListen: { wake() },
            onAppearance: { wake(); sheet = .appearance }, onTypography: { wake(); sheet = .typography },
            onInteraction: wake, onFocusChange: { controlsFocused = $0; if $0 { wake() } }, controlsVisible: controlsVisible)
    }
    private var transport: some View {
        VStack(spacing: 6) {
            HStack {
                Text(hasPlayback ? "\(speech.layerTitle) · 第 \(speech.position + 1) / \(speech.count) 段" : idleResumePosition == nil ? "原文 · 点播放开始" : "原文 · 可继续上次朗读")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    .accessibilityIdentifier("reader-listening-playback-status")
                    .accessibilityValue(speech.isOutputPlaying ? "正在朗读 · \(speech.activeSentence)" : speech.playing ? "正在准备声音" : "已暂停")
                Spacer()
                if !hasComparison { ReaderListeningBoostButton(speech: speech, onSettings: { wake(); sheet = .settings }).frame(width: 54, height: 44) }
                Group {
                    if canLocate {
                        Button(action: locatePlayback) { Image(systemName: "location").frame(width: 44, height: 44).contentShape(Rectangle()) }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                            .accessibilityLabel("定位当前朗读").accessibilityHint("回到当前句，保持播放状态和语速")
                            .accessibilityIdentifier("reader-listening-locate")
                    } else { Color.clear.accessibilityHidden(true) }
                }.frame(width: 44, height: 44)
                Button { controlsVisible = false } label: { Image(systemName: "chevron.down").frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("收起").accessibilityIdentifier("reader-listening-hide")
            }
            HStack(spacing: 4) {
                if hasComparison { ReaderListeningBoostButton(speech: speech, onSettings: { wake(); sheet = .settings }).frame(maxWidth: .infinity) }
                else { Spacer(minLength: 0) }
                Button { moveChapter(-1) } label: { Image(systemName: "backward.end.fill").frame(width: 44, height: 44) }
                    .accessibilityLabel("上一章").accessibilityIdentifier("reader-speech-previous-chapter")
                    .disabled(!selectedLines.isEmpty || chapterTarget(-1) == nil)
                Button(action: togglePlayback) { Image(systemName: speech.playing ? "pause.fill" : "play.fill").font(.title2).frame(width: 60, height: 60)
                        .background(Color.primary.opacity(0.035), in: Circle()).overlay { Circle().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5) } }
                    .accessibilityLabel(speech.playing ? "暂停朗读" : speech.paused ? "继续朗读" : idleResumePosition != nil ? "继续上次朗读" : "从当前句开始朗读").accessibilityIdentifier("reader-speech-play")
                Button { moveChapter(1) } label: { Image(systemName: "forward.end.fill").frame(width: 44, height: 44) }
                    .accessibilityLabel("下一章").accessibilityIdentifier("reader-speech-next-chapter")
                    .disabled(!selectedLines.isEmpty || chapterTarget(1) == nil)
                if hasComparison {
                    Button { var prefs = session.state.preferences; prefs.listeningShowsComparison.toggle(); session.changePreferences(prefs); wake() } label: {
                        Image(systemName: "character.bubble").frame(minWidth: 44, maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                    }.accessibilityLabel("对照").accessibilityValue(session.state.preferences.listeningShowsComparison ? "开启" : "关闭").accessibilityIdentifier("reader-listening-comparison-toggle")
                } else { Spacer(minLength: 0) }
            }.buttonStyle(.plain)
            if let message = speech.message { Text(message).font(.caption).foregroundStyle(.secondary) }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("reader-listening-transport")
    }
    private func togglePlayback() {
        // Directory intent is captured before following clears the browse state.
        let explicit = chosenStartAnchor.flatMap { anchor in rows.first { $0.id == anchor.passageID && $0.content.chapterID == anchor.chapterID } }
        let chapterStart = !hasPlayback || browsingChapterID != speech.chapterID
            ? rows.first(where: { $0.content.chapterID == browsingChapterID }) : nil
        let target = !speech.playing ? (explicit ?? chapterStart) : nil
        if let target {
            let content = target.content
            let scalar = chosenStartAnchor?.passageID == target.id && content.layer == "original" ? chosenStartAnchor?.characterOffset ?? 0 : 0
            let offset = SourceTextOffsets(content.source).utf16Offset(forScalarOffset: scalar)
            let location = ReaderSpeechLocation(chapterID: content.chapterID, passageID: content.passageID, layer: content.layer, snapshot: content.source, utf16Offset: offset)
            if speech.seek(session, to: location) { chosenStartAnchor = nil; resumeFollowing() }
        } else {
            let resumes = !speech.playing
            speech.toggle(session)
            if resumes, speech.playing { resumeFollowing() }
        }
        wake()
    }
    private func changeChapter(_ index: Int, anchor: ReadingAnchor? = nil) {
        guard session.book.chapters.indices.contains(index), selectedLines.isEmpty else { return }
        browsingChapterID = session.book.chapters[index].id; comparisonPassageID = anchor?.passageID
        requestedScrollID = anchor?.passageID; chosenStartAnchor = anchor; browsedAway = true; followsTranscript = false; wake()
    }
    @ViewBuilder private func sheetContent(_ destination: ListeningSheet) -> some View {
        NavigationStack {
            Group {
                switch destination {
                case .settings: settingsForm
                case .contents: ReaderContentsPanel(session: session, onJump: { index, anchor in changeChapter(index, anchor: anchor); sheet = nil })
                case .appearance: ReaderAppearancePanel(session: session)
                case .typography: ReaderPreferencesPanel(session: session)
                case .comparison:
                    ScrollView {
                        if let snapshot = expandedComparison {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(snapshot.label).font(.caption).foregroundStyle(.secondary)
                                ReaderListeningText(text: snapshot.text, preferences: session.state.preferences, secondary: true)
                            }.padding(24)
                        }
                    }.navigationTitle("段落对照")
                }
            }.toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { sheet = nil; wake() } } }
        }.presentationDetents(destination == .comparison || destination == .typography ? [.large] : [.medium, .large])
    }
    private var settingsForm: some View {
        Form {
            Section("声音与语速") {
                ReaderSpeechSpeedControl(session: session, speech: speech)
                Picker("朗读声音", selection: $speech.voiceID) {
                    Text("自动匹配原文语言").tag("")
                    ForEach(speech.voices, id: \.identifier) { voice in Text("\(voice.name) · \(voice.language)").tag(voice.identifier) }
                }
                Text("播放时长按倍速，逐步加速；松开恢复原速。").font(.footnote).foregroundStyle(.secondary)
            }
            Section(hasComparison ? "对照与跟随" : "逐句跟随") {
                if hasComparison { Toggle("显示段落对照", isOn: Binding(get: { session.state.preferences.listeningShowsComparison }, set: { value in var prefs = session.state.preferences; prefs.listeningShowsComparison = value; session.changePreferences(prefs) })) }
                Toggle("逐句跟随", isOn: $followsTranscript)
                Text(hasComparison ? "字体、字号、行距与纸面和阅读共用；对照开关只改变显示，不切换朗读语言。" : "字体、字号、行距与纸面和阅读共用。").font(.footnote).foregroundStyle(.secondary)
                Button("从当前书页重新开始", systemImage: "play.circle") { browsingChapterID = nil; comparisonPassageID = nil; chosenStartAnchor = nil; speech.start(session, useSavedPosition: false); sheet = nil }
                    .accessibilityIdentifier("reader-speech-start-here")
                if hasPlayback { Button("结束听书", systemImage: "stop.fill") { speech.stop(); sheet = nil } }
            }
            Section { Text("使用此设备的系统声音，不上传正文、不使用阅读点。锁屏与后台可以继续朗读；来电或音频中断会暂停，返回后由你继续。离线可用性取决于已安装的声音。听书不计入阅读时长。")
                .font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("声音与语速")
    }
}
