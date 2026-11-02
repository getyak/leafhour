import SwiftUI
import LeafhourCore

struct ReaderListeningPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var settings = false
    @State private var followsTranscript = true
    @State private var sentenceRanges: [NSRange] = []
    @State private var transcriptText = ""
    private var paper: Color { Color(uiColor: session.state.preferences.paperColor) }
    private var hasPlayback: Bool { speech.playing || speech.paused }
    private var chapterTitle: String {
        session.book.chapters.first { $0.id == (hasPlayback ? speech.chapterID : nil) }?.title ?? session.chapter.title
    }
    private var displayedText: String {
        if hasPlayback { return speech.text }
        guard let passage = ReaderCloudTools.currentPassage(session) else { return "" }
        let variant: ReaderTranslationVariant? = session.state.preferences.viewMode == .translation ? session.state.preferences.translationVariant : nil
        return ReaderSpeechContent(chapterID: session.chapter.id, passage: passage, variant: variant, translation: session.translations[passage.id],
            markdown: session.book.rendersMarkdown ? MarkdownChapterLayout(book: session.book, chapter: session.chapter, original: session.original) : nil,
            passageIndex: session.chapter.passages.firstIndex { $0.id == passage.id } ?? 0).text
    }
    private var transcript: ReaderListeningTranscript { ReaderListeningTranscript(text: displayedText, wordRange: hasPlayback ? speech.spokenWordRange : nil, sentenceRanges: transcriptText == displayedText ? sentenceRanges : nil) }
    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height && !typeSize.isAccessibilitySize
            ZStack {
                paper.ignoresSafeArea()
                if landscape {
                    HStack(spacing: 32) {
                        ScrollView { VStack(spacing: 20) { identity(compact: true); transport }.padding(.vertical, 12) }
                            .frame(width: min(300, geometry.size.width * 0.38))
                        sentenceStage
                    }.padding(.horizontal, 24)
                } else if typeSize.isAccessibilitySize {
                    ScrollView { VStack(spacing: 24) { identity(compact: true); sentenceStage.frame(height: max(240, geometry.size.height * 0.45)); transport }.padding(20) }
                } else {
                    VStack(spacing: 16) {
                        identity(compact: geometry.size.height < 600)
                        sentenceStage
                        transport
                    }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 12)
                }
            }.accessibilityElement(children: .contain).accessibilityIdentifier(landscape ? "reader-listening-landscape" : "reader-listening-portrait")
        }
        .navigationTitle("听书").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("声音与语速", systemImage: "slider.horizontal.3") { settings = true }
                    .accessibilityIdentifier("reader-listening-settings")
            }
        }
        .sheet(isPresented: $settings) {
            NavigationStack {
                Form {
                    Section("声音与语速") {
                        ReaderSpeechSpeedControl(session: session, speech: speech)
                        Picker("朗读声音", selection: $speech.voiceID) {
                            Text("自动匹配原文语言").tag("")
                            ForEach(speech.voices, id: \.identifier) { voice in Text("\(voice.name) · \(voice.language)").tag(voice.identifier) }
                        }
                    }
                    Section {
                        Toggle("逐句跟随", isOn: $followsTranscript)
                        Toggle("书页跟随朗读", isOn: $speech.following)
                        Button("从当前书页重新开始", systemImage: "play.circle") { speech.start(session, useSavedPosition: false); settings = false }
                            .accessibilityIdentifier("reader-speech-start-here")
                        if hasPlayback { Button("结束听书", systemImage: "stop.fill") { speech.stop(); settings = false } }
                    }
                    Section { Text("使用此设备的系统声音，不上传正文、不使用阅读点。后台会暂停，返回后由你继续。离线可用性取决于已安装的声音。听书不计入阅读时长。未提供音频总时长时，只显示实际段落进度。")
                            .font(.footnote).foregroundStyle(.secondary) }
                }.navigationTitle("声音与语速")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { settings = false } } }
            }.presentationDetents([.medium, .large])
        }
        .onChange(of: displayedText, initial: true) { _, text in sentenceRanges = ReaderSpeechContent.sentenceRanges(text); transcriptText = text }
        .onChange(of: speech.voiceID) { _, _ in speech.restartVoice() }
    }
    private func identity(compact: Bool) -> some View {
        VStack(spacing: compact ? 8 : 12) {
            if !compact {
                Image(systemName: "book.closed").font(.system(size: 32, weight: .ultraLight))
                    .frame(width: 76, height: 76).modifier(ReaderGlassSurface(paper: paper, cornerRadius: 26, interactive: false))
                    .accessibilityHidden(true)
            }
            Text(session.book.title).font(.system(.title3, design: .serif).weight(.medium)).multilineTextAlignment(.center).lineLimit(3)
            Text(chapterTitle).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(2)
        }.frame(maxWidth: .infinity)
    }
    private var sentenceStage: some View {
        let snapshot = transcript
        return ScrollViewReader { proxy in
            ScrollView {
                if displayedText.isEmpty {
                    ContentUnavailableView("此处暂无可朗读文字", systemImage: "text.magnifyingglass", description: Text("扫描页可返回书页继续阅读。"))
                } else {
                    LazyVStack(alignment: .leading, spacing: 26) {
                        ForEach(snapshot.lines) { line in
                            let active = line.id == (snapshot.activeID ?? 0)
                            (Text(line.beforeWord) + Text(line.word).foregroundColor(.leafInk).bold() + Text(line.afterWord))
                                .font(.system(.title2, design: .serif).weight(active ? .medium : .regular))
                                .foregroundStyle(active ? Color.primary : Color.secondary)
                                .lineSpacing(8).frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 4).id(line.id)
                                .accessibilityIdentifier(active ? "reader-listening-active-sentence" : "reader-listening-sentence")
                        }
                    }.padding(.vertical, 36).padding(.horizontal, 6)
                }
            }.scrollIndicators(.hidden)
                .overlay(alignment: .bottomTrailing) {
                    if !followsTranscript {
                        Button("回到朗读", systemImage: "arrow.down.to.line") { followsTranscript = true; scroll(proxy, id: snapshot.activeID ?? 0) }
                            .font(.caption).padding(10).modifier(ReaderGlassSurface(paper: paper))
                    }
                }
                .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { _ in followsTranscript = false })
                .onChange(of: snapshot.activeID) { _, id in if followsTranscript, let id { scroll(proxy, id: id) } }
                .onChange(of: speech.passageID) { _, _ in if followsTranscript { scroll(proxy, id: 0) } }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("reader-listening-transcript")
    }
    private func scroll(_ proxy: ScrollViewProxy, id: Int) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.35)) { proxy.scrollTo(id, anchor: .center) }
    }
    private var transport: some View {
        VStack(spacing: 12) {
            if speech.count > 0, hasPlayback {
                ProgressView(value: Double(speech.position), total: Double(max(1, speech.count))).tint(.primary)
                    .accessibilityLabel("本书听书进度").accessibilityValue("第 \(speech.position + 1) 段，共 \(speech.count) 段")
                Text("\(speech.layerTitle) · 第 \(speech.position + 1) / \(speech.count) 段").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            } else { Text("从当前句开始 · 系统朗读").font(.caption2).foregroundStyle(.secondary) }
            ReaderGlassGroup {
                HStack(spacing: 28) {
                    Button { speech.move(-1) } label: { Image(systemName: "backward.end.fill").frame(width: 48, height: 48) }
                        .accessibilityLabel("上一段").disabled(!hasPlayback || !speech.canPrevious)
                    Button { speech.toggle(session) } label: {
                        Image(systemName: speech.playing ? "pause.fill" : "play.fill").font(.title2)
                            .frame(width: 64, height: 64).modifier(ReaderGlassSurface(paper: paper, cornerRadius: 32))
                    }.accessibilityLabel(speech.playing ? "暂停朗读" : speech.paused ? "继续朗读" : speech.hasResumePosition(session) ? "继续上次朗读" : "从当前句开始朗读")
                        .accessibilityIdentifier("reader-speech-play")
                    Button { speech.move(1) } label: { Image(systemName: "forward.end.fill").frame(width: 48, height: 48) }
                        .accessibilityLabel("下一段").disabled(!hasPlayback || !speech.canNext)
                }.buttonStyle(.plain).frame(maxWidth: .infinity)
            }
            Button { settings = true } label: {
                Text(speech.speed.formatted(.number.precision(.fractionLength(0...2))) + "× · 声音与语速")
                    .font(.caption).padding(.horizontal, 14).padding(.vertical, 8)
                    .modifier(ReaderGlassSurface(paper: paper)).frame(minHeight: 44)
            }.buttonStyle(.plain).accessibilityIdentifier("reader-listening-speed-open")
            if let message = speech.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        }
    }
}
