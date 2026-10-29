import SwiftUI
import UIKit
import LeafhourCore

enum ReaderChrome { case asleep, top, progress, tools }
private enum ReaderChromeRegion: Hashable { case top, bottom }
private struct ReaderChromeHeightKey: PreferenceKey {
    static var defaultValue: [ReaderChromeRegion: CGFloat] = [:]
    static func reduce(value: inout [ReaderChromeRegion: CGFloat], nextValue: () -> [ReaderChromeRegion: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}
enum ReaderPanel: Identifiable {
    case contents, search, preferences, records, tools, listening, translation, introduction, conversation, note(SelectedQuote), source(SelectedQuote), companion(SelectedQuote?)
    var isCompanion: Bool { switch self { case .companion, .conversation: true; default: false } }
    var isNoteEditor: Bool { if case .note = self { true } else { false } }
    var id: String {
        switch self {
        case .contents: "contents"; case .search: "search"; case .preferences: "preferences"; case .records: "records"
        case .tools: "tools"; case .listening: "listening"; case .translation: "translation"
        case .introduction: "introduction"; case .conversation: "conversation"
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
    @State private var chrome: ReaderChrome = .tools
    @State private var panel: ReaderPanel?
    @State private var speech = ReaderSpeech()
    @State private var tools = ReaderCloudTools()
    @State private var clockID = UUID()
    @State private var adjustingProgress = false
    @State private var selectionDismissalID = UUID()
    @State private var hasNativeTextSelection = false
    @State private var chromeHeights: [ReaderChromeRegion: CGFloat] = [.top: 44, .bottom: 156]
    private enum ChromeFocus: Hashable { case back, preferences, companion, previous, next, progress, contents, listening, translation, records, tools }
    @FocusState private var focusedControl: ChromeFocus?
    private var paper: Color { session.state.preferences.theme == "paper" ? .readingPaper : Color(uiColor: .systemBackground) }
    // Keep page margins stable when chrome sleeps. Only a real control-size change
    // updates them, so waking the tools never reflows the chapter or moves its anchor.
    private var pageInsets: UIEdgeInsets {
        UIEdgeInsets(top: max(64, (chromeHeights[.top] ?? 44) + 16), left: 24,
                     bottom: max(44, (chromeHeights[.bottom] ?? 156) + 24), right: 24)
    }
    var body: some View {
        ZStack(alignment: .top) {
            paper.ignoresSafeArea()
            if session.book.kind == .pdf {
                PDFReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onSelection: { quote in
                    // PDFView can synchronously notify while its native selection is being cleared.
                    if quote != nil || session.selection != nil { session.selection = quote }
                }, onWake: wake, onReadingScroll: readingDidScroll)
            } else {
                TextReadingView(session: session, pageInsets: pageInsets, selectionDismissalID: selectionDismissalID, onNote: { showNote($0) }, onSource: { panel = .source($0); chrome = .asleep }, onExplain: { showCompanion($0) }, onWake: wake, onReadingScroll: readingDidScroll,
                    onTranslate: { session.selection = $0; present(.translation) },
                    onSelectionChange: { quote, active in session.selection = quote; hasNativeTextSelection = active })
            }
            VStack(spacing: 0) {
                if chrome == .top || chrome == .tools {
                    HStack {
                        Button("返回书房", systemImage: "chevron.left") { Task { let receipt = await session.flush(); if session.isCurrent(receipt) { dismiss() } } }.focused($focusedControl, equals: .back).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        Text(session.book.title).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity)
                        Button("陪我读", systemImage: "text.bubble") { showCompanion(currentQuote) }.focused($focusedControl, equals: .companion).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        Button("阅读设置", systemImage: "textformat.size") { panel = .preferences; chrome = .asleep }.focused($focusedControl, equals: .preferences).labelStyle(.iconOnly).frame(width: 44, height: 44)
                    }.padding(.horizontal, 10).background(paper)
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
                    VStack(spacing: 10) {
                        HStack {
                            Button(session.book.kind == .pdf ? "上一页" : "上一章", systemImage: "chevron.left") { session.go(to: session.chapterIndex - 1) }.focused($focusedControl, equals: .previous).disabled(session.chapterIndex == 0).labelStyle(.iconOnly).frame(width: 44, height: 44)
                            Button { wake(.progress) } label: {
                                Text("\(session.chapterIndex + 1) / \(session.book.chapters.count) · \(session.chapter.title)").font(.footnote).lineLimit(1).frame(maxWidth: .infinity).frame(minHeight: 44)
                            }.buttonStyle(.plain).accessibilityLabel("调整阅读进度")
                            Button(session.book.kind == .pdf ? "下一页" : "下一章", systemImage: "chevron.right") { session.go(to: session.chapterIndex + 1) }.focused($focusedControl, equals: .next).disabled(session.chapterIndex + 1 == session.book.chapters.count).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        }
                        if chrome == .progress && session.book.chapters.count > 1 {
                            Slider(value: Binding(get: { Double(session.chapterIndex) }, set: { session.go(to: Int($0.rounded())) }), in: 0...Double(session.book.chapters.count - 1), step: 1, onEditingChanged: { adjustingProgress = $0; clockID = UUID() }).focused($focusedControl, equals: .progress).accessibilityLabel(session.book.kind == .pdf ? "页码" : "章节")
                        }
                        HStack(spacing: 4) {
                            ReaderDockButton("目录", symbol: "list.bullet") { present(.contents) }.focused($focusedControl, equals: .contents)
                            ReaderDockButton("听书", symbol: speech.playing ? "waveform" : "headphones") { present(.listening) }.focused($focusedControl, equals: .listening)
                            ReaderDockButton("翻译", symbol: "character.book.closed") { present(.translation) }.focused($focusedControl, equals: .translation)
                            ReaderDockButton("笔记", symbol: "square.and.pencil", accessibility: "我的记录") { present(.records) }.focused($focusedControl, equals: .records)
                            ReaderDockButton("更多", symbol: "ellipsis") { present(.tools) }.focused($focusedControl, equals: .tools)
                        }
                    }.padding(.horizontal, 18).padding(.bottom, 12).padding(.top, 4)
                        .background(paper, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.primary.opacity(0.08)) }
                        .shadow(color: .black.opacity(0.08), radius: 12, y: 3)
                        .padding(.horizontal, 12).padding(.bottom, 6)
                        .accessibilityIdentifier("reader-tool-dock")
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
                            }.accessibilityLabel("显示阅读进度、目录、搜索与记录").accessibilityHint("轻点书页底边也能打开阅读工具")
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
                // The progress slider can make the dock taller than its tools state.
                // Keep that room for this reading session so returning to tools at
                // the chapter end cannot clamp the page to a different offset.
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
            do { try await Task.sleep(for: .seconds(6)); guard !Task.isCancelled, !adjustingProgress, focusedControl == nil, panel == nil, session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }; sleepChrome() } catch {}
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { speech.pause(); session.save(); chrome = .asleep } }
        .onAppear { tools.configure(library: library, localBookID: session.book.id) }
        .onDisappear { speech.stop() }
    }
    private func sleepChrome() {
        guard chrome != .asleep, !adjustingProgress, focusedControl == nil, panel == nil, session.selection == nil, !hasNativeTextSelection, !UIAccessibility.isVoiceOverRunning else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { chrome = .asleep }
    }
    private func readingDidScroll() { hasNativeTextSelection = false; session.clearTransientSelection(); selectionDismissalID = UUID(); sleepChrome() }
    private func wake(_ value: ReaderChrome) { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { chrome = value } }
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

private struct ReaderDockButton: View {
    let title: String
    let symbol: String
    let accessibility: String
    let action: () -> Void
    init(_ title: String, symbol: String, accessibility: String? = nil, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.accessibility = accessibility ?? title; self.action = action
    }
    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) { Image(systemName: symbol).font(.system(size: 18, weight: .regular)); Text(title).font(.caption2) }
                .frame(maxWidth: .infinity).frame(minHeight: 52).contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(Color.leafInk).accessibilityLabel(accessibility)
    }
}

/// A tap must finish at a reading edge. Selection, links and scrolling retain their system gestures.
@MainActor final class ReaderEdgeTapHandler: NSObject, UIGestureRecognizerDelegate {
    private weak var view: UIView?
    private let blocked: () -> Bool
    private let onWake: (ReaderChrome) -> Void
    init(view: UIView, blocked: @escaping () -> Bool, onWake: @escaping (ReaderChrome) -> Void) {
        self.view = view; self.blocked = blocked; self.onWake = onWake
        super.init()
        let tap = UITapGestureRecognizer(target: self, action: #selector(activate(_:)))
        tap.cancelsTouchesInView = false; tap.delegate = self; view.addGestureRecognizer(tap)
    }
    private func edge(at point: CGPoint) -> ReaderChrome? {
        guard let view else { return nil }
        if point.y < view.bounds.minY + 44 { return .top }
        if point.y > view.bounds.maxY - 44 { return .progress }
        return nil
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        !blocked() && edge(at: touch.location(in: view)) != nil
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    @objc private func activate(_ tap: UITapGestureRecognizer) {
        guard tap.state == .ended, !blocked(), let edge = edge(at: tap.location(in: view)) else { return }
        onWake(edge)
    }
}
