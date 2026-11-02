import XCTest
import SwiftUI
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderImmersionTests: XCTestCase {
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
