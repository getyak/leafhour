import XCTest
@testable import LeafhourCore

final class LocalShelfArchiveTests: XCTestCase {
    func testRemovalAndRestoreRetainOriginalAndPersonalStateAcrossReopening() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("book.txt")
        try Data("Original paragraph\n\nAnother paragraph".utf8).write(to: source)
        let library = try OfflineLibrary(root: root, scope: .device)
        let book = try await library.importFile(source)
        var state = try await library.state(book.id)
        state.lastActivityAt = Date(timeIntervalSince1970: 42)
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "Original paragraph", body: "Personal note")]
        let draft = NoteDraft(anchor: anchor, quote: "Original paragraph", body: "Unfinished draft")
        state.drafts = [draft.id: draft]
        try await library.saveState(state, bookID: book.id)
        try await library.setLocalArchived([book.id], archived: true)
        let reopened = try OfflineLibrary(root: root, scope: .device)
        let removed = try await reopened.localArchivedBookIDs()
        XCTAssertEqual(removed, [book.id])
        let retained = try await reopened.state(book.id)
        XCTAssertEqual(retained, state)
        let original = try await reopened.originalURL(book.id)
        XCTAssertEqual(try Data(contentsOf: original), try Data(contentsOf: source))
        try await reopened.setLocalArchived([book.id], archived: false)
        let restored = try await reopened.localArchivedBookIDs()
        XCTAssertTrue(restored.isEmpty)
        let verified = try await reopened.verify(book.id)
        XCTAssertTrue(verified)
        let account = try OfflineLibrary(root: root, scope: .account(UUID()))
        let separate = try await account.localArchivedBookIDs()
        XCTAssertTrue(separate.isEmpty)
    }

    func testInvalidBatchDoesNotPartiallyRemoveBooks() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .device)
        let source = root.appendingPathComponent("valid.txt")
        try Data("Valid original text".utf8).write(to: source)
        let book = try await library.importFile(source)
        do { try await library.setLocalArchived([book.id, "../escape"], archived: true); XCTFail("Unsafe identity accepted") } catch {}
        let removed = try await library.localArchivedBookIDs()
        XCTAssertTrue(removed.isEmpty)
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
    }
    func testAccountArchiveRestoreQueueKeepsLatestIntentAndScope() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID()
        let library = try OfflineLibrary(root: root, scope: .account(owner))
        let archive = try await library.enqueueAccountAction(ownerID: owner.uuidString, action: .archive(bookID: "a"), baseRevision: 1)
        let restore = try await library.enqueueAccountAction(ownerID: owner.uuidString, action: .restore(bookID: "a"), baseRevision: 1)
        try await library.acknowledgeAccountAction(archive, revision: 2)
        let reopened = try OfflineLibrary(root: root, scope: .account(owner))
        let actions = try await reopened.accountActions(ownerID: owner.uuidString)
        XCTAssertEqual(actions.map(\.id), [restore.id])
        XCTAssertEqual(actions.first?.action, .restore(bookID: "a"))
        do { _ = try await reopened.accountActions(ownerID: UUID().uuidString); XCTFail("Wrong account accepted") } catch {}
    }

}
