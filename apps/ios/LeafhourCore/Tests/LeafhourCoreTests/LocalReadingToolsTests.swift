import Foundation
import XCTest
@testable import LeafhourCore

final class LocalReadingToolsTests: XCTestCase {
    private func book(passages: [Passage]? = nil) -> LocalBook {
        LocalBook(id: "local-book", title: "A local book", author: "An author", kind: .txt,
                  sourceVersion: "sha256-local-source", originalFilename: "private.txt", importedAt: .distantPast,
                  chapters: [BookChapter(id: "one", title: "One", sourcePath: "private/source.txt", passages: passages ?? [
                    Passage(id: "p1", text: "🐿️ CAFÉ and quiet reading."),
                    Passage(id: "p2", text: "A second exact source."),
                    Passage(id: "image", text: "Illustration placeholder", resourcePath: "private/secret.png", alternative: "Private image label")
                  ]), BookChapter(id: "two", title: "Two", sourcePath: "private/next.txt", passages: [
                    Passage(id: "p3", text: "A future passage stays unread.")
                  ])])
    }

    func testContextUsesCapturedBookPositionAndNeverTreatsMissingTranslationsAsText() async throws {
        let tools = LocalReadingTools(book: book(), chapterID: "one", passageID: "p2")
        let result = await tools.execute(name: "reader_get_context")
        XCTAssertEqual(result["bookId"].string, "local-book")
        XCTAssertEqual(result["sourceVersion"].string, "sha256-local-source")
        XCTAssertEqual(result["contentVersion"].string, "sha256-local-source")
        XCTAssertEqual(result["passageId"].string, "p2")
        XCTAssertEqual(result["passages"].array.count, 1)
        let piece = try XCTUnwrap(result["passages"].array.first)
        XCTAssertEqual(piece["original"].string, "A second exact source.")
        XCTAssertEqual(piece["literal"], .null)
        XCTAssertEqual(piece["interpretive"], .null)
        XCTAssertEqual(piece["translationStatus"]["literal"].string, "missing")
        XCTAssertEqual(piece["translationStatus"]["interpretive"].string, "missing")
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(result), as: UTF8.self).contains("private/"))
    }

    func testListsOnlyCurrentBookAndPagesRealOutline() async {
        let tools = LocalReadingTools(book: book(), chapterID: "one", passageID: "p1")
        let listed = await tools.execute(name: "reader_list_books")
        XCTAssertEqual(listed["books"].array.map { $0["bookId"].string }, ["local-book"])
        let missing = await tools.execute(name: "reader_list_books", args: .object(["query": .string("absent")]))
        XCTAssertEqual(missing["books"].array, [])
        let outline = await tools.execute(name: "reader_get_outline", args: .object(["bookId": .string("local-book"), "limit": .number(1)]))
        XCTAssertEqual(outline["chapters"].array.first?["id"].string, "one")
        XCTAssertEqual(outline["chapters"].array.first?["startPassageId"].string, "p1")
        XCTAssertEqual(outline["nextOffset"].number, 1)
    }

    func testChapterLayerDefaultsToOriginalAndMissingTranslationsNeverReturnSource() async {
        let tools = LocalReadingTools(book: book(), chapterID: "one", passageID: "p1")
        let base: [String: CloudJSON] = ["bookId": .string("local-book"), "chapterId": .string("one")]
        let continuation = await tools.execute(name: "reader_read_chapter", args: .object(base.merging([
            "passageId": .string("p1"), "charOffset": .number(0)
        ]) { _, new in new }))
        XCTAssertEqual(continuation["error"], .null)
        XCTAssertEqual(continuation["passages"].array.first?["original"].string, "🐿️ CAFÉ and quiet reading.")
        for layer in ["literal", "interpretive"] {
            for cursor: [String: CloudJSON] in [[:], ["passageId": .string("p1"), "charOffset": .number(0)]] {
                let args = base.merging(cursor) { _, new in new }.merging(["layer": .string(layer)]) { _, new in new }
                let response = await tools.execute(name: "reader_read_chapter", args: .object(args))
                XCTAssertEqual(response["error"]["code"].string, "UNAVAILABLE")
                XCTAssertEqual(response["passages"], .null)
            }
        }
    }

    func testLongUnicodePassageContinuationLosesNoTextAndKeepsGraphemesIntact() async throws {
        let unit = "👩🏽‍💻e\u{301}中文\"\\\n"
        let source = String(repeating: unit, count: 3_000)
        let tools = LocalReadingTools(book: book(passages: [Passage(id: "long", text: source), Passage(id: "after", text: "The end.")]), chapterID: "one", passageID: "long")
        var args: CloudJSON = .object(["bookId": .string("local-book"), "chapterId": .string("one"), "limit": .number(1)])
        var reconstructed = "", pages = 0, sawEnd = false
        while pages < 500 {
            let page = await tools.execute(name: "reader_read_chapter", args: args)
            XCTAssertEqual(page["error"], .null)
            XCTAssertLessThanOrEqual(try JSONEncoder().encode(page).count, 24_576)
            XCTAssertFalse(page["passages"].array.isEmpty)
            for passage in page["passages"].array {
                if passage["passageId"].string == "after" { sawEnd = true; break }
                let piece = try XCTUnwrap(passage["original"].string)
                XCTAssertFalse(piece.isEmpty, "A continuation must make progress")
                let begin = try XCTUnwrap(passage["visibleRanges"]["original"]["charOffset"].number)
                let end = try XCTUnwrap(passage["visibleRanges"]["original"]["charEnd"].number)
                XCTAssertEqual(Int(begin), reconstructed.unicodeScalars.count)
                reconstructed += piece
                XCTAssertEqual(Int(end), reconstructed.unicodeScalars.count)
                XCTAssertTrue(source.hasPrefix(reconstructed))
                // Exact Character boundaries matter for combining marks and joined emoji.
                XCTAssertEqual(Array(source.prefix(reconstructed.count)), Array(reconstructed))
            }
            if sawEnd { break }
            if page["nextCursor"] != .null {
                XCTAssertEqual(page["nextOffset"], .null)
                XCTAssertEqual(page["nextCursor"]["sourceVersion"].string, "sha256-local-source")
                args = page["nextCursor"]
            } else if let offset = page["nextOffset"].number {
                args = .object(["bookId": .string("local-book"), "chapterId": .string("one"), "offset": .number(offset), "limit": .number(1)])
            } else { break }
            pages += 1
        }
        XCTAssertEqual(reconstructed.unicodeScalars.map(\.value), source.unicodeScalars.map(\.value))
        XCTAssertTrue(sawEnd)
        XCTAssertGreaterThan(pages, 1)
    }

    func testSearchReturnsExactSourceOffsetsAndOnlyExposesReturnedExcerptForCitation() async throws {
        let source = String(repeating: "前", count: 300) + " CAFÉ " + String(repeating: "后", count: 300)
        let tools = LocalReadingTools(book: book(passages: [Passage(id: "p1", text: source)]), chapterID: "one", passageID: "p1")
        let search = await tools.execute(name: "reader_search", args: .object(["query": .string("café")]))
        let result = try XCTUnwrap(search["results"].array.first)
        XCTAssertEqual(result["passageId"].string, "p1")
        XCTAssertEqual(result["layer"].string, "original")
        let excerpt = try XCTUnwrap(result["excerpt"].string)
        let start = Int(try XCTUnwrap(result["charOffset"].number))
        let end = Int(try XCTUnwrap(result["charEnd"].number))
        XCTAssertEqual(String(String.UnicodeScalarView(Array(source.unicodeScalars)[start..<end])), excerpt)
        XCTAssertTrue(excerpt.contains("CAFÉ"))
        let cite = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("p1"), "quote": .string("CAFÉ")]))
        XCTAssertEqual(cite["quote"].string, "CAFÉ")
        let outside = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("p1"), "quote": .string(String(repeating: "前", count: 200))]))
        XCTAssertEqual(outside["error"]["code"].string, "UNREAD_SOURCE")
    }

    func testCitationsRequirePreviouslyReturnedExactUnicodeAndCorrectLayer() async {
        let tools = LocalReadingTools(book: book(passages: [Passage(id: "p1", text: "An exact e\u{301} quote.")]), chapterID: "one", passageID: "p1")
        let cite: [String: CloudJSON] = ["bookId": .string("local-book"), "passageId": .string("p1"), "quote": .string("exact")]
        let unread = await tools.execute(name: "reader_cite", args: .object(cite))
        XCTAssertEqual(unread["error"]["code"].string, "UNREAD_SOURCE")
        _ = await tools.execute(name: "reader_get_context")
        let read = await tools.execute(name: "reader_cite", args: .object(cite))
        XCTAssertEqual(read["quote"].string, "exact")
        XCTAssertEqual(read["contentVersion"].string, "sha256-local-source")
        let future = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("p3"), "quote": .string("future")]))
        XCTAssertEqual(future["error"]["code"].string, "UNREAD_SOURCE")
        let normalized = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("p1"), "quote": .string("é")]))
        XCTAssertEqual(normalized["error"]["code"].string, "UNREAD_SOURCE", "Canonical equivalence must not fabricate an exact quote")
        let translation = await tools.execute(name: "reader_cite", args: .object(cite.merging(["layer": .string("literal")]) { _, new in new }))
        XCTAssertEqual(translation["error"]["code"].string, "UNREAD_SOURCE")
    }

    func testCitationsMergeAdjacentReadRangesButNeverBridgeAnUnreadGap() async throws {
        let source = (0..<5_000).map { "token\($0) " }.joined()
        let tools = LocalReadingTools(book: book(passages: [Passage(id: "long", text: source)]), chapterID: "one", passageID: "long")
        let first = await tools.execute(name: "reader_get_context")
        let firstPiece = try XCTUnwrap(first["passages"].array.first?["original"].string)
        let end = firstPiece.unicodeScalars.count
        var skipped = first["nextCursor"].object
        skipped["charOffset"] = .number(Double(end + 100))
        _ = await tools.execute(name: "reader_read_chapter", args: .object(skipped))
        let gapQuote = String(source.dropFirst(end - 20).prefix(140))
        let gapCitation = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("long"), "quote": .string(gapQuote)]))
        XCTAssertEqual(gapCitation["error"]["code"].string, "UNREAD_SOURCE")
        let next = await tools.execute(name: "reader_read_chapter", args: first["nextCursor"])
        let secondPiece = try XCTUnwrap(next["passages"].array.first?["original"].string)
        let joined = String(firstPiece.suffix(20)) + String(secondPiece.prefix(20))
        let citation = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("long"), "quote": .string(joined)]))
        XCTAssertEqual(citation["quote"].string, joined)
    }

    func testRejectsCrossBookCrossVersionUnknownToolAndInvalidCursorDeterministically() async {
        let tools = LocalReadingTools(book: book(), chapterID: "one", passageID: "p1")
        let cases: [(String, CloudJSON, String)] = [
            ("reader_read_chapter", .object(["bookId": .string("other"), "chapterId": .string("one")]), "SCOPE_DENIED"),
            ("reader_search", .object(["query": .string("book"), "bookIds": .array([.string("other")])]), "SCOPE_DENIED"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("other")]), "NOT_FOUND"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("one"), "sourceVersion": .string("old")]), "SOURCE_CHANGED"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("one"), "passageId": .string("p1")]), "INVALID_ARGUMENTS"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("one"), "passageId": .string("p1"), "layer": .string("original"), "charOffset": .number(1)]), "INVALID_ARGUMENTS"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("one"), "offset": .number(-1)]), "INVALID_ARGUMENTS"),
            ("reader_read_chapter", .object(["bookId": .string("local-book"), "chapterId": .string("one"), "limit": .number(1.5)]), "INVALID_ARGUMENTS"),
            ("reader_search", .object(["query": .string(" ")]), "INVALID_ARGUMENTS"),
            ("reader_get_context", .object(["path": .string("/private/secret")]), "INVALID_ARGUMENTS"),
            ("reader_get_notes", .object([:]), "UNKNOWN_TOOL")
        ]
        for (name, args, code) in cases {
            let result = await tools.execute(name: name, args: args)
            XCTAssertEqual(result["error"]["code"].string, code, "\(name): \(args)")
        }
    }

    func testImageResourcesRemainUnavailableAndCannotBeSearchedOrCited() async throws {
        let tools = LocalReadingTools(book: book(), chapterID: "one", passageID: "image")
        let context = await tools.execute(name: "reader_get_context")
        let piece = try XCTUnwrap(context["passages"].array.first)
        XCTAssertEqual(piece["textStatus"].string, "unavailable")
        XCTAssertEqual(piece["original"], .null)
        let serialized = String(decoding: try JSONEncoder().encode(context), as: UTF8.self)
        XCTAssertFalse(serialized.contains("secret.png"))
        XCTAssertFalse(serialized.contains("Illustration placeholder"))
        XCTAssertFalse(serialized.contains("Private image label"))
        let search = await tools.execute(name: "reader_search", args: .object(["query": .string("placeholder")]))
        XCTAssertEqual(search["results"].array, [])
        let cite = await tools.execute(name: "reader_cite", args: .object(["bookId": .string("local-book"), "passageId": .string("image"), "quote": .string("placeholder")]))
        XCTAssertEqual(cite["error"]["code"].string, "UNREAD_SOURCE")
    }

    func testOversizedMetadataAndSearchResultsRemainBounded() async throws {
        var input = book(passages: (0..<100).map { Passage(id: "p\($0)", text: String(repeating: "\"🐿️/\\\u{0001}needle", count: 100)) })
        input.title = String(repeating: "\"🐿️/\\\u{0001}", count: 5_000)
        input.author = input.title
        for index in input.chapters.indices { input.chapters[index].title = input.title }
        let tools = LocalReadingTools(book: input, chapterID: "one", passageID: "p0")
        for (name, args) in [
            ("reader_get_context", CloudJSON.object([:])),
            ("reader_list_books", .object([:])),
            ("reader_get_outline", .object(["bookId": .string("local-book")])),
            ("reader_search", .object(["query": .string("needle"), "limit": .number(20)]))
        ] {
            let result = await tools.execute(name: name, args: args)
            XCTAssertEqual(result["error"], .null, name)
            XCTAssertLessThanOrEqual(try JSONEncoder().encode(result).count, 24_576, name)
        }
    }

    func testCapturedSnapshotDoesNotFollowLaterBookReplacement() async {
        var input = book()
        let tools = LocalReadingTools(book: input, chapterID: "one", passageID: "p1")
        input.sourceVersion = "replaced"
        input.chapters[0].passages[0].text = "Changed text"
        let context = await tools.execute(name: "reader_get_context")
        XCTAssertEqual(context["sourceVersion"].string, "sha256-local-source")
        XCTAssertEqual(context["passages"].array.first?["original"].string, "🐿️ CAFÉ and quiet reading.")
    }

    func testLargeScalarCursorUsesActualSourceLengthRatherThanCloudProductLimit() async throws {
        let source = String(repeating: "a", count: 10_000_001) + "end"
        let tools = LocalReadingTools(book: book(passages: [Passage(id: "large", text: source)]), chapterID: "one", passageID: "large")
        let page = await tools.execute(name: "reader_read_chapter", args: .object([
            "bookId": .string("local-book"), "chapterId": .string("one"), "passageId": .string("large"),
            "layer": .string("original"), "charOffset": .number(10_000_001)
        ]))
        XCTAssertEqual(page["error"], .null)
        XCTAssertEqual(page["passages"].array.first?["original"].string, "end")
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(page).count, 24_576)
    }
}
