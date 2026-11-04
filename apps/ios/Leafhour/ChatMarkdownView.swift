import SwiftUI
import UIKit
import LeafhourCore

/// The same CommonMark/GFM parser used by the reader renders complete chat blocks.
struct ChatMarkdownView: UIViewRepresentable {
    let source: String
    var plainText = false
    var copySource: String? = nil
    var onReference: (() -> Void)? = nil
    var onLike: (() -> Void)? = nil
    var liked = false
    var onReact: ((String) -> Void)? = nil
    var onSelectMessage: (() -> Void)? = nil
    var onShareMessage: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    func makeUIView(context: Context) -> UITextView {
        let view = Self.makeNativeTextView()
        view.delegate = context.coordinator
        configureActions(context.coordinator)
        return view
    }
    static func makeNativeTextView() -> UITextView {
        let storage = NSTextStorage()
        let layout = ChatTextLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.heightTracksTextView = false
        storage.addLayoutManager(layout); layout.addTextContainer(container)
        let view = UITextView(frame: .zero, textContainer: container)
        view.isEditable = false; view.isSelectable = true; view.isScrollEnabled = false
        view.clipsToBounds = false // The outer history clips; native italic ink may overhang its advance.
        view.backgroundColor = .clear; view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
        // SwiftUI's category owns every rendered font and its measured layout.
        view.adjustsFontForContentSizeCategory = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.linkTextAttributes = [.foregroundColor: UIColor.tintColor, .underlineStyle: NSUnderlineStyle.single.rawValue]
        return view
    }
    private func configureActions(_ coordinator: Coordinator) {
        coordinator.onReference = onReference; coordinator.onLike = onLike; coordinator.liked = liked
        coordinator.copySource = copySource ?? source
        coordinator.onReact = onReact; coordinator.onSelectMessage = onSelectMessage; coordinator.onShareMessage = onShareMessage
    }
    func updateUIView(_ view: UITextView, context: Context) {
        configureActions(context.coordinator)
        // SwiftUI supplies the first useful width through sizeThatFits. Avoid
        // rendering a speculative narrow column before that measurement.
        guard view.bounds.width > 0 else { return }
        context.coordinator.update(view, source: source, width: view.bounds.width, category: ReaderTypography.category(for: dynamicTypeSize), plainText: plainText)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return context.coordinator.size(uiView, source: source, width: width, category: ReaderTypography.category(for: dynamicTypeSize), plainText: plainText)
    }
    static func render(_ source: String, width: CGFloat, category: UIContentSizeCategory? = nil) -> NSAttributedString {
        render(MarkdownDocument(source: source), width: width, category: category)
    }
    private static func render(_ document: MarkdownDocument, width: CGFloat, category: UIContentSizeCategory?) -> NSAttributedString {
        ChatMarkdownLayout(document: document, width: width, category: category ?? UITraitCollection.current.preferredContentSizeCategory).attributed()
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, UITextViewDelegate {
        var onReference: (() -> Void)?
        var onLike: (() -> Void)?
        var liked = false
        var onReact: ((String) -> Void)?
        var onSelectMessage: (() -> Void)?
        var onShareMessage: (() -> Void)?
        var copySource: String?
        private var plainText = false
        private var source: String?
        private var document: MarkdownDocument?
        private var width: CGFloat?
        private var category: UIContentSizeCategory?
        private var attributed: NSAttributedString?
        private var measured: CGSize?
        private weak var installedView: UITextView?
        private var installedText: NSAttributedString?
        /// updateUIView and sizeThatFits often receive the same answer many
        /// times during keyboard/navigation layout. Parse once per text value,
        /// then reuse the measured native layout until width/type changes.
        func rendered(_ source: String, width: CGFloat, category: UIContentSizeCategory, plainText: Bool = false) -> NSAttributedString {
            if self.source != source || self.plainText != plainText {
                self.source = source; self.plainText = plainText; document = plainText ? nil : MarkdownDocument(source: source)
                attributed = nil
            }
            if attributed == nil || self.width != width || self.category != category {
                self.width = width; self.category = category; measured = nil
                if plainText {
                    attributed = NSAttributedString(string: source, attributes: [.font: UIFont.preferredFont(forTextStyle: .subheadline, compatibleWith: UITraitCollection(preferredContentSizeCategory: category)), .foregroundColor: UIColor.label])
                } else { attributed = ChatMarkdownView.render(document!, width: width, category: category) }
            }
            return attributed!
        }
        func update(_ view: UITextView, source: String, width: CGFloat, category: UIContentSizeCategory, plainText: Bool = false) {
            let result = rendered(source, width: width, category: category, plainText: plainText)
            if installedView !== view || installedText !== result {
                view.attributedText = result
                view.accessibilityLabel = result.string
                installedView = view; installedText = result
            }
        }
        func size(_ view: UITextView, source: String, width: CGFloat, category: UIContentSizeCategory, plainText: Bool = false) -> CGSize {
            if view.bounds.width != width { view.bounds.size.width = width }
            update(view, source: source, width: width, category: category, plainText: plainText)
            if let measured { return measured }
            let native = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            // UITextView prefers the narrowest width that fits its current text.
            // SwiftUI owns the column width; returning that narrower size makes
            // updateUIView and the next proposal repeatedly reflow each other.
            let result = CGSize(width: width, height: native.height)
            measured = result; return result
        }
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            var actions = [UIMenuElement]()
            if let onReference { actions.append(UIAction(title: "引用", image: UIImage(systemName: "arrowshape.turn.up.left")) { _ in onReference() }) }
            if let onLike { actions.append(UIAction(title: liked ? "取消点赞" : "点赞", image: UIImage(systemName: liked ? "hand.thumbsup.fill" : "hand.thumbsup")) { _ in onLike() }) }
            if let onReact { actions.append(UIMenu(title: "表情", children: ReaderCloudTools.reactionChoices.map { emoji in UIAction(title: emoji) { _ in onReact(emoji) } })) }
            if let onSelectMessage { actions.append(UIAction(title: "多选", image: UIImage(systemName: "checkmark.circle")) { _ in onSelectMessage() }) }
            if let onShareMessage { actions.append(UIAction(title: "分享 / 转发", image: UIImage(systemName: "square.and.arrow.up")) { _ in onShareMessage() }) }
            if onReference != nil || onLike != nil {
                let message = copySource ?? source ?? textView.text ?? ""
                actions.append(UIAction(title: "复制消息", image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.string = message })
            }
            guard !actions.isEmpty else { return nil }
            return UIMenu(children: [UIMenu(options: .displayInline, children: actions)] + suggestedActions)
        }
        func textView(_ textView: UITextView, shouldInteractWith url: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
        }
    }
}
