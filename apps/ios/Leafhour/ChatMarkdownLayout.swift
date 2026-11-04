import UIKit
import LeafhourCore

extension NSAttributedString.Key {
    static let chatCodeBlock = Self("leafhour.chat.code-block")
    static let chatInlineCode = Self("leafhour.chat.inline-code")
    static let chatQuote = Self("leafhour.chat.quote")
    static let chatTableColumns = Self("leafhour.chat.table-columns")
    static let chatTableHeader = Self("leafhour.chat.table-header")
    static let chatTableRow = Self("leafhour.chat.table-row")
    static let chatRule = Self("leafhour.chat.rule")
}

/// Conversation presentation is separate from book typography and source anchors.
/// All visible content remains in one native, selectable attributed string.
struct ChatMarkdownLayout {
    let document: MarkdownDocument
    let width: CGFloat
    let category: UIContentSizeCategory
    private var traits: UITraitCollection { UITraitCollection(preferredContentSizeCategory: category) }

    private func font(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body, code: Bool = false) -> UIFont {
        if size == 17 && weight == .regular && style == .body && !code {
            return UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
        }
        let base = code ? UIFont.monospacedSystemFont(ofSize: size, weight: weight) : UIFont.systemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base, compatibleWith: traits)
    }

    func attributed() -> NSAttributedString {
        let text = NSMutableAttributedString(string: document.text)
        for run in document.runs where run.range.length > 0 {
            let style = run.style
            var actual = font(17)
            if style.heading > 0 {
                let sizes: [CGFloat] = [23, 21, 19, 17, 16, 16]
                actual = font(sizes[min(5, style.heading - 1)], weight: .semibold, style: .headline)
            } else if style.code { actual = font(15, code: true) }
            var symbols = actual.fontDescriptor.symbolicTraits
            if style.bold { symbols.insert(.traitBold) }
            if style.italic { symbols.insert(.traitItalic) }
            if let descriptor = actual.fontDescriptor.withSymbolicTraits(symbols) { actual = UIFont(descriptor: descriptor, size: actual.pointSize) }
            let paragraph = NSMutableParagraphStyle()
            paragraph.baseWritingDirection = .natural
            paragraph.lineSpacing = style.codeBlock ? 3 : 4
            paragraph.paragraphSpacing = style.codeBlock ? 0 : (style.listDepth > 0 ? 5 : 12)
            paragraph.paragraphSpacingBefore = style.heading > 0 ? 14 : 0
            let indent = CGFloat(style.quoteDepth * 14 + max(0, style.listDepth - 1) * 18)
            paragraph.firstLineHeadIndent = indent + (style.codeBlock ? 12 : 0)
            paragraph.headIndent = indent + (style.codeBlock ? 12 : style.listDepth > 0 ? 18 : 0)
            if style.codeBlock { paragraph.headIndent = indent + 24; paragraph.tailIndent = -12; paragraph.lineBreakMode = .byWordWrapping }
            var attributes: [NSAttributedString.Key: Any] = [
                .font: actual, .foregroundColor: style.quoteDepth > 0 ? UIColor.label.withAlphaComponent(0.84) : UIColor.label,
                .paragraphStyle: paragraph
            ]
            if style.codeBlock { attributes[.chatCodeBlock] = run.range.location }
            else if style.code { attributes[.chatInlineCode] = true }
            if style.quoteDepth > 0 { attributes[.chatQuote] = style.quoteDepth }
            if style.table { attributes[.chatTableColumns] = style.tableColumns; attributes[.chatTableHeader] = style.tableHeader }
            if style.strikethrough { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let link = style.link, let url = URL(string: link) { attributes[.link] = url }
            text.addAttributes(attributes, range: run.range)
            if style.italic && !style.code {
                var offset = run.range.location
                for scalar in (document.text as NSString).substring(with: run.range).unicodeScalars {
                    if (0x2E80...0x9FFF).contains(scalar.value) || (0xF900...0xFAFF).contains(scalar.value) || (0x20000...0x323AF).contains(scalar.value) {
                        text.addAttribute(.obliqueness, value: 0.14, range: NSRange(location: offset, length: scalar.utf16.count))
                    }
                    offset += scalar.utf16.count
                }
            }
            if style.codeBlock { spaceCodeParagraphs(text, range: run.range) }
        }
        for run in document.runs where run.style.thematicBreak {
            let paragraph = NSMutableParagraphStyle()
            paragraph.minimumLineHeight = 20; paragraph.paragraphSpacing = 14
            text.addAttributes([.font: UIFont.systemFont(ofSize: 1), .foregroundColor: UIColor.clear,
                                .paragraphStyle: paragraph, .chatRule: true],
                               range: (text.string as NSString).paragraphRange(for: run.range))
        }
        adaptTables(text)
        // An opening title does not need a preceding blank paragraph.
        if text.length > 0, text.attribute(.chatCodeBlock, at: 0, effectiveRange: nil) == nil,
           let initial = text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle,
           let first = initial.mutableCopy() as? NSMutableParagraphStyle {
            first.paragraphSpacingBefore = 0
            text.addAttribute(.paragraphStyle, value: first, range: (text.string as NSString).paragraphRange(for: NSRange(location: 0, length: 1)))
        }
        return text
    }

    private func spaceCodeParagraphs(_ text: NSMutableAttributedString, range: NSRange) {
        let source = text.string as NSString
        var at = range.location
        while at < NSMaxRange(range) {
            let line = source.paragraphRange(for: NSRange(location: at, length: 1))
            if let existing = text.attribute(.paragraphStyle, at: at, effectiveRange: nil) as? NSParagraphStyle,
               let paragraph = existing.mutableCopy() as? NSMutableParagraphStyle {
                paragraph.paragraphSpacingBefore = at == range.location ? 8 : 0
                paragraph.paragraphSpacing = NSMaxRange(line) >= NSMaxRange(range) ? 14 : 0
                if let face = text.attribute(.font, at: at, effectiveRange: nil) as? UIFont {
                    let prefix = String(source.substring(with: line).prefix { $0 == " " || $0 == "\t" })
                    let leading = (prefix as NSString).size(withAttributes: [.font: face]).width
                    paragraph.headIndent = min(paragraph.firstLineHeadIndent + leading + 12,
                                               max(paragraph.firstLineHeadIndent + 12, width * 0.45))
                }
                text.addAttribute(.paragraphStyle, value: paragraph, range: line)
            }
            at = NSMaxRange(line)
        }
    }

    private struct Row {
        let range: NSRange
        let cells: [NSAttributedString]
        let header: Bool
    }

    private func adaptTables(_ text: NSMutableAttributedString) {
        for table in document.tables.reversed() {
            let rows = table.rows.map { row in
                Row(range: row.range, cells: row.cells.map { text.attributedSubstring(from: $0) }, header: row.isHeader)
            }
            guard let header = rows.first, rows.count > 1 else { continue }
            let columns = max(1, header.cells.count), cellWidth = width / CGFloat(columns)
            let needsRows = columns > 3 || cellWidth < font(17).pointSize * 5 || rows.contains { row in
                row.cells.contains { $0.string.contains("\t") || $0.string.contains("\n") || $0.size().width > cellWidth - 10 }
            }
            if needsRows {
                let replacement = stacked(rows)
                text.replaceCharacters(in: table.range, with: replacement)
            } else {
                for row in rows {
                    let paragraph = NSMutableParagraphStyle()
                    paragraph.lineSpacing = 4; paragraph.paragraphSpacing = 8
                    paragraph.tabStops = (1..<columns).map { NSTextTab(textAlignment: .left, location: CGFloat($0) * cellWidth) }
                    paragraph.defaultTabInterval = cellWidth
                    text.addAttributes([.paragraphStyle: paragraph, .chatTableRow: row.range.location], range: row.range)
                }
            }
        }
    }

    private func stacked(_ rows: [Row]) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        let headings = rows[0].cells
        for (rowIndex, row) in rows.dropFirst().enumerated() {
            for column in headings.indices {
                let start = result.length
                let label = NSMutableAttributedString(attributedString: headings[column])
                if label.length == 0 { label.append(NSAttributedString(string: "·")) }
                label.enumerateAttribute(.font, in: NSRange(location: 0, length: label.length)) { value, range, _ in
                    let old = value as? UIFont
                    let mono = old?.fontDescriptor.symbolicTraits.contains(.traitMonoSpace) == true
                    var actual = font(column == 0 ? 17 : 14, weight: .semibold, code: mono)
                    if let old, let descriptor = actual.fontDescriptor.withSymbolicTraits(actual.fontDescriptor.symbolicTraits.union(old.fontDescriptor.symbolicTraits)) {
                        actual = UIFont(descriptor: descriptor, size: actual.pointSize)
                    }
                    label.addAttribute(.font, value: actual, range: range)
                }
                let color = column == 0 ? UIColor.label : UIColor.label.withAlphaComponent(0.64)
                label.addAttribute(.foregroundColor, value: color, range: NSRange(location: 0, length: label.length))
                result.append(label)
                result.append(NSAttributedString(string: "：", attributes: [.font: font(column == 0 ? 17 : 14, weight: .semibold), .foregroundColor: color]))
                if column < row.cells.count, row.cells[column].length > 0 { result.append(row.cells[column]) }
                else { result.append(NSAttributedString(string: "—", attributes: [.font: font(17), .foregroundColor: UIColor.secondaryLabel])) }
                result.append(NSAttributedString(string: "\n", attributes: [.font: font(17), .foregroundColor: UIColor.label]))
                let paragraph = NSMutableParagraphStyle()
                paragraph.lineSpacing = 4
                var minimum = font(17).lineHeight
                result.enumerateAttribute(.font, in: NSRange(location: start, length: result.length - start)) { value, _, _ in
                    if let face = value as? UIFont { minimum = max(minimum, face.lineHeight) }
                }
                paragraph.minimumLineHeight = minimum
                paragraph.paragraphSpacingBefore = column == 0 && rowIndex > 0 ? 10 : 0
                paragraph.paragraphSpacing = column == headings.count - 1 ? 14 : 5
                let range = NSRange(location: start, length: result.length - start)
                result.addAttribute(.paragraphStyle, value: paragraph, range: range)
                result.removeAttribute(.chatTableColumns, range: range)
                result.removeAttribute(.chatTableHeader, range: range)
            }
        }
        return result
    }
}

