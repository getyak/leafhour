import XCTest
@testable import LeafhourCore

final class ReadingTextWindowTests: XCTestCase {
    private func chapter(_ rows: [String]) -> BookChapter {
        BookChapter(id: "text", title: "Source", sourcePath: "text", passages: rows.enumerated().map { Passage(id: "text-\($0.offset)", text: $0.element) })
    }
    func testLargeChapterOnlyPreparesBoundedTextAndKeepsCanonicalIDs() {
        let source = chapter((0..<230_000).map { "Source paragraph \($0). " + String(repeating: "原文 🐿️ ", count: 20) })
        let window = ReadingTextWindow(chapter: source, anchor: ReadingAnchor(chapterID: "text", passageID: "text-120000"))
        XCTAssertLessThanOrEqual(window.slices.reduce(0) { $0 + $1.display.text.utf16.count }, 24_100)
        XCTAssertLessThanOrEqual(window.slices.count, 160)
        XCTAssertTrue(window.contains(ReadingAnchor(chapterID: "text", passageID: "text-120000")))
        XCTAssertFalse(window.isComplete)
        XCTAssertNotNil(window.previousAnchor)
        XCTAssertNotNil(window.nextAnchor)
        XCTAssertEqual(source.passages.count, 230_000)
    }
    func testOversizedSinglePassageHasUnicodeSafeContinuationAndSourceOffsets() {
        let text = String(repeating: "原文 🐿️ café e\u{301}\n", count: 10_000)
        let source = chapter([text])
        let start = ReadingTextWindow(chapter: source, anchor: nil)
        XCTAssertLessThan(start.slices[0].display.text.utf16.count, 24_100)
        let next = start.nextAnchor!
        let later = ReadingTextWindow(chapter: source, anchor: next)
        XCTAssertTrue(later.contains(next))
        XCTAssertEqual(later.slices[0].original.id, "text-0")
        XCTAssertGreaterThan(later.slices[0].sourceRange.location, 0)
        XCTAssertFalse(later.slices[0].display.text.contains("\u{fffd}"))
        XCTAssertNotNil(later.previousAnchor)
    }
    func testBackwardWindowEndsBeforeTheWindowBeingLeft() {
        let source = chapter((0..<2000).map { "Paragraph \($0) " + String(repeating: "x", count: 200) })
        let current = ReadingTextWindow(chapter: source, anchor: ReadingAnchor(chapterID: "text", passageID: "text-1000"))
        let previous = ReadingTextWindow(chapter: source, anchor: current.previousAnchor, endingAtAnchor: true)
        XCTAssertLessThan(previous.slices.last!.index, current.slices.first!.index)
        XCTAssertEqual(previous.nextAnchor?.passageID, current.slices.first!.original.id)
    }

    func testSmallMarkdownKeepsEntireSourceAndLastWindowCanReachTheEnd() {
        let small = chapter(["# Heading", "**Source**", "Last."])
        XCTAssertTrue(ReadingTextWindow(chapter: small, anchor: nil).isComplete)
        let large = chapter((0..<2000).map { "Paragraph \($0) " + String(repeating: "x", count: 200) })
        let last = ReadingTextWindow(chapter: large, anchor: ReadingAnchor(chapterID: "text", passageID: "text-1999"))
        XCTAssertNil(last.nextAnchor)
        XCTAssertTrue(last.contains(ReadingAnchor(chapterID: "text", passageID: "text-1999")))
    }
}
