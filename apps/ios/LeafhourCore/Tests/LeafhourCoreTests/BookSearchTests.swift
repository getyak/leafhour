import XCTest
@testable import LeafhourCore

final class BookSearchTests: XCTestCase {
    private func chapters() -> [BookChapter] {
        [BookChapter(id: "one", title: "One", sourcePath: "one", passages: [
            Passage(id: "repeated-id", text: "🐿️ CAFÉ and another café."),
            Passage(id: "other", text: "A quiet book.")
        ]), BookChapter(id: "two", title: "Two", sourcePath: "two", passages: [
            Passage(id: "repeated-id", text: "原文 👩‍👩‍👧‍👦 cafe\u{301}，继续读。")
        ])]
    }

    func testMatchesPreserveChapterIdentityAndExactScalarNavigation() async throws {
        let results = try await BookSearch.matches(in: chapters(), query: "  cafe \n")
        XCTAssertEqual(results.count, 2, "Count matching paragraphs, not occurrences")
        XCTAssertEqual(results.map(\.chapterIndex), [0, 1])
        XCTAssertNotEqual(results[0].id, results[1].id)
        XCTAssertEqual(results[0].anchor, ReadingAnchor(chapterID: "one", passageID: "repeated-id", characterOffset: "🐿️ ".unicodeScalars.count))
        XCTAssertEqual(results[1].anchor, ReadingAnchor(chapterID: "two", passageID: "repeated-id", characterOffset: "原文 👩‍👩‍👧‍👦 ".unicodeScalars.count))
        XCTAssertEqual(results[0].excerpt.match, "CAFÉ")
        XCTAssertEqual(results[1].excerpt.match, "cafe\u{301}")
    }

    func testEmptyAndMissingQueriesHaveNoResults() async throws {
        for query in ["", " \t\n", "absent"] {
            let results = try await BookSearch.matches(in: chapters(), query: query)
            XCTAssertTrue(results.isEmpty)
        }
    }

    func testConcurrentQueriesDoNotMixResults() async throws {
        let input = chapters()
        async let coffee = BookSearch.matches(in: input, query: "cafe")
        async let quiet = BookSearch.matches(in: input, query: "quiet")
        let (first, second) = try await (coffee, quiet)
        XCTAssertEqual(first.count, 2)
        XCTAssertEqual(second.count, 1)
        XCTAssertEqual(second[0].anchor.passageID, "other")
        XCTAssertEqual(second[0].excerpt.match, "quiet")
    }

    func testCancelledParentDoesNotReturnSearchResults() async throws {
        let input = chapters()
        let request = Task { try await BookSearch.matches(in: input, query: "cafe") }
        request.cancel()
        do { _ = try await request.value; XCTFail("A cancelled request must not publish results") }
        catch is CancellationError { }
    }

    func testCancellingALargeScanLeavesANewSearchUsable() async throws {
        let source = "原文 🐿️ " + String(repeating: "bounded source ", count: 40)
        let input = [BookChapter(id: "large", title: "Large", sourcePath: "large", passages:
            (0..<50_000).map { Passage(id: "p\($0)", text: source) })]
        let request = Task { try await BookSearch.matches(in: input, query: "source") }
        try await Task.sleep(for: .milliseconds(5))
        request.cancel()
        do { _ = try await request.value; XCTFail("A superseded scan must be cancelled") }
        catch is CancellationError { }
        let fresh = try await BookSearch.matches(in: chapters(), query: "quiet")
        XCTAssertEqual(fresh.count, 1)
        XCTAssertEqual(fresh[0].anchor.passageID, "other")
    }
}
