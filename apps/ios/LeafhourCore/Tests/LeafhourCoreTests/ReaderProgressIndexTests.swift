import XCTest
@testable import LeafhourCore

final class ReaderProgressIndexTests: XCTestCase {
    private func book(_ kind: BookKind = .txt) -> LocalBook {
        LocalBook(id: "progress", title: "Synthetic", author: "", kind: kind, sourceVersion: "v1", originalFilename: "synthetic.txt", importedAt: Date(), chapters: [
            BookChapter(id: "short", title: "Short", sourcePath: "", passages: [Passage(id: "a", text: "a😀")]),
            BookChapter(id: "long", title: "Long", sourcePath: "", passages: [Passage(id: "b", text: "12345678")])
        ])
    }
    func testProgressWeightsUnequalChaptersAndUsesScalarOffsets() {
        let index = ReaderProgressIndex(book: book())
        XCTAssertEqual(index.fraction(chapterIndex: 1, anchor: ReadingAnchor(chapterID: "long", passageID: "b", characterOffset: 3)), 0.5)
        XCTAssertEqual(index.fraction(chapterIndex: 0, anchor: ReadingAnchor(chapterID: "short", passageID: "a", characterOffset: 1)), 0.1)
        XCTAssertEqual(index.fraction(chapterIndex: 1, anchor: ReadingAnchor(chapterID: "short", passageID: "a", characterOffset: 1)), 0.2)
        XCTAssertNil(index.fraction(chapterIndex: 9, anchor: nil))
    }
    func testPDFUsesRealPageOrderAndClampsOffsets() {
        XCTAssertEqual(ReaderProgressIndex(book: book(.pdf)).fraction(chapterIndex: 0, anchor: nil), 0.5)
        XCTAssertEqual(ReaderProgressIndex(book: book(.pdf)).fraction(chapterIndex: 1, anchor: nil), 1)
        XCTAssertEqual(ReaderProgressIndex(book: book()).fraction(chapterIndex: 1, anchor: ReadingAnchor(chapterID: "long", passageID: "b", characterOffset: 999)), 1)
    }
}