/// Draw block surfaces behind selectable text, never as images or nested controls.
final class ChatTextLayoutManager: NSLayoutManager {
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        guard let storage = textStorage, let container = textContainers.first else {
            super.drawBackground(forGlyphRange: glyphsToShow, at: origin); return
        }
        let visible = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        func ranges(_ key: NSAttributedString.Key, draw: (Any, CGRect) -> Void) {
            var drawn = Set<String>()
            storage.enumerateAttribute(key, in: visible) { value, part, _ in
                guard let value else { return }
                var whole = NSRange()
                _ = storage.attribute(key, at: part.location, longestEffectiveRange: &whole, in: NSRange(location: 0, length: storage.length))
                guard drawn.insert("\(whole.location):\(whole.length)").inserted else { return }
                let glyphs = self.glyphRange(forCharacterRange: whole, actualCharacterRange: nil)
                let rect = self.boundingRect(forGlyphRange: glyphs, in: container).offsetBy(dx: origin.x, dy: origin.y)
                draw(value, rect)
            }
        }
        ranges(.chatCodeBlock) { _, rect in
            let panel = CGRect(x: origin.x, y: rect.minY - 6, width: container.size.width, height: rect.height + 12)
            UIColor.secondarySystemBackground.setFill()
            UIBezierPath(roundedRect: panel, cornerRadius: 7).fill()
        }
        storage.enumerateAttribute(.chatInlineCode, in: visible) { value, range, _ in
            guard value != nil else { return }
            let glyphs = self.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            self.enumerateLineFragments(forGlyphRange: glyphs) { _, _, lineContainer, lineGlyphs, _ in
                let fragment = NSIntersectionRange(glyphs, lineGlyphs)
                guard fragment.length > 0 else { return }
                let rect = self.boundingRect(forGlyphRange: fragment, in: lineContainer).offsetBy(dx: origin.x, dy: origin.y)
                UIColor.secondarySystemFill.setFill()
                UIBezierPath(roundedRect: rect.insetBy(dx: -2, dy: 0), cornerRadius: 3).fill()
            }
        }
        ranges(.chatQuote) { value, rect in
            guard let depth = value as? Int else { return }
            UIColor.separator.setStroke()
            for level in 0..<depth {
                let line = UIBezierPath(); line.lineWidth = 1
                let x = origin.x + CGFloat(level * 14) + 1
                line.move(to: CGPoint(x: x, y: rect.minY)); line.addLine(to: CGPoint(x: x, y: rect.maxY)); line.stroke()
            }
        }
        ranges(.chatTableHeader) { value, rect in
            guard (value as? NSNumber)?.boolValue == true else { return }
            UIColor.tertiarySystemFill.setFill()
            UIBezierPath(rect: CGRect(x: origin.x, y: rect.minY - 2, width: container.size.width, height: rect.height + 4)).fill()
        }
        ranges(.chatTableRow) { _, rect in
            UIColor.separator.setStroke()
            let line = UIBezierPath(); line.lineWidth = 0.5
            line.move(to: CGPoint(x: origin.x, y: rect.maxY + 3)); line.addLine(to: CGPoint(x: origin.x + container.size.width, y: rect.maxY + 3)); line.stroke()
        }
        ranges(.chatRule) { _, rect in
            UIColor.separator.setStroke()
            let line = UIBezierPath(); line.lineWidth = 0.5
            line.move(to: CGPoint(x: origin.x, y: rect.midY)); line.addLine(to: CGPoint(x: origin.x + container.size.width, y: rect.midY)); line.stroke()
        }
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    }
}
