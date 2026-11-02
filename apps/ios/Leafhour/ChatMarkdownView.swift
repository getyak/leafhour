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
        let width = max(120, view.bounds.width)
        view.attributedText = Self.render(source, width: width)
        view.accessibilityLabel = view.attributedText.string
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        uiView.attributedText = Self.render(source, width: width)
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
    static func render(_ source: String, width: CGFloat) -> NSAttributedString {
        let font = UIFont.preferredFont(forTextStyle: .body)
        return MarkdownChapterLayout(document: MarkdownDocument(source: source)).attributed(font: font, size: font.pointSize, lineSpacing: 5, contentWidth: width)
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, UITextViewDelegate {
        func textView(_ textView: UITextView, shouldInteractWith url: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
        }
    }
}
