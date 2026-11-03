import Foundation
import XCTest
@testable import LeafhourCore

final class OfflineStateIndexCacheTests: XCTestCase {
    private func fixture() async throws -> (URL, OfflineLibrary, LocalBook, URL) {
        let base = ProcessInfo.processInfo.environment["LEAFHOUR_TEST_ROOT"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.temporaryDirectory
        let root = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try Disk.directory(root)
        let source = root.appendingPathComponent("source.txt")
        try Data("One real passage.\n\nAnother real passage.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(source)
        let index = root.appendingPathComponent("library/device/books/" + book.id + "/book.json")
        return (root, library, book, index)
    }

    func testSavingRejectsAnIndexForAnotherBookWithoutOverwritingSavedState() async throws {
        let (root, library, book, index) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        try await library.saveState(state, bookID: book.id)
        _ = try await library.books()
        var unrelated = book
        unrelated.id = String(repeating: "a", count: 64)
        try Disk.write(unrelated, to: index)
        state.anchor = nil
        do { try await library.saveState(state, bookID: book.id); XCTFail("Mismatched package identity must not authorize state writes") }
        catch { }
        let saved = try await library.state(book.id)
        XCTAssertNotNil(saved.anchor)
    }

    func testAtomicSameSizeSameDateReplacementInvalidatesCacheByFileNumber() async throws {
        let (root, library, book, index) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        try await library.saveState(state, bookID: book.id)
        _ = try await library.books()
        let before = try FileManager.default.attributesOfItem(atPath: index.path)
        var changed = book
        let oldID = changed.chapters[0].passages[0].id
        changed.chapters[0].passages[0].id = String(repeating: "z", count: oldID.count)
        try Disk.write(changed, to: index)
        try FileManager.default.setAttributes([.modificationDate: try XCTUnwrap(before[.modificationDate])], ofItemAtPath: index.path)
        let after = try FileManager.default.attributesOfItem(atPath: index.path)
        XCTAssertEqual((before[.size] as? NSNumber)?.int64Value, (after[.size] as? NSNumber)?.int64Value)
        XCTAssertNotEqual((before[.systemFileNumber] as? NSNumber)?.uint64Value, (after[.systemFileNumber] as? NSNumber)?.uint64Value)
        do { try await library.saveState(state, bookID: book.id); XCTFail("The old anchor must not survive a replacement index") }
        catch { }
        state.anchor = ReadingAnchor(chapterID: changed.chapters[0].id, passageID: changed.chapters[0].passages[0].id)
        try await library.saveState(state, bookID: book.id)
        let saved = try await library.state(book.id)
        XCTAssertEqual(saved.anchor, state.anchor)
    }

    func testDamagedIndexDoesNotFallBackToPreviouslyListedBook() async throws {
        let (root, library, book, index) = try await fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try await library.books()
        try Data("{broken".utf8).write(to: index, options: .atomic)
        do { try await library.saveState(ReaderState(), bookID: book.id); XCTFail("Damaged indexes must not be hidden by cached data") }
        catch { }
        let listed = try await library.books()
        XCTAssertTrue(try XCTUnwrap(listed.first).chapters.isEmpty)
    }
}
