import SwiftUI
import UIKit
import LeafhourCore

/// Resolve against this reader's proposed space, never a physical screen or a
/// device name. There is no hinge information in the supported iOS 17+ SDK path.
struct ReaderAdaptiveLayout: Equatable {
    let size: CGSize
    let minimumReadingWidth: CGFloat
    let accessibilityText: Bool
    let toolIsOpen: Bool

    var isBeside: Bool {
        toolIsOpen && !accessibilityText && size.height >= 360
            && size.width >= max(360, minimumReadingWidth) + 341
    }
    var toolWidth: CGFloat { isBeside ? min(420, max(340, size.width * 0.38)) : max(0, size.width) }
    var readingWidth: CGFloat { isBeside ? max(0, size.width - toolWidth - 1) : max(0, size.width) }
}

/// The same two structural children survive every resize. In compact space the
/// tool covers the source; beside it the source remains usable. No dismissal,
/// new editor, request, or ReaderSession is caused by changing the arrangement.
struct ReaderAdaptiveSurface<Primary: View, Tool: View>: View {
    let toolIsOpen: Bool
    let minimumReadingWidth: CGFloat
    let accessibilityText: Bool
    @ViewBuilder let primary: () -> Primary
    @ViewBuilder let tool: () -> Tool

    var body: some View {
        GeometryReader { geometry in
            let layout = ReaderAdaptiveLayout(size: geometry.size, minimumReadingWidth: minimumReadingWidth,
                                              accessibilityText: accessibilityText, toolIsOpen: toolIsOpen)
            ZStack(alignment: .trailing) {
                primary()
                    .frame(width: layout.readingWidth, height: geometry.size.height)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .allowsHitTesting(!toolIsOpen || layout.isBeside)
                    .accessibilityHidden(toolIsOpen && !layout.isBeside)
                if toolIsOpen {
                    tool()
                        .frame(width: layout.toolWidth, height: geometry.size.height)
                        .background(Color(uiColor: .systemBackground))
                        .overlay(alignment: .leading) { if layout.isBeside { Divider() } }
                        .accessibilityIdentifier(layout.isBeside ? "reader-tool-side-area" : "reader-tool-page")
                }
            }
        }
    }
}

/// A real native button keeps the quiet entry usable with touch, VoiceOver,
/// keyboard focus and Switch Control while the source remains fully selectable.
struct ReaderToolsEntry: UIViewRepresentable {
    let listening: Bool
    let onOpen: () -> Void

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.accessibilityIdentifier = "reader-tools"
        button.accessibilityLabel = "阅读工具"
        button.accessibilityHint = "目录、语言、文字与纸面、笔记、听读和陪读"
        button.addAction(UIAction { _ in context.coordinator.onOpen() }, for: .touchUpInside)
        button.setContentHuggingPriority(.required, for: .horizontal)
        button.setContentHuggingPriority(.required, for: .vertical)
        update(button)
        return button
    }
    func updateUIView(_ button: UIButton, context: Context) { context.coordinator.onOpen = onOpen; update(button) }
    func makeCoordinator() -> Coordinator { Coordinator(onOpen: onOpen) }
    final class Coordinator {
        var onOpen: () -> Void
        init(onOpen: @escaping () -> Void) { self.onOpen = onOpen }
    }
    private func update(_ button: UIButton) {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: listening ? "ellipsis.circle" : "ellipsis")
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)
        configuration.baseForegroundColor = UIColor(Color.leafInk)
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
        button.configuration = configuration
        button.accessibilityValue = listening ? "正在听书" : nil
    }
}

struct ReaderQuietToolsPanel: View {
    @Bindable var session: ReaderSession
    @Bindable var speech: ReaderSpeech
    let onPresent: (ReaderPanel) -> Void
    let onNote: () -> Void
    let onCompanion: () -> Void
    let onReturnToLibrary: () -> Void
    @State private var export: RecordsDocument?
    @State private var exporting = false

