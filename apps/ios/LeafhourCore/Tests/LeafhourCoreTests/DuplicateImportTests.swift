import XCTest
@testable import LeafhourCore

final class DuplicateImportTests: XCTestCase {
    func testDamagedCanonicalAllowsIndependentCopyAndHealthyCopyRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.txt")
        try Data("Valid external original.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root, scope: .device)
        let canonical = try await library.importFile(source)
        let damagedSource = try await library.originalURL(canonical.id)
        try Data("damaged installed source".utf8).write(to: damagedSource)
        let match = try await library.duplicate(for: source)
        XCTAssertEqual(match?.id, canonical.id, "Discovery does not claim package integrity")
        do { _ = try await library.importFile(source, duplicatePolicy: .keep); XCTFail("Keep must verify") } catch {}
        let operation = UUID(), copy = try await library.importFile(source, duplicatePolicy: .new, operationID: operation)
        let reopened = try OfflineLibrary(root: root, scope: .device)
        let retry = try await reopened.importFile(source, duplicatePolicy: .new, operationID: operation)
        XCTAssertEqual(copy.id, retry.id)
        XCTAssertNotEqual(copy.id, canonical.id)
        let verified = try await reopened.verify(copy.id)
        XCTAssertTrue(verified)
        do { _ = try await reopened.verify(canonical.id); XCTFail("Canonical damage must remain explicit") } catch {}
    }

    func testUploadIntentFreezesPolicyAndReceiptAcrossReopen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.txt")
        try Data("Upload recovery source.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root, scope: .device), book = try await library.importFile(source)
        let first = try await library.beginUpload(book.id, ownerID: "owner", sourceVersion: book.sourceVersion, policy: .new)
        let reopened = try OfflineLibrary(root: root, scope: .device)
        let retry = try await reopened.beginUpload(book.id, ownerID: "owner", sourceVersion: book.sourceVersion, policy: .replace)
        XCTAssertEqual(first, retry)
        do { _ = try await reopened.pendingUpload(book.id, ownerID: "another-owner", sourceVersion: book.sourceVersion); XCTFail("Owner mismatch") } catch {}
        let receipt = try await reopened.retainUploadReceipt(retry, localBookID: book.id, bookID: "remote-copy", contentVersion: "v1")
        let recovered = try await library.pendingUpload(book.id, ownerID: "owner", sourceVersion: book.sourceVersion)
        XCTAssertEqual(recovered, receipt)
        try await reopened.finishUpload(receipt, localBookID: book.id)
        let next = try await library.beginUpload(book.id, ownerID: "owner", sourceVersion: book.sourceVersion, policy: .new)
        XCTAssertNotEqual(next.operationID, first.operationID)
    }

    func testChoicesKeepIdentityButNewCopyHasIndependentDurableStateAndSourceIntegrity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("book.txt")
        try Data("Original text.\n\nSecond paragraph.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root, scope: .device)
        let first = try await library.importFile(source)
        var state = ReaderState(); state.anchor = ReadingAnchor(chapterID: first.chapters[0].id, passageID: first.chapters[0].passages[0].id)
        try await library.saveState(state, bookID: first.id)
        let kept = try await library.importFile(source, duplicatePolicy: .keep)
        let replaced = try await library.importFile(source, duplicatePolicy: .replace)
        XCTAssertEqual(first.id, kept.id); XCTAssertEqual(first.id, replaced.id)
        let operation = UUID(), copy = try await library.importFile(source, duplicatePolicy: .new, operationID: operation)
        XCTAssertNotEqual(first.id, copy.id); XCTAssertEqual(copy.sourceVersion, first.sourceVersion)
        let reopened = try OfflineLibrary(root: root, scope: .device)
        let retry = try await reopened.importFile(source, duplicatePolicy: .new, operationID: operation)
        XCTAssertEqual(retry.id, copy.id)
        let copyState = try await reopened.state(copy.id), originalState = try await reopened.state(first.id)
        XCTAssertNil(copyState.anchor); XCTAssertEqual(originalState.anchor, state.anchor)
        let repaired = try await reopened.repair(copy.id)
        XCTAssertEqual(repaired.id, copy.id)
        let original = try await reopened.originalURL(copy.id)
        XCTAssertEqual(try Data(contentsOf: original), try Data(contentsOf: source))
        try Data("corrupt".utf8).write(to: original)
        do { _ = try await reopened.verify(copy.id); XCTFail("tampering must fail") } catch {}
    }
}
