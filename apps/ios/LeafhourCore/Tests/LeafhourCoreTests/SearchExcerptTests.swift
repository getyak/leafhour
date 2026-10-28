import XCTest
@testable import LeafhourCore

final class SearchExcerptTests: XCTestCase {
    func testLateMatchShowsContextAndUsesScalarOffset() throws {
        let prefix = String(repeating: "原文 🐿️ e\u{301} ", count: 80)
        let source = prefix + "needle" + String(repeating: " 后文", count: 100)
        let result = try XCTUnwrap(SearchExcerpt.find(in: source, query: "needle"))
        XCTAssertEqual(result.characterOffset, prefix.unicodeScalars.count)
        XCTAssertEqual(result.match, "needle")
        XCTAssertEqual(result.before, "…" + String(prefix.suffix(32)))
        XCTAssertEqual(result.after, String(source.suffix(300).prefix(64)) + "…")
        XCTAssertLessThanOrEqual((result.before + result.match + result.after).count, 194)
        let start = source.unicodeScalars.index(source.unicodeScalars.startIndex, offsetBy: result.characterOffset)
        XCTAssertTrue(String(source.unicodeScalars[start...]).hasPrefix("needle"))
    }

    func testLocaleSearchRetainsSourceSpellingAndTrimsInput() throws {
        let result = try XCTUnwrap(SearchExcerpt.find(in: "🐿️ A CAFÉ by the sea.", query: " \n cafe \t"))
        XCTAssertEqual(result.match, "CAFÉ")
        XCTAssertEqual(result.before, "🐿️ A ")
        XCTAssertEqual(result.after, " by the sea.")
        XCTAssertEqual(result.characterOffset, "🐿️ A ".unicodeScalars.count)
    }

    func testComposedSourceAndRepeatedMatchesUseFirstOccurrence() throws {
        let source = "家族 👩‍👩‍👧‍👦 cafe\u{301}，café"
        let result = try XCTUnwrap(SearchExcerpt.find(in: source, query: "cafe"))
        XCTAssertEqual(result.before, "家族 👩‍👩‍👧‍👦 ")
        XCTAssertEqual(result.match, "cafe\u{301}")
        XCTAssertEqual(result.after, "，café")
        XCTAssertEqual(result.characterOffset, result.before.unicodeScalars.count)
    }

    func testVeryLongMatchIsBoundedWithoutBreakingCharacters() throws {
        let query = String(repeating: "👩‍👩‍👧‍👦", count: 160)
        let result = try XCTUnwrap(SearchExcerpt.find(in: "前" + query + "后", query: query))
        XCTAssertEqual(result.before, "前")
        XCTAssertEqual(result.match, String(query.prefix(96)))
        XCTAssertEqual(result.after, "…")
        XCTAssertEqual(result.characterOffset, 1)
    }

    func testMatchInsideEmojiKeepsDisplayWholeAndExactScalarDestination() throws {
        let result = try XCTUnwrap(SearchExcerpt.find(in: "前👩‍👩‍👧‍👦后", query: "👧"))
        XCTAssertEqual(result.before, "前")
        XCTAssertEqual(result.match, "👩‍👩‍👧‍👦")
        XCTAssertEqual(result.after, "后")
        XCTAssertEqual(result.characterOffset, "前👩‍👩‍".unicodeScalars.count)
    }

    func testEmptyWhitespaceAndMissingQueryHaveNoMatch() {
        for query in ["", " \n\t ", "absent"] {
            XCTAssertNil(SearchExcerpt.find(in: "source", query: query))
        }
        XCTAssertNil(SearchExcerpt.find(in: "", query: "source"))
    }

    func testHardLineBreaksCannotPushMatchOutOfPreview() throws {
        let prefix = "一\n二\r\n三\t四\n"
        let result = try XCTUnwrap(SearchExcerpt.find(in: prefix + "needle\n后文", query: "needle"))
        XCTAssertEqual(result.before, "一 二 三 四 ")
        XCTAssertEqual(result.match, "needle")
        XCTAssertEqual(result.after, " 后文")
        XCTAssertEqual(result.characterOffset, prefix.unicodeScalars.count)
    }
}
