import SwiftUI
import LeafhourCore

/// A drop is a shortcut for the current native selection, not imported context.
enum ReaderSelectionDrop {
    static func accepts(_ items: [String], quote: SelectedQuote) -> Bool {
        items.count == 1 && !quote.text.isEmpty && items[0] == quote.text
    }
}

struct ReaderAIButton: View {
    var paper: Color
    var quote: SelectedQuote?
    var onOpen: () -> Void
    @State private var targeted = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Button(action: onOpen) {
            Image(systemName: targeted ? "quote.bubble.fill" : "sparkles")
                .font(.system(size: 21, weight: .medium))
                .frame(width: 48, height: 48)
                .background(.primary.opacity(targeted ? 0.12 : 0), in: Circle())
                .modifier(ReaderGlassSurface(paper: paper, cornerRadius: 24)).contentShape(Circle())
        }.buttonStyle(.plain)
            .scaleEffect(targeted && !reduceMotion ? 1.08 : 1)
            .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: targeted)
            .sensoryFeedback(.selection, trigger: targeted)
            .accessibilityLabel(quote == nil ? "与 AI 聊这本书" : "引用选文与 AI 聊天")
            .accessibilityHint("也可把选文卡片拖到这里，引用后再输入问题")
            .accessibilityIdentifier("reader-ai")
            .dropDestination(for: String.self) { items, _ in
                guard let quote, ReaderSelectionDrop.accepts(items, quote: quote) else { return false }
                onOpen(); return true
            } isTargeted: { targeted = $0 && quote != nil }
    }
}

struct ReaderSelectionDock: View {
    let quote: SelectedQuote
    let paper: Color
    let onAI: () -> Void
    let onNote: () -> Void
    let onTranslate: () -> Void
    let onShare: () -> Void
    let onClear: () -> Void
    @State private var copied = false
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "text.quote").accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(quote.origin == "translation" ? "选中的译文 · 拖到 AI 引用" : "选中的原文 · 拖到 AI 引用").font(.caption2).foregroundStyle(.secondary)
                    Text(quote.text).font(.footnote).lineLimit(2)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "hand.draw").font(.caption).accessibilityHidden(true)
            }.padding(12).modifier(ReaderGlassSurface(paper: paper, cornerRadius: 18, interactive: false))
                .draggable(quote.text)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("可拖动的选文，" + quote.text)
                .accessibilityIdentifier("reader-selection-drag")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { actions(compact: false); ReaderAIButton(paper: paper, quote: quote, onOpen: onAI) }.fixedSize(horizontal: true, vertical: false)
                HStack(spacing: 10) { actions(compact: true); ReaderAIButton(paper: paper, quote: quote, onOpen: onAI) }
            }

        }.accessibilityElement(children: .contain).accessibilityIdentifier("reader-selection-dock").onChange(of: quote) { _, _ in copied = false }
    }
    private func actions(compact: Bool) -> some View {
        HStack(spacing: 0) {
            action(copied ? "已复制" : "复制", symbol: copied ? "checkmark" : "doc.on.doc", id: "reader-selection-copy") { UIPasteboard.general.string = quote.text; copied = true }
            if compact {
                Menu("更多选文操作", systemImage: "ellipsis") {
                    Button("记笔记", systemImage: "square.and.pencil", action: onNote)
                    Button("翻译", systemImage: "character.book.closed", action: onTranslate)
                    Button("分享摘录", systemImage: "square.and.arrow.up", action: onShare)
                }.labelStyle(.iconOnly).font(.system(size: typeSize.isAccessibilitySize ? 26 : 20)).frame(minWidth: 44, minHeight: 44)
            } else {
                action("记笔记", symbol: "square.and.pencil", id: "reader-selection-note", action: onNote)
                action("翻译", symbol: "character.book.closed", id: "reader-selection-translate", action: onTranslate)
                action("分享摘录", symbol: "square.and.arrow.up", id: "reader-selection-share", action: onShare)
            }
            action("取消选择", symbol: "xmark", id: "reader-selection-clear", action: onClear)
        }.padding(3).modifier(ReaderGlassSurface(paper: paper))
    }
    private func action(_ title: String, symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: typeSize.isAccessibilitySize ? 26 : 20)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
            .buttonStyle(.plain).accessibilityLabel(title).accessibilityIdentifier(id)
    }
}
