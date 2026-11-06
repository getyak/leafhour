import SwiftUI
import UIKit
import LeafhourCore

enum ReaderChrome: Equatable { case asleep, top, progress, tools }
/// Keep the native book surface alive underneath Chat. Repeated tool/status
/// changes must not traverse TextKit/PDFKit while that surface is covered.
/// Preserve the same content position and native view when freezing or returning.
struct ReaderBackgroundSurface<Content: View>: View, Equatable {
    let isCovered: Bool
    private let content: () -> Content
    @State private var frozen: Content?
    init(isCovered: Bool, @ViewBuilder content: @escaping () -> Content) { self.isCovered = isCovered; self.content = content }
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.isCovered && rhs.isCovered }
    private var displayed: Content { isCovered ? frozen ?? content() : content() }
    var body: some View {
        displayed.onChange(of: isCovered, initial: true) { _, covered in
            frozen = covered ? content() : nil
        }
    }
}

private enum ReaderChromeRegion: Hashable { case top, bottom }
private struct ReaderChromeLayout: Equatable {
    let width: Int
    let height: Int
    let typeSize: DynamicTypeSize
    let bookID: String
    var compact: Bool { height < 440 }
}
private struct ReaderChromeMeasurement: Equatable {
    let layout: ReaderChromeLayout
    let region: ReaderChromeRegion
    let height: CGFloat
}
private struct ReaderChromeMetrics: Equatable {
    let layout: ReaderChromeLayout
    let top: CGFloat
    let bottom: CGFloat
}
/// Keep the real chrome's layout while sleeping, and give its visible branch
/// a fresh native/AX lifecycle when controls return above the reader.
private struct ReaderChromeVisibility: ViewModifier {
    let isVisible: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if isVisible { content }
        else { content.hidden() }
    }
}
private struct ReaderChromeHeightKey: PreferenceKey {
    static var defaultValue: [ReaderChromeMeasurement] = []
    static func reduce(value: inout [ReaderChromeMeasurement], nextValue: () -> [ReaderChromeMeasurement]) {
        value.append(contentsOf: nextValue())
    }
}
enum ReaderPanel: Identifiable {
    case contents, search, preferences, appearance, records, tools, listening, time, autoPage, translation, pageTranslation, introduction, readingGuide, bookmarks, conversation, bookInformation, note(SelectedQuote), source(SelectedQuote), passageTranslation(SelectedQuote), companion(SelectedQuote?), share(SelectedQuote?)
    var isCompanion: Bool { switch self { case .companion, .conversation, .readingGuide: true; default: false } }
    var isNoteEditor: Bool { if case .note = self { true } else { false } }
    var id: String {
        switch self {
        case .contents: "contents"; case .search: "search"; case .preferences: "preferences"; case .records: "records"
        case .time: "time"; case .appearance: "appearance"; case .tools: "tools"; case .listening: "listening"; case .translation: "translation"; case .pageTranslation: "page-translation"
        case .autoPage: "auto-page"
        case .share(let quote): "share-" + (quote?.id ?? "book")
        case .readingGuide: "reading-guide"; case .bookmarks: "bookmarks"
        case .introduction: "introduction"; case .conversation: "conversation"; case .bookInformation: "book-information"
        case .passageTranslation(let quote): "passage-translation-" + quote.id
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
    var positionConflict = false
    var resolvePosition: ((Bool) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .caption2) private var quietProgressHeight: CGFloat = 16
    @State private var chrome: ReaderChrome = .asleep
    @State private var returningToLibrary = false
    @State private var panel: ReaderPanel?
    @State private var speech = ReaderSpeech()
    @State private var autoPage = ReaderAutoPageController()
    @State private var readerIsTouching = false
    @State private var voiceOverRunning = UIAccessibility.isVoiceOverRunning
    @State private var startAutoPageOnDismiss = false
    @State private var speechNavigationID: UUID?
    @State private var tools = ReaderCloudTools()
    @State private var viewedTranslations = Set<String>()
    @State private var reading = ReaderReadingContent()
    @State private var guide = ReadingGuideController()
    @State private var readingNavigationID = UUID()
    @State private var conversationAutoLoad = true
    @State private var bookmarkRanges: [ReaderBookmarkVisibleRange] = []
    @State private var bookmarkPull: ReaderBookmarkPullVisual = .idle
    @State private var bookmarkSavedID: UUID?
    @State private var bookmarkConfigurationID: UUID?
    @State private var bookmarkMessage: String?
    @State private var bookmarkSaving = false
    @State private var clockID = UUID()
    @State private var bottomBarFocused = false
    @State private var pagePosition: ReaderPagePosition?
    @State private var progressIndex: ReaderProgressIndex?
    @State private var progressVisible = false
    @State private var progressPulse = UUID()
    @State private var visiblePage: ReaderVisiblePage?
    @State private var recoveryExport: RecordsDocument?
    @State private var exportingRecovery = false
    @State private var recoveryExported = false
    @State private var recoveryExportError: String?
    @State private var selectionDismissalID = UUID()
    @State private var hasNativeTextSelection = false
    @State private var chromeMetrics: ReaderChromeMetrics?
    private enum ChromeFocus: Hashable { case back, bookInformation, tools }
    @FocusState private var focusedControl: ChromeFocus?
    init(session: ReaderSession, systemColorScheme: ColorScheme, cloud: CloudLibraryClient? = nil, library: OfflineLibrary? = nil,
         positionConflict: Bool = false, resolvePosition: ((Bool) -> Void)? = nil, conversationTools: ReaderCloudTools? = nil) {
        self.session = session; self.systemColorScheme = systemColorScheme; self.cloud = cloud; self.library = library
        self.positionConflict = positionConflict; self.resolvePosition = resolvePosition
        _tools = State(initialValue: conversationTools ?? ReaderCloudTools())
    }
    private var hasPDFText: Bool { session.chapter.passages.contains { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    private var needsPDFSourceFallback: Bool { session.book.kind == .pdf && session.state.preferences.viewMode != .source && !hasPDFText }
    private var paper: Color { Color(uiColor: session.state.preferences.paperColor) }
    // Safe areas belong to the system. Controls overlay this stable viewport;
    // waking, listening or recording time never changes its page boundaries.
    private func readingInsets(for layout: ReaderChromeLayout) -> UIEdgeInsets {
        UIEdgeInsets(top: 4, left: 22, bottom: session.state.preferences.alwaysShowReadingProgress ? quietProgressHeight + 8 : 8, right: 22)
    }
    private var presentedReader: some View {
        ReaderBackgroundSurface(isCovered: panel?.isCompanion == true || panel?.id == "listening" || scenePhase != .active) { readingSurface }.equatable()
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
        .statusBarHidden(true)
        .interactiveDismissDisabled(panel?.isCompanion != true && (session.saving || session.saveError != nil))
        .sheet(item: Binding<ReaderPanel?>(get: {
            guard let panel, panel.id != "contents", panel.id != "listening" else { return nil }
            return panel
        }, set: { value in
            if value == nil && (panel?.id == "contents" || panel?.id == "listening") { return }
            panel = value
        }), onDismiss: {
            bookmarkConfigurationID = nil
            hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); chrome = .asleep
            if startAutoPageOnDismiss { startAutoPageOnDismiss = false; beginAutoPaging() }
        }) { destination in
            ReaderPanelView(panel: destination, session: session, systemColorScheme: systemColorScheme, speech: speech, tools: tools, cloud: cloud, library: library, reading: reading, visiblePage: visiblePage, readingNavigationID: readingNavigationID, readingGuide: guide, activeBookmarkID: bookmarkConfigurationID ?? activeBookmark?.id, currentBookmarkCapture: bookmarkRanges.first?.capture, conversationAutoLoad: conversationAutoLoad,
                onJump: { index, anchor in reading.suspendForUserNavigation(); readingNavigationID = UUID(); speech.userNavigated(); session.go(to: index, anchor: anchor); panel = nil; session.setReadingVisible(scenePhase == .active && !speech.playing); session.recordReadingInteraction() }, onCompanion: { showCompanion(currentQuote) },
                autoPage: autoPage, onAutoPageStart: startAutoPaging, onPresent: present, onUserNavigate: { reading.suspendForUserNavigation(); readingNavigationID = UUID() }, onPreparedConversation: presentPreparedGuideConversation)
                .modifier(ReaderPanelPresentation(isCompanion: destination.isCompanion, isNoteEditor: destination.isNoteEditor, startsExpanded: destination.id == "time"))
        }
        .alert(session.saveError == nil ? "阅读提示" : "阅读记录", isPresented: Binding(get: { session.message != nil || (session.noteEditorID == nil && session.saveMessage != nil) }, set: { if !$0 { session.message = nil; session.saveMessage = nil } })) {
            if session.saveError != nil {
                Button("重试保存") { session.message = nil; session.saveMessage = nil; session.save() }
            } else {
                Button("知道了") { session.message = nil; session.saveMessage = nil }
            }
        } message: { Text(session.message ?? session.saveMessage ?? "") }
    }
    private var readingSurface: some View {
        GeometryReader { geometry in
            let layout = ReaderChromeLayout(width: Int(geometry.size.width.rounded()), height: Int(geometry.size.height.rounded()),
                                            typeSize: dynamicTypeSize, bookID: session.book.id)
            let pageInsets = readingInsets(for: layout)
            let showingTop = chrome == .top || chrome == .tools
            let showingBottom = chrome == .progress || chrome == .tools
            ZStack(alignment: .top) {
                paper.ignoresSafeArea()
                Group {
                if session.book.kind == .pdf && (session.state.preferences.viewMode == .source || needsPDFSourceFallback) {
                    PDFReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onSelection: { quote in
                        // PDFView can synchronously notify while its native selection is being cleared.
                        if quote != nil || session.selection != nil { session.selection = quote }
                        if quote != nil { speech.userNavigated() }
                    }, onWake: wake, onReadingScroll: readingDidScroll, onPageChange: { pagePosition = $0 }, onVisiblePage: receiveVisiblePage, speechHighlight: speech.highlight, followsSpeech: speech.following && !speech.readerIsInteracting,
                        onReadingPosition: { speech.updateVisible($0) }, onTouchActivity: readingTouchChanged,
                        isReadingSurfaceActive: panel == nil && scenePhase == .active,
                        pageRequest: autoPage.pageRequest, onPageRequestResult: autoPage.receive, onBookmark: addBookmark, onBookmarkPull: receiveBookmarkPull, onBookmarkViewport: { bookmarkRanges = $0 })
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if needsPDFSourceFallback {
                            Text("此页没有可对照文字，先显示原页。")
                                .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 24).padding(.vertical, 8).background(paper)
                                .accessibilityIdentifier("reader-pdf-source-fallback")
                        }
                    }
                    // PDFKit's page controller scales into its complete bounds.
                    // Give it an unobscured page instead of covering source lines.
                    .padding(.top, session.state.preferences.navigationMode == .paged ? pageInsets.top : 0)
                    .padding(.bottom, session.state.preferences.navigationMode == .paged || needsPDFSourceFallback ? pageInsets.bottom : 0)
                } else {
                    TextReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onNote: { showNote($0) }, onSource: { present(.source($0)) }, onExplain: { showCompanion($0) }, onWake: wake, onReadingScroll: readingDidScroll,
                        onTranslate: { viewedTranslations.insert($0.anchor.passageID); present(.passageTranslation($0)) },
                        onShare: { present(.share($0)) },
                        onSelectionChange: { quote, active in session.selection = quote; hasNativeTextSelection = active; if active { speech.userNavigated() } },
                        onPageChange: { pagePosition = $0 }, onVisiblePage: receiveVisiblePage, speechHighlight: speech.highlight, followsSpeech: speech.following && !speech.readerIsInteracting,
                        onReadingPosition: { speech.updateVisible($0) }, onTouchActivity: readingTouchChanged,
                        isReadingSurfaceActive: panel == nil && scenePhase == .active, translatedPassageIDs: viewedTranslations,
                        pageRequest: autoPage.pageRequest, onPageRequestResult: autoPage.receive, onBookmark: addBookmark, onBookmarkPull: receiveBookmarkPull, onBookmarkViewport: { bookmarkRanges = $0 }, onBookmarkCapture: { addBookmark(capture: $0) })
                }
                }
                .offset(y: reduceMotion ? 0 : bookmarkPull.displacement)
                if chrome == .asleep, activeBookmark != nil {
                    VStack { HStack { Spacer(); bookmarkButton }.padding(.trailing, 4); Spacer() }
                }
                if bookmarkPull.feedback != .idle || bookmarkMessage != nil {
                    ReaderBookmarkFeedbackView(pull: bookmarkPull, message: bookmarkMessage, canEdit: bookmarkSavedID != nil) {
                        bookmarkConfigurationID = bookmarkSavedID; present(.bookmarks)
                    }
                    .padding(.top, showingTop ? (chromeMetrics?.top ?? 44) + 6 : 6).padding(.horizontal, 16).zIndex(2)
                }
                VStack(spacing: 0) {
                    // Measure the same real controls while asleep. Hiding or waking
                    // them changes ink, hit testing and AX, never the source margins.
                    navigationHeader(compact: layout.compact).padding(.horizontal, 10).background(paper)
                        .overlay(alignment: .bottom) { Divider() }
                        .background { GeometryReader { geometry in Color.clear.preference(key: ReaderChromeHeightKey.self, value: [ReaderChromeMeasurement(layout: layout, region: .top, height: geometry.size.height)]) } }
                        .modifier(ReaderChromeVisibility(isVisible: showingTop)).allowsHitTesting(showingTop).disabled(!showingTop).accessibilityHidden(!showingTop)
                        .overlay {
                            if !showingTop {
                                Button { wake(.top) } label: { Color.clear.frame(maxWidth: .infinity).frame(height: 44) }.allowsHitTesting(false)
                                    .accessibilityLabel("显示书名、返回与阅读设置")
                            }
                        }
                    Spacer()
                    ZStack(alignment: .bottom) {
                        ReaderGlassGroup {
                            VStack(spacing: layout.compact ? 0 : 4) {
                                if let quote = session.selection {
                                    ReaderSelectionDock(quote: quote, paper: paper, onAI: { showCompanion(quote) },
                                        onNote: { showNote(quote) }, onTranslate: { viewedTranslations.insert(quote.anchor.passageID); present(.passageTranslation(quote)) }, onShare: { present(.share(quote)) },
                                        onClear: { session.selection = nil; hasNativeTextSelection = false; selectionDismissalID = UUID() }, showsTranslation: session.state.preferences.viewMode != .translation)
                                } else {
                                    HStack(spacing: 8) {
                                        Spacer(minLength: 0)
                                        ReaderAIButton(paper: paper, quote: nil, onOpen: { showCompanion(currentQuote) })
                                    }.padding(.horizontal, 12).accessibilityHidden(!showingBottom)
                                    ReaderReadingTransport(canPreviousChapter: session.chapterIndex > 0,
                                        canNextChapter: session.chapterIndex + 1 < session.book.chapters.count,
                                        onPreviousChapter: { jumpChapter(-1) }, onNextChapter: { jumpChapter(1) },
                                        onTranslatePage: { present(.pageTranslation) })
                                    ReaderBottomBar(
                                        paper: paper, mode: .reading,
                                        chapterAccessibilityValue: progressDescription,
                                        listeningAccessibilityHint: speech.playing ? "正在朗读，打开听书控制" : speech.paused ? "听书已暂停，打开后可继续" : "打开听书控制，点击播放后才开始",
                                        onContents: { present(.contents) },
                                        onRead: { autoPage.pause(.interaction); speech.pause(); chrome = .asleep },
                                        onListen: { present(.listening) },
                                        onAppearance: { present(.appearance) },
                                        onTypography: { present(.preferences) },
                                        onInteraction: { autoPage.pause(.interaction); clockID = UUID() },
                                        onFocusChange: { bottomBarFocused = $0; clockID = UUID() },
                                        controlsVisible: showingBottom
                                    )
                                }
                            }
                        }
                        .padding(.horizontal, 12).padding(.bottom, layout.compact ? 4 : 6)
                        .background {
                            // Paper fades in before the floating controls so source
                            // ink never competes through the spaces between pills.
                            LinearGradient(stops: [.init(color: paper.opacity(0), location: 0),
                                                   .init(color: paper, location: 0.35),
                                                   .init(color: paper, location: 1)],
                                           startPoint: .top, endPoint: .bottom)
                                .padding(.top, -8).ignoresSafeArea(edges: .bottom)
                                .allowsHitTesting(false).accessibilityHidden(true)
                        }
                        .background { GeometryReader { geometry in Color.clear.preference(key: ReaderChromeHeightKey.self, value: session.selection == nil ? [ReaderChromeMeasurement(layout: layout, region: .bottom, height: geometry.size.height)] : []) } }
                        .modifier(ReaderChromeVisibility(isVisible: showingBottom || session.selection != nil)).allowsHitTesting(showingBottom || session.selection != nil).disabled(!showingBottom && session.selection == nil)
                        if !showingBottom && session.selection == nil { quietReadingControl }
                    }
                }
            }
            .overlay(alignment: .bottomTrailing) { floatingProgress(showingBottom: showingBottom) }
            .onPreferenceChange(ReaderChromeHeightKey.self) { recordChrome($0, for: layout) }
        }
    }
    @ViewBuilder private func floatingProgress(showingBottom: Bool) -> some View {
        if panel == nil && session.selection == nil && !hasNativeTextSelection && (progressVisible || showingBottom || session.state.preferences.alwaysShowReadingProgress) {
            Text(progressCaption).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(paper.opacity(0.96), in: Capsule())
                .padding(.trailing, 18)
                .padding(.bottom, showingBottom ? (chromeMetrics?.bottom ?? 180) + 8 : 8)
                .allowsHitTesting(false).accessibilityLabel(progressDescription)
                .accessibilityIdentifier("reader-progress-caption")
        }
    }
    private var readingRefreshKey: String {
        let visible = scenePhase == .active && panel?.isCompanion != true
        return "\(session.chapter.id):\(session.state.preferences.viewMode.rawValue):\(session.translationSettings):\(session.packageVerificationPending):\(visible)"
    }
    private var navigationReader: some View {
        NavigationStack {
            presentedReader
                .toolbar(.hidden, for: .navigationBar)
                .navigationTitle("阅读")
                .navigationDestination(isPresented: Binding(get: { panel?.id == "listening" }, set: { if !$0 && panel?.id == "listening" { panel = nil } })) {
                    ReaderListeningPanel(session: session, speech: speech)
                        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
                        .toolbar { ToolbarItem(placement: .confirmationAction) {
                            Button("继续读", systemImage: "book") { speech.pause(); panel = nil }.accessibilityIdentifier("reader-listening-return")
                        } }
                }

        }
        .accessibilityHidden(panel?.id == "contents")
        .allowsHitTesting(panel?.id != "contents")
        .overlay {
            if panel?.id == "contents" {
                ReaderContentsOverlay(session: session, onJump: { index, anchor in
                    reading.suspendForUserNavigation(); readingNavigationID = UUID()
                    speech.userNavigated(); session.go(to: index, anchor: anchor); panel = nil
                    session.setReadingVisible(scenePhase == .active && !speech.playing); session.recordReadingInteraction()
                }, onClose: { panel = nil }, cloud: cloud, library: library)
            }
        }
    }
    private var trackedReader: some View {
        navigationReader
        .modifier(ReaderTimeTracking(session: session, visible: scenePhase == .active && panel == nil && !speech.playing))
        .safeAreaInset(edge: .top, spacing: 0) { remotePositionNotice }
        .onChange(of: autoPageConditions, initial: true) { _, conditions in autoPage.update(conditions, navigationID: session.navigationID) }
        .onChange(of: session.navigationID) { _, id in
            reading.suspendForUserNavigation()
            bookmarkRanges = []; bookmarkPull = .idle; bookmarkMessage = nil; bookmarkSavedID = nil; bookmarkConfigurationID = nil
            autoPage.update(autoPageConditions, navigationID: id)
        }
        .onChange(of: session.state.preferences) { old, new in
            if old != new { autoPage.pause(.layout) }
            if old.speechSpeed != new.speechSpeed { speech.speed = new.speechSpeed }
        }
    }
    private var progressTrackedReader: some View {
        trackedReader
        .task(id: session.book.sourceVersion) {
            let book = session.book
            let index = await Task.detached(priority: .utility) { ReaderProgressIndex(book: book) }.value
            if !Task.isCancelled { progressIndex = index }
        }
        .onChange(of: pagePosition) { _, _ in revealProgress() }
        .onChange(of: session.currentAnchor) { _, _ in revealProgress() }
        .task(id: progressPulse) {
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { progressVisible = false }
        }
    }
    private var synchronizedReader: some View {
        progressTrackedReader
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.voiceOverStatusDidChangeNotification)) { _ in voiceOverRunning = UIAccessibility.isVoiceOverRunning }
        .onChange(of: focusedControl) { _, _ in clockID = UUID() }
        .onChange(of: session.selection?.id) { _, _ in clockID = UUID() }
        .onChange(of: hasNativeTextSelection) { _, _ in clockID = UUID() }
        .onChange(of: chrome) { _, value in
            clockID = UUID()
            if value == .asleep { focusedControl = nil; bottomBarFocused = false }
        }
        .onChange(of: session.chapterIndex) { _, _ in
            hasNativeTextSelection = false
            let belongsToSpeech = speechNavigationID == session.navigationID
            if belongsToSpeech { speechNavigationID = nil }
            if !belongsToSpeech && (speech.playing || speech.paused) { speech.userNavigated() }
            reading.enteredChapter(session.chapter.id)
            if chrome == .progress || chrome == .tools { clockID = UUID() }
        }
        .onChange(of: speech.highlight) { _, _ in followSpeechChapter() }
        .onChange(of: speech.following) { _, _ in followSpeechChapter() }
        .onChange(of: session.contentRevision) { _, _ in speech.contentChanged() }
        .onChange(of: session.state.preferences.translationVariant) { _, _ in speech.stop() }
        .onChange(of: session.translationSettings) { _, _ in
            reading.stop(); reading.proposed = nil; tools.consent = nil; speech.stop()
        }
        .task(id: readingRefreshKey) { await refreshReadingContent() }
        .onChange(of: session.state.preferences.viewMode) { _, mode in
            speech.stop()
            readerIsTouching = false; speech.readerIsInteracting = false
            if mode == .source { reading.stop(); reading.offerFirstPassage = false }
            selectionDismissalID = UUID()
        }
        .onChange(of: tools.completedTranslation) { _, row in
            if let row { session.updateTranslations(ReaderReadingContent.translations([row], targetLanguage: session.translationSettings.targetLanguage)) }
        }
        .onChange(of: panel?.isCompanion) { _, active in
            reading.setForeground(scenePhase == .active && active != true)
            if active == true { speech.pause() }
        }
        .sensoryFeedback(.selection, trigger: panel?.id)
        .task(id: clockID) { await settleChrome() }
        .onChange(of: scenePhase) { _, phase in
            reading.setForeground(phase == .active && panel?.isCompanion != true)
            if phase != .active { readerIsTouching = false; speech.readerIsInteracting = false; speech.applicationDidBackground(); session.save(); chrome = .asleep }
        }
    }
    var body: some View {
        Group {
            if let error = session.packageVerificationError { recoveryNotice(error) }
            else { synchronizedReader }
        }
        .onChange(of: session.packageVerificationError) { _, error in
            if error != nil { releaseReadingResources(); panel = nil; session.setReadingVisible(false) }
        }
        .task(id: speechArtworkKey) {
            guard session.packageVerificationError == nil else { return }
            let scheme = session.state.preferences.colorScheme(following: systemColorScheme)
            await speech.prepareArtwork(session, cloud: cloud, library: library, traits: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light))
        }
        .task(id: "\(session.book.sourceVersion):\(session.packageVerificationPending):\(scenePhase)") {
            guard scenePhase == .active, !session.packageVerificationPending, session.packageVerificationError == nil else { guide.cancel(); return }
            await guide.prepare(session: session, library: library, cloud: cloud)
        }
        .task(id: bookmarkMessage) {
            guard bookmarkMessage != nil else { return }
            do { try await Task.sleep(for: .seconds(voiceOverRunning ? 10 : 5)) } catch { return }
            guard !Task.isCancelled else { return }; bookmarkMessage = nil
        }
        .onAppear { configureReading() }
        .onDisappear(perform: releaseReadingResources)
    }
    private func recoveryNotice(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "book.closed").font(.largeTitle).foregroundStyle(.secondary)
            Text("书籍文件需要修复").font(.title2)
            Text(error).font(.body).foregroundStyle(.secondary)
            Text(session.packageRecoveryRetained
                 ? "刚才的阅读位置、笔记与草稿已单独保留。请回书房，在书籍详情中修复文件。"
                 : "当前记录仍保留在这里。请先导出笔记与草稿，再返回书房修复文件。")
                .font(.footnote).foregroundStyle(.secondary)
            Button("导出笔记与草稿", systemImage: "square.and.arrow.up") {
                do {
                    recoveryExport = RecordsDocument(data: try JSONEncoder().encode(RecordsBackup(book: session.book, state: session.openingRecoverySnapshot)))
                    exportingRecovery = true
                } catch { recoveryExportError = error.localizedDescription }
            }.frame(minHeight: 44)
            Button("返回书房") { dismiss() }.frame(minHeight: 44)
                .disabled(!session.packageRecoveryRetained && !recoveryExported)
            if let recoveryExportError { Text(recoveryExportError).font(.footnote).foregroundStyle(.secondary) }
        }.padding(28).frame(maxWidth: 560, maxHeight: .infinity, alignment: .leading)
            .frame(maxWidth: .infinity).background(paper.ignoresSafeArea())
            .interactiveDismissDisabled(!session.packageRecoveryRetained && !recoveryExported)
            .accessibilityIdentifier("reader-opening-recovery")
            .fileExporter(isPresented: $exportingRecovery, document: recoveryExport, contentType: .json, defaultFilename: "Leafhour-recovered-records") { result in
                switch result {
                case .success: recoveryExported = true; recoveryExportError = nil
                case .failure(let error): recoveryExportError = error.localizedDescription
                }
            }
    }
    private func releaseReadingResources() {
        autoPage.stop(); speech.stop(); speech.releasePresentation(); reading.stop(); guide.cancel()
        reading.requestPreparation = nil; reading.requestPassagePreparation = nil; reading.confirmPreparation = nil; reading.requestFollowingPreparation = nil
    }
    @ViewBuilder private var remotePositionNotice: some View {
        if positionConflict {
            HStack {
                Text("另一台设备更新了阅读位置").font(.footnote)
                Spacer()
                Menu("选择位置") {
                    Button("从云端位置继续") { resolvePosition?(false) }
                    Button("保留此设备的位置") { resolvePosition?(true) }
                }
            }.padding(.horizontal, 16).padding(.vertical, 8).background(paper)
        }
    }
    private func settleChrome() async {
        guard chrome != .asleep else { return }
        do { try await Task.sleep(for: .seconds(6)) } catch { return }
        guard !Task.isCancelled, !returningToLibrary, !bottomBarFocused, focusedControl == nil, panel == nil,
              session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }
        sleepChrome()
    }
    private func configureReading() {
        guard session.packageVerificationError == nil else { return }
        speech.speed = session.state.preferences.speechSpeed
        autoPage.setInterval(session.state.preferences.autoPageInterval)
        tools.configure(library: library, localBookID: session.book.id)
        reading.setForeground(scenePhase == .active)
        reading.requestFollowingPreparation = { present(.pageTranslation) }
        let reading = reading, session = session, cloud = cloud, library = library
        reading.requestPreparation = { [weak reading] in
            guard let reading else { return }
            Task { await reading.prepare(session, cloud: cloud, library: library, scope: .chapter) }
        }
        reading.requestPassagePreparation = { [weak reading] in
            guard let reading else { return }
            Task { await reading.prepare(session, cloud: cloud, library: library, scope: .passage) }
        }
        reading.confirmPreparation = { [weak reading] run in reading?.confirm(run, session: session, cloud: cloud, library: library) }
    }
    private func refreshReadingContent() async {
        guard !session.packageVerificationPending, session.packageVerificationError == nil, scenePhase == .active, panel?.isCompanion != true else { return }
        await reading.refresh(session, cloud: cloud, library: library)
        guard !Task.isCancelled else { return }
        guard panel?.id != "page-translation", reading.offerFirstPassage, session.state.preferences.viewMode != .source else { return }
        reading.offerFirstPassage = false
        if session.book.cloud != nil {
            await reading.prepare(session, cloud: cloud, library: library, scope: .passage)
        }
    }
    private func followSpeechChapter() {
        guard speech.following, speech.playing || speech.paused, !hasNativeTextSelection, !speech.readerIsInteracting,
              let highlight = speech.highlight, highlight.location.chapterID != session.chapter.id,
              let index = session.book.chapters.firstIndex(where: { $0.id == highlight.location.chapterID }) else { return }
        let offset = highlight.location.layer == "original" ? SourceTextOffsets(highlight.location.snapshot).scalarOffset(forUTF16Offset: highlight.location.utf16Offset) : 0
        session.go(to: index, anchor: ReadingAnchor(chapterID: highlight.location.chapterID, passageID: highlight.location.passageID, characterOffset: offset))
        speechNavigationID = session.navigationID
    }
    private func recordChrome(_ values: [ReaderChromeMeasurement], for layout: ReaderChromeLayout) {
        if let previous = chromeMetrics?.layout, previous != layout { autoPage.pause(.layout) }
        let current = values.filter { $0.layout == layout }
        guard let top = current.last(where: { $0.region == .top })?.height, top > 0,
              let bottom = current.last(where: { $0.region == .bottom })?.height, bottom > 0 else { return }
        let previous = chromeMetrics?.layout == layout ? chromeMetrics : nil
        // Retain space only inside the same width/height/type/book context.
        // A true resize or OS text change must release the previous tall dock.
        let updated = ReaderChromeMetrics(layout: layout, top: max(previous?.top ?? 0, top),
                                          bottom: max(previous?.bottom ?? 0, bottom))
        if chromeMetrics?.layout != layout || abs((chromeMetrics?.top ?? 0) - updated.top) > 0.5 || abs((chromeMetrics?.bottom ?? 0) - updated.bottom) > 0.5 {
            chromeMetrics = updated
        }
    }
    @ViewBuilder private var quietReadingControl: some View {
        if autoPage.showsStatus && !speech.playing && !speech.paused {
            ReaderAutoPageStatusControl(controller: autoPage, onContinue: startAutoPaging, onSettings: { present(.autoPage) })
                .padding(.horizontal, 16)

        }
    }
    @ViewBuilder private func navigationHeader(compact: Bool) -> some View {
        if dynamicTypeSize.isAccessibilitySize && !compact {
            VStack(spacing: 0) {
                HStack {
                    backButton(compact: false)
                    Spacer(minLength: 8)
                    bookmarkButton
                    moreButton(compact: false)
                }
                bookTitleButton(compact: false)
            }
        } else {
            HStack {
                backButton(compact: compact)
                bookTitleButton(compact: compact)
                bookmarkButton
                moreButton(compact: compact)
            }
        }
    }
    private var activeBookmark: ReaderBookmark? { session.bookmarks(in: bookmarkRanges).first }
    private var bookmarkButton: some View {
        Button {
            if let activeBookmark { bookmarkConfigurationID = activeBookmark.id; present(.bookmarks) }
            else if let capture = bookmarkRanges.first?.capture { addBookmark(capture: capture) }
        } label: {
            Image(systemName: activeBookmark == nil ? "bookmark" : "bookmark.fill")
                .foregroundStyle(activeBookmark?.color.swiftUIColor ?? Color.leafInk)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(bookmarkSaving || session.packageVerificationError != nil || bookmarkRanges.isEmpty)
            .accessibilityLabel(activeBookmark == nil ? "添加当前位置书签" : "编辑本页书签")
            .accessibilityValue(activeBookmark.map { session.isBookmarkPersisted(id: $0.id) ? $0.color.name : "书签尚未保存" } ?? "尚未添加")
            .accessibilityIdentifier("reader-bookmark")
            .contextMenu { Button("查看本书书签", systemImage: "bookmark") { bookmarkConfigurationID = nil; present(.bookmarks) } }
    }
    private func receiveBookmarkPull(_ value: ReaderBookmarkPullVisual) {
        if value.feedback != .idle { bookmarkMessage = nil; bookmarkSavedID = nil }
        withAnimation(value.feedback == .idle && !reduceMotion ? .spring(response: 0.42, dampingFraction: 0.82) : nil) {
            bookmarkPull = value
        }
    }
    private func addBookmark(_ anchor: ReadingAnchor?) {
        guard let anchor else { bookmarkMessage = "当前位置尚未准备好"; return }
        addBookmark(capture: ReaderBookmarkCapture(anchor: anchor))
    }
    private func addBookmark(capture: ReaderBookmarkCapture) {
        guard !bookmarkSaving else { return }
        bookmarkSaving = true
        let navigation = session.navigationID
        Task {
            let result = await session.addBookmark(capture: capture)
            bookmarkSaving = false
            guard session.navigationID == navigation else { return }
            bookmarkMessage = result.message
            switch result {
            case .saved(let id): bookmarkSavedID = id; UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case .existing(let id): bookmarkSavedID = id
            default: bookmarkSavedID = nil
            }
            UIAccessibility.post(notification: .announcement, argument: result.message)
        }
    }
    private func backButton(compact: Bool) -> some View {
        Button { speech.pause(); Task { await finishAndDismiss() } } label: {
            Group {
                if returningToLibrary { ProgressView() }
                else { Label("返回书房", systemImage: "chevron.left").labelStyle(.iconOnly) }
            }.font(compact ? .system(size: 20) : .body)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }.disabled(returningToLibrary)
            .accessibilityLabel(returningToLibrary ? "正在保存阅读记录" : "返回书房")
            .focused($focusedControl, equals: .back)
            .accessibilityHidden(chrome != .top && chrome != .tools)
    }
    private func finishAndDismiss() async {
        guard !returningToLibrary else { return }
        returningToLibrary = true
        defer { returningToLibrary = false }
        autoPage.pause(.panel)
        session.finishReadingTime()
        async let savedTime = session.flushReadingTime()
        async let savedState = session.flush()
        let (timeSaved, receipt) = await (savedTime, savedState)
        guard timeSaved else {
            session.message = session.readingTimeError ?? "阅读时间尚未保存，请打开阅读工具重试。"
            return
        }
        if session.isCurrent(receipt) { dismiss() }
    }
    private func bookTitleButton(compact: Bool) -> some View {
        Button { present(.bookInformation) } label: {
            // Navigation stays bounded at every text size. The information
            // sheet keeps the complete selectable title available on demand.
            if compact {
                Image(systemName: "info.circle").font(.system(size: 20))
                    .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            } else {
                Text(session.book.title).font(.subheadline)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            }
        }.buttonStyle(.plain).foregroundStyle(Color.primary)
            .focused($focusedControl, equals: .bookInformation)
            .accessibilityLabel(session.book.title)
            .accessibilityHint("查看完整书名、作者与来源格式")
            .accessibilityIdentifier("reader-book-title")
            .accessibilityHidden(chrome != .top && chrome != .tools)
    }
    private func moreButton(compact: Bool) -> some View {
        Button { present(.tools) } label: {
            Label("更多", systemImage: "ellipsis")
                .font(compact ? .system(size: 20) : .body)
                .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }.focused($focusedControl, equals: .tools)
            .accessibilityIdentifier("reader-more")
            .accessibilityHidden(chrome != .top && chrome != .tools)
    }
    private var progressDescription: String {
        let unit = session.book.kind == .pdf ? "页" : "章"
        return "第 \(session.chapterIndex + 1) / \(session.book.chapters.count) \(unit) · \(session.chapter.title) · " + progressCaption
    }
    private var progressCaption: String {
        if let fraction = progressIndex?.fraction(chapterIndex: session.chapterIndex, anchor: session.currentAnchor) {
            return (session.book.kind == .pdf ? "" : "约 ") + "\(Int((fraction * 100).rounded()))%"
        }
        return "第 \(session.chapterIndex + 1) / \(session.book.chapters.count) " + (session.book.kind == .pdf ? "页" : "章")
    }
    private func sleepChrome() {
        guard chrome != .asleep, !bottomBarFocused, focusedControl == nil, panel == nil, session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { chrome = .asleep }
    }
    private var speechArtworkKey: String {
        "\(session.book.id):\(session.book.sourceVersion):\(session.book.cloud?.ownerID ?? "device"):\(session.state.preferences.theme):\(session.state.preferences.fontStyle.rawValue):\(session.state.preferences.latinFont.rawValue):\(systemColorScheme == .dark)"
    }
    private func receiveVisiblePage(_ page: ReaderVisiblePage?) {
        if let page, page.isCurrent(session) {
            visiblePage = page
            let marker = readingNavigationID
            Task { await reading.follow(session, cloud: cloud, library: library, page: page, userNavigationID: marker) }
        }
        else if visiblePage?.isCurrent(session) != true { visiblePage = nil }
    }
    private func jumpChapter(_ delta: Int) {
        let index = session.chapterIndex + delta
        guard session.book.chapters.indices.contains(index) else { return }
        reading.suspendForUserNavigation(); readingNavigationID = UUID()
        autoPage.pause(.interaction); speech.userNavigated(); session.go(to: index)
        hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); chrome = .tools; clockID = UUID()
    }
    private func revealProgress() { progressVisible = true; progressPulse = UUID() }
    private func readingDidScroll() { reading.suspendForUserNavigation(); readingNavigationID = UUID(); revealProgress(); autoPage.pause(.interaction); session.recordReadingInteraction(); speech.userNavigated(); hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); sleepChrome() }
    private func wake(_: ReaderChrome) { session.recordReadingInteraction(); withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { chrome = chrome == .tools ? .asleep : .tools } }
    private func revealTools() {
        autoPage.pause(.interaction)
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { chrome = .tools }
        clockID = UUID()
    }
    private func present(_ value: ReaderPanel) { conversationAutoLoad = true; session.setReadingVisible(false); autoPage.pause(.panel); panel = value; chrome = .asleep }
    private func presentPreparedGuideConversation() -> Bool {
        guard panel?.id == "reading-guide", scenePhase == .active, session.packageVerificationError == nil else { return false }
        present(.conversation); conversationAutoLoad = false; return true
    }
    private var autoPageConditions: ReaderAutoPageConditions {
        ReaderAutoPageConditions(isForeground: scenePhase == .active,
            isPaged: session.state.preferences.navigationMode == .paged,
            hasSelection: session.selection != nil || hasNativeTextSelection,
            isTouching: readerIsTouching, hasPanel: panel != nil || bottomBarFocused || focusedControl != nil,
            isListening: speech.playing, voiceOverEnabled: voiceOverRunning,
            hasAlert: session.message != nil || session.saveMessage != nil || reading.proposed != nil || tools.consent != nil || positionConflict)
    }
    private func readingTouchChanged(_ active: Bool) {
        speech.readerIsInteracting = active
        guard readerIsTouching != active else { return }
        readerIsTouching = active
        if active { autoPage.pause(.interaction) }
    }
    private func startAutoPaging() {
        speech.stop()
        focusedControl = nil; bottomBarFocused = false
        if session.state.preferences.navigationMode != .paged {
            var preferences = session.state.preferences; preferences.navigationMode = .paged
            session.changePreferences(preferences)
        }
        if panel != nil {
            startAutoPageOnDismiss = true; panel = nil
        } else { beginAutoPaging() }
    }
    private func beginAutoPaging() {
        autoPage.setInterval(session.state.preferences.autoPageInterval)
        autoPage.update(autoPageConditions, navigationID: session.navigationID)
        autoPage.start(); chrome = .asleep
    }
    private func showNote(_ quote: SelectedQuote) {
        autoPage.pause(.panel)
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
        session.setReadingVisible(false)
        autoPage.pause(.panel)
        hasNativeTextSelection = false
        session.selection = nil
        selectionDismissalID = UUID()
        focusedControl = nil
        chrome = .asleep
        panel = .companion(quote)
    }
}
