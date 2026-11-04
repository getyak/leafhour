import XCTest
@testable import LeafhourCore

final class ReadingGuideTests: XCTestCase {
    func testFollowUpsContainActualAnswerPhrasesAndKeepThreeDistinctItems() {
        let items = ChatFollowUps.make(parentID: "turn", answer: "Finite games end with a winner. Infinite games continue.", question: "What are these games?")
        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(Set(items.map(\.text)).count, 3)
        XCTAssertTrue(items.allSatisfy { $0.text.contains("Finite games") || $0.text.contains("Infinite games") })
        XCTAssertEqual(items, ChatFollowUps.make(parentID: "turn", answer: "Finite games end with a winner. Infinite games continue.", question: "What are these games?"))
    }
    func testSuppliedSuggestionsAreDeduplicatedAndOldRepliesAreFilledWithoutModelCalls() {
        let supplied = [ChatFollowUp(id: "one", text: "Why finite games?"), ChatFollowUp(id: "two", text: "Why finite games?"), ChatFollowUp(id: "bad", text: " ")]
        let items = ChatFollowUps.make(parentID: "old", answer: "“有限游戏”有明确的终点。", question: "什么叫有限游戏？", supplied: supplied)
        XCTAssertEqual(items.count, 3); XCTAssertEqual(items.first?.text, "Why finite games?")
        XCTAssertEqual(Set(items.map(\.id)).count, 3); XCTAssertEqual(Set(items.map(\.text)).count, 3)
        XCTAssertTrue(items.dropFirst().allSatisfy { $0.text.contains("有限游戏") })
    }
    func testGuideSampleStopsAtSixOriginalPassagesAndPreservesUnicodeByteAndCharacterBounds() throws {
        let book = LocalBook(id: "book", title: "字".repeated(700), author: "作者", kind: .txt, sourceVersion: "version", originalFilename: "private.txt", importedAt: .distantPast,
                             chapters: (0..<30).map { c in BookChapter(id: "c\(c)", title: "章".repeated(250), sourcePath: "private.txt", passages: (0..<10).map { p in Passage(id: "p\(c)-\(p)", text: "👩🏽‍💻中文".repeated(1500)) }) })
        let sample = try ReadingGuideContext.make(book: book)
        XCTAssertLessThanOrEqual(sample.chapters.count, 24); XCTAssertLessThanOrEqual(sample.passages.count, 6)
        XCTAssertLessThanOrEqual(sample.passages.reduce(0) { $0 + $1.original.unicodeScalars.count }, 6000)
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(sample).count, 18000)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(sample), as: UTF8.self).contains("private.txt"))
        XCTAssertTrue(book.chapters[0].passages[0].text.hasPrefix(try XCTUnwrap(sample.passages.first?.original)))
    }
    func testImageOnlyBookHasNoInventedOpening() {
        let book = LocalBook(id: "scan", title: "Scan", author: "", kind: .pdf, sourceVersion: "v", originalFilename: "scan.pdf", importedAt: .distantPast,
                             chapters: [BookChapter(id: "c1", title: "Page", sourcePath: "", passages: [Passage(id: "p1", text: "Page 1", resourcePath: "page.png")])])
        XCTAssertThrowsError(try ReadingGuideContext.make(book: book))
    }
}
private extension String { func repeated(_ count: Int) -> String { String(repeating: self, count: count) } }
