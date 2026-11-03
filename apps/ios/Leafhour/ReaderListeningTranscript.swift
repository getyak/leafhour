import Foundation
import LeafhourCore

/// Translation alignment is a paragraph contract, never a sentence-count guess.
@MainActor final class ReaderListeningPassage: Identifiable {
    let id: String
    // The chapter index is cheap. Tokenize/hash only paragraphs the lazy
    // transcript actually presents, retaining the result across word callbacks.
    private let makeContent: () -> ReaderSpeechContent
    lazy var content: ReaderSpeechContent = makeContent()
    let comparison: String?
    let comparisonLabel: String
    init(chapterID: String, passage: Passage, variant: ReaderTranslationVariant?, translation: ReadingTranslation?,
         comparisonVariant: ReaderTranslationVariant = .literal, markdown: MarkdownChapterLayout? = nil, passageIndex: Int = 0) {
        id = passage.id
        makeContent = { ReaderSpeechContent(chapterID: chapterID, passage: passage, variant: variant, translation: translation, markdown: markdown, passageIndex: passageIndex) }
        if !passage.heading, let variant, translation?.original == passage.text, translation?.text(variant) != nil {
            comparison = passage.text
            comparisonLabel = "原文 · 段落对照"
        } else {
            comparison = !passage.heading && translation?.original == passage.text ? translation?.text(comparisonVariant) : nil
            comparisonLabel = (comparisonVariant == .literal ? "直译" : "意译") + " · 段落对照"
        }
    }
}

/// Display coordinates, independently of source/Markdown anchor coordinates.
struct ReaderListeningTranscript {
    struct Line: Identifiable {
        let id: Int
        let range: NSRange
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
                return Line(id: index, range: range, text: source.substring(with: range), beforeWord: source.substring(with: range), word: "", afterWord: "")
            }
            return Line(id: index, range: range, text: source.substring(with: range),
                beforeWord: source.substring(with: NSRange(location: range.location, length: overlap.location - range.location)),
                word: source.substring(with: overlap),
                afterWord: source.substring(with: NSRange(location: NSMaxRange(overlap), length: NSMaxRange(range) - NSMaxRange(overlap))))
        }
    }
}
