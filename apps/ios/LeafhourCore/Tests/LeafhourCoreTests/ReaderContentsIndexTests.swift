import XCTest
@testable import LeafhourCore

final class ReaderContentsIndexTests: XCTestCase {
    private let chapters = [
        BookChapter(id: "opening", title: "前言", sourcePath: "opening", passages: []),
        BookChapter(id: "later", title: "第四章：安静阅读", sourcePath: "later", passages: []),
        BookChapter(id: "earlier", title: "第二章：阅读与思考", sourcePath: "earlier", passages: [])
    ]

    func testFilteringKeepsOriginalOrderAndOriginalNavigationIndices() {
        let all = ReaderContentsIndex.entries(chapters: chapters, kind: .epub, query: "  ")
        XCTAssertEqual(all.map(\.id), ["opening", "later", "earlier"])
        let matches = ReaderContentsIndex.entries(chapters: chapters, kind: .epub, query: " 阅读 ")
        XCTAssertEqual(matches.map(\.id), ["later", "earlier"])
        XCTAssertEqual(matches.map(\.chapterIndex), [1, 2], "Filtering must not turn result indices into book destinations")
        XCTAssertTrue(ReaderContentsIndex.entries(chapters: chapters, kind: .epub, query: "不存在的小节").isEmpty)
    }

    func testPDFNumericQueryResolvesTheExactRealPageWithoutInventingDestinations() {
        let pages = (1...12).map { BookChapter(id: "page-\($0)", title: "第 \($0) 页", sourcePath: "page-\($0)", passages: []) }
        XCTAssertEqual(ReaderContentsIndex.entries(chapters: pages, kind: .pdf, query: "1").map(\.id), ["page-1"])
        XCTAssertEqual(ReaderContentsIndex.entries(chapters: pages, kind: .pdf, query: " 12 ").map(\.chapterIndex), [11])
        XCTAssertTrue(ReaderContentsIndex.entries(chapters: pages, kind: .pdf, query: "13").isEmpty)
        XCTAssertTrue(ReaderContentsIndex.entries(chapters: pages, kind: .pdf, query: "0").isEmpty)
        XCTAssertEqual(ReaderContentsIndex.entries(chapters: pages, kind: .pdf, query: "第 2 页").map(\.chapterIndex), [1])
    }
}
