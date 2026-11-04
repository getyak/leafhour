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
    func testLongUnicodePassageWindowPreparationProfile() throws {
        let text = String(repeating: "原文 🐿️ café e\u{301}\n", count: 120_000)
        let source = chapter([text])
        let start = ContinuousClock.now
        var current = ReadingTextWindow(chapter: source, anchor: nil)
        let firstEnd = ContinuousClock.now
        var elapsed: [String] = []
        for _ in 0..<4 {
            let anchor = try XCTUnwrap(current.nextAnchor), begin = ContinuousClock.now
            let next = ReadingTextWindow(chapter: source, anchor: anchor, reusing: current)
            XCTAssertEqual(next.preparedOffsetUTF16Count, 0, "Adjacent slices must reuse the unchanged long source offsets")
            XCTAssertEqual(next.reusedOffsetCount, 1)
            elapsed.append(String(describing: begin.duration(to: .now)))
            XCTAssertTrue(next.contains(anchor))
            XCTAssertEqual(next.slices.first?.original.id, "text-0")
            XCTAssertLessThan(next.slices.first!.display.text.utf16.count, 24_100)
            XCTAssertFalse(next.slices.first!.display.text.contains("\u{fffd}"))
            current = next
        }
        print("OPENING_LONG_WINDOW sourceBytes=\(text.utf8.count) first=\(start.duration(to: firstEnd)) subsequent=\(elapsed.joined(separator: ","))")
    }

    func testOffsetReuseRejectsChangedSourceOrChapterAndMatchesExactOriginal() throws {
        let text = String(repeating: "原文 🐿️ café e\u{301}\n", count: 10_000)
        let original = chapter([text]), first = ReadingTextWindow(chapter: chapter([text]), anchor: nil)
        XCTAssertTrue(first.matchesSource(original))
        var changed = original
        changed.passages[0].text = String(repeating: "a", count: text.utf16.count)
        XCTAssertFalse(first.matchesSource(changed))
        let next = ReadingTextWindow(chapter: changed, anchor: first.nextAnchor, reusing: first)
        XCTAssertGreaterThan(next.preparedOffsetUTF16Count, 0)
        XCTAssertEqual(next.reusedOffsetCount, 0)
        XCTAssertEqual(next.slices.first?.offsets.scalarCount, text.utf16.count, "Old Unicode checkpoints cannot map changed ASCII source")
        changed = original; changed.id = "different-chapter"
        let other = ReadingTextWindow(chapter: changed, anchor: nil, reusing: first)
        XCTAssertEqual(other.reusedOffsetCount, 0)
        XCTAssertFalse(first.matchesSource(changed))
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
