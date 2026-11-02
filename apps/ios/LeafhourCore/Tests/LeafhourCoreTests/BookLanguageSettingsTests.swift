import XCTest
@testable import LeafhourCore

final class BookLanguageSettingsTests: XCTestCase {
    func testLegacyStateKeepsPerBookLanguageUnsetAndIndentationOff() throws {
        let data = try JSONEncoder().encode(ReaderState())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "translationSettings")
        let state = try JSONDecoder().decode(ReaderState.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(state.translationSettings)
        XCTAssertEqual(state.preferences.firstLineIndent, .none)
        var preferences = state.preferences; preferences.firstLineIndent = .twoCharacters
        XCTAssertEqual(try JSONDecoder().decode(ReaderPreferences.self, from: JSONEncoder().encode(preferences)).firstLineIndent, .twoCharacters)
    }

    func testLanguageSuggestionsFollowOriginalAndManualSelectionIsIndependent() {
        XCTAssertEqual(BookTranslationSettings.suggested(for: .zh).targetLanguage, .en)
        XCTAssertEqual(BookTranslationSettings.suggested(for: .en).targetLanguage, .zh)
        var value = BookTranslationSettings.suggested(for: .zh)
        value.sourceLanguage = .ja; value.targetLanguage = .fr
        XCTAssertEqual(value.resolvedSource(detected: .zh), .ja)
        XCTAssertTrue(value.isValid(detected: .zh))
        value.targetLanguage = .ja
        XCTAssertFalse(value.isValid(detected: .zh))
    }

    func testSourceIndentationCanBeRemovedWithoutLosingScalarAnchorMapping() {
        let source = "  \t　天地 🌿。"
        let prefix = ReaderParagraphPresentation.leadingIndentUTF16(source, kind: .txt, heading: false)
        XCTAssertEqual(prefix, 4)
        let displayed = (source as NSString).substring(from: prefix)
        XCTAssertEqual(displayed, "天地 🌿。")
        let offsets = SourceTextOffsets(source)
        XCTAssertEqual(offsets.scalarOffset(forUTF16Offset: prefix + 3), 7)
        XCTAssertEqual(ReaderParagraphPresentation.leadingIndentUTF16(source, kind: .markdown, heading: false), 0)
        XCTAssertEqual(ReaderParagraphPresentation.leadingIndentUTF16(source, kind: .txt, heading: true), 0)
    }

    func testTargetLanguagePreventsOtherLanguageTranslationFromBeingUsed() throws {
        let row = try CloudJSON.decode(Data(#"{"original":"原文","translations":{"literal":{"text":"English","targetLanguage":"en"},"interpretive":{"text":"Natural English","targetLanguage":"en"}}}"#.utf8))
        XCTAssertNil(ReadingTranslation(row, targetLanguage: .ja)?.text(.literal))
        XCTAssertEqual(ReadingTranslation(row, targetLanguage: .en)?.text(.literal), "English")
        let legacy = try CloudJSON.decode(Data(#"{"original":"Source","translations":{"literal":{"text":"中文"},"interpretive":{"text":"中文意译"}}}"#.utf8))
        XCTAssertEqual(ReadingTranslation(legacy, targetLanguage: .zh)?.text(.literal), "中文")
        XCTAssertNil(ReadingTranslation(legacy, targetLanguage: .en)?.text(.literal))
    }

    @MainActor func testBookLanguagesStayLocalToOneBookAndRejectLateTranslations() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .device)
        let source = root.appendingPathComponent("one.txt"); try Data("A quiet original paragraph.".utf8).write(to: source)
        let first = try await library.importFile(source)
        let secondSource = root.appendingPathComponent("two.txt"); try Data("Another original paragraph.".utf8).write(to: secondSource)
        let second = try await library.importFile(secondSource)
        let session = ReaderSession(book: first, state: try await library.state(first.id), original: source, directory: root, library: library)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .ja))
        let passage = first.chapters[0].passages[0]
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: "迟到的中文", targetLanguage: .zh)])
        XCTAssertTrue(session.translations.isEmpty)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: "日本語", targetLanguage: .ja)])
        XCTAssertEqual(session.translations[passage.id]?.literal, "日本語")
        let saved = await session.flush(); XCTAssertTrue(saved.succeeded)
        let own = try await library.state(first.id), other = try await library.state(second.id)
        XCTAssertEqual(own.translationSettings?.targetLanguage, .ja)
        XCTAssertNil(other.translationSettings)
    }

    func testTranslationCacheAndUncertainRequestAreSeparatedByTargetLanguage() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), library = try OfflineLibrary(root: root, scope: .account(owner))
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c","title":"Chapter","sourcePath":"c","passages":[{"id":"p","text":"原文","heading":false}]}]"#.utf8))
        let identity = CloudBookIdentity(ownerID: owner.uuidString.lowercased(), bookID: "synthetic", contentVersion: "v1", sourceFormat: "txt")
        let content = Data(#"{"bookId":"synthetic","contentVersion":"v1","sections":[{"chapterId":"c","paragraphs":[{"id":"p","original":"原文","translations":{},"translationsByLanguage":{"en":{"literal":{"text":"Reviewed English","status":"reviewed","targetLanguage":"en"},"interpretive":{"text":"Reviewed English natural","status":"reviewed","targetLanguage":"en"}}}}]}]}"#.utf8)
        let book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic", author: "", chapters: chapters, content: content))
        func row(_ language: String, _ text: String) throws -> CloudJSON {
            try CloudJSON.decode(JSONSerialization.data(withJSONObject: ["id": "p", "original": "原文", "translations": ["literal": ["text": text, "targetLanguage": language, "status": "draft"], "interpretive": ["text": text + " natural", "targetLanguage": language, "status": "draft"]]]))
        }
        try await library.cacheCloudPassages([row("en", "English")], bookID: book.id, targetLanguage: .en)
        try await library.cacheCloudPassages([row("ja", "日本語")], bookID: book.id, targetLanguage: .ja)
        let english = try await library.readingTranslations(bookID: book.id, targetLanguage: .en)
        let japanese = try await library.readingTranslations(bookID: book.id, targetLanguage: .ja)
        XCTAssertEqual(english["p"]?.literal, "Reviewed English"); XCTAssertEqual(japanese["p"]?.literal, "日本語")
        try await library.savePendingReadingTranslation(Data("uncertain-en".utf8), bookID: book.id, targetLanguage: .en)
        try await library.savePendingReadingTranslation(Data("uncertain-ja".utf8), bookID: book.id, targetLanguage: .ja)
        let pendingEnglish = try await library.pendingReadingTranslation(bookID: book.id, targetLanguage: .en)
        XCTAssertEqual(pendingEnglish, Data("uncertain-en".utf8))
        try await library.savePendingReadingTranslation(nil, bookID: book.id, targetLanguage: .ja)
        let stillEnglish = try await library.pendingReadingTranslation(bookID: book.id, targetLanguage: .en)
        XCTAssertEqual(stillEnglish, pendingEnglish)
    }
}
