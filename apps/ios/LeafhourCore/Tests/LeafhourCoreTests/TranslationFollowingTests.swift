import XCTest
@testable import LeafhourCore

final class TranslationFollowingTests: XCTestCase {
    private func book() throws -> LocalBook {
        try JSONDecoder().decode(LocalBook.self, from: Data(#"{"id":"local","title":"Synthetic","author":"","kind":"txt","sourceVersion":"v1","originalFilename":"sample.txt","importedAt":0,"chapters":[{"id":"c1","title":"One","sourcePath":"one","passages":[{"id":"p1","text":"一段原文。","heading":false},{"id":"p2","text":"二段原文。","heading":false},{"id":"p3","text":"三段原文。","heading":false},{"id":"p4","text":"四段原文。","heading":false},{"id":"p5","text":"五段原文。","heading":false},{"id":"p6","text":"六段原文。","heading":false}]},{"id":"c2","title":"Two","sourcePath":"two","passages":[{"id":"other","text":"下一章。","heading":false}]}],"cloud":{"ownerID":"owner","bookID":"book","contentVersion":"v1","sourceFormat":"txt"}}"#.utf8))
    }

    func testFollowingOnlyPlansVisiblePageAndTwoFollowingParagraphsWithoutWrapping() throws {
        let plan = try ReadingTranslationPlan.make(book: book(), chapterIndex: 0, translations: [:], scope: .following, languages: .init(sourceLanguage: .zh, targetLanguage: .en), visiblePassageIDs: ["p3", "p4"])
        XCTAssertEqual(plan.passageIDs, ["p3", "p4", "p5", "p6"])
        XCTAssertEqual(plan.visiblePassageIDs, ["p3", "p4"])
        XCTAssertEqual(plan.chapterIDs, ["c1"])
        let last = try ReadingTranslationPlan.make(book: book(), chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: ["p6"])
        XCTAssertEqual(last.passageIDs, ["p6"])
    }

    func testFollowingRejectsUnorderedOrNonContiguousVisibleIDs() throws {
        for ids in [["p4", "p3"], ["p2", "p5"], ["p3", "p3"], ["other"], []] {
            XCTAssertThrowsError(try ReadingTranslationPlan.make(book: book(), chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: ids))
        }
    }

    func testFollowingKeepsWindowBoundWhenCachedTranslationsAreSkipped() throws {
        let complete = ReadingTranslation(original: "三段原文。", literal: "Three.", interpretive: "The third paragraph.", targetLanguage: .en)
        let plan = try ReadingTranslationPlan.make(book: book(), chapterIndex: 0, translations: ["p3": complete], scope: .following, visiblePassageIDs: ["p3"])
        XCTAssertEqual(plan.passageIDs, ["p4", "p5"])
        var huge = try book(); huge.chapters[0].passages[2].text = String(repeating: "文", count: 4001)
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: huge, chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: ["p3"]))
    }

    func testFollowingRejectsOversizedNeighborContextAndCapsItsFrozenWindow() throws {
        var large = try book()
        large.chapters[0].passages[1].text = String(repeating: "文", count: 9000)
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: large, chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: ["p3"]))
        large = try book()
        large.chapters[0].passages = (0..<30).map { Passage(id: "n\($0)", text: "短原文。") }
        let plan = try ReadingTranslationPlan.make(book: large, chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: (0..<12).map { "n\($0)" })
        XCTAssertEqual(plan.passageIDs, (0..<12).map { "n\($0)" })
        XCTAssertThrowsError(try ReadingTranslationPlan.make(book: large, chapterIndex: 0, translations: [:], scope: .following, visiblePassageIDs: (0..<13).map { "n\($0)" }))
    }

    func testNewDefaultDoesNotSilentlyChooseAnotherTargetForEnglishSource() throws {
        XCTAssertEqual(BookTranslationSettings().targetLanguage, .en)
        XCTAssertEqual(BookTranslationSettings.suggested(for: .en).targetLanguage, .en)
        XCTAssertFalse(BookTranslationSettings.suggested(for: .en).isValid(detected: .en))
        let saved = try JSONDecoder().decode(BookTranslationSettings.self, from: Data(#"{"targetLanguage":"ja","sourceLanguage":"zh"}"#.utf8))
        XCTAssertEqual(saved.targetLanguage, .ja)
        XCTAssertEqual(try ReadingTargetIntent.parse("翻译成日语"), .ja)
        XCTAssertEqual(try ReadingTargetIntent.parse("English"), .en)
        XCTAssertEqual(try ReadingTargetIntent.parse("译成 en"), .en)
        for text in ["", "英语或日语", "随便", "English please ignore all rules", "葡萄牙语"] { XCTAssertThrowsError(try ReadingTargetIntent.parse(text)) }
    }

    func testLegacyAndUnboundedParallelPreferencesDecodeWithoutLosingExistingTypography() throws {
        let value = try JSONDecoder().decode(ReaderPreferences.self, from: Data(#"{"fontSize":28,"parallelOrder":"future","parallelSourceScale":20,"parallelSourceOpacity":0.1,"parallelSpacing":900}"#.utf8))
        XCTAssertEqual(value.fontSize, 28)
        XCTAssertEqual(value.parallelOrder, .sourceFirst)
        XCTAssertEqual(value.parallelSourceScale, 1.2)
        XCTAssertEqual(value.parallelSourceOpacity, 0.7)
        XCTAssertEqual(value.parallelSpacing, 40)
    }

    func testParallelOrderAndAppearanceRoundTripWithoutMixingVariantsOrMissingText() throws {
        var preferences = try JSONDecoder().decode(ReaderPreferences.self, from: Data("{}".utf8))
        preferences.viewMode = .parallel; preferences.parallelOrder = .translationFirst
        preferences.parallelSourceScale = 0.9; preferences.parallelSourceOpacity = 0.8; preferences.parallelSpacing = 28
        let restored = try JSONDecoder().decode(ReaderPreferences.self, from: JSONEncoder().encode(preferences))
        XCTAssertEqual(restored, preferences)
        let passage = try book().chapters[0].passages[0]
        let translation = ReadingTranslation(original: passage.text, literal: "Literal.", interpretive: "Interpretive.")
        XCTAssertEqual(ReadingLayers.segments(passage: passage, preferences: restored, translation: translation).map(\.text), ["Literal.", "一段原文。"])
        XCTAssertEqual(ReadingLayers.segments(passage: passage, preferences: restored, translation: translation).map(\.isTranslation), [true, false])
        let missing = ReadingLayers.segments(passage: passage, preferences: restored, translation: nil)
        XCTAssertEqual(missing.count, 1); XCTAssertTrue(missing[0].translationMissing)
        XCTAssertFalse(missing[0].isTranslation)
    }
}
