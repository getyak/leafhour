import Foundation
import XCTest
@testable import LeafhourCore

final class ReaderOpeningTests: XCTestCase {
    private func fixture() async throws -> (URL, OfflineLibrary, LocalBook, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Disk.directory(root)
        let source = root.appendingPathComponent("Synthetic.txt")
        try Data("An invented opening paragraph.\n\nA second source paragraph.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(source), folder = try await library.bookDirectory(book.id)
        let extra = folder.appendingPathComponent("unused.bin")
        try Data("unused resource".utf8).write(to: extra)
        var manifest = try Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json"))
        manifest.files.append(FileDigest(path: "unused.bin", sha256: try Disk.hashFile(extra), bytes: try Disk.size(extra)))
        try Disk.write(manifest, to: folder.appendingPathComponent("manifest.json"))
        return (root, library, book, folder)
    }

    func testDamagedDeferredResourceDoesNotDelaySourceButStopsWritesAndPreservesRepairData() async throws {
        let (root, library, book, folder) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        try await library.saveState(state, bookID: book.id)
        try Data("broken resource".utf8).write(to: folder.appendingPathComponent("unused.bin"))
        let opening = try await library.readingOpening(book.id)
        XCTAssertEqual(opening.state.anchor, state.anchor)
        XCTAssertEqual(opening.book.chapters[0].passages[0].text, "An invented opening paragraph.")
        do { try await library.verifyReadingOpening(opening); XCTFail("Deferred verification must report corrupt resources") } catch { }
        do { try await library.saveState(ReaderState(), bookID: book.id); XCTFail("An invalidated reading copy cannot overwrite records") } catch { }
        let retained = try await library.state(book.id)
        XCTAssertEqual(retained.anchor, state.anchor)
        XCTAssertTrue(FileManager.default.fileExists(atPath: opening.original.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("unused.bin").path))
    }

    func testUnchangedWarmOpeningRejectsInPlaceSourceMutationWithRestoredSizeAndDate() async throws {
        let (root, library, book, folder) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try await library.readingOpening(book.id)
        let source = folder.appendingPathComponent("source.txt")
        let before = try FileManager.default.attributesOfItem(atPath: source.path)
        let handle = try FileHandle(forWritingTo: source); try handle.write(contentsOf: Data("X".utf8)); try handle.close()
        try FileManager.default.setAttributes([.modificationDate: try XCTUnwrap(before[.modificationDate])], ofItemAtPath: source.path)
        do { _ = try await library.readingOpening(book.id); XCTFail("In-place mutations must invalidate an unchanged-size/date cache") } catch { }
    }

    func testWarmOpeningRejectsReplacedIndexAndStaleVerificationCannotAuthorizeIt() async throws {
        let (root, library, book, folder) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let opening = try await library.readingOpening(book.id)
        var changed = book; changed.chapters[0].passages[0].text = "A substituted source paragraph."
        try Disk.write(changed, to: folder.appendingPathComponent("book.json"))
        do { _ = try await library.readingOpening(book.id); XCTFail("Unverified replacement indexes cannot revive cached text") } catch { }
        do { try await library.verifyReadingOpening(opening); XCTFail("A receipt for old content must not verify a replacement") } catch { }
    }

    func testReadingOpeningRetainsProfileAndCannotBeVerifiedByAnotherLibrary() async throws {
        let (root, library, book, _) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let opening = try await library.readingOpening(book.id)
        let other = try OfflineLibrary(root: root.appendingPathComponent("other"), scope: .device)
        do { try await other.verifyReadingOpening(opening); XCTFail("A reading receipt must stay bound to its profile") } catch { }
        try await library.verifyReadingOpening(opening)
        try await library.saveState(opening.state, bookID: book.id)
    }

    @MainActor func testSessionDoesNotReadUnverifiedResourcesOrMoveAfterFullPass() async throws {
        let (root, library, book, _) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let opening = try await library.readingOpening(book.id)
        let session = ReaderSession(book: opening.book, state: opening.state, original: opening.original, directory: opening.directory,
                                    library: library, preparation: opening.preparation)
        XCTAssertFalse(session.canReadResource("unverified.png"))
        let anchor = session.currentAnchor, navigation = session.navigationID
        try await library.verifyReadingOpening(opening)
        session.completePackageVerification()
        XCTAssertTrue(session.canReadResource("unverified.png"))
        XCTAssertEqual(session.currentAnchor, anchor)
        XCTAssertEqual(session.navigationID, navigation)
    }

    func testDeferredFailureRetainsNewWorkSeparatelyFromCanonicalRecords() async throws {
        let (root, library, book, folder) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let opening = try await library.readingOpening(book.id)
        let originalState = try await library.state(book.id)
        var recent = originalState
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[1].id)
        recent.anchor = anchor
        recent.notes.append(ReaderNote(anchor: anchor, quote: "second source", body: "New work before deferred failure."))
        try Data("broken resource".utf8).write(to: folder.appendingPathComponent("unused.bin"))
        do { try await library.verifyReadingOpening(opening); XCTFail("Fixture must fail integrity") } catch { }
        try await library.retainReaderOpeningRecovery(recent, opening: opening)
        let recoveries = try await library.readerOpeningRecoveries(book.id)
        XCTAssertEqual(recoveries.count, 1)
        XCTAssertEqual(recoveries.first?.state, recent)
        XCTAssertEqual(recoveries.first?.sourceVersion, book.sourceVersion)
        let canonical = try await library.state(book.id)
        XCTAssertEqual(canonical, originalState, "Recovery never rewrites canonical notes or progress")
        let restarted = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let afterRestart = try await restarted.readerOpeningRecoveries(book.id)
        XCTAssertEqual(afterRestart.first?.state, recent)
        _ = try await restarted.repair(book.id)
        _ = try await restarted.verify(book.id)
        let afterRepair = try await restarted.readerOpeningRecoveries(book.id)
        XCTAssertEqual(afterRepair.first?.state, recent, "Repair and process restart retain the exportable recovery")
        let repairedCanonical = try await restarted.state(book.id)
        XCTAssertEqual(repairedCanonical, originalState)
    }

