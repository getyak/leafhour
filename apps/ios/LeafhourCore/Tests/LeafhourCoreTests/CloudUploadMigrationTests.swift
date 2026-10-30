import XCTest
@testable import LeafhourCore

final class CloudUploadMigrationTests: XCTestCase {
    func book(_ rows: [(String, String)], chapter: String) -> LocalBook {
        LocalBook(id: String(repeating: "a", count: 64), title: "Fixture", author: "", kind: .txt,
            sourceVersion: "fixture", originalFilename: "fixture.txt", importedAt: .distantPast,
            chapters: [BookChapter(id: chapter, title: chapter, sourcePath: chapter,
                passages: rows.map { Passage(id: $0.0, text: $0.1) })])
    }
    func testMapsExactUnicodeSourceAndPreservesNotesDraftAndProgress() {
        let text = "引言 🐿️ café 与原文。"
        let source = book([("local", text)], chapter: "local-chapter")
        let target = book([("remote", "Before " + text + " After")], chapter: "cloud-chapter")
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 3)
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "🐿️ café", body: "A thought")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "🐿️ café", body: "Unfinished")
        let original = state
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(state, original)
        XCTAssertEqual(result.unresolvedCount, 0)
        XCTAssertEqual(result.state.anchor, ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 10))
        XCTAssertEqual(result.state.notes.first?.id, state.notes.first?.id)
        XCTAssertEqual(result.state.notes.first?.anchor, result.state.anchor)
        XCTAssertEqual(result.state.drafts.values.first?.body, "Unfinished")
    }
    func testAmbiguousQuoteIsKeptInOriginalAndNeverGuessed() {
        let source = book([("local", "Shared words")], chapter: "local-chapter")
        let target = book([("remote-1", "Shared words"), ("remote-2", "Shared words")], chapter: "cloud-chapter")
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: ReadingAnchor(chapterID: "local-chapter", passageID: "local"), quote: "Shared words", body: "Personal")]
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 1)
        XCTAssertTrue(result.state.notes.isEmpty)
        XCTAssertEqual(state.notes.first?.body, "Personal")
    }
    func testTranslatedDraftRetainsItsLayerWhenAnExactSourceMovesToCloud() {
        let source = book([("local", "Unique original source")],chapter:"local-chapter")
        let target = book([("remote", "Unique original source")],chapter:"cloud-chapter")
        let anchor = ReadingAnchor(chapterID:"local-chapter",passageID:"local")
        var state = ReaderState()
        state.drafts[anchor.key] = NoteDraft(anchor:anchor,quote:"选中译文",body:"未完成",quoteOrigin:"translation",quoteLanguage:"zh")
        let result = CloudUploadMigration.remap(source:source,state:state,destination:target,destinationState:ReaderState())
        XCTAssertEqual(result.state.drafts.values.first?.quoteOrigin,"translation")
        XCTAssertEqual(result.state.drafts.values.first?.quoteLanguage,"zh")
    }
    func testRepeatedMigrationDeduplicatesAndDoesNotReplaceExistingPosition() {
        let source = book([("local", "Unique source paragraph")], chapter: "local-chapter")
        let target = book([("remote", "Unique source paragraph")], chapter: "cloud-chapter")
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 7)
        state.anchor = anchor; state.notes = [ReaderNote(anchor: anchor, quote: "source", body: "Keep")]
        var destination = ReaderState()
        destination.anchor = ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote", characterOffset: 2)
        let once = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: destination)
        let twice = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: once.state)
        XCTAssertEqual(once.state.notes.count, 1)
        XCTAssertEqual(twice.state, once.state)
        XCTAssertEqual(twice.state.anchor, destination.anchor)
        XCTAssertEqual(twice.unresolvedCount, 1, "A different existing position requires a choice")
    }
    func testUniqueSelectedQuoteCanBridgeDifferentParagraphSplitting() {
        let source = book([("local", "First sentence. Distinct selected quote. Last sentence.")], chapter: "local-chapter")
        let target = book([("remote-1", "First sentence."), ("remote-2", "Distinct selected quote."), ("remote-3", "Last sentence.")], chapter: "cloud-chapter")
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: ReadingAnchor(chapterID: "local-chapter", passageID: "local", characterOffset: 16), quote: "Distinct selected quote.", body: "Keep this idea")]
        let result = CloudUploadMigration.remap(source: source, state: state, destination: target, destinationState: ReaderState())
        XCTAssertEqual(result.unresolvedCount, 0)
        XCTAssertEqual(result.state.notes.first?.anchor, ReadingAnchor(chapterID: "cloud-chapter", passageID: "remote-2"))
    }
}
