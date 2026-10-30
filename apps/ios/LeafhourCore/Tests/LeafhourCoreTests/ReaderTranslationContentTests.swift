import XCTest
@testable import LeafhourCore

final class ReaderTranslationContentTests: XCTestCase {
    func testLegacyPreferencesEnableContinuousTranslationWithoutLosingTypography() throws {
        let value = try JSONDecoder().decode(ReaderPreferences.self, from: Data(#"{"fontSize":28,"navigationMode":"paged"}"#.utf8))
        XCTAssertEqual(value.fontSize, 28)
        XCTAssertEqual(value.navigationMode, .paged)
        XCTAssertEqual(value.textMode, .translation)
        XCTAssertEqual(value.translationVariant, .interpretive)
        XCTAssertTrue(value.automaticTranslation)
        var changed = value
        changed.textMode = .parallel; changed.translationVariant = .literal; changed.automaticTranslation = false
        XCTAssertEqual(try JSONDecoder().decode(ReaderPreferences.self, from: JSONEncoder().encode(changed)), changed)
    }

    func testTranslationOffsetHasItsOwnIdentityAndDoesNotBecomeASourceCharacterOffset() throws {
        let source = ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 3)
        var translated = source
        translated.translationOffset = 12; translated.translationVariant = .interpretive; translated.translationVersion = "version"
        XCTAssertEqual(translated.characterOffset, 3)
        XCTAssertNotEqual(translated.key, source.key)
        XCTAssertEqual(try JSONDecoder().decode(ReadingAnchor.self, from: JSONEncoder().encode(translated)), translated)
    }

    @MainActor func testReceiptsRejectStaleOrMismatchedSourceAndPreserveReadingAnchor() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("source.txt")
        try Data("A source 😀 passage.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        book.cloud = CloudBookIdentity(ownerID: "owner", bookID: "book", contentVersion: "v1", sourceFormat: "txt")
        let state = try await library.state(book.id)
        let session = ReaderSession(book: book, state: state, original: file, directory: root, library: library)
        let passage = try XCTUnwrap(book.chapters.first?.passages.first)
        let anchor = ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id, characterOffset: 4)
        session.recordVisible(anchor, navigationID: session.navigationID)
        func receipt(original: String, status: String = "draft", text: String = "译文") -> CloudJSON {
            .object(["id": .string(passage.id), "original": .string(original), "translations": .object([
                "literal": .object(["text": .string(text), "status": .string(status), "sourceVersion": .string("v1")]),
                "interpretive": .object(["text": .string("另一种译法"), "status": .string("draft"), "sourceVersion": .string("v1")])])])
        }
        XCTAssertFalse(session.adoptTranslation(receipt(original: passage.text), contentVersion: "old"))
        XCTAssertFalse(session.adoptTranslation(receipt(original: "different"), contentVersion: "v1"))
        XCTAssertTrue(session.translations.isEmpty)
        XCTAssertTrue(session.adoptTranslation(receipt(original: passage.text, status: "reviewed"), contentVersion: "v1"))
        XCTAssertEqual(session.translations[passage.id]?[.literal]?.text, "译文")
        XCTAssertEqual(session.translations[passage.id]?[.interpretive]?.text, "另一种译法")
        XCTAssertEqual(session.currentAnchor, anchor)
        XCTAssertFalse(session.adoptTranslation(receipt(original: passage.text, text: "较旧草稿"), contentVersion: "v1"))
        XCTAssertEqual(session.translations[passage.id]?[.literal]?.text, "译文")
    }

    @MainActor func testTranslatedNoteKeepsItsLayerAndOriginalQuoteSeparately() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("source.txt"); try Data("Original source.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file), state = try await library.state(book.id)
        let session = ReaderSession(book: book, state: state, original: file, directory: root, library: library)
        let quote = SelectedQuote(anchor: ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[0].id), text: "选中的译文", sourceText: "Original source.", origin: "translation", language: "zh")
        let saved = await session.saveNote(quote, text: "自己的想法")
        XCTAssertTrue(saved)
        XCTAssertEqual(session.state.notes.first?.quoteOrigin, "translation")
        XCTAssertEqual(session.state.notes.first?.quoteLanguage, "zh")
        XCTAssertEqual(session.state.notes.first?.quote, "选中的译文")
    }
}
