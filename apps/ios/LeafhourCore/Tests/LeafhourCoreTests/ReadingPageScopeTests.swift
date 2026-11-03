import XCTest
@testable import LeafhourCore

final class ReadingPageScopeTests: XCTestCase {
    private func book() throws -> LocalBook {
        try JSONDecoder().decode(LocalBook.self, from: Data(#"{"id":"local","title":"Synthetic","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"a.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"heading","text":"Heading","heading":true},{"id":"p1","text":"Full first paragraph.","heading":false},{"id":"image","text":"Image alternative","heading":false,"resourcePath":"image.png"},{"id":"p2","text":"Full second paragraph.","heading":false},{"id":"empty","text":"  ","heading":false},{"id":"p3","text":"Full third paragraph.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p4","text":"Another chapter.","heading":false}]}],"cloud":{"ownerID":"owner","bookID":"remote","contentVersion":"v1","sourceFormat":"txt"}}"#.utf8))
    }

    func testPageUsesOnlyExactVisibleIDsInSourceOrderWithoutAnchorRotation() throws {
        let plan = try ReadingTranslationPlan.make(book: book(), chapterIndex: 0, translations: [:], scope: .page, passageID: "p3", visiblePassageIDs: ["p3", "p1"])
        XCTAssertEqual(plan.chapterIDs, ["c1"])
        XCTAssertEqual(plan.passageIDs, ["p1", "p3"])
        XCTAssertEqual(plan.visiblePassageIDs, ["p1", "p3"])
        XCTAssertEqual(plan.maximumPoints, 2)
        let restored = try JSONDecoder().decode(ReadingTranslationPlan.self, from: JSONEncoder().encode(plan))
        XCTAssertEqual(restored, plan)
    }

    func testUnknownDuplicateNonTextAndOtherChapterIDsCannotBroadenPage() throws {
        let book = try book()
        for ids: [String]? in [nil, [], ["p1", "p1"], ["missing"], ["p4"], ["p1", "p4"], ["heading"], ["image"], ["empty"]] {
            XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .page, visiblePassageIDs: ids), "Invalid page IDs: \(String(describing: ids))")
        }
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 1, translations: [:], scope: .page, visiblePassageIDs: ["p1"]))
    }

    func testPageKeepsCompleteTwinsAndRejectsPartialOrDifferentOriginal() throws {
        let book = try book()
        let complete = ReadingTranslation(original: "Full first paragraph.", literal: "Literal one", interpretive: "Interpretive one")
        let plan = try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: ["p1": complete], scope: .page, visiblePassageIDs: ["p1", "p2"])
        XCTAssertEqual(plan.passageIDs, ["p2"])
        XCTAssertEqual(plan.visiblePassageIDs, ["p1", "p2"], "The confirmed viewport also retains already complete source IDs")
        for existing in [ReadingTranslation(original: "Full first paragraph.", literal: "Only literal"), ReadingTranslation(original: "Old source version.", literal: "Old literal", interpretive: "Old interpretation")] {
            XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: ["p1": existing], scope: .page, visiblePassageIDs: ["p1"]))
        }
    }

    func testMarkdownImagePlaceholderIsNotAnAuthorParagraphButMixedTextRemainsEligible() throws {
        var book = try book(); book.kind = .markdown
        book.chapters[0].passages = [Passage(id: "image-only", text: "![Synthetic image alternative](asset.png)"), Passage(id: "mixed", text: "Author text beside ![an image](asset.png).")]
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .page, visiblePassageIDs: ["image-only"]))
        let plan = try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .page, visiblePassageIDs: ["mixed"])
        XCTAssertEqual(plan.passageIDs, ["mixed"])
    }
}
