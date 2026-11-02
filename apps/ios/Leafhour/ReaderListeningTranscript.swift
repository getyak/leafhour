import Foundation

/// Display coordinates, independently of source/Markdown anchor coordinates.
struct ReaderListeningTranscript {
    struct Line: Identifiable {
        let id: Int
        let text: String
        let beforeWord: String
        let word: String
        let afterWord: String
    }
    let lines: [Line]
    let activeID: Int?
    init(text: String, wordRange: NSRange?, sentenceRanges: [NSRange]? = nil) {
        let source = text as NSString
        let valid = wordRange.flatMap { $0.length > 0 && $0.location >= 0 && $0.location <= source.length - $0.length && Range($0, in: text) != nil ? $0 : nil }
        let ranges = sentenceRanges ?? ReaderSpeechContent.sentenceRanges(text)
        activeID = valid.flatMap { word in ranges.firstIndex { NSIntersectionRange($0, word).length > 0 } }
        lines = ranges.enumerated().map { index, range in
            let overlap = valid.map { NSIntersectionRange(range, $0) }
            guard let overlap, overlap.length > 0 else {
                return Line(id: index, text: source.substring(with: range), beforeWord: source.substring(with: range), word: "", afterWord: "")
            }
            return Line(id: index, text: source.substring(with: range),
                beforeWord: source.substring(with: NSRange(location: range.location, length: overlap.location - range.location)),
                word: source.substring(with: overlap),
                afterWord: source.substring(with: NSRange(location: NSMaxRange(overlap), length: NSMaxRange(range) - NSMaxRange(overlap))))
        }
    }
}