    private var textMode: Binding<ReaderTextMode> {
        Binding(get: { session.state.preferences.textMode }, set: { value in
            var preferences = session.state.preferences; preferences.textMode = value; session.changePreferences(preferences)
        })
    }
    private var translationVariant: Binding<ReaderTranslationVariant> {
        Binding(get: { session.state.preferences.translationVariant }, set: { value in
            var preferences = session.state.preferences; preferences.translationVariant = value; session.changePreferences(preferences)
        })
    }
    private var automaticTranslation: Binding<Bool> {
        Binding(get: { session.state.preferences.automaticTranslation }, set: { value in
            var preferences = session.state.preferences; preferences.automaticTranslation = value; session.changePreferences(preferences)
        })
    }
    var body: some View {
        List {
            Section {
                Text(session.book.title).font(.headline).textSelection(.enabled)
                Text(session.chapter.title).font(.subheadline).foregroundStyle(.secondary)
                entry("目录与进度", "list.bullet", panel: .contents, identifier: "reader-contents")
                entry("搜索原文", "magnifyingglass", panel: .search)
                entry("书籍信息", "info.circle", panel: .bookInformation, identifier: "reader-book-title")
            }
            if session.book.kind != .pdf {
                Section("正文语言") {
                    Picker("阅读方式", selection: textMode) {
                        Text("原文").tag(ReaderTextMode.original)
                        Text("译文").tag(ReaderTextMode.translation)
                        Text("原译对照").tag(ReaderTextMode.parallel)
                    }.accessibilityIdentifier("reader-text-mode")
                    Picker("译法", selection: translationVariant) {
                        Text("直译").tag(ReaderTranslationVariant.literal)
                        Text("意译").tag(ReaderTranslationVariant.interpretive)
                    }.accessibilityIdentifier("reader-text-variant")
                    Toggle("自动准备译文", isOn: automaticTranslation)
                        .accessibilityIdentifier("reader-auto-translation")
                    Text("只准备当前章和紧接的下一章。原文随时保留；译文与作者原文分开。").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("自动准备译文") {
                ReaderAutomaticTranslationStatus(session: session)
                Text("当前章优先，然后只提前准备下一章。新段双译按服务价格使用阅读点；已有译文直接复用。可随时关闭。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("手边工具") {
                entry("文字与纸面", "textformat.size", panel: .preferences, identifier: "reader-typography")
                entry("外观", "circle.lefthalf.filled", panel: .appearance, identifier: "reader-appearance")
                Button(action: onNote) { Label("记笔记", systemImage: "square.and.pencil").frame(minHeight: 44) }
                    .accessibilityIdentifier("reader-note")
                entry("我的记录", "note.text", panel: .records)
                entry("这一段的译文", "character.book.closed", panel: .translation)
                entry(speech.playing ? "正在听书" : speech.paused ? "继续听读" : "听一会儿", "headphones", panel: .listening, identifier: "reader-listen")
                Button(action: onCompanion) { Label("阅读陪读", systemImage: "bubble.left.and.bubble.right").frame(minHeight: 44) }
                    .accessibilityIdentifier("reader-companion")
                entry("导读与摘要", "text.book.closed", panel: .introduction)
            }
            Section("带走自己的记录") {
                ShareLink(item: session.original) { Label("分享此设备上的书籍文件", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                Button {
                    do { export = RecordsDocument(data: try JSONEncoder().encode(RecordsBackup(book: session.book, state: session.state))); exporting = true }
                    catch { session.message = error.localizedDescription }
                } label: { Label("导出笔记与草稿", systemImage: "doc.text").frame(minHeight: 44) }
                entry("更多书房工具", "globe", panel: .webTools)
            }
            Section {
                Button(action: onReturnToLibrary) { Label("返回书房", systemImage: "chevron.left").frame(minHeight: 44) }
                    .accessibilityIdentifier("reader-return-library")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle("阅读工具")
        .fileExporter(isPresented: $exporting, document: export, contentType: .json, defaultFilename: "Leafhour-records") { result in
            if case .failure(let error) = result { session.message = error.localizedDescription }
        }
    }
    private func entry(_ title: String, _ symbol: String, panel: ReaderPanel, identifier: String = "") -> some View {
        Button { onPresent(panel) } label: { Label(title, systemImage: symbol).frame(minHeight: 44) }
            .accessibilityIdentifier(identifier)
    }
}
