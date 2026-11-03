import XCTest
import SwiftUI
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderImmersionTests: XCTestCase {
    func testListeningComparisonUsesExactParagraphTranslationWithoutInventedSentenceAlignment() throws {
        let passage = try JSONDecoder().decode(Passage.self, from: Data(#"{"id":"p","text":"First sentence. Second sentence.","heading":false}"#.utf8))
        let translation = ReadingTranslation(original: passage.text, literal: "这是整段的直译。", interpretive: "这是意译。")
        let row = ReaderListeningPassage(chapterID: "c", passage: passage, variant: nil, translation: translation)
        XCTAssertEqual(row.content.text, passage.text)
        XCTAssertEqual(row.comparison, "这是整段的直译。")
        XCTAssertEqual(row.comparisonLabel, "直译 · 段落对照")
        let translated = ReaderListeningPassage(chapterID: "c", passage: passage, variant: .interpretive, translation: translation)
        XCTAssertEqual(translated.content.text, "这是意译。")
        XCTAssertEqual(translated.comparison, passage.text)
        XCTAssertEqual(translated.comparisonLabel, "原文 · 段落对照")
        let stale = ReaderListeningPassage(chapterID: "c", passage: passage, variant: nil, translation: ReadingTranslation(original: "another version", literal: "不可使用"))
        XCTAssertNil(stale.comparison)
    }

    func testNativeListeningPaintPreservesSelectedTextAndUsesReaderTypography() {
        var preferences = ReaderPreferences(); preferences.fontSize = 28; preferences.fontStyle = .sans
        let source = "A quiet 🙂 sentence remains selectable."
        var changes: [Bool] = []
        let initial = ReaderListeningText(text: source, preferences: preferences, active: false, onSelection: { changes.append($0) })
        let coordinator = ReaderListeningText.Coordinator(initial), view = UITextView()
        view.isEditable = false; view.delegate = coordinator
        coordinator.update(view, category: .large)
        let selected = (source as NSString).range(of: "quiet 🙂")
        view.selectedRange = selected
        let eventCount = changes.count
        coordinator.parent = ReaderListeningText(text: source, preferences: preferences, wordRange: (source as NSString).range(of: "sentence"), active: true, onSelection: { changes.append($0) })
        coordinator.update(view, category: .large)
        XCTAssertEqual(view.attributedText.string, source)
        XCTAssertEqual(view.selectedRange, selected)
        XCTAssertEqual(changes.count, eventCount, "Speech paint must not produce selection lifecycle changes")
        let font = view.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        XCTAssertEqual(font?.pointSize, ReaderTypography.font(style: .sans, size: 28, traits: UITraitCollection(preferredContentSizeCategory: .large)).pointSize)
    }

    func testDropKeepsExactCurrentSelectionAndRejectsExternalOrMultipleQuotes() {
        let quote = SelectedQuote(anchor: .init(chapterID: "chapter", passageID: "paragraph"), text: "中文🙂 selected source", origin: "translation", variant: "literal", translationOffset: 3)
        XCTAssertTrue(ReaderSelectionDrop.accepts([quote.text], quote: quote))
        XCTAssertFalse(ReaderSelectionDrop.accepts(["unrelated external text"], quote: quote))
        XCTAssertFalse(ReaderSelectionDrop.accepts([quote.text, quote.text], quote: quote))
        XCTAssertFalse(ReaderSelectionDrop.accepts([""], quote: quote))
    }

    func testSelectionDockFitsNarrowAndAccessibilityProposalsWithoutClippingActions() throws {
        let quote = SelectedQuote(anchor: .init(chapterID: "c", passageID: "p"), text: "A selected sentence remains available in full to Chat.")
        for width in [CGFloat(240), 320, 378] {
            for size in [DynamicTypeSize.large, .accessibility5] {
                let dock = ReaderSelectionDock(quote: quote, paper: .white, onAI: {}, onNote: {}, onTranslate: {}, onShare: {}, onClear: {})
                    .environment(\.dynamicTypeSize, size)
                let host = UIHostingController(rootView: dock)
                let fitting = host.sizeThatFits(in: CGSize(width: width, height: 2000))
                XCTAssertLessThanOrEqual(fitting.width, width + 0.5, "Actions must fit inside the proposed reader width")
                XCTAssertGreaterThan(fitting.height, 80, "The quote and real touch targets need their full height")
            }
        }
    }

    func testTranscriptUsesDisplayedUTF16WordsAcrossEmojiAndSentences() throws {
        let text = "中文🙂，慢慢读。下一句继续。"
        let word = (text as NSString).range(of: "下一句")
        let transcript = ReaderListeningTranscript(text: text, wordRange: word)
        XCTAssertEqual(transcript.lines.map(\.text), ["中文🙂，慢慢读。", "下一句继续。"])
        XCTAssertEqual(transcript.activeID, 1)
        XCTAssertEqual(transcript.lines[1].beforeWord, "")
        XCTAssertEqual(transcript.lines[1].word, "下一句")
        XCTAssertEqual(transcript.lines[1].afterWord, "继续。")
        XCTAssertNil(ReaderListeningTranscript(text: text, wordRange: NSRange(location: 900, length: 1)).activeID)
    }
}
