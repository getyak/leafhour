import Foundation

/// Disposable presentation only. Canonical chapter/passage identities never change.
public struct ReadingTextWindow: Sendable {
    public struct Slice: Sendable {
        public let index: Int
        public let original: Passage
        public let display: Passage
        public let sourceRange: NSRange
        public let offsets: SourceTextOffsets
        public let scalarStart: Int
        public let scalarEnd: Int
    }
    public let slices: [Slice]
    public let previousAnchor: ReadingAnchor?
    public let nextAnchor: ReadingAnchor?
    public let isComplete: Bool
    public let signature: String
    private let chapterID: String

    public init(chapter: BookChapter, anchor: ReadingAnchor?, maximumUTF16: Int = 24_000, maximumPassages: Int = 160, endingAtAnchor: Bool = false) {
        chapterID = chapter.id
        let budget = max(1024, maximumUTF16), limit = max(1, maximumPassages)
        let target = anchor.flatMap { value in chapter.passages.firstIndex { $0.id == value.passageID } } ?? 0
        var lower = target, behind = 0
        while lower > 0 && target - lower < (endingAtAnchor ? limit - 1 : 12) {
            let passage = chapter.passages[lower - 1]
            let cost = max(1, passage.text.utf16.count) + (passage.resourcePath == nil ? 2 : 8192)
            guard behind + cost <= (endingAtAnchor ? budget - chapter.passages[target].text.utf16.count - 2 : budget / 4) else { break }
            behind += cost; lower -= 1
        }
        if chapter.passages.indices.contains(target), behind + chapter.passages[target].text.utf16.count + 2 > budget { lower = target }
        var result: [Slice] = [], used = 0
        for index in lower..<(endingAtAnchor ? min(chapter.passages.count, target + 1) : chapter.passages.count) {
            let passage = chapter.passages[index], length = passage.text.utf16.count
            let cost = length + (passage.resourcePath == nil ? 2 : 8192)
            if !result.isEmpty && (used + cost > budget || result.count >= limit) { break }
            let offsets = SourceTextOffsets(passage.text)
            let range: NSRange
            if length > budget {
                // A single source paragraph can itself contain an entire book.
                // Keep offsets in the original paragraph, including emoji pairs.
                let position = index == target ? offsets.utf16Offset(forScalarOffset: anchor?.characterOffset ?? 0) : 0
                let end = endingAtAnchor ? min(length, position + 1) : length
                let start = endingAtAnchor ? max(0, end - budget) : max(0, min(max(0, length - budget), position - budget / 4))
                range = (passage.text as NSString).rangeOfComposedCharacterSequences(for: NSRange(location: start, length: min(budget, end - start)))
            } else { range = NSRange(location: 0, length: length) }
            var display = passage
            if range.location != 0 || range.length != length { display.text = (passage.text as NSString).substring(with: range) }
            result.append(Slice(index: index, original: passage, display: display, sourceRange: range, offsets: offsets,
                                scalarStart: offsets.scalarOffset(forUTF16Offset: range.location), scalarEnd: offsets.scalarOffset(forUTF16Offset: NSMaxRange(range))))
            used += cost
            if NSMaxRange(range) < length { break }
        }
        slices = result
        if let first = result.first, first.sourceRange.location > 0 {
            previousAnchor = ReadingAnchor(chapterID: chapter.id, passageID: first.original.id, characterOffset: max(0, first.scalarStart - 1))
        } else if let first = result.first, first.index > 0 {
            let previous = chapter.passages[first.index - 1]
            previousAnchor = ReadingAnchor(chapterID: chapter.id, passageID: previous.id, characterOffset: max(0, previous.text.unicodeScalars.count - 1))
        } else { previousAnchor = nil }
        if let last = result.last, NSMaxRange(last.sourceRange) < last.offsets.utf16Count {
            nextAnchor = ReadingAnchor(chapterID: chapter.id, passageID: last.original.id, characterOffset: last.scalarEnd)
        } else if let last = result.last, last.index + 1 < chapter.passages.count {
            nextAnchor = ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages[last.index + 1].id)
        } else { nextAnchor = nil }
        isComplete = previousAnchor == nil && nextAnchor == nil
        signature = (result.first.map { "\($0.index):\($0.sourceRange.location)" } ?? "empty")
            + ":" + (result.last.map { "\($0.index):\(NSMaxRange($0.sourceRange))" } ?? "empty")
    }
    public func contains(_ anchor: ReadingAnchor) -> Bool {
        anchor.chapterID == chapterID && slices.contains { $0.original.id == anchor.passageID && anchor.characterOffset >= $0.scalarStart && anchor.characterOffset < max($0.scalarStart + 1, $0.scalarEnd) }
    }
    public func chapter(from original: BookChapter) -> BookChapter {
        var result = original; result.passages = slices.map(\.display); return result
    }
}
