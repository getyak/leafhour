import XCTest
import UIKit
@testable import Leafhour

@MainActor final class ReaderTapTests: XCTestCase {
    func testCenterRevealsFullToolsAndEdgesRemainReachableAfterScrolling() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in })
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 350)), .tools)
        text.bounds.origin.y = 800
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 810)), .top)
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 1490)), .progress)
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 1150)), .tools)
        XCTAssertNil(handler.destination(at: CGPoint(x: 180, y: 10)))
    }
    func testRawNativeSelectionBlocksDisclosureEvenWithoutDomainQuote() {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        text.text = "A selection across two paragraphs.\n\nAnother paragraph."
        text.selectedRange = NSRange(location: 2, length: 40)
        let handler = ReaderEdgeTapHandler(view: text, blocked: { text.selectedRange.length > 0 }, onWake: { _ in })
        XCTAssertNil(handler.destination(at: CGPoint(x: 180, y: 350)))
    }
    func testNativeLinkGlyphDoesNotOpenReaderChrome() throws {
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), textContainer: nil)
        text.attributedText = NSAttributedString(string: "A source link", attributes: [.font: UIFont.systemFont(ofSize: 22), .link: URL(string: "https://example.invalid")!])
        text.layoutManager.ensureLayout(for: text.textContainer)
        let rect = text.layoutManager.boundingRect(forGlyphRange: NSRange(location: 2, length: 1), in: text.textContainer)
        let point = CGPoint(x: rect.midX + text.textContainerInset.left, y: rect.midY + text.textContainerInset.top)
        let handler = ReaderEdgeTapHandler(view: text, blocked: { false }, onWake: { _ in })
        XCTAssertTrue(ReaderEdgeTapHandler.isLink(at: point, in: text))
        XCTAssertNil(handler.destination(at: point))
        XCTAssertEqual(handler.destination(at: CGPoint(x: 180, y: 350)), .tools)
    }
}
