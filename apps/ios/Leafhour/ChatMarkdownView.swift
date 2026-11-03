import SwiftUI
import UIKit
import LeafhourCore

/// The same CommonMark/GFM parser used by the reader renders complete chat blocks.
struct ChatMarkdownView: UIViewRepresentable {
    let source: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false; view.isSelectable = true; view.isScrollEnabled = false
        view.backgroundColor = .clear; view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true; view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.linkTextAttributes = [.foregroundColor: UIColor.tintColor, .underlineStyle: NSUnderlineStyle.single.rawValue]
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        // SwiftUI supplies the first useful width through sizeThatFits. Avoid
        // rendering a speculative narrow column before that measurement.
        guard view.bounds.width > 0 else { return }
        context.coordinator.update(view, source: source, width: view.bounds.width, category: ReaderTypography.category(for: dynamicTypeSize))
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return context.coordinator.size(uiView, source: source, width: width, category: ReaderTypography.category(for: dynamicTypeSize))
    }
    static func render(_ source: String, width: CGFloat, category: UIContentSizeCategory? = nil) -> NSAttributedString {
        render(MarkdownDocument(source: source), width: width, category: category)
    }
    private static func render(_ document: MarkdownDocument, width: CGFloat, category: UIContentSizeCategory?) -> NSAttributedString {
        let traits = category.map { UITraitCollection(preferredContentSizeCategory: $0) }
        let font = UIFont.preferredFont(forTextStyle: .subheadline, compatibleWith: traits)
        return MarkdownChapterLayout(document: document).attributed(font: font, size: font.pointSize, lineSpacing: 4, contentWidth: width)
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, UITextViewDelegate {
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
        func rendered(_ source: String, width: CGFloat, category: UIContentSizeCategory) -> NSAttributedString {
            if self.source != source {
                self.source = source; document = MarkdownDocument(source: source)
                attributed = nil
            }
            if attributed == nil || self.width != width || self.category != category {
                self.width = width; self.category = category; measured = nil
                attributed = ChatMarkdownView.render(document!, width: width, category: category)
            }
            return attributed!
        }
        func update(_ view: UITextView, source: String, width: CGFloat, category: UIContentSizeCategory) {
            let result = rendered(source, width: width, category: category)
            if installedView !== view || installedText !== result {
                view.attributedText = result
                view.accessibilityLabel = result.string
                installedView = view; installedText = result
            }
        }
        func size(_ view: UITextView, source: String, width: CGFloat, category: UIContentSizeCategory) -> CGSize {
            update(view, source: source, width: width, category: category)
            if let measured { return measured }
            let result = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            measured = result; return result
        }
        func textView(_ textView: UITextView, shouldInteractWith url: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
        }
    }
}