    @MainActor func testIntegrityFailureKeepsLiveWorkAndRevokesResourceAccess() async throws {
        let (root, library, book, _) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let opening = try await library.readingOpening(book.id)
        let session = ReaderSession(book: opening.book, state: opening.state, original: opening.original, directory: opening.directory, library: library, preparation: opening.preparation)
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[1].id)
        session.recordVisible(anchor, navigationID: session.navigationID)
        session.state.notes.append(ReaderNote(anchor: anchor, quote: "second source", body: "Unsaved note."))
        session.failPackageVerification("Synthetic integrity failure")
        XCTAssertNotNil(session.packageVerificationError)
        XCTAssertEqual(session.openingRecoverySnapshot.anchor, anchor)
        XCTAssertEqual(session.openingRecoverySnapshot.notes.first?.body, "Unsaved note.")
        session.completePackageVerification()
        XCTAssertFalse(session.canReadResource("unverified.png"), "A late success cannot release a failed session")
        session.go(to: 0, anchor: ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id))
        XCTAssertEqual(session.openingRecoverySnapshot.anchor, anchor, "Late navigation callbacks cannot change the frozen recovery snapshot")
    }

    func testSyntheticOpeningProfile() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try Disk.directory(root)
        let source = root.appendingPathComponent("Synthetic.txt")
        let paragraph = "Invented source for opening performance. " + String(repeating: "quiet words ", count: 20)
        try Data((0..<32_000).map { "\($0) " + paragraph }.joined(separator: "\n\n").utf8).write(to: source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let imported = try await library.importFile(source)
        _ = try await library.books()
        let first = ContinuousClock.now
        let book = try await library.book(imported.id)
        let second = ContinuousClock.now
        _ = try await library.originalURL(imported.id)
        let third = ContinuousClock.now
        _ = ReadingLanguage.detect(in: book)
        let fourth = ContinuousClock.now
        _ = ReadingTextWindow(chapter: book.chapters[0], anchor: nil)
        print("OPENING_BASELINE bytes=\(try Disk.size(source)) passages=\(book.chapters.reduce(0) { $0 + $1.passages.count }) fullBook=\(first.duration(to: second)) duplicateOriginal=\(second.duration(to: third)) language=\(third.duration(to: fourth)) window=\(fourth.duration(to: .now))")
        let coldStart = ContinuousClock.now
        let opening = try await library.readingOpening(book.id)
        let coldEnd = ContinuousClock.now
        _ = try await library.readingOpening(book.id)
        print("OPENING_READER_FIRST coldCritical=\(coldStart.duration(to: coldEnd)) warmCritical=\(coldEnd.duration(to: .now))")
        XCTAssertEqual(opening.book.chapters.count, book.chapters.count)
        XCTAssertFalse(book.chapters.isEmpty)
    }
}
