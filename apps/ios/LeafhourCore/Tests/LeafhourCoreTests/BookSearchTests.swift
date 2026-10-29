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
    func testMarkdownSearchUsesRenderedTextAndOriginalUnicodeAnchor() async throws {
        let source = "🐿️ A **bold** gentle thought, then [中文](https://example.org)."
        let input = [BookChapter(id: "md", title: "Markdown", sourcePath: "md", passages: [Passage(id: "text-0", text: source)])]
        let results = try await BookSearch.matches(in: input, query: "bold gentle", markdown: true)
        XCTAssertEqual(results.count, 1)
        let result = try XCTUnwrap(results.first)
        XCTAssertEqual(result.excerpt.match, "bold gentle")
        XCTAssertFalse((result.excerpt.before + result.excerpt.after).contains("**"))
        XCTAssertFalse((result.excerpt.before + result.excerpt.after).contains("https://"))
        XCTAssertEqual(result.anchor.characterOffset, "🐿️ A **".unicodeScalars.count)
        XCTAssertEqual(result.excerpt.characterOffset, result.anchor.characterOffset)
        let chinese = try await BookSearch.matches(in: input, query: "中文", markdown: true)
        let prefix = source[..<source.range(of: "中文")!.lowerBound]
        XCTAssertEqual(chinese.first?.anchor.characterOffset, prefix.unicodeScalars.count)
    }
    func testMarkdownSearchRetainsLegacyPassageIDsAndCodeLiteralsAcrossBlankLines() async throws {
        let source = [Passage(id: "text-0", text: "# Heading"), Passage(id: "text-1", text: "```md\n**kept**"), Passage(id: "text-2", text: "still **literal**\n```"), Passage(id: "text-3", text: "After **formatting**.")]
        let input = [BookChapter(id: "text", title: "Book", sourcePath: "text", passages: source)]
        let result = try await BookSearch.matches(in: input, query: "**literal**", markdown: true)
        XCTAssertEqual(result.first?.anchor.passageID, "text-2")
        XCTAssertEqual(result.first?.anchor.characterOffset, "still ".unicodeScalars.count)
        let formatted = try await BookSearch.matches(in: input, query: "formatting", markdown: true)
        XCTAssertEqual(formatted.first?.anchor.passageID, "text-3")
        XCTAssertFalse(formatted.first?.excerpt.before.contains("**") ?? true)
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
