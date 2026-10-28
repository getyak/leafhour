import SwiftUI
import UIKit
import LeafhourCore

enum ReaderChrome { case asleep, top, progress }
enum ReaderPanel: Identifiable {
    case contents, search, preferences, records, note(SelectedQuote), source(SelectedQuote)
    var id: String {
        switch self { case .contents: "contents"; case .search: "search"; case .preferences: "preferences"; case .records: "records"; case .note(let quote): "note-" + quote.id; case .source(let quote): "source-" + quote.id }
    }
}
struct ReaderScreen: View {
    @Bindable var session: ReaderSession
    let systemColorScheme: ColorScheme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var chrome: ReaderChrome = .asleep
    @State private var panel: ReaderPanel?
    @State private var clockID = UUID()
    @State private var adjustingProgress = false
    private enum ChromeFocus: Hashable { case back, preferences, previous, next, progress, contents, search, records }
    @FocusState private var focusedControl: ChromeFocus?
    private var paper: Color { session.state.preferences.theme == "paper" ? .readingPaper : Color(uiColor: .systemBackground) }
    var body: some View {
        ZStack(alignment: .top) {
            paper.ignoresSafeArea()
            if session.book.kind == .pdf {
                PDFReadingView(session: session, onSelection: { session.selection = $0 }, onWake: wake, onReadingScroll: sleepChrome)
            } else {
                TextReadingView(session: session, onNote: { showNote($0) }, onSource: { panel = .source($0); chrome = .asleep }, onWake: wake, onReadingScroll: sleepChrome)
            }
            VStack(spacing: 0) {
                if chrome == .top {
                    HStack {
                        Button("返回书房", systemImage: "chevron.left") { Task { await session.flush(); if session.saveError == nil { dismiss() } } }.focused($focusedControl, equals: .back).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        Text(session.book.title).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity)
                        Button("阅读设置", systemImage: "textformat.size") { panel = .preferences; chrome = .asleep }.focused($focusedControl, equals: .preferences).labelStyle(.iconOnly).frame(width: 44, height: 44)
                    }.padding(.horizontal, 10).background(.regularMaterial)
                } else {
                    Button { wake(.top) } label: { Color.clear.frame(maxWidth: .infinity).frame(height: 44) }.allowsHitTesting(false)
                        .accessibilityLabel("显示书名、返回与阅读设置")
                }
                Spacer()
                if let quote = session.selection, session.book.kind == .pdf {
                    HStack { Text("已选择原文").font(.footnote); Spacer(); Button("记笔记", systemImage: "square.and.pencil") { showNote(quote) }; Button("取消") { session.selection = nil } }.padding().background(.regularMaterial)
                }
                if chrome == .progress {
                    VStack(spacing: 10) {
                        HStack {
                            Button(session.book.kind == .pdf ? "上一页" : "上一章", systemImage: "chevron.left") { session.go(to: session.chapterIndex - 1) }.focused($focusedControl, equals: .previous).disabled(session.chapterIndex == 0).labelStyle(.iconOnly).frame(width: 44, height: 44)
                            Text("\(session.chapterIndex + 1) / \(session.book.chapters.count) · \(session.chapter.title)").font(.footnote).lineLimit(1).frame(maxWidth: .infinity)
                            Button(session.book.kind == .pdf ? "下一页" : "下一章", systemImage: "chevron.right") { session.go(to: session.chapterIndex + 1) }.focused($focusedControl, equals: .next).disabled(session.chapterIndex + 1 == session.book.chapters.count).labelStyle(.iconOnly).frame(width: 44, height: 44)
                        }
                        if session.book.chapters.count > 1 {
                            Slider(value: Binding(get: { Double(session.chapterIndex) }, set: { session.go(to: Int($0.rounded())) }), in: 0...Double(session.book.chapters.count - 1), step: 1, onEditingChanged: { adjustingProgress = $0; clockID = UUID() }).focused($focusedControl, equals: .progress).accessibilityLabel(session.book.kind == .pdf ? "页码" : "章节")
                        }
                        HStack {
                            Button("目录", systemImage: "list.bullet") { panel = .contents; chrome = .asleep }.focused($focusedControl, equals: .contents); Spacer()
                            Button("搜索", systemImage: "magnifyingglass") { panel = .search; chrome = .asleep }.focused($focusedControl, equals: .search); Spacer()
                            Button("我的记录", systemImage: "square.and.pencil") { panel = .records; chrome = .asleep }.focused($focusedControl, equals: .records)
                        }.font(.subheadline).frame(minHeight: 44)
                    }.padding(.horizontal, 18).padding(.bottom, 14).background(.regularMaterial)
                } else {
                    Button { wake(.progress) } label: { Color.clear.frame(maxWidth: .infinity).frame(height: 44) }.allowsHitTesting(false).accessibilityLabel("显示阅读进度、目录、搜索与记录")
                }
            }
        }
        .preferredColorScheme(session.state.preferences.colorScheme(following: systemColorScheme))
        .statusBarHidden(false)
        .interactiveDismissDisabled(session.saving || session.saveError != nil)
        .sheet(item: $panel, onDismiss: { chrome = .asleep }) { destination in
            ReaderPanelView(panel: destination, session: session, systemColorScheme: systemColorScheme, onJump: { index, anchor in session.go(to: index, anchor: anchor); panel = nil })
                .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        }
        .alert("阅读记录", isPresented: Binding(get: { session.message != nil }, set: { if !$0 { session.message = nil } })) { Button("重试保存") { session.message = nil; session.save() } } message: { Text(session.message ?? "") }
        .onChange(of: focusedControl) { _, _ in clockID = UUID() }
        .onChange(of: session.selection?.id) { _, _ in clockID = UUID() }
        .onChange(of: chrome) { _, _ in clockID = UUID() }
        .onChange(of: session.chapterIndex) { _, _ in if chrome == .progress { clockID = UUID() } }
        .task(id: clockID) {
            guard chrome != .asleep else { return }
            do { try await Task.sleep(for: .seconds(3)); guard !Task.isCancelled, !adjustingProgress, focusedControl == nil, panel == nil, session.selection == nil, !UIAccessibility.isVoiceOverRunning else { return }; sleepChrome() } catch {}
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { session.save(); chrome = .asleep } }
    }
    private func sleepChrome() {
        guard chrome != .asleep, !adjustingProgress, focusedControl == nil, panel == nil, session.selection == nil, !UIAccessibility.isVoiceOverRunning else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { chrome = .asleep }
    }
    private func wake(_ value: ReaderChrome) { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { chrome = value } }
    private func showNote(_ quote: SelectedQuote) {
        let draft = session.state.drafts[quote.anchor.key]
        panel = .note(draft.map { SelectedQuote(anchor: $0.anchor, text: $0.quote) } ?? quote)
        chrome = .asleep
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
