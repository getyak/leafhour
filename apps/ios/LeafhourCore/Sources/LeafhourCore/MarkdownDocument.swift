import Foundation
import cmark_gfm
import cmark_gfm_extensions

extension LocalBook {
    public var rendersMarkdown: Bool {
        kind == .markdown || ["md", "markdown", "text/markdown"].contains(cloud?.sourceFormat.lowercased() ?? "")
    }
}

/// CommonMark/GFM is parsed by the upstream Swift project's cmark-gfm, never by regular expressions.
/// Source remains untouched: every displayed UTF-16 position maps back to the original Markdown.
public struct MarkdownDocument: Sendable {
    public struct Style: Equatable, Sendable {
        public var bold = false, italic = false, code = false, strikethrough = false
        public var heading = 0, listDepth = 0, quoteDepth = 0
        public var codeBlock = false, table = false
        public var tableColumns = 0, tableHeader = false
        public var link: String?
    }
    public struct Run: Equatable, Sendable {
        public var range: NSRange
        public var style: Style
    }
    public let text: String
    public let runs: [Run]
    private let sourceOffsets: [Int]

    public init(source: String) {
        var builder = Builder(source: source)
        builder.parse()
        text = builder.text; runs = builder.runs; sourceOffsets = builder.sourceOffsets
    }
    public func sourceUTF16Offset(at displayedUTF16Offset: Int) -> Int {
        sourceOffsets[min(max(0, displayedUTF16Offset), sourceOffsets.count - 1)]
    }
    public func displayedUTF16Offset(forSourceUTF16Offset offset: Int) -> Int {
        var low = 0, high = sourceOffsets.count
        while low < high {
            let middle = (low + high) / 2
            if sourceOffsets[middle] < offset { low = middle + 1 } else { high = middle }
        }
        return min(low, sourceOffsets.count - 1)
    }
    private static let registered: Void = { cmark_gfm_core_extensions_ensure_registered() }()

