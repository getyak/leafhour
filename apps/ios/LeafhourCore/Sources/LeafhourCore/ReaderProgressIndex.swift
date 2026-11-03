import Foundation

/// A source-coordinate estimate, built once off the main actor. Layout screens
/// and translation length never change how far through the original book we are.
public struct ReaderProgressIndex: Sendable {
    private struct Entry: Sendable { let chapterID: String; let start: Int; let length: Int }
    private let kind: BookKind
    private var chapters: [String] = []
    private var starts: [Int] = []
    private var passages: [String: Entry] = [:]
    private var total = 0

    public init(book: LocalBook) {
        kind = book.kind
        for chapter in book.chapters {
            chapters.append(chapter.id); starts.append(total)
            for passage in chapter.passages where kind != .pdf {
                let length = max(1, passage.text.unicodeScalars.count)
                passages[passage.id] = Entry(chapterID: chapter.id, start: total, length: length)
                total += length
            }
        }
    }

    public func fraction(chapterIndex: Int, anchor: ReadingAnchor?) -> Double? {
        guard chapters.indices.contains(chapterIndex) else { return nil }
        if kind == .pdf { return Double(chapterIndex + 1) / Double(chapters.count) }
        guard total > 0 else { return nil }
        var position = starts[chapterIndex]
        if let anchor, anchor.chapterID == chapters[chapterIndex], let entry = passages[anchor.passageID], entry.chapterID == anchor.chapterID {
            position = entry.start + min(entry.length, max(0, anchor.characterOffset))
        }
        return min(1, max(0, Double(position) / Double(total)))
    }
}
