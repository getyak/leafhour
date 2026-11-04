import XCTest
import PDFKit
import CoreText
@testable import LeafhourCore

final class BookLanguageSettingsTests: XCTestCase {
    private func makeLegacyPackage(_ book: LocalBook, library: OfflineLibrary) async throws -> (URL, Data, Data) {
        let folder = try await library.bookDirectory(book.id), indexURL = folder.appendingPathComponent("book.json")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: indexURL)) as? [String: Any])
        index.removeValue(forKey: "translationDefaultsVersion")
        try JSONSerialization.data(withJSONObject: index, options: [.sortedKeys]).write(to: indexURL)
        let manifestURL = folder.appendingPathComponent("manifest.json")
        var manifest = try Disk.read(OfflineManifest.self, from: manifestURL)
        let slot = try XCTUnwrap(manifest.files.firstIndex { $0.path == "book.json" })
        manifest.files[slot] = FileDigest(path: "book.json", sha256: try Disk.hashFile(indexURL), bytes: try Disk.size(indexURL))
        try Disk.write(manifest, to: manifestURL)
        return (folder, try Data(contentsOf: indexURL), try Data(contentsOf: manifestURL))
    }

    func testOldPackagesWithoutStateKeepLegacyDefaultsWithoutRewritingTheirManifest() async throws {
        for (sourceText, detected, expected) in [
            ("An English original paragraph in an unread old package.", ReadingLanguage.en, ReadingLanguage.zh),
            ("这是一个尚未打开过的旧书包，中文原文保持旧有的默认翻译目标。", .zh, .en)
        ] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let library = try OfflineLibrary(root: root, scope: .device), source = root.appendingPathComponent("old.txt")
            try Data(sourceText.utf8).write(to: source)
            let imported = try await library.importFile(source)
            let (folder, indexBytes, manifestBytes) = try await makeLegacyPackage(imported, library: library)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("device/states/" + imported.id + ".json").path))
            let oldBook = try await library.book(imported.id)
            XCTAssertNil(oldBook.translationDefaultsVersion)
            let state = try await library.state(imported.id)
            XCTAssertNil(state.anchor)
            XCTAssertNil(state.translationDefaultsVersion)
            XCTAssertEqual(state.resolvedTranslationSettings(detected: detected).targetLanguage, expected)
            XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("book.json")), indexBytes)
            XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("manifest.json")), manifestBytes)
        }
    }

    func testFreshLocalAndCloudCopiesWithoutStateUseVersionedEnglishDefault() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let owner = UUID(), library = try OfflineLibrary(root: root, scope: .account(owner))
        let source = root.appendingPathComponent("new.txt")
        try Data("An English original paragraph in a newly imported book.".utf8).write(to: source)
        let local = try await library.importFile(source)
        XCTAssertEqual(local.translationDefaultsVersion, 1)
        let localState = try await library.state(local.id)
        XCTAssertEqual(localState.translationDefaultsVersion, 1)
        XCTAssertEqual(localState.resolvedTranslationSettings(detected: .en).targetLanguage, .en)
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c","title":"Chapter","sourcePath":"c","passages":[{"id":"p","text":"An original cloud paragraph.","heading":false}]}]"#.utf8))
        let identity = CloudBookIdentity(ownerID: owner.uuidString.lowercased(), bookID: "new-cloud", contentVersion: "v1", sourceFormat: "txt")
        let content = Data(#"{"bookId":"new-cloud","contentVersion":"v1","sections":[{"chapterId":"c","paragraphs":[{"id":"p","original":"An original cloud paragraph.","translations":{}}]}]}"#.utf8)
        let cloud = try await library.importCloud(CloudReadingCopy(identity: identity, title: "New", author: "", chapters: chapters, content: content))
        XCTAssertEqual(cloud.translationDefaultsVersion, 1)
        var cloudState = try await library.state(cloud.id)
        XCTAssertEqual(cloudState.translationDefaultsVersion, 1)
        XCTAssertEqual(cloudState.resolvedTranslationSettings(detected: .en).targetLanguage, .en)
        cloudState.translationSettings = .init(sourceLanguage: .en, targetLanguage: .ja)
        try await library.saveState(cloudState, bookID: cloud.id)
        let explicit = try await library.state(cloud.id)
        XCTAssertEqual(explicit.resolvedTranslationSettings(detected: .en).targetLanguage, .ja)
        _ = try await makeLegacyPackage(cloud, library: library)
        let existingState = try await library.state(cloud.id)
        XCTAssertEqual(existingState.translationDefaultsVersion, 1, "An existing state wins over the package's legacy marker")
        XCTAssertEqual(existingState.resolvedTranslationSettings(detected: .en).targetLanguage, .ja)
    }

    func testLegacyCloudCacheRewriteDoesNotUpgradeItsMissingDefaultMarker() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), library = try OfflineLibrary(root: root, scope: .account(owner))
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c","title":"Chapter","sourcePath":"c","passages":[{"id":"p","text":"Legacy English cloud paragraph.","heading":false}]}]"#.utf8))
        let identity = CloudBookIdentity(ownerID: owner.uuidString.lowercased(), bookID: "old-cloud", contentVersion: "v1", sourceFormat: "txt")
        let content = Data(#"{"bookId":"old-cloud","contentVersion":"v1","sections":[{"chapterId":"c","paragraphs":[{"id":"p","original":"Legacy English cloud paragraph.","translations":{}}]}]}"#.utf8)
        let cloud = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Old", author: "", chapters: chapters, content: content))
        _ = try await makeLegacyPackage(cloud, library: library)
        let row = try CloudJSON.decode(Data(#"{"id":"p","original":"Legacy English cloud paragraph.","translations":{"literal":{"text":"原有中文。","status":"draft"},"interpretive":{"text":"原有中文意译。","status":"draft"}}}"#.utf8))
        try await library.cacheCloudPassage(row, bookID: cloud.id)
        let rewritten = try await library.book(cloud.id), state = try await library.state(cloud.id)
        XCTAssertNil(rewritten.translationDefaultsVersion)
        XCTAssertNil(state.translationDefaultsVersion)
        XCTAssertEqual(state.resolvedTranslationSettings(detected: .en).targetLanguage, .zh)
        let cached = try await library.readingTranslations(bookID: cloud.id)
        XCTAssertEqual(cached["p"]?.literal, "原有中文。")
    }

    func testRepairOfLegacyPDFPreservesItsMissingDefaultMarker() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("legacy.pdf"), library = try OfflineLibrary(root: root, scope: .device)
        var box = CGRect(x: 0, y: 0, width: 400, height: 600)
        let context = try XCTUnwrap(CGContext(source as CFURL, mediaBox: &box, nil))
        context.beginPDFPage(nil)
        let text = NSAttributedString(string: "An English page in a legacy PDF.", attributes: [.font: CTFontCreateWithName("Helvetica" as CFString, 18, nil)])
        context.textPosition = CGPoint(x: 30, y: 500)
        CTLineDraw(CTLineCreateWithAttributedString(text), context)
        context.endPDFPage(); context.closePDF()
        let book = try await library.importFile(source)
        _ = try await makeLegacyPackage(book, library: library)
        let repaired = try await library.repair(book.id), state = try await library.state(book.id)
        XCTAssertNil(repaired.translationDefaultsVersion)
        XCTAssertNil(state.translationDefaultsVersion)
        XCTAssertEqual(state.resolvedTranslationSettings(detected: .en).targetLanguage, .zh)
    }

    @MainActor func testUnreadLegacyStateKeepsChineseCacheButNewStateDefaultsToEnglish() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let source = root.appendingPathComponent("legacy.txt")
        try Data("An English original paragraph for a legacy unread book.".utf8).write(to: source)
        let book = try await library.importFile(source)
        let directory = try await library.bookDirectory(book.id), original = try await library.originalURL(book.id)
        let oldJSON = Data(#"{"drafts":{},"notes":[],"preferences":{}}"#.utf8)
        let oldState = try JSONDecoder().decode(ReaderState.self, from: oldJSON)
        XCTAssertNil(oldState.anchor, "Unread old books also retain their old default")
        let legacy = ReaderSession(book: book, state: oldState, original: original, directory: directory, library: library)
        XCTAssertEqual(legacy.translationSettings.targetLanguage, .zh)
        let passage = try XCTUnwrap(book.chapters.first?.passages.first)
        let cached = ReadingTranslation(original: passage.text, literal: "原有中文直译。", interpretive: "原有中文意译。")
        legacy.updateTranslations([passage.id: cached])
        XCTAssertEqual(legacy.translations[passage.id]?.literal, "原有中文直译。")
        let roundTrip = try JSONDecoder().decode(ReaderState.self, from: JSONEncoder().encode(legacy.state))
        let reopened = ReaderSession(book: book, state: roundTrip, original: original, directory: directory, library: library)
        XCTAssertEqual(reopened.translationSettings.targetLanguage, .zh, "Saving an old nil-marker state must not silently opt into the new default")

        let newState = ReaderState()
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(newState)) as? [String: Any])
        XCTAssertEqual(encoded["translationDefaultsVersion"] as? Int, 1)
        let fresh = ReaderSession(book: book, state: newState, original: original, directory: directory, library: library)
        XCTAssertEqual(fresh.translationSettings.targetLanguage, .en)
        fresh.updateTranslations([passage.id: cached])
        XCTAssertNil(fresh.translations[passage.id], "New defaults do not weaken target-language isolation")
        for base in [oldState, newState] {
            var explicit = base; explicit.translationSettings = .init(sourceLanguage: .en, targetLanguage: .ja)
            let session = ReaderSession(book: book, state: explicit, original: original, directory: directory, library: library)
            XCTAssertEqual(session.translationSettings.targetLanguage, .ja)
        }
    }

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

    func testEnglishDefaultKeepsManualSelectionIndependent() {
        XCTAssertEqual(BookTranslationSettings.suggested(for: .zh).targetLanguage, .en)
        XCTAssertEqual(BookTranslationSettings.suggested(for: .en).targetLanguage, .en)
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
