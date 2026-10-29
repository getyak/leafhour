import SwiftUI
import UIKit
import LeafhourCore

enum ReaderChrome: Equatable { case asleep, top, progress, tools }
private enum ReaderChromeRegion: Hashable { case top, bottom }
private struct ReaderChromeHeightKey: PreferenceKey {
    static var defaultValue: [ReaderChromeRegion: CGFloat] = [:]
    static func reduce(value: inout [ReaderChromeRegion: CGFloat], nextValue: () -> [ReaderChromeRegion: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}
enum ReaderPanel: Identifiable {
    case contents, search, preferences, appearance, records, tools, listening, translation, introduction, conversation, bookInformation, note(SelectedQuote), source(SelectedQuote), companion(SelectedQuote?)
    var isCompanion: Bool { switch self { case .companion, .conversation: true; default: false } }
    var isNoteEditor: Bool { if case .note = self { true } else { false } }
    var id: String {
        switch self {
        case .contents: "contents"; case .search: "search"; case .preferences: "preferences"; case .records: "records"
        case .appearance: "appearance"; case .tools: "tools"; case .listening: "listening"; case .translation: "translation"
        case .introduction: "introduction"; case .conversation: "conversation"; case .bookInformation: "book-information"
        case .note(let quote): "note-" + quote.id; case .source(let quote): "source-" + quote.id
        case .companion(let quote): "companion-" + (quote?.id ?? "current")
        }
    }
}
struct ReaderScreen: View {
    @Bindable var session: ReaderSession
    let systemColorScheme: ColorScheme
    var cloud: CloudLibraryClient? = nil
    var library: OfflineLibrary? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var chrome: ReaderChrome = .tools
    @State private var panel: ReaderPanel?
    @State private var speech = ReaderSpeech()
    @State private var tools = ReaderCloudTools()
    @State private var clockID = UUID()
    @State private var bottomBarFocused = false
    @State private var pagePosition: ReaderPagePosition?
    @State private var selectionDismissalID = UUID()
    @State private var hasNativeTextSelection = false
    @State private var chromeHeights: [ReaderChromeRegion: CGFloat] = [.top: 44, .bottom: 100]
    private enum ChromeFocus: Hashable { case back, bookInformation, tools }
    @FocusState private var focusedControl: ChromeFocus?
    private var paper: Color { session.state.preferences.theme == "paper" ? .readingPaper : Color(uiColor: .systemBackground) }
    // Keep page margins stable when chrome sleeps. Only a real control-size change
    // updates them, so waking the tools never reflows the chapter or moves its anchor.
    private var pageInsets: UIEdgeInsets {
        UIEdgeInsets(top: max(64, (chromeHeights[.top] ?? 44) + 16), left: 24,
                     bottom: max(44, (chromeHeights[.bottom] ?? 100) + 24), right: 24)
    }
    var body: some View {
        ZStack(alignment: .top) {
            paper.ignoresSafeArea()
            if session.book.kind == .pdf {
                PDFReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onSelection: { quote in
                    // PDFView can synchronously notify while its native selection is being cleared.
                    if quote != nil || session.selection != nil { session.selection = quote }
                }, onWake: wake, onReadingScroll: readingDidScroll)
                // PDFKit's page controller scales into its complete bounds.
                // Give it an unobscured page instead of covering source lines.
                .padding(.top, session.state.preferences.navigationMode == .paged ? pageInsets.top : 0)
                .padding(.bottom, session.state.preferences.navigationMode == .paged ? pageInsets.bottom : 0)
            } else {
                TextReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onNote: { showNote($0) }, onSource: { panel = .source($0); chrome = .asleep }, onExplain: { showCompanion($0) }, onWake: wake, onReadingScroll: readingDidScroll,
                    onTranslate: { session.selection = $0; present(.translation) },
                    onSelectionChange: { quote, active in session.selection = quote; hasNativeTextSelection = active },
                    onPageChange: { pagePosition = $0 })
            }
            VStack(spacing: 0) {
                if chrome == .top || chrome == .tools {
                    navigationHeader.padding(.horizontal, 10).background(paper)
                        .overlay(alignment: .bottom) { Divider() }
                        .background { GeometryReader { geometry in Color.clear.preference(key: ReaderChromeHeightKey.self, value: [.top: geometry.size.height]) } }
                } else {
                    Button { wake(.top) } label: { Color.clear.frame(maxWidth: .infinity).frame(height: 44) }.allowsHitTesting(false)
                        .accessibilityLabel("显示书名、返回与阅读设置")
                }
                Spacer()
                if let quote = session.selection, session.book.kind == .pdf {
                    HStack { Text("已选择原文").font(.footnote); Spacer(); Button("解释这句") { showCompanion(quote) }; Button("记笔记", systemImage: "square.and.pencil") { showNote(quote) }; Button("取消") { session.selection = nil; selectionDismissalID = UUID() } }.padding().background(.regularMaterial)
                }
                if chrome == .progress || chrome == .tools {
                    VStack(spacing: 8) {
                        Text(progressDescription).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            .padding(.horizontal, 12).padding(.vertical, 4)
                            .background(paper, in: Capsule()).accessibilityHidden(true)
                        ReaderBottomBar(
                            mode: speech.playing ? .listening : .reading,
                            chapterAccessibilityValue: progressDescription,
                            listeningAccessibilityHint: speech.playing ? "正在朗读，打开听书控制" : speech.paused ? "听书已暂停，打开后可继续" : "打开听书控制，点击播放后才开始",
                            onContents: { present(.contents) },
                            onRead: { speech.pause(); chrome = .asleep },
                            onListen: { present(.listening) },
                            onAppearance: { present(.appearance) },
                            onTypography: { present(.preferences) },
                            onInteraction: { clockID = UUID() },
                            onFocusChange: { bottomBarFocused = $0; clockID = UUID() }
                        )
                    }
                    .padding(.horizontal, 12).padding(.bottom, 6)
                    .background {
                        // Paper fades in before the floating controls so source
                        // ink never competes through the spaces between pills.
                        LinearGradient(stops: [.init(color: paper.opacity(0), location: 0),
                                               .init(color: paper, location: 0.35),
                                               .init(color: paper, location: 1)],
                                       startPoint: .top, endPoint: .bottom)
                            .padding(.top, -24).ignoresSafeArea(edges: .bottom)
                            .allowsHitTesting(false).accessibilityHidden(true)
                    }
                    .background { GeometryReader { geometry in Color.clear.preference(key: ReaderChromeHeightKey.self, value: [.bottom: geometry.size.height]) } }
                } else {
                    HStack {
                        Spacer()
                        if speech.playing || speech.paused {
                            Button { present(.listening) } label: {
                                Label(speech.playing ? "正在听书" : "听书已暂停", systemImage: speech.playing ? "waveform" : "pause.fill").font(.caption).padding(.horizontal, 16).frame(minHeight: 44)
                            }.background(.regularMaterial, in: Capsule())
                        } else {
                            Button { wake(.tools) } label: {
                                Capsule().fill(.secondary.opacity(0.4)).frame(width: 30, height: 4).frame(width: 72, height: 44)
                            }.accessibilityLabel("显示阅读进度、目录、搜索与记录").accessibilityHint("轻点书页也能打开阅读工具")
                        }
                        Spacer()
                    }
                }
            }
        }
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
        .statusBarHidden(false)
        .onPreferenceChange(ReaderChromeHeightKey.self) { values in
            for (region, height) in values where height > 0 {
                // Keep the measured space stable while controls sleep or wrap.
                // Returning at a chapter end must not clamp to another source line.
                let retained = region == .bottom ? max(chromeHeights[region] ?? 0, height) : height
                if abs((chromeHeights[region] ?? 0) - retained) > 0.5 { chromeHeights[region] = retained }
            }
        }
        .interactiveDismissDisabled(panel?.isCompanion != true && (session.saving || session.saveError != nil))
        .sheet(item: $panel, onDismiss: { hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); chrome = .asleep }) { destination in
            ReaderPanelView(panel: destination, session: session, systemColorScheme: systemColorScheme, speech: speech, tools: tools, cloud: cloud,
                onJump: { index, anchor in session.go(to: index, anchor: anchor); panel = nil }, onCompanion: { showCompanion(currentQuote) })
                .modifier(ReaderPanelPresentation(isCompanion: destination.isCompanion, isNoteEditor: destination.isNoteEditor))
        }
        .alert(session.saveError == nil ? "阅读提示" : "阅读记录", isPresented: Binding(get: { session.message != nil || (session.noteEditorID == nil && session.saveMessage != nil) }, set: { if !$0 { session.message = nil; session.saveMessage = nil } })) {
            if session.saveError != nil {
                Button("重试保存") { session.message = nil; session.saveMessage = nil; session.save() }
            } else {
                Button("知道了") { session.message = nil; session.saveMessage = nil }
            }
        } message: { Text(session.message ?? session.saveMessage ?? "") }
        .onChange(of: focusedControl) { _, _ in clockID = UUID() }
        .onChange(of: session.selection?.id) { _, _ in clockID = UUID() }
        .onChange(of: hasNativeTextSelection) { _, _ in clockID = UUID() }
        .onChange(of: chrome) { _, _ in clockID = UUID() }
        .onChange(of: session.chapterIndex) { _, _ in hasNativeTextSelection = false; speech.stop(); if chrome == .progress || chrome == .tools { clockID = UUID() } }
        .sensoryFeedback(.selection, trigger: panel?.id)
        .task(id: clockID) {
            guard chrome != .asleep else { return }
            do { try await Task.sleep(for: .seconds(6)); guard !Task.isCancelled, !bottomBarFocused, focusedControl == nil, panel == nil, session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }; sleepChrome() } catch {}
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { speech.pause(); session.save(); chrome = .asleep } }
        .onAppear { tools.configure(library: library, localBookID: session.book.id) }
        .onDisappear { speech.stop() }
    }
    @ViewBuilder private var navigationHeader: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: 0) {
                HStack {
                    backButton
                    Spacer(minLength: 8)
                    moreButton
                }
                bookTitleButton
            }
        } else {
            HStack {
                backButton
                bookTitleButton
                moreButton
            }
        }
    }
    private var backButton: some View {
        Button { Task { let receipt = await session.flush(); if session.isCurrent(receipt) { dismiss() } } } label: {
            Label("返回书房", systemImage: "chevron.left").labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }.focused($focusedControl, equals: .back)
    }
    private var bookTitleButton: some View {
        Button { present(.bookInformation) } label: {
            // Navigation stays bounded at every text size. The information
            // sheet keeps the complete selectable title available on demand.
            Text(session.book.title).font(.subheadline)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(Color.primary)
            .focused($focusedControl, equals: .bookInformation)
            .accessibilityLabel(session.book.title)
            .accessibilityHint("查看完整书名、作者与来源格式")
            .accessibilityIdentifier("reader-book-title")
    }
    private var moreButton: some View {
        Button { present(.tools) } label: {
            Label("更多", systemImage: "ellipsis")
                .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }.focused($focusedControl, equals: .tools)
            .accessibilityIdentifier("reader-more")
    }
    private var progressDescription: String {
        let unit = session.book.kind == .pdf ? "页" : "章"
        let chapter = "第 \(session.chapterIndex + 1) / \(session.book.chapters.count) \(unit) · \(session.chapter.title)"
        guard session.book.kind != .pdf, session.state.preferences.navigationMode == .paged,
              let pagePosition, pagePosition.chapterIndex == session.chapterIndex else { return chapter }
        return chapter + " · 本章第 \(pagePosition.index + 1) / \(pagePosition.count) 屏"
    }
    private func sleepChrome() {
        guard chrome != .asleep, !bottomBarFocused, focusedControl == nil, panel == nil, session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { chrome = .asleep }
    }
    private func readingDidScroll() { hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); sleepChrome() }
    private func wake(_: ReaderChrome) { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { chrome = chrome == .tools ? .asleep : .tools } }
    private func present(_ value: ReaderPanel) { panel = value; chrome = .asleep }
    private func showNote(_ quote: SelectedQuote) {
        let draft = session.state.drafts[quote.anchor.key]
        panel = .note(draft.map { SelectedQuote(anchor: $0.anchor, text: $0.quote) } ?? quote)
        chrome = .asleep
    }
    private var currentQuote: SelectedQuote? {
        if let selected = session.selection { return selected }
        guard let passage = ReaderCloudTools.currentPassage(session) else { return nil }
        var source = "", count = 0
        for scalar in passage.text.unicodeScalars {
            guard count + scalar.utf16.count <= 2000 else { break }
            source.unicodeScalars.append(scalar); count += scalar.utf16.count
        }
        let visible = session.book.rendersMarkdown ? MarkdownDocument(source: source).text.trimmingCharacters(in: .whitespacesAndNewlines) : source
        return SelectedQuote(anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id), text: visible, sourceText: source)
    }
    private func showCompanion(_ quote: SelectedQuote?) {
        hasNativeTextSelection = false
        session.selection = nil
        selectionDismissalID = UUID()
        focusedControl = nil
        chrome = .asleep
        panel = .companion(quote)
    }
}
