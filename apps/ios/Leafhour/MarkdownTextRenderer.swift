import Foundation
import UIKit
import LeafhourCore

/// Retains the existing raw-passage identity while TextKit lays out the rendered Markdown.
struct MarkdownChapterLayout {
    let document: MarkdownDocument
    let sourceRanges: [NSRange]

    init(book: LocalBook, chapter: BookChapter, original: URL) {
        let retained: String?
        if MarkdownChapterDocument.canUseRetainedSource(for: book) {
            retained = (try? String(contentsOf: original, encoding: .utf8)) ?? (try? String(contentsOf: original, encoding: .utf16))
        } else { retained = nil }
        let layout = MarkdownChapterDocument(book: book, chapter: chapter, retainedSource: retained)
        document = layout.document; sourceRanges = layout.sourceRanges
    }
    func attributed(font: UIFont, size: Double, lineSpacing: Double, contentWidth: CGFloat = UIScreen.main.bounds.width - 48) -> NSAttributedString {
        let result = NSMutableAttributedString(string: document.text)
        for run in document.runs {
            let style = run.style
            var actualFont = font
            if style.heading > 0 {
                actualFont = UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: size + Double(max(2, 10 - style.heading * 2)), weight: .semibold))
            } else if style.code {
                actualFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: max(14, size - 2), weight: style.bold ? .semibold : .regular))
            } else if style.table {
                actualFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: max(14, size - 2), weight: style.tableHeader ? .semibold : .regular))
            }
            var traits = actualFont.fontDescriptor.symbolicTraits
            if style.bold { traits.insert(.traitBold) }
            if style.italic { traits.insert(.traitItalic) }
            if let descriptor = actualFont.fontDescriptor.withSymbolicTraits(traits) { actualFont = UIFont(descriptor: descriptor, size: actualFont.pointSize) }
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = style.codeBlock ? 3 : lineSpacing
            paragraph.paragraphSpacing = style.codeBlock ? 0 : (style.listDepth > 0 || style.table ? 8 : 20)
            paragraph.baseWritingDirection = .natural
            let indent = CGFloat(style.quoteDepth * 16 + max(0, style.listDepth - 1) * 16)
            paragraph.firstLineHeadIndent = indent
            paragraph.headIndent = indent + (style.listDepth > 0 ? 18 : 0)
            if style.codeBlock { paragraph.lineBreakMode = .byCharWrapping }
            if style.table {
                let count = max(1, style.tableColumns)
                let columnWidth = max(40, contentWidth / CGFloat(count))
                paragraph.tabStops = (1..<count).map { NSTextTab(textAlignment: .left, location: CGFloat($0) * columnWidth) }
                paragraph.defaultTabInterval = columnWidth
                paragraph.lineBreakMode = .byWordWrapping
            }
            var attributes: [NSAttributedString.Key: Any] = [.font: actualFont, .foregroundColor: style.quoteDepth > 0 ? UIColor.secondaryLabel : UIColor.label, .paragraphStyle: paragraph]
            if style.code { attributes[.backgroundColor] = UIColor.secondarySystemGroupedBackground }
            if style.tableHeader { attributes[.backgroundColor] = UIColor.tertiarySystemFill }
            if style.strikethrough { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let link = style.link, let url = URL(string: link) { attributes[.link] = url }
            result.addAttributes(attributes, range: run.range)
        }
        // Keep intentional newlines within code, without adding paragraph gaps to every code line.
        // Only its final line receives the same breathing room as other page blocks.
        for run in document.runs where run.style.codeBlock && run.range.length > 0 {
            let lastLine = (document.text as NSString).paragraphRange(for: NSRange(location: NSMaxRange(run.range) - 1, length: 1))
            if let style = result.attribute(.paragraphStyle, at: run.range.location, effectiveRange: nil) as? NSParagraphStyle,
               let finalStyle = style.mutableCopy() as? NSMutableParagraphStyle {
                finalStyle.paragraphSpacing = 20
                result.addAttribute(.paragraphStyle, value: finalStyle, range: lastLine)
            }
        }
        return result
    }
}
