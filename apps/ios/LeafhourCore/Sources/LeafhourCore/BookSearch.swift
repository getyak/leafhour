import Foundation

public struct BookSearchResult: Identifiable, Sendable {
    public let chapterIndex: Int
    public let anchor: ReadingAnchor
    public let excerpt: SearchExcerpt
    public var id: String { anchor.key }
}

public enum BookSearch {
    /// CPU work has no UI actor or persistence access. Its lifetime follows the awaiting request.
    public static func matches(in chapters: [BookChapter], query: String) async throws -> [BookSearchResult] {
        try Task.checkCancellation()
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        let worker = Task.detached(priority: .userInitiated) {
            var results: [BookSearchResult] = []
            for (index, chapter) in chapters.enumerated() {
                for passage in chapter.passages {
                    try Task.checkCancellation()
                    if let excerpt = SearchExcerpt.find(in: passage.text, query: query) {
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
