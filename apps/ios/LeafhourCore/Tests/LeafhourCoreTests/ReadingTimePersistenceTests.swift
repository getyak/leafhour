import XCTest
@testable import LeafhourCore

final class ReadingTimePersistenceTests: XCTestCase {
    func testLargeBookCheckpointsReuseUnchangedIndexInsteadOfDecodingWholeBook() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try Disk.directory(root)
        let original = root.appendingPathComponent("large.txt")
        let paragraph = String(repeating: "Synthetic reading source. ", count: 16)
        try Data((0..<32_000).map { "\($0) " + paragraph }.joined(separator: "\n\n").utf8).write(to: original)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(original)
        _ = try await library.readingOpening(book.id)
        let index = try await library.bookDirectory(book.id).appendingPathComponent("book.json")
        // Compare with real full decodes of this same large index, avoiding a
        // device-specific absolute time budget while catching repeated parsing.
        let decodeStart = ContinuousClock.now
        for _ in 0..<5 { _ = try Disk.read(LocalBook.self, from: index) }
        let decodeDuration = decodeStart.duration(to: .now)
        let base = Date(timeIntervalSince1970: 1_793_491_200)
        var clock = ReadingActivityClock()
        try clock.start(bookID: book.id, contentVersion: book.sourceVersion, anchor: ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id), at: base)
        let saveStart = ContinuousClock.now
        for second in 1...5 {
            let snapshot = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(Double(second))))
            try await library.retainReadingTime(snapshot, bookID: book.id)
        }
        let saveDuration = saveStart.duration(to: .now)
        print("READING_TIME_LARGE_INDEX bytes=\(try Disk.size(index)) fiveDecodes=\(decodeDuration) fiveCheckpoints=\(saveDuration)")
        XCTAssertLessThan(saveDuration, decodeDuration, "Warm reading checkpoints must not reparse the large book index")
        let saved = try await library.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(saved.snapshots.first?.durationSeconds, 5)
    }

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
    func testWarmCheckpointCacheRejectsReplacedIndexAndChangedManifestWithoutOverwritingLedger() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try Disk.directory(root)
        let original = root.appendingPathComponent("fixture.txt")
        try Data("Synthetic source for checkpoint cache invalidation.".utf8).write(to: original)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device), book = try await library.importFile(original)
        _ = try await library.readingOpening(book.id)
        let directory = try await library.bookDirectory(book.id), index = directory.appendingPathComponent("book.json"), manifestURL = directory.appendingPathComponent("manifest.json")
        let originalIndex = try Data(contentsOf: index), originalManifest = try Data(contentsOf: manifestURL)
        var clock = ReadingActivityClock()
        let base = Date(timeIntervalSince1970: 1_793_491_200)
        try clock.start(bookID: book.id, contentVersion: book.sourceVersion, anchor: ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id), at: base)
        let first = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(1)))
        try await library.retainReadingTime(first, bookID: book.id)
        let ledgerURL = root.appendingPathComponent("library/device/states/" + book.id + "-reading-time.json"), saved = try Data(contentsOf: ledgerURL)
        let attributes = try FileManager.default.attributesOfItem(atPath: index.path)
        var replacement = book
        replacement.chapters[0].passages[0].id = String(repeating: "z", count: replacement.chapters[0].passages[0].id.count)
        try Disk.write(replacement, to: index)
        try FileManager.default.setAttributes([.modificationDate: try XCTUnwrap(attributes[.modificationDate])], ofItemAtPath: index.path)
        let next = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(2)))
        do { try await library.retainReadingTime(next, bookID: book.id); XCTFail("A replaced index must not authorize the stale cached anchor") } catch {}
        XCTAssertEqual(try Data(contentsOf: ledgerURL), saved)
        try originalIndex.write(to: index, options: .atomic)
        var manifest = try Disk.read(OfflineManifest.self, from: manifestURL)
        let source = try XCTUnwrap(manifest.files.firstIndex(where: { $0.path == "source.txt" }))
        manifest.files[source].sha256 = String(repeating: "a", count: 64)
        try Disk.write(manifest, to: manifestURL)
        do { try await library.retainReadingTime(next, bookID: book.id); XCTFail("The current manifest must still authorize this source version") } catch {}
        XCTAssertEqual(try Data(contentsOf: ledgerURL), saved)
        try originalManifest.write(to: manifestURL, options: .atomic)
        try await library.retainReadingTime(next, bookID: book.id)
        let restored = try await library.readingTimeLedger(bookID: book.id)
        XCTAssertEqual(restored.snapshots.first?.durationSeconds, 2)
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
