import Foundation
import NaturalLanguage
import CryptoKit
import LeafhourCore

struct ReaderSpeechLocation: Equatable {
    let chapterID: String
    let passageID: String
    let layer: String
    let snapshot: String
    let utf16Offset: Int
}

struct ReaderSpeechHighlight: Equatable {
    let location: ReaderSpeechLocation
    let sentenceRange: NSRange
    let wordRange: NSRange
}

/// Spoken/displayed text and raw-layer offsets share the reader's full Markdown
/// parse, including cross-paragraph references and retained-source boundaries.
struct ReaderSpeechContent {
    let chapterID: String
    let passageID: String
    let layer: String
    let source: String
    let text: String
    let fingerprint: String
    let sentences: [NSRange]
    private let document: MarkdownDocument?
    private let documentStart: Int
    private let sourceStart: Int

    init(chapterID: String, passage: Passage, variant: ReaderTranslationVariant?, translation: ReadingTranslation?, markdown: MarkdownChapterLayout? = nil, passageIndex: Int = 0) {
        self.chapterID = chapterID; passageID = passage.id
        if !passage.heading, let variant, let translation, translation.original == passage.text, let translated = translation.text(variant) {
            layer = variant.rawValue; source = translated; text = translated
            document = nil; documentStart = 0; sourceStart = 0
        } else {
            layer = "original"; source = passage.text
            if let markdown, markdown.sourceRanges.indices.contains(passageIndex) {
                let raw = markdown.sourceRanges[passageIndex]
                let start = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: raw.location)
                let end = markdown.document.displayedUTF16Offset(forSourceUTF16Offset: NSMaxRange(raw))
                text = (markdown.document.text as NSString).substring(with: NSRange(location: start, length: max(0, end - start)))
                document = markdown.document; documentStart = start; sourceStart = raw.location
            } else {
                text = passage.text; document = nil; documentStart = 0; sourceStart = 0
            }
        }
        fingerprint = SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined()
        sentences = Self.sentenceRanges(text)
    }
    static func sentenceRanges(_ text: String) -> [NSRange] {
        let tokenizer = NLTokenizer(unit: .sentence); tokenizer.string = text
        var result: [NSRange] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            var start = range.lowerBound, end = range.upperBound
            while start < end && text[start].isWhitespace { start = text.index(after: start) }
            while end > start && text[text.index(before: end)].isWhitespace { end = text.index(before: end) }
            if start < end { result.append(NSRange(start..<end, in: text)) }
            return true
        }
        return result
    }
    func sentence(at offset: Int) -> NSRange? {
        sentences.first { NSMaxRange($0) > offset } ?? sentences.last
    }
    func sourceOffset(at spokenOffset: Int) -> Int {
        let bounded = min(max(0, spokenOffset), text.utf16.count)
        return min(source.utf16.count, max(0, document.map { $0.sourceUTF16Offset(at: documentStart + bounded) - sourceStart } ?? bounded))
    }
    func spokenOffset(at sourceOffset: Int) -> Int {
        let bounded = min(max(0, sourceOffset), source.utf16.count)
        return min(text.utf16.count, max(0, document.map { $0.displayedUTF16Offset(forSourceUTF16Offset: sourceStart + bounded) - documentStart } ?? bounded))
    }
    func sourceRange(_ spokenRange: NSRange) -> NSRange {
        let start = sourceOffset(at: spokenRange.location), end = sourceOffset(at: NSMaxRange(spokenRange))
        return NSRange(location: start, length: max(0, end - start))
    }
    func location(at spokenOffset: Int) -> ReaderSpeechLocation {
        ReaderSpeechLocation(chapterID: chapterID, passageID: passageID, layer: layer, snapshot: source, utf16Offset: sourceOffset(at: spokenOffset))
    }
}
