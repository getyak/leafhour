import XCTest
@testable import LeafhourCore

final class ReadingLayerTests: XCTestCase {
    func testLegacyPreferencesStillReadSourceAndKeepTheirTypography() throws {
        let p = try JSONDecoder().decode(ReaderPreferences.self, from: Data(#"{"fontSize":27,"theme":"night"}"#.utf8))
        XCTAssertEqual(p.viewMode, .source); XCTAssertEqual(p.translationVariant, .literal)
        XCTAssertEqual(p.fontSize, 27); XCTAssertEqual(p.theme, "night")
    }
    func testAllModesKeepSourceAndBothVariantsIndependent() {
        let passage = Passage(id: "p1", text: "Original 🌿")
        let translated = ReadingTranslation(original: passage.text, literal: "直译", interpretive: "意译", literalStatus: "draft", interpretiveStatus: "reviewed")
        var p = ReaderPreferences()
        XCTAssertEqual(ReadingLayers.segments(passage: passage, preferences: p, translation: translated).map(\.text), [passage.text])
        p.viewMode = .translation
        XCTAssertEqual(ReadingLayers.segments(passage: passage, preferences: p, translation: translated).map(\.text), ["直译"])
        p.translationVariant = .interpretive; p.viewMode = .parallel
        let segments = ReadingLayers.segments(passage: passage, preferences: p, translation: translated)
        XCTAssertEqual(segments.map(\.text), [passage.text, "意译"])
        XCTAssertEqual(segments.map(\.isTranslation), [false, true])
        XCTAssertEqual(segments.last?.status, "reviewed")
    }
    func testMissingOrStaleTranslationKeepsSourceWithExplicitMissingState() {
        let source = Passage(id: "p", text: "Untouched source")
        var p = ReaderPreferences(); p.viewMode = .translation
        for translation in [nil, ReadingTranslation(original: "Other edition", literal: "错误") ] as [ReadingTranslation?] {
            let segments = ReadingLayers.segments(passage: source, preferences: p, translation: translation)
            XCTAssertEqual(segments.map(\.text), [source.text]); XCTAssertFalse(segments[0].isTranslation)
            XCTAssertTrue(segments[0].translationMissing)
        }
    }
    func testTranslationQuoteMetadataSurvivesDraftAndNoteEncoding() throws {
        let anchor = ReadingAnchor(chapterID: "c", passageID: "p")
        let note = ReaderNote(anchor: anchor, quote: "译文 🌿", body: "我的想法", quoteOrigin: "translation", quoteVariant: "interpretive")
        let decoded = try JSONDecoder().decode(ReaderNote.self, from: JSONEncoder().encode(note))
        XCTAssertEqual(decoded.quoteOrigin, "translation"); XCTAssertEqual(decoded.quoteVariant, "interpretive")
    }
    func testTranslationDraftKeepsOriginVariantAndSelectionIdentity() throws {
        let anchor = ReadingAnchor(chapterID: "c", passageID: "p")
        let draft = NoteDraft(anchor: anchor, quote: "译文", body: "想法", quoteOrigin: "translation", quoteVariant: "interpretive")
        let restored = try JSONDecoder().decode(NoteDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.quoteOrigin, "translation"); XCTAssertEqual(restored.quoteVariant, "interpretive")
        let first = SelectedQuote(anchor: anchor, text: "same", origin: "translation", variant: "literal", translationOffset: 0)
        let second = SelectedQuote(anchor: anchor, text: "same", origin: "translation", variant: "literal", translationOffset: 20)
        XCTAssertNotEqual(first.id, second.id)
    }
    func testPlanFreezesOnlyCurrentAndNextAndCapsCost() throws {
        let data = Data(#"{"id":"local","title":"Book","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"a.txt","importedAt":0,"chapters":[{"id":"c1","title":"1","sourcePath":"1","passages":[{"id":"p1","text":"one","heading":false}]},{"id":"c2","title":"2","sourcePath":"2","passages":[{"id":"p2","text":"two","heading":false}]},{"id":"c3","title":"3","sourcePath":"3","passages":[{"id":"p3","text":"three","heading":false}]}],"cloud":{"ownerID":"owner","bookID":"remote","contentVersion":"v1","sourceFormat":"txt"}}"#.utf8)
        let book = try JSONDecoder().decode(LocalBook.self, from: data)
        let plan = try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:])
        XCTAssertEqual(plan.chapterIDs, ["c1","c2"]); XCTAssertEqual(plan.passageIDs, ["p1","p2"]); XCTAssertEqual(plan.maximumPoints, 2)
        XCTAssertEqual(plan.bookID, "remote"); XCTAssertEqual(plan.ownerID, "owner")
        let complete = ["p1": ReadingTranslation(original: "one", literal: "一", interpretive: "壹")]
        XCTAssertEqual(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: complete).passageIDs, ["p2"])
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: ["p1": ReadingTranslation(original: "one", literal: "一")]))
    }
    func testExplicitScopesPrioritizeCurrentPassageAndNeverIncludeAnotherChapter() throws {
        let data = Data(#"{"id":"local","title":"Book","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"a.txt","importedAt":0,"chapters":[{"id":"c1","title":"1","sourcePath":"1","passages":[{"id":"p1","text":"one","heading":false},{"id":"p2","text":"two","heading":false},{"id":"p3","text":"three","heading":false}]},{"id":"c2","title":"2","sourcePath":"2","passages":[{"id":"p4","text":"four","heading":false}]}],"cloud":{"ownerID":"owner","bookID":"remote","contentVersion":"v1","sourceFormat":"txt"}}"#.utf8)
        let book = try JSONDecoder().decode(LocalBook.self, from: data)
        let single = try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .passage, passageID: "p2")
        XCTAssertEqual(single.passageIDs, ["p2"])
        XCTAssertEqual(single.chapterIDs, ["c1"])
        XCTAssertEqual(single.maximumPoints, 1)
        let chapter = try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .chapter, passageID: "p2")
        XCTAssertEqual(chapter.passageIDs, ["p2", "p3", "p1"])
        XCTAssertEqual(chapter.chapterIDs, ["c1"])
        let ready = ["p2": ReadingTranslation(original: "two", literal: "二", interpretive: "贰")]
        XCTAssertTrue(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: ready, scope: .passage, passageID: "p2").passageIDs.isEmpty)
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book, chapterIndex: 0, translations: [:], scope: .passage, passageID: "p4"))
    }

}
