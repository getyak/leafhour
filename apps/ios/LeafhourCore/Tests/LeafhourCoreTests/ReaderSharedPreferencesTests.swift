import XCTest
@testable import LeafhourCore

final class ReaderSharedPreferencesTests: XCTestCase {
    func testExpandedPaperAndLanguageFontsPersistWithoutLosingBookState() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var preferences = ReaderPreferences()
        preferences.fontStyle = .kai; preferences.latinFont = .baskerville
        for theme in ReaderPaper.allCases {
            preferences.theme = theme.rawValue
            try await fixture.library.saveReaderPreferences(preferences)
            let restored = try await fixture.library.readingPreferences()
            XCTAssertEqual(restored, preferences)
        }
        let legacy = try JSONDecoder().decode(ReaderPreferences.self, from: Data("{\"fontStyle\":\"sans\",\"theme\":\"sage\"}".utf8))
        XCTAssertEqual(legacy.latinFont, .automatic)
        XCTAssertEqual(legacy.fontStyle, .sans)
        XCTAssertEqual(legacy.theme, "sage")
        let future = try JSONDecoder().decode(ReaderPreferences.self, from: Data("{\"latinFont\":\"future-font\"}".utf8))
        XCTAssertEqual(future.latinFont, .automatic)
    }

    @MainActor
    func testChangingOneBookAppliesEveryPreferenceToAnotherWithoutMovingItsRecords() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var second = ReaderState()
        let passage = try XCTUnwrap(fixture.second.chapters.first?.passages.first)
        let chapter = try XCTUnwrap(fixture.second.chapters.first)
        let anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id, characterOffset: 3)
        second.anchor = anchor
        second.notes = [ReaderNote(anchor: anchor, quote: "Second", body: "Only this book")]
        second.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "Second", body: "Unfinished")
        try await fixture.library.saveState(second, bookID: fixture.second.id)
        let state = try await fixture.library.state(fixture.first.id)
        let session = ReaderSession(book: fixture.first, state: state,
            original: try await fixture.library.originalURL(fixture.first.id),
            directory: try await fixture.library.bookDirectory(fixture.first.id), library: fixture.library)
        var preferences = session.state.preferences
        preferences.fontStyle = .rounded
        preferences.fontSize = 29; preferences.lineSpacing = 13; preferences.theme = "night"
        preferences.navigationMode = .scroll; preferences.viewMode = .parallel
        preferences.translationVariant = .interpretive; preferences.speechSpeed = 2.5
        preferences.autoPageInterval = 45
        session.changePreferences(preferences)
        let receipt = await session.flush()
        XCTAssertTrue(receipt.succeeded)
        let reopenedLibrary = try OfflineLibrary(root: fixture.root, scope: .device)
        let reopened = try await reopenedLibrary.state(fixture.second.id)
        XCTAssertEqual(reopened.preferences, preferences)
        XCTAssertEqual(reopened.anchor, anchor)
        XCTAssertEqual(reopened.notes, second.notes)
        XCTAssertEqual(reopened.drafts, second.drafts)
        XCTAssertNil(reopened.listeningPosition, "Saving listening speed never starts or fabricates listening")
    }

    func testLegacyMigrationUsesLastOpenedBookAndPreservesItsExplicitScroll() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var old = ReaderState(); old.preferences.fontSize = 31
        old.preferences.theme = "night"; old.preferences.navigationMode = .scroll
        try await fixture.library.saveState(old, bookID: fixture.first.id)
        try await fixture.library.setLastOpenedBook(fixture.first.id)
        let source = fixture.root.appendingPathComponent("device/states/" + fixture.first.id + ".json")
        let before = try Data(contentsOf: source)
        let next = try await fixture.library.state(fixture.second.id)
        XCTAssertEqual(next.preferences.fontSize, 31)
        XCTAssertEqual(next.preferences.theme, "night")
        XCTAssertEqual(next.preferences.navigationMode, .scroll)
        XCTAssertEqual(try Data(contentsOf: source), before, "Migration must leave old book records as recovery evidence")
    }

    func testSharedPreferencesAreIsolatedFromOtherAccountsAndDeviceLibrary() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let owner = UUID(), other = UUID()
        let account = try OfflineLibrary(root: fixture.root, scope: .account(owner))
        let anotherAccount = try OfflineLibrary(root: fixture.root, scope: .account(other))
        let source = fixture.root.appendingPathComponent("first.txt")
        let ownedBook = try await account.importFile(source)
        let otherBook = try await anotherAccount.importFile(source)
        var preferences = ReaderPreferences(); preferences.fontSize = 34; preferences.speechSpeed = 4
        try await account.saveReaderPreferences(preferences)
        let own = try await account.state(ownedBook.id)
        let foreign = try await anotherAccount.state(otherBook.id)
        let device = try await fixture.library.state(fixture.first.id)
        XCTAssertEqual(own.preferences.fontSize, 34)
        XCTAssertEqual(foreign.preferences.fontSize, 22)
        XCTAssertEqual(device.preferences.fontSize, 22)
        XCTAssertEqual(foreign.preferences.navigationMode, .paged)
        XCTAssertEqual(device.preferences.navigationMode, .paged)
    }

    func testCorruptSharedPreferencesAreNotSilentlyOverwritten() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let file = fixture.root.appendingPathComponent("device/reader-preferences.json")
        let original = Data("{broken preferences".utf8)
        try original.write(to: file)
        do {
            _ = try await fixture.library.state(fixture.first.id)
            XCTFail("Unreadable shared settings need an explicit recoverable error")
        } catch {}
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    @MainActor
    func testFailedSharedWriteIsReportedAndRetryKeepsTheLatestPreferences() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let state = try await fixture.library.state(fixture.first.id)
        try await fixture.library.saveState(state, bookID: fixture.first.id)
        let stateFile = fixture.root.appendingPathComponent("device/states/" + fixture.first.id + ".json")
        let savedBeforeFailure = try Data(contentsOf: stateFile)
        let session = ReaderSession(book: fixture.first, state: state,
            original: try await fixture.library.originalURL(fixture.first.id),
            directory: try await fixture.library.bookDirectory(fixture.first.id), library: fixture.library)
        let file = fixture.root.appendingPathComponent("device/reader-preferences.json")
        let retained = fixture.root.appendingPathComponent("retained-preferences.json")
        try FileManager.default.moveItem(at: file, to: retained)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        var preferences = state.preferences; preferences.fontSize = 30
        session.changePreferences(preferences)
        let failed = await session.flush()
        XCTAssertFalse(failed.succeeded)
        XCTAssertNotNil(session.saveError)
        XCTAssertEqual(try Data(contentsOf: stateFile), savedBeforeFailure,
            "A failed profile write must not reach a cloud-scheduling state store")
        preferences.fontSize = 32
        session.changePreferences(preferences)
        _ = await session.flush()
        try FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: retained, to: file)
        session.save()
        let retried = await session.flush()
        XCTAssertTrue(retried.succeeded)
        XCTAssertNil(session.saveError)
        let next = try await fixture.library.state(fixture.second.id)
        XCTAssertEqual(next.preferences.fontSize, 32)
    }

    @MainActor
    func testStateStoreSeesTheNewSharedAuthorityBeforeSchedulingSynchronization() async throws {
        let fixture = try await makeLibrary()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let state = try await fixture.library.state(fixture.first.id)
        let observer = ProfileObservingStateStore(library: fixture.library)
        let session = ReaderSession(book: fixture.first, state: state,
            original: try await fixture.library.originalURL(fixture.first.id),
            directory: try await fixture.library.bookDirectory(fixture.first.id), library: observer, preferencesStore: fixture.library)
        var preferences = state.preferences
        preferences.viewMode = .parallel; preferences.translationVariant = .interpretive
        session.changePreferences(preferences)
        let receipt = await session.flush()
        XCTAssertTrue(receipt.succeeded)
        let observed = await observer.observedPreferences
        XCTAssertEqual(observed.map(\.viewMode), [.parallel])
        XCTAssertEqual(observed.map(\.translationVariant), [.interpretive])
    }

    func testLegacyAndUnknownFieldsKeepRecordsAndSafePlaybackDefaults() throws {
        let missing = try JSONDecoder().decode(ReaderPreferences.self, from: Data(#"{"fontSize":27,"lineSpacing":12,"theme":"paper"}"#.utf8))
        XCTAssertEqual(missing.navigationMode, .paged)
        XCTAssertEqual(missing.fontStyle, .serif)
        XCTAssertEqual(missing.speechSpeed, 1)
        XCTAssertEqual(missing.autoPageInterval, 30)
        let future = try JSONDecoder().decode(ReaderPreferences.self, from: Data(#"{"navigationMode":"future","speechSpeed":99,"autoPageInterval":6}"#.utf8))
        XCTAssertEqual(future.navigationMode, .paged)
        XCTAssertEqual(future.speechSpeed, 5)
        XCTAssertEqual(future.autoPageInterval, 5)
    }

    func testAutomaticTimeOptOutSurvivesEncodingAndLegacySettingsHaveVisibleEstimate() throws {
        let legacy = try JSONDecoder().decode(ReaderPreferences.self, from: Data("{}".utf8))
        XCTAssertTrue(legacy.automaticReadingTime)
        var optedOut = legacy; optedOut.automaticReadingTime = false
        let restored = try JSONDecoder().decode(ReaderPreferences.self, from: JSONEncoder().encode(optedOut))
        XCTAssertFalse(restored.automaticReadingTime)
    }

    private func makeLibrary() async throws -> (root: URL, library: OfflineLibrary, first: LocalBook, second: LocalBook) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeafhourSharedPreferences-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let library = try OfflineLibrary(root: root, scope: .device)
        let firstURL = root.appendingPathComponent("first.txt"), secondURL = root.appendingPathComponent("second.txt")
        try Data("First book has its own source and position.".utf8).write(to: firstURL)
        try Data("Second book keeps its own notes and drafts.".utf8).write(to: secondURL)
        return (root, library, try await library.importFile(firstURL), try await library.importFile(secondURL))
    }
}

/// Observe the real library read available to a state store's synchronization
/// hook; storage itself still uses the production OfflineLibrary.
private actor ProfileObservingStateStore: ReaderStateStore {
    let library: OfflineLibrary
    var observedPreferences: [ReaderPreferences] = []
    init(library: OfflineLibrary) { self.library = library }
    func saveState(_ state: ReaderState, bookID: String) async throws {
        try await library.saveState(state, bookID: bookID)
        observedPreferences.append(try await library.state(bookID).preferences)
    }
}
