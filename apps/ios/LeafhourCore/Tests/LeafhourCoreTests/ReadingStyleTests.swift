import XCTest
@testable import LeafhourCore

final class ReadingStyleTests: XCTestCase {
    func testEveryPaperThemeSurvivesProfilePersistence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .device)
        for theme in ["paper", "white", "sage", "night", "system"] {
            var preferences = ReaderPreferences(); preferences.theme = theme
            try await library.saveReaderPreferences(preferences)
            let restored = try await library.readingPreferences()
            XCTAssertEqual(restored, preferences)
        }
    }
    func testStyleChangesOnlyTypographyAndRemainsRecognizable() {
        var preferences = ReaderPreferences()
        preferences.theme = "night"; preferences.viewMode = .parallel
        preferences.translationVariant = .interpretive; preferences.navigationMode = .scroll
        preferences.speechSpeed = 2.5; preferences.autoPageInterval = 55
        for style in ReaderStylePreset.allCases {
            let changed = style.applying(to: preferences)
            XCTAssertEqual(changed.theme, "night"); XCTAssertEqual(changed.viewMode, .parallel)
            XCTAssertEqual(changed.translationVariant, .interpretive); XCTAssertEqual(changed.navigationMode, .scroll)
            XCTAssertEqual(changed.speechSpeed, 2.5); XCTAssertEqual(changed.autoPageInterval, 55)
            XCTAssertEqual(ReaderStylePreset.matching(changed), style)
        }
    }
    func testConversationDraftsAreIsolatedByOwnerAndBook() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), other = UUID()
        let first = try OfflineLibrary(root: root, scope: .account(owner))
        let second = try OfflineLibrary(root: root, scope: .account(other))
        let bytes = Data("draft".utf8)
        try await first.saveConversationDraft(bytes, bookID: "a/book", ownerID: owner.uuidString)
        let restored = try await first.conversationDraft(bookID: "a/book", ownerID: owner.uuidString)
        XCTAssertEqual(restored, bytes)
        let anotherBook = try await first.conversationDraft(bookID: "b", ownerID: owner.uuidString)
        let anotherOwner = try await second.conversationDraft(bookID: "a/book", ownerID: other.uuidString)
        XCTAssertNil(anotherBook); XCTAssertNil(anotherOwner)
        do { _ = try await first.conversationDraft(bookID: "a/book", ownerID: other.uuidString); XCTFail("Wrong owner must be rejected") }
        catch { }
    }

}
