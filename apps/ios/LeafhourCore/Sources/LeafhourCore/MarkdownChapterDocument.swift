import Foundation

/// Selects only the current chapter's source; cloud copies can contain many chapters.
public struct MarkdownChapterDocument: Sendable {
    public let document: MarkdownDocument
    public let sourceRanges: [NSRange]

    public static func canUseRetainedSource(for book: LocalBook) -> Bool {
        book.cloud == nil && book.kind == .markdown && (book.chapters.count == 1 || book.chapters.allSatisfy { $0.sourceUTF16Range != nil })
    }
    public init(book: LocalBook, chapter: BookChapter, retainedSource: String? = nil) {
        let fallback = chapter.passages.map(\.text).joined(separator: chapter.sourceUTF16Range == nil ? "\n\n" : "")
        func locations(in source: String) -> [NSRange]? {
            let text = source as NSString
            var cursor = 0, result: [NSRange] = []
            for passage in chapter.passages {
                let found = text.range(of: passage.text, options: [], range: NSRange(location: cursor, length: text.length - cursor))
                guard found.location != NSNotFound else { return nil }
                result.append(found); cursor = NSMaxRange(found)
            }
            return result
        }
        // Historical local Markdown indexes split at blank lines. Reading their retained single
        // source preserves blank lines inside code without rewriting passage IDs or private anchors.
        var retained = Self.canUseRetainedSource(for: book) ? retainedSource?.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n") : nil
        if let range = chapter.sourceUTF16Range {
            if let source = retained as NSString?, range.location >= 0, range.length >= 0,
               range.location <= source.length, range.length <= source.length - range.location {
                let slice = source.substring(with: range)
                retained = slice == fallback ? slice : nil
            } else { retained = nil }
        }
        if let retained, let ranges = locations(in: retained) {
            document = MarkdownDocument(source: retained); sourceRanges = ranges
        } else {
            document = MarkdownDocument(source: fallback); sourceRanges = locations(in: fallback) ?? []
        }
    }
}
