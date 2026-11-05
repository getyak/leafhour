import XCTest
@testable import LeafhourCore

final class ReaderBookmarksTests: XCTestCase {
    func testLegacyStateWithoutBookmarksRemainsReadable() throws {
        let old = Data(#"{"drafts":{},"notes":[],"preferences":{}}"#.utf8)
        let state = try JSONDecoder().decode(ReaderState.self, from: old)
        XCTAssertTrue((state.bookmarks ?? []).isEmpty)
        let oldSource = ReaderBookmark(sourceVersion: "v1", contentVersion: nil, anchor: ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 12))
        var payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(oldSource)) as? [String: Any])
        payload.removeValue(forKey: "presentation")
        let decoded = try JSONDecoder().decode(ReaderBookmark.self, from: JSONSerialization.data(withJSONObject: payload))
        XCTAssertNil(decoded.presentation)
        XCTAssertEqual(decoded.anchor.characterOffset, 12)
    }

    func testBookmarkColorRejectsMalformedOrTransparentValuesAndKeepsTextName() {
        XCTAssertNil(BookmarkColor(hex: "#1234", name: "Test"))
        XCTAssertNil(BookmarkColor(hex: "#12345678", name: "Test"))
        let color = BookmarkColor(hex: "#ab1234", name: " ")
        XCTAssertEqual(color?.hex, "#AB1234")
        XCTAssertEqual(color?.name, "自定义")
        XCTAssertTrue(BookmarkColor.presets.allSatisfy { !$0.name.isEmpty })
    }

    func testBookmarkKeyIncludesPDFAndImagePositions() {
        let base = ReadingAnchor(chapterID: "c", passageID: "p")
        var first = base, second = base
        first.pageY = 120; second.pageY = 220
        XCTAssertNotEqual(ReaderBookmark.positionKey(first), ReaderBookmark.positionKey(second))
        first.pageY = nil; second.pageY = nil; first.resourceY = 0.1; second.resourceY = 0.9
        XCTAssertNotEqual(ReaderBookmark.positionKey(first), ReaderBookmark.positionKey(second))
        second.resourceY = 0.10001
        XCTAssertEqual(ReaderBookmark.positionKey(first), ReaderBookmark.positionKey(second))
    }

    func testPullRequiresEndedArmedGestureAndDoesNotRearmAfterCancellation() {
        var pull = ReaderBookmarkPullState()
        pull.begin(eligible: true)
        XCTAssertEqual(pull.change(down: 71, across: 0), .pulling)
        XCTAssertFalse(pull.end())
        pull.begin(eligible: true)
        XCTAssertEqual(pull.change(down: 72, across: 2), .armed)
        XCTAssertEqual(pull.change(down: 60, across: 0), .armed)
        XCTAssertEqual(pull.change(down: 55, across: 0), .pulling)
        XCTAssertFalse(pull.end())
        pull.begin(eligible: true); _ = pull.change(down: 100, across: 0)
        pull.cancel(); XCTAssertFalse(pull.end())
        pull.begin(eligible: false); _ = pull.change(down: 100, across: 0)
        XCTAssertFalse(pull.end())
        pull.begin(eligible: true); _ = pull.change(down: 100, across: 0)
        XCTAssertTrue(pull.end()); XCTAssertFalse(pull.end())
    }

    func testHorizontalAndReversedPullCannotAddBookmark() {
        var pull = ReaderBookmarkPullState()
        pull.begin(eligible: true); _ = pull.change(down: 80, across: 70)
        XCTAssertFalse(pull.end())
        pull.begin(eligible: true); _ = pull.change(down: 80, across: 0)
        _ = pull.change(down: -10, across: 0)
        XCTAssertFalse(pull.end())
    }

    func testPullVisualTracksFingerWithBoundedResistanceAndResetsOnRelease() {
        var pull = ReaderBookmarkPullState()
        pull.begin(eligible: true)
        _ = pull.change(down: 36, across: 0)
        XCTAssertEqual(pull.visual.progress, 0.5)
        let first = pull.visual.displacement
        XCTAssertGreaterThan(first, 0); XCTAssertLessThan(first, 36)
        _ = pull.change(down: 72, across: 0)
        XCTAssertEqual(pull.visual.progress, 1)
        XCTAssertGreaterThan(pull.visual.displacement, first)
        _ = pull.change(down: 10000, across: 0)
        XCTAssertLessThan(pull.visual.displacement, 112)
        XCTAssertTrue(pull.end()); XCTAssertEqual(pull.visual, .idle)
    }

    func testReturningFromLongPullAndInvalidSamplesCannotRearmBeforeANewTouch() {
        for sample in [120.0, Double.nan, Double.infinity] {
            var pull = ReaderBookmarkPullState()
            pull.begin(eligible: true); _ = pull.change(down: 150, across: 0)
            _ = pull.change(down: sample, across: 0)
            _ = pull.change(down: 100, across: 0)
            XCTAssertFalse(pull.end())
            XCTAssertEqual(pull.visual, .idle)
            pull.begin(eligible: true); _ = pull.change(down: 80, across: 0)
            XCTAssertTrue(pull.end())
        }
    }

    func testViewportMatchingDoesNotMarkAnotherPartOfALongParagraph() {
        let start = ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 500)
        let end = ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 600)
        let visible = ReaderBookmarkVisibleRange(start: start, end: end)
        XCTAssertFalse(visible.contains(ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 10)))
        XCTAssertTrue(visible.contains(ReadingAnchor(chapterID: "c", passageID: "p", characterOffset: 550)))
        XCTAssertFalse(visible.contains(ReadingAnchor(chapterID: "c", passageID: "p", pageY: 550)))
    }

    func testPDFViewportUsesInvertedPageCoordinatesAndImagesUseNormalizedIntervals() {
        let pdf = ReaderBookmarkVisibleRange(start: ReadingAnchor(chapterID: "c", passageID: "p", pageY: 700), end: ReadingAnchor(chapterID: "c", passageID: "p", pageY: 350))
        XCTAssertTrue(pdf.contains(ReadingAnchor(chapterID: "c", passageID: "p", pageY: 400)))
        XCTAssertFalse(pdf.contains(ReadingAnchor(chapterID: "c", passageID: "p", pageY: 100)))
        let image = ReaderBookmarkVisibleRange(start: ReadingAnchor(chapterID: "c", passageID: "i", resourceY: 0.4), end: ReadingAnchor(chapterID: "c", passageID: "i", resourceY: 0.8))
        XCTAssertFalse(image.contains(ReadingAnchor(chapterID: "c", passageID: "i", resourceY: 0.1)))
        XCTAssertTrue(image.contains(ReadingAnchor(chapterID: "c", passageID: "i", resourceY: 0.5)))
    }

    @MainActor func testDistinctTranslationPagesKeepOneCanonicalSourceAndDifferentPresentationBookmarks() async throws {
        let f = try await fixture(), session = f.session()
        let passage = session.chapter.passages[0], text = String(repeating: "Translated words 😀 preserve their own positions. ", count: 80)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh))
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: text, targetLanguage: .zh)])
        let first = try XCTUnwrap(ReaderBookmarkPresentation(layer: .literal, targetLanguage: .zh, text: text, utf16Offset: 10, viewMode: .translation))
        let second = try XCTUnwrap(ReaderBookmarkPresentation(layer: .literal, targetLanguage: .zh, text: text, utf16Offset: 800, viewMode: .translation))
        let a = await session.addBookmark(capture: ReaderBookmarkCapture(anchor: f.anchor, presentation: first))
        let b = await session.addBookmark(capture: ReaderBookmarkCapture(anchor: f.anchor, presentation: second))
        XCTAssertTrue(a.succeeded); XCTAssertTrue(b.succeeded)
        XCTAssertEqual(session.bookmarks.count, 2)
        XCTAssertEqual(session.bookmarks.map(\.anchor), [f.anchor, f.anchor], "The source-language scalar is not invented from translated text")
        let page = ReaderBookmarkVisibleRange(start: f.anchor, end: f.anchor, presentation: second, displayEndOffset: 1000)
        XCTAssertEqual(session.bookmarks(in: [page]).map { $0.presentation?.utf16Offset }, [800])
        XCTAssertTrue(page.contains(try XCTUnwrap(session.bookmarks.last)))
        XCTAssertFalse(page.contains(try XCTUnwrap(session.bookmarks.first)))
        XCTAssertFalse(page.contains(f.anchor), "A translated display range must not mark a source-only bookmark")
    }

    @MainActor func testTranslatedBookmarkRestoresVerifiedLayerAfterTemplateSwitchAndRejectsChangedSnapshot() async throws {
        let f = try await fixture(), session = f.session()
        let passage = session.chapter.passages[0], text = String(repeating: "Verified translation. ", count: 70)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh))
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, interpretive: text, targetLanguage: .zh)])
        let presentation = try XCTUnwrap(ReaderBookmarkPresentation(layer: .interpretive, targetLanguage: .zh, text: text, utf16Offset: 600, viewMode: .parallel))
        _ = await session.addBookmark(capture: ReaderBookmarkCapture(anchor: f.anchor, presentation: presentation))
        let id = try XCTUnwrap(session.bookmarks.first?.id)
        var preferences = session.state.preferences; preferences.viewMode = .source; session.changePreferences(preferences)
        XCTAssertTrue(session.goToBookmark(id: id))
        XCTAssertEqual(session.state.preferences.viewMode, .parallel)
        XCTAssertEqual(session.state.preferences.translationVariant, .interpretive)
        XCTAssertEqual(session.bookmarkNavigation?.presentation, presentation)
        XCTAssertEqual(session.bookmarkNavigation?.navigationID, session.navigationID)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, interpretive: "Changed " + text, targetLanguage: .zh)])
        let navigation = session.navigationID
        XCTAssertFalse(session.goToBookmark(id: id))
        XCTAssertEqual(session.navigationID, navigation)
        XCTAssertTrue(session.message?.contains("待核对") == true)
    }

    @MainActor func testTranslationBookmarkRejectsWrongLanguageAndSourceVersionAndRoundTripsPresentation() async throws {
        let f = try await fixture(), session = f.session()
        let passage = session.chapter.passages[0], text = "A real translated snapshot"
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh))
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: text, targetLanguage: .zh)])
        let presentation = try XCTUnwrap(ReaderBookmarkPresentation(layer: .literal, targetLanguage: .zh, text: text, utf16Offset: 4))
        _ = await session.addBookmark(capture: ReaderBookmarkCapture(anchor: f.anchor, presentation: presentation))
        let row = try XCTUnwrap(session.bookmarks.first)
        let restored = try JSONDecoder().decode(ReaderState.self, from: JSONEncoder().encode(session.state))
        XCTAssertEqual(restored.bookmarks?.first?.presentation, presentation)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .ja))
        XCTAssertFalse(session.goToBookmark(id: row.id))
        var stale = row; stale = ReaderBookmark(sourceVersion: "old-source", contentVersion: nil, anchor: f.anchor, presentation: presentation)
        session.state.bookmarks = [stale]
        XCTAssertFalse(session.goToBookmark(id: stale.id))
        XCTAssertEqual(session.bookmarks.count, 1)
    }

    @MainActor func testAddUsesLatestVisibleSourceAnchorPersistsAndIsIdempotent() async throws {
        let f = try await fixture(), session = f.session()
        var anchor = f.anchor; anchor.characterOffset = 3
        session.recordVisible(anchor, navigationID: session.navigationID)
        let first = await session.addBookmark()
        XCTAssertTrue(first.succeeded)
        let bookmark = try XCTUnwrap(session.bookmarks.first)
        XCTAssertEqual(bookmark.anchor, anchor)
        let updated = await session.updateBookmark(id: bookmark.id, color: BookmarkColor.presets[1], name: "  Return here  ")
        XCTAssertTrue(updated.succeeded)
        let second = await session.addBookmark()
        XCTAssertTrue(second.succeeded)
        XCTAssertEqual(session.bookmarks.count, 1)
        XCTAssertEqual(session.bookmarks.first?.name, "Return here")
        XCTAssertEqual(session.bookmarks.first?.color, BookmarkColor.presets[1])
        XCTAssertTrue(session.state.notes.isEmpty)
        let saved = try await f.library.state(f.book.id)
        let decoded = try JSONDecoder().decode(ReaderState.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(decoded.bookmarks, session.bookmarks)
        let reopened = f.session(state: decoded)
        XCTAssertTrue(reopened.goToBookmark(id: bookmark.id))
        XCTAssertEqual(reopened.currentAnchor, anchor)
    }

    @MainActor func testExportedStateRestoresBookmarksInANewIsolatedLibrary() async throws {
        let f = try await fixture(), session = f.session()
        _ = await session.addBookmark()
        let row = try XCTUnwrap(session.bookmarks.first)
        _ = await session.updateBookmark(id: row.id, color: BookmarkColor.presets[3], name: "Portable bookmark")
        let data = try JSONEncoder().encode(session.state)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeafhourBookmarkRestore-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let isolated = try OfflineLibrary(root: root, scope: .device)
        let book = try await isolated.importFile(f.original)
        let decoded = try JSONDecoder().decode(ReaderState.self, from: data)
        try await isolated.saveState(decoded, bookID: book.id)
        let saved = try await isolated.state(book.id)
        XCTAssertEqual(saved.bookmarks, session.state.bookmarks)
        XCTAssertEqual(saved.bookmarks?.first?.color, BookmarkColor.presets[3])
        XCTAssertEqual(saved.bookmarks?.first?.name, "Portable bookmark")
        XCTAssertTrue(saved.notes.isEmpty)
    }

    @MainActor func testInvalidAnchorDoesNotCreateBookmarkOrJumpToChapterStart() async throws {
        let f = try await fixture(), session = f.session()
        let result = await session.addBookmark(at: ReadingAnchor(chapterID: "missing", passageID: "missing"))
        XCTAssertFalse(result.succeeded)
        XCTAssertTrue(session.bookmarks.isEmpty)
    }

    @MainActor func testStaleSourceBookmarkIsRetainedButCannotNavigate() async throws {
        let f = try await fixture()
        var state = ReaderState()
        let old = ReaderBookmark(sourceVersion: "old-version", contentVersion: nil, anchor: f.anchor)
        state.bookmarks = [old]
        let session = f.session(state: state)
        XCTAssertFalse(session.goToBookmark(id: old.id))
        XCTAssertEqual(session.bookmarks.count, 1)
        let added = await session.addBookmark(at: f.anchor)
        XCTAssertTrue(added.succeeded)
        XCTAssertEqual(session.bookmarks.count, 2)
    }

    @MainActor func testFailureIsNotReportedAsSavedAndRetryKeepsSingleBookmark() async throws {
        let f = try await fixture(), store = BookmarkFailingStore(), session = f.session(store: store)
        let failed = await session.addBookmark()
        XCTAssertFalse(failed.succeeded)
        XCTAssertFalse(session.isBookmarkPersisted(id: try XCTUnwrap(session.bookmarks.first?.id)))
        XCTAssertEqual(session.bookmarks.count, 1, "The editable pending bookmark stays available for retry")
        await store.allowWrites()
        let retried = await session.addBookmark()
        XCTAssertTrue(retried.succeeded)
        XCTAssertTrue(session.isBookmarkPersisted(id: try XCTUnwrap(session.bookmarks.first?.id)))
        XCTAssertEqual(session.bookmarks.count, 1)
    }

    @MainActor func testFailedRemovalRemainsVisibleForRetryWithoutReplacingNotes() async throws {
        let f = try await fixture(), store = BookmarkFailingStore()
        await store.allowWrites()
        let session = f.session(store: store)
        _ = await session.addBookmark()
        let id = try XCTUnwrap(session.bookmarks.first?.id)
        await store.failWrites()
        session.state.notes = [ReaderNote(anchor: f.anchor, quote: "source", body: "Independent edit")]
        let result = await session.removeBookmark(id: id)
        XCTAssertFalse(result.succeeded)
        XCTAssertEqual(session.bookmarks.first?.id, id)
        XCTAssertEqual(session.state.notes.first?.body, "Independent edit")
        await store.allowWrites()
        let retried = await session.removeBookmark(id: id)
        XCTAssertTrue(retried.succeeded)
        XCTAssertTrue(session.bookmarks.isEmpty)
    }

    @MainActor func testRemoveSurvivesReopenAndPreservesNotes() async throws {
        let f = try await fixture(), session = f.session()
        _ = await session.addBookmark()
        let id = try XCTUnwrap(session.bookmarks.first?.id)
        session.state.notes = [ReaderNote(anchor: f.anchor, quote: "source", body: "Keep my note")]
        let removed = await session.removeBookmark(id: id)
        XCTAssertTrue(removed.succeeded)
        let saved = try await f.library.state(f.book.id)
        XCTAssertTrue((saved.bookmarks ?? []).isEmpty)
        XCTAssertEqual(saved.notes.first?.body, "Keep my note")
    }

    @MainActor func testInvalidCurrentVersionBookmarkCannotOverwriteDurableState() async throws {
        let f = try await fixture()
        var state = ReaderState()
        state.bookmarks = [ReaderBookmark(sourceVersion: f.book.sourceVersion, contentVersion: nil, anchor: ReadingAnchor(chapterID: "wrong", passageID: "wrong"))]
        do { try await f.library.saveState(state, bookID: f.book.id); XCTFail("Invalid anchor was accepted") }
        catch { XCTAssertTrue(error.localizedDescription.contains("书签")) }
        let saved = try await f.library.state(f.book.id)
        XCTAssertTrue((saved.bookmarks ?? []).isEmpty)
    }

    @MainActor func testConcurrentAddsCoalesceIntoOneBookmark() async throws {
        let f = try await fixture(), session = f.session()
        async let first = session.addBookmark()
        async let second = session.addBookmark()
        let results = await [first, second]
        XCTAssertTrue(results.allSatisfy(\.succeeded))
        XCTAssertEqual(session.bookmarks.count, 1)
        let saved = try await f.library.state(f.book.id)
        XCTAssertEqual(saved.bookmarks?.count, 1)
    }

    @MainActor func testAccountProfilesDoNotShareBookmarkedState() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeafhourBookmarkAccounts-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("sample.txt")
        try Data("One source paragraph.".utf8).write(to: source)
        let first = try OfflineLibrary(root: root, scope: .account(UUID())), second = try OfflineLibrary(root: root, scope: .account(UUID()))
        let book = try await first.importFile(source), other = try await second.importFile(source)
        let passage = try XCTUnwrap(book.chapters.first?.passages.first)
        var state = ReaderState()
        state.bookmarks = [ReaderBookmark(sourceVersion: book.sourceVersion, contentVersion: nil, anchor: ReadingAnchor(chapterID: book.chapters[0].id, passageID: passage.id))]
        try await first.saveState(state, bookID: book.id)
        let otherState = try await second.state(other.id)
        XCTAssertTrue((otherState.bookmarks ?? []).isEmpty)
    }

    @MainActor private func fixture() async throws -> BookmarkFixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeafhourBookmarks-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("book.txt")
        try Data("First 😀 source paragraph.\n\nSecond source paragraph.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("Library"), scope: .device)
        let book = try await library.importFile(source)
        let chapter = try XCTUnwrap(book.chapters.first), passage = try XCTUnwrap(chapter.passages.first)
        return BookmarkFixture(library: library, book: book, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), anchor: ReadingAnchor(chapterID: chapter.id, passageID: passage.id))
    }
}

private struct BookmarkFixture {
    let library: OfflineLibrary
    let book: LocalBook
    let original: URL
    let directory: URL
    let anchor: ReadingAnchor
    @MainActor func session(state: ReaderState? = nil, store: (any ReaderStateStore)? = nil) -> ReaderSession {
        var saved = state ?? ReaderState(); if saved.anchor == nil { saved.anchor = anchor }
        return ReaderSession(book: book, state: saved, original: original, directory: directory, library: store ?? library)
    }
}

private actor BookmarkFailingStore: ReaderStateStore {
    private var fails = true
    func allowWrites() { fails = false }
    func failWrites() { fails = true }
    func saveState(_ state: ReaderState, bookID: String) async throws {
        if fails { throw LibraryError.invalid("Synthetic disk failure") }
    }
}
