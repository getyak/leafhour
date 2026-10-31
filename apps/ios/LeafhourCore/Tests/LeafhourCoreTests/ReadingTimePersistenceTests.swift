import XCTest
@testable import LeafhourCore

final class ReadingTimePersistenceTests: XCTestCase {
    func testColdLibraryRecoveryFinishesAtDurableCheckpointWithoutAddingShutdownGap() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = root.appendingPathComponent("fixture.txt"); try Data("A real synthetic paragraph for offline reading.".utf8).write(to: original)
        let library = try OfflineLibrary(root: root, scope: .device), book = try await library.importFile(original)
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id), base = Date(timeIntervalSince1970: 1_793_491_200)
        var clock = ReadingActivityClock(); try clock.start(bookID: book.id, contentVersion: book.sourceVersion, anchor: anchor, at: base)
        clock.tick(at: base.addingTimeInterval(3)); let checkpoint = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(3)))
        try await library.retainReadingTime(checkpoint, bookID: book.id)
        let reopened = try OfflineLibrary(root: root, scope: .device)
        let recovered = try await reopened.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(recovered.pending.first?.status, .finished)
        XCTAssertEqual(recovered.pending.first?.sequence, checkpoint.sequence + 1)
        XCTAssertEqual(recovered.pending.first?.endedAt, checkpoint.endedAt)
        XCTAssertEqual(recovered.pending.first?.durationSeconds, 3)
        let again = try OfflineLibrary(root: root, scope: .device)
        let stable = try await again.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(stable.pending, recovered.pending)
    }
    func testVersionMismatchPreservesExistingLedgerBytesAndPendingSnapshot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = root.appendingPathComponent("fixture.txt"); try Data("Another synthetic paragraph for disk persistence.".utf8).write(to: original)
        let library = try OfflineLibrary(root: root, scope: .device), book = try await library.importFile(original)
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id), base = Date(timeIntervalSince1970: 1_793_491_200)
        var clock = ReadingActivityClock(); try clock.start(bookID: book.id, contentVersion: book.sourceVersion, anchor: anchor, at: base)
        clock.tick(at: base.addingTimeInterval(1)); let first = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(1)))
        try await library.retainReadingTime(first, bookID: book.id)
        let file = root.appendingPathComponent("device/states/" + book.id + "-reading-time.json"), before = try Data(contentsOf: file)
        var wrong = first; wrong.contentVersion = "another-version"; wrong.sequence += 1
        do { try await library.retainReadingTime(wrong, bookID: book.id); XCTFail("Wrong version was persisted") } catch {}
        XCTAssertEqual(try Data(contentsOf: file), before)
        let ledger = try await library.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(ledger.pending, [first])
    }
    func testActualFilesystemWriteFailureRetainsPreviousDurableSnapshotForRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = root.appendingPathComponent("fixture.txt"); try Data("A synthetic source for write failures.".utf8).write(to: original)
        let library = try OfflineLibrary(root: root, scope: .device), book = try await library.importFile(original)
        var clock = ReadingActivityClock(); let base = Date(timeIntervalSince1970: 1_793_491_200)
        try clock.start(bookID: book.id, contentVersion: book.sourceVersion, anchor: ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id), at: base)
        clock.tick(at: base.addingTimeInterval(1)); let first = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(1)))
        try await library.retainReadingTime(first, bookID: book.id)
        let states = root.appendingPathComponent("device/states"), file = states.appendingPathComponent(book.id + "-reading-time.json"), before = try Data(contentsOf: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: states.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: states.path) }
        guard !FileManager.default.isWritableFile(atPath: states.path) else { throw XCTSkip("This process bypasses filesystem permission checks") }
        clock.tick(at: base.addingTimeInterval(2)); let next = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(2)))
        do { try await library.retainReadingTime(next, bookID: book.id); XCTFail("Write to a blocked ledger unexpectedly succeeded") } catch {}
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: states.path)
        XCTAssertEqual(try Data(contentsOf: file), before)
        let retained = try await library.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(retained.pending, [first])
        try await library.retainReadingTime(next, bookID: book.id)
        let retried = try await library.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(retried.pending, [next])
    }
}
