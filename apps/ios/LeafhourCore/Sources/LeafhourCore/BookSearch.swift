import Foundation

public struct BookSearchResult: Identifiable, Sendable {
    public let chapterIndex: Int
    public let anchor: ReadingAnchor
    public let excerpt: SearchExcerpt
    public var id: String { anchor.key }
}

public enum BookSearch {
    /// CPU work has no UI actor or persistence access. Its lifetime follows the awaiting request.
    public static func matches(in chapters: [BookChapter], query: String, markdown: Bool = false) async throws -> [BookSearchResult] {
        try Task.checkCancellation()
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        let worker = Task.detached(priority: .userInitiated) {
            var results: [BookSearchResult] = []
            for (index, chapter) in chapters.enumerated() {
                try Task.checkCancellation()
                let document = markdown ? MarkdownDocument(source: chapter.passages.map(\.text).joined(separator: "\n\n")) : nil
                var sourceStart = 0
                for passage in chapter.passages {
                    try Task.checkCancellation()
                    defer { if markdown { sourceStart += passage.text.utf16.count + 2 } }
                    let displayStart = document?.displayedUTF16Offset(forSourceUTF16Offset: sourceStart) ?? 0
                    let displayEnd = document?.displayedUTF16Offset(forSourceUTF16Offset: sourceStart + passage.text.utf16.count) ?? 0
                    let searchable = document.map { ($0.text as NSString).substring(with: NSRange(location: displayStart, length: max(0, displayEnd - displayStart))) } ?? passage.text
                    if var excerpt = SearchExcerpt.find(in: searchable, query: query) {
                        if let document {
                            let scalarIndex = searchable.unicodeScalars.index(searchable.unicodeScalars.startIndex, offsetBy: excerpt.characterOffset)
                            let displayOffset = String(searchable.unicodeScalars[..<scalarIndex]).utf16.count
                            let rawOffset = min(passage.text.utf16.count, max(0, document.sourceUTF16Offset(at: displayStart + displayOffset) - sourceStart))
                            let sourceScalarOffset = (passage.text as NSString).substring(to: rawOffset).unicodeScalars.count
                            excerpt = SearchExcerpt(before: excerpt.before, match: excerpt.match, after: excerpt.after, characterOffset: sourceScalarOffset)
                        }
                        results.append(BookSearchResult(chapterIndex: index, anchor: ReadingAnchor(chapterID: chapter.id, passageID: passage.id, characterOffset: excerpt.characterOffset), excerpt: excerpt))
                    }
                }
            }
            try Task.checkCancellation()
            return results
        }
        return try await withTaskCancellationHandler(operation: {
            let results = try await worker.value
            try Task.checkCancellation()
            return results
        }, onCancel: { worker.cancel() })
    }
}
