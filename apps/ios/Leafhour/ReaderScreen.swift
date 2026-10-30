import SwiftUI
import UIKit
import LeafhourCore

enum ReaderChrome: Equatable { case asleep, top, progress, tools }
enum ReaderPanel: Identifiable {
    case contents, search, preferences, appearance, records, tools, webTools, listening, translation, introduction, conversation, bookInformation, note(SelectedQuote), source(SelectedQuote), companion(SelectedQuote?)
    var isCompanion: Bool { switch self { case .companion, .conversation: true; default: false } }
    var isNoteEditor: Bool { if case .note = self { true } else { false } }
    var id: String {
        switch self {
        case .contents: "contents"; case .search: "search"; case .preferences: "preferences"; case .records: "records"
        case .appearance: "appearance"; case .tools: "tools"; case .webTools: "web-tools"; case .listening: "listening"; case .translation: "translation"
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var minimumReadingWidth = 360.0
    @State private var panel: ReaderPanel?
    @State private var pinnedSelection: SelectedQuote?
    @State private var speech = ReaderSpeech()
    @State private var tools = ReaderCloudTools()
    @State private var automaticTranslation = ReaderAutomaticTranslation()
    @State private var pagePosition: ReaderPagePosition?
    @State private var selectionDismissalID = UUID()
    @State private var hasNativeTextSelection = false
    @AccessibilityFocusState private var toolsFocused: Bool
    private var paper: Color { session.state.preferences.theme == "paper" ? .readingPaper : Color(uiColor: .systemBackground) }
    // One small entry is reserved at every width; opening tools never changes
    // these margins. Window changes continue through TextKit's source anchors.
    private let pageInsets = UIEdgeInsets(top: 24, left: 24, bottom: 64, right: 24)

    var body: some View {
        ReaderAdaptiveSurface(toolIsOpen: panel != nil, minimumReadingWidth: minimumReadingWidth,
                              accessibilityText: dynamicTypeSize.isAccessibilitySize) {
            readingSurface
        } tool: {
            if let panel {
                ReaderPanelView(panel: panel, session: session, systemColorScheme: systemColorScheme,
                                speech: speech, tools: tools, cloud: cloud,
                    onJump: { index, anchor in session.go(to: index, anchor: anchor); closePanel() },
                    onCompanion: { showCompanion(currentQuote) }, onPresent: present,
                    onNote: { if let quote = currentQuote { showNote(quote) } },
                    onReturnToLibrary: returnToLibrary, onClose: closePanel,
                    pinnedSelection: pinnedSelection, onUseCurrentPassage: useCurrentPassage)
            }
        }
        .background(paper.ignoresSafeArea())
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
        .statusBarHidden(false)
        .environment(\.readerAutomaticTranslation, automaticTranslation)
        .task(id: preparationKey) {
            await automaticTranslation.run(session:session,cloud:cloud,library:library,active:scenePhase == .active)
        }
        .interactiveDismissDisabled(panel?.isCompanion != true && (session.saving || session.saveError != nil))
        .alert(session.saveError == nil ? "阅读提示" : "阅读记录", isPresented: Binding(get: { session.message != nil || (session.noteEditorID == nil && session.saveMessage != nil) }, set: { if !$0 { session.message = nil; session.saveMessage = nil } })) {
            if session.saveError != nil {
                Button("重试保存") { session.message = nil; session.saveMessage = nil; session.save() }
            } else {
                Button("知道了") { session.message = nil; session.saveMessage = nil }
            }
        } message: { Text(session.message ?? session.saveMessage ?? "") }
        .onChange(of: session.chapterIndex) { _, _ in hasNativeTextSelection = false; speech.stop() }
        .sensoryFeedback(.selection, trigger: panel?.id)
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { speech.pause(); session.save(); automaticTranslation.stop() }
        }
        // Automatic translation's scope/scene hooks are integrated here by the
        // reader coordinator. Cloud tools remain owned by this reading session.
        .onAppear { tools.configure(library: library, localBookID: session.book.id) }
        .onDisappear { speech.stop(); automaticTranslation.stop() }
    }
    private var preparationKey:String {
        automaticTranslation.scopeKey(session) + "|\(session.state.preferences.automaticTranslation)|\(session.state.preferences.textMode.rawValue)|\(scenePhase == .active)|\(automaticTranslation.retryRevision)"
    }

    private var readingSurface: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if geometry.size.height >= 440 || !dynamicTypeSize.isAccessibilitySize {
                    chapterHeading(compact: geometry.size.height < 440)
                }
                ZStack(alignment: .bottomTrailing) {
                    if session.book.kind == .pdf {
                        PDFReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onSelection: { quote in
                            if quote != nil || session.selection != nil { session.selection = quote }
                        }, onWake: wake, onReadingScroll: readingDidScroll)
                        .padding(.top, session.state.preferences.navigationMode == .paged ? pageInsets.top : 0)
                        .padding(.bottom, session.state.preferences.navigationMode == .paged ? pageInsets.bottom : 0)
                    } else {
                        ReaderContentView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID,
                            onNote: showNote, onSource: { present(.source($0)) }, onExplain: showCompanion,
                            onWake: wake, onReadingScroll: readingDidScroll,
                            onTranslate: { session.selection = $0; present(.translation) },
                            onSelectionChange: { quote, active in
                                // A tool's pinned quote belongs to that tool until
                                // it is explicitly closed or replaced.
                                if panel == nil { session.selection = quote }
                                hasNativeTextSelection = active
                            }, onPageChange: { pagePosition = $0 })
                    }
                    ReaderToolsEntry(listening: speech.playing || speech.paused) { present(.tools) }
                        .frame(width: 44, height: 44).background(paper, in: Circle())
                        .accessibilityFocused($toolsFocused)
                        .allowsHitTesting(panel?.isNoteEditor != true)
                        .accessibilityHidden(panel?.isNoteEditor == true)
                        .padding(.trailing, 12).padding(.bottom, 8)
                }
            }
            .background(paper)
        }
    }
    private func chapterHeading(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 6) {
            Text(session.chapter.title)
                .font(compact ? .caption : .system(.title3, design: .serif))
                .fontWeight(.medium).foregroundStyle(.primary)
                .lineLimit(compact ? 1 : 2)
                .accessibilityAddTraits(.isHeader)
            Text(progressCaption + modeCaption).font(.caption).foregroundStyle(.secondary)
                .lineLimit(1).accessibilityIdentifier("reader-progress-caption")
        }
        .frame(maxWidth: 420, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, 24).padding(.top, compact ? 4 : 18).padding(.bottom, compact ? 4 : 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(session.chapter.title + "，" + progressDescription + modeCaption)
    }
    private var modeCaption: String {
        guard session.book.kind != .pdf else { return " · 原书页面" }
        if session.state.preferences.textMode != .original {
            let current = session.chapter.passages.first { $0.id == session.currentAnchor?.passageID } ?? session.chapter.passages.first
            guard let current, let value = session.translations[current.id]?[session.state.preferences.translationVariant] else {
                return automaticTranslation.loading ? " · 原文，译文准备中" : " · 作者原文"
            }
            let name = session.state.preferences.translationVariant == .literal ? "直译" : "意译"
            return (session.state.preferences.textMode == .parallel ? " · 原文与" : " · ") + name + (value.status == "reviewed" ? " · 已复核" : " · AI 草稿")
        }
        switch session.state.preferences.textMode {
        case .original: return " · 作者原文"
        case .translation: return session.state.preferences.translationVariant == .literal ? " · 直译" : " · 意译"
        case .parallel: return session.state.preferences.translationVariant == .literal ? " · 原文与直译" : " · 原文与意译"
        }
    }
    private var progressDescription: String {
        let unit = session.book.kind == .pdf ? "页" : "章"
        let chapter = "第 \(session.chapterIndex + 1) / \(session.book.chapters.count) \(unit)"
        guard session.book.kind != .pdf, session.state.preferences.navigationMode == .paged,
              let pagePosition, pagePosition.chapterIndex == session.chapterIndex else { return chapter }
        return chapter + " · 本章第 \(pagePosition.index + 1) / \(pagePosition.count) 屏"
    }
    private var progressCaption: String { progressDescription }
    private func readingDidScroll() {
        hasNativeTextSelection = false
        if panel == nil { session.clearTransientSelection(); selectionDismissalID = UUID() }
    }
    private func wake(_: ReaderChrome) {
        if panel == nil { present(.tools) }
        else if panel?.id == ReaderPanel.tools.id { closePanel() }
    }
    private func present(_ value: ReaderPanel) {
        toolsFocused = false
        // The editor's explicit close waits for its current save receipt.
        // A source-side tap must not replace it during that operation.
        guard panel?.isNoteEditor != true else { return }
        if case .translation = value {
            pinnedSelection = currentQuote
            session.selection = pinnedSelection
        }
        if case .tools = value, panel != nil { session.clearTransientSelection() }
        panel = value
    }
    private func closePanel() {
        panel = nil
        pinnedSelection = nil
        hasNativeTextSelection = false
        session.clearTransientSelection()
        selectionDismissalID = UUID()
        toolsFocused = true
    }
    private func returnToLibrary() {
        Task { let receipt = await session.flush(); if session.isCurrent(receipt) { dismiss() } }
    }
    private func showNote(_ quote: SelectedQuote) {
        let draft = session.state.drafts[quote.anchor.key]
        panel = .note(draft.map { SelectedQuote(anchor: $0.anchor, text: $0.quote, origin: $0.quoteOrigin, language: $0.quoteLanguage) } ?? quote)
    }
    private var currentQuote: SelectedQuote? {
        if let selected = session.selection { return selected }
        return currentReadingQuote
    }
    private var currentReadingQuote: SelectedQuote? {
        guard let passage = session.chapter.passages.first(where: { $0.id == session.currentAnchor?.passageID && $0.resourcePath == nil && !$0.text.isEmpty })
                ?? session.chapter.passages.first(where: { $0.resourcePath == nil && !$0.text.isEmpty }) else { return nil }
        var source = "", count = 0
        for scalar in passage.text.unicodeScalars {
            guard count + scalar.utf16.count <= 2000 else { break }
            source.unicodeScalars.append(scalar); count += scalar.utf16.count
        }
        let visible = session.book.rendersMarkdown ? MarkdownDocument(source: source).text.trimmingCharacters(in: .whitespacesAndNewlines) : source
        return SelectedQuote(anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id), text: visible, sourceText: source)
    }
    private func useCurrentPassage() {
        guard !tools.loading, !tools.generating, tools.retry == nil else { return }
        let quote = currentReadingQuote
        if panel?.isCompanion == true { showCompanion(quote) }
        else {
            pinnedSelection = quote
            session.selection = quote
        }
    }
    private func showCompanion(_ quote: SelectedQuote?) {
        hasNativeTextSelection = false
        session.selection = nil
        selectionDismissalID = UUID()
        pinnedSelection = quote
        panel = .companion(quote)
    }
}