    private struct Builder {
        let source: String
        let sourceText: NSString
        let lines: [String]
        let lineOffsets: [Int]
        var text = ""
        var runs: [Run] = []
        var sourceOffsets: [Int] = []
        init(source: String) {
            self.source = source; sourceText = source as NSString
            lines = source.components(separatedBy: "\n")
            var offset = 0, offsets: [Int] = []
            for line in lines { offsets.append(offset); offset += line.utf16.count + 1 }
            lineOffsets = offsets
        }
        mutating func parse() {
            _ = MarkdownDocument.registered
            guard let parser = cmark_parser_new(CMARK_OPT_DEFAULT | CMARK_OPT_VALIDATE_UTF8) else { finish(); return }
            defer { cmark_parser_free(parser) }
            for name in ["table", "strikethrough", "autolink", "tasklist"] {
                name.withCString { if let ext = cmark_find_syntax_extension($0) { cmark_parser_attach_syntax_extension(parser, ext) } }
            }
            source.withCString { cmark_parser_feed(parser, $0, source.utf8.count) }
            if let root = cmark_parser_finish(parser) { render(root, style: Style()); cmark_node_free(root) }
            finish()
        }
        mutating func finish() {
            // One terminal entry makes the empty document and end-of-selection safe.
            sourceOffsets.append(max(sourceOffsets.last ?? 0, sourceText.length))
        }
        func position(line: Int, column: Int) -> Int {
            guard line > 0, line <= lines.count else { return 0 }
            let bytes = lines[line - 1].utf8.prefix(max(0, column - 1))
            return min(sourceText.length, lineOffsets[line - 1] + String(decoding: bytes, as: UTF8.self).utf16.count)
        }
        func range(_ node: UnsafeMutablePointer<cmark_node>) -> NSRange {
            let start = position(line: Int(cmark_node_get_start_line(node)), column: Int(cmark_node_get_start_column(node)))
            let end = position(line: Int(cmark_node_get_end_line(node)), column: Int(cmark_node_get_end_column(node)) + 1)
            return NSRange(location: start, length: max(0, end - start))
        }
        func literal(_ node: UnsafeMutablePointer<cmark_node>) -> String { cmark_node_get_literal(node).map(String.init(cString:)) ?? "" }
        mutating func children(_ node: UnsafeMutablePointer<cmark_node>, style: Style) {
            var child = cmark_node_first_child(node)
            while let current = child { render(current, style: style); child = cmark_node_next(current) }
        }
        mutating func separator(_ node: UnsafeMutablePointer<cmark_node>, style: Style, count: Int = 1) {
            let existing = text.reversed().prefix(while: { $0 == "\n" }).count
            if existing < count { append(String(repeating: "\n", count: count - existing), sourceRange: NSRange(location: NSMaxRange(range(node)), length: 0), style: style, synthetic: true) }
        }
        mutating func render(_ node: UnsafeMutablePointer<cmark_node>, style: Style) {
            let type = String(cString: cmark_node_get_type_string(node))
            var next = style
            switch type {
            case "document": children(node, style: style)
            case "heading":
                next.heading = Int(cmark_node_get_heading_level(node)); next.bold = true
                children(node, style: next); separator(node, style: next)
            case "paragraph": children(node, style: style); separator(node, style: style)
            case "block_quote": next.quoteDepth += 1; children(node, style: next); separator(node, style: next)
            case "list":
                next.listDepth += 1
                let ordered = cmark_node_get_list_type(node) == CMARK_ORDERED_LIST
                var number = Int(cmark_node_get_list_start(node)), child = cmark_node_first_child(node)
                while let item = child {
                    let task = String(cString: cmark_node_get_type_string(item)) == "tasklist"
                    let prefix = task ? (cmark_gfm_extensions_get_tasklist_item_checked(item) ? "☑ " : "☐ ") : (ordered ? "\(number). " : "• ")
                    append(prefix, sourceRange: range(item), style: next, synthetic: true)
                    children(item, style: next); separator(item, style: next, count: 1)
                    number += 1; child = cmark_node_next(item)
                }
                separator(node, style: next)
            case "item", "tasklist": children(node, style: style)
            case "code_block":
                next.code = true; next.codeBlock = true
                var sourceRange = range(node)
                // Fenced code's literal excludes the opening fence and info string.
                let raw = sourceText.substring(with: sourceRange)
                if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") || raw.trimmingCharacters(in: .whitespaces).hasPrefix("~~~"), let newline = raw.firstIndex(of: "\n") {
                    let skip = raw[..<raw.index(after: newline)].utf16.count
                    sourceRange = NSRange(location: sourceRange.location + skip, length: max(0, sourceRange.length - skip))
                }
                var code = literal(node)
                if code.hasSuffix("\n") { code.removeLast() }
                append(code, sourceRange: sourceRange, style: next)
                // The block's terminator belongs to the surrounding page, not the code background.
                separator(node, style: style)
            case "text": append(literal(node), sourceRange: range(node), style: style)
            case "softbreak", "linebreak": append("\n", sourceRange: range(node), style: style, synthetic: true)
            case "code": next.code = true; append(literal(node), sourceRange: range(node), style: next)
            case "emph": next.italic = true; children(node, style: next)
            case "strong": next.bold = true; children(node, style: next)
            case "strikethrough": next.strikethrough = true; children(node, style: next)
            case "link":
                if let value = cmark_node_get_url(node), let url = URL(string: String(cString: value)), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { next.link = url.absoluteString }
                children(node, style: next)
            case "image":
                append("[插图：", sourceRange: range(node), style: style, synthetic: true)
                children(node, style: style)
                append("]", sourceRange: NSRange(location: NSMaxRange(range(node)), length: 0), style: style, synthetic: true)
            case "thematic_break": append("────────", sourceRange: range(node), style: style, synthetic: true); separator(node, style: style)
            case "html_inline": break // Tags are never executed; surrounding text remains native text.
            case "html_block":
                // Raw HTML is not a WebView. Keep its visible characters without tag syntax.
                append(Self.visibleHTML(literal(node)), sourceRange: range(node), style: style); separator(node, style: style)
            case "table":
                next.table = true; next.tableColumns = Int(cmark_gfm_extensions_get_table_columns(node))
                children(node, style: next); separator(node, style: style)
            case "table_header", "table_row":
                next.table = true
                next.tableHeader = type == "table_header" || cmark_gfm_extensions_get_table_row_is_header(node) != 0
                next.bold = next.tableHeader
                var child = cmark_node_first_child(node), first = true
                while let cell = child {
                    if !first { append("\t", sourceRange: NSRange(location: max(0, range(cell).location - 1), length: 0), style: next, synthetic: true) }
                    children(cell, style: next); first = false; child = cmark_node_next(cell)
                }
                separator(node, style: next, count: 1)
            default: children(node, style: style)
            }
        }
        mutating func append(_ value: String, sourceRange: NSRange, style: Style, synthetic: Bool = false) {
            guard !value.isEmpty else { return }
            let start = sourceOffsets.count
            let original = sourceText.substring(with: sourceRange)
            let originals = Array(original.unicodeScalars), visible = Array(value.unicodeScalars)
            var originalPositions: [Int] = [], at = sourceRange.location
            for scalar in originals { originalPositions.append(at); at += scalar.utf16.count }
            var cursor = 0, entityScalars = 0, entityPosition = 0
            for (index, scalar) in visible.enumerated() {
                var position = sourceRange.location
                if !synthetic {
                    if entityScalars > 0 {
                        appendPosition(entityPosition, scalar: scalar); entityScalars -= 1; continue
                    }
                    // Entity and escape syntax can be longer than the decoded display character.
                    if cursor < originals.count, originals[cursor] == "&", let end = originals[cursor...].prefix(32).firstIndex(of: ";") {
                        let entity = String(String.UnicodeScalarView(originals[cursor...end]))
                        let remaining = visible[index...]
                        let decoded = Self.decodeEntity(entity)
                        let decodedScalars = Array(decoded.unicodeScalars), literalScalars = Array(entity.unicodeScalars)
                        // An entity can decode to the first scalar of a larger
                        // grapheme (e.g. encoded squirrel + variation selector).
                        // String.hasPrefix compares Characters and can reject
                        // that valid prefix, losing the source cursor entirely.
                        if decoded != entity,
                           !remaining.prefix(literalScalars.count).elementsEqual(literalScalars),
                           remaining.prefix(decodedScalars.count).elementsEqual(decodedScalars) {
                            entityPosition = originalPositions[cursor]; entityScalars = max(0, decoded.unicodeScalars.count - 1)
                            cursor = end + 1; appendPosition(entityPosition, scalar: scalar); continue
                        }
                    }
                    if cursor < originals.count, let found = originals[cursor...].firstIndex(of: scalar) { cursor = found; position = originalPositions[found]; cursor += 1 }
                    else { position = min(NSMaxRange(sourceRange), originalPositions.last ?? sourceRange.location) }
                }
                appendPosition(position, scalar: scalar)
            }
            text += value
            runs.append(Run(range: NSRange(location: start, length: value.utf16.count), style: style))
        }
        mutating func appendPosition(_ position: Int, scalar: Unicode.Scalar) {
            let clamped = min(sourceText.length, max(sourceOffsets.last ?? 0, position))
            for _ in 0..<scalar.utf16.count { sourceOffsets.append(clamped) }
        }
        static func decodeEntity(_ value: String) -> String {
            var buffer = cmark_strbuf()
            cmark_strbuf_init(cmark_get_default_mem_allocator(), &buffer, 0)
            defer { cmark_strbuf_free(&buffer) }
            let bytes = Array(value.utf8)
            bytes.withUnsafeBufferPointer { houdini_unescape_html_f(&buffer, $0.baseAddress, Int32($0.count)) }
            return String(decoding: UnsafeBufferPointer(start: buffer.ptr, count: Int(buffer.size)), as: UTF8.self)
        }
        static func visibleHTML(_ value: String) -> String {
            var result = "", inside = false
            for character in value {
                if character == "<" { inside = true }
                else if character == ">" { inside = false }
                else if !inside { result.append(character) }
            }
            return result.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}
