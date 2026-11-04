import XCTest
@testable import LeafhourCore

final class ContentsSourceTests: XCTestCase {
    private func book(_ text: String = "A 😀 source, with café and an exact thought.") throws -> LocalBook {
        let chapters = try JSONDecoder().decode([BookChapter].self, from: JSONSerialization.data(withJSONObject: [["id":"c1","title":"First","sourcePath":"one","passages":[["id":"p1","text":text,"heading":false]]],["id":"c2","title":"Second","sourcePath":"two","passages":[["id":"p2","text":"Another verified sentence.","heading":false]]]]))
        return try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: ["id":"synthetic-book","title":"Synthetic","author":"","kind":"txt","originalFilename":"Synthetic.txt","sourceVersion":"version-one","importedAt":0,"chapters":try JSONSerialization.jsonObject(with: JSONEncoder().encode(chapters))]))
    }
    private func ref(book: String = "synthetic-book", version: String = "version-one", chapter: String = "c1", passage: String = "p1", quote: String = "café", layer: String = "original", source: String = "local-device") -> CloudJSON {
        .object(["bookId":.string(book),"sourceVersion":.string(version),"contentVersion":.string(version),"chapterId":.string(chapter),"passageId":.string(passage),"quote":.string(quote),"layer":.string(layer),"source":.string(source)])
    }
    func testVerifiedReferencesKeepActualChapterOrderAndScalarOffsets() throws {
        let value = try book(), refs = [ref(chapter:"c2",passage:"p2",quote:"verified"), ref(), ref()]
        let matches = ContentsSourceIndex.validated(refs, in:value)
        XCTAssertEqual(matches.map(\.chapterIndex),[0,1]); XCTAssertEqual(matches.count,2)
        XCTAssertEqual(matches[0].anchor.characterOffset,17)
        XCTAssertEqual(matches[0].quote,"café")
    }
    func testForeignSourceVersionChapterLayerAndInventedQuotesNeverBecomeDestinations() throws {
        let value = try book()
        for bad in [ref(book:"other"),ref(version:"old"),ref(chapter:"c2"),ref(passage:"invented"),ref(quote:"not in the source"),ref(layer:"literal"),ref(source:"web")] {
            XCTAssertTrue(ContentsSourceIndex.validated([bad],in:value).isEmpty)
        }
    }
    func testRepeatedAndNormalizedEquivalentQuotesCannotGuessTheirLocation() throws {
        XCTAssertTrue(ContentsSourceIndex.validated([ref(quote:"same")],in:try book("same, then same")).isEmpty)
        XCTAssertTrue(ContentsSourceIndex.validated([ref(quote:"aaa")],in:try book("aaaa")).isEmpty)
        XCTAssertTrue(ContentsSourceIndex.validated([ref(quote:"café")],in:try book("cafe\u{301}")).isEmpty)
    }
    func testExactRangeCanDisambiguateRepeatedSourceWithoutTrustingAnInventedOffset() throws {
        let value = try book("same, then same")
        var fields = ref(quote:"same").object; fields["charOffset"] = .number(11); fields["charEnd"] = .number(15)
        XCTAssertEqual(ContentsSourceIndex.validated([.object(fields)],in:value).first?.anchor.characterOffset,11)
        fields["charOffset"] = .number(1); fields["charEnd"] = .number(5)
        XCTAssertTrue(ContentsSourceIndex.validated([.object(fields)],in:value).isEmpty)
    }
    func testChapterBodySearchCanMatchWhenTheTitleDoesNot() async throws {
        let value = try book(), matches = try await BookSearch.matches(in:value.chapters,query:"exact thought")
        XCTAssertEqual(matches.map(\.chapterIndex),[0]); XCTAssertEqual(matches.first?.anchor.passageID,"p1")
    }
}
