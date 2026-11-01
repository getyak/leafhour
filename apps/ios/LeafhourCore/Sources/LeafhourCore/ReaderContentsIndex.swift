import Foundation

public struct ReaderContentsEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let chapterIndex: Int
    public let title: String
}

/// A projection of existing chapters, not an inferred outline. Original indices
/// stay attached to filtered results so choosing a match opens its real source.
public enum ReaderContentsIndex {
    public static func entries(chapters: [BookChapter], kind: BookKind, query: String) -> [ReaderContentsEntry] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let exactPDFPage = kind == .pdf && !value.isEmpty ? Int(value) : nil
        return chapters.enumerated().compactMap { index, chapter in
            let matches = exactPDFPage.map { $0 > 0 && index == $0 - 1 }
                ?? (value.isEmpty || chapter.title.localizedStandardContains(value))
            guard matches else { return nil }
            return ReaderContentsEntry(id: chapter.id, chapterIndex: index, title: chapter.title)
        }
    }
}
