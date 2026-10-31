import XCTest
@testable import LeafhourCore

final class AccountShelfTests: XCTestCase {
    let owner = "b323d184-ce41-4e97-a378-17b107c0fdbb"
    override func tearDown() { CloudMockProtocol.handler = nil; super.tearDown() }
    func testAuthoritativeSnapshotRetainsPersonalMetadataThroughCache() throws {
        let data = Data(#"{"kind":"leafhour-account-shelf-v1","user":{"id":"b323d184-ce41-4e97-a378-17b107c0fdbb"},"shelfRevision":4,"shelf":{"revision":4,"order":["b","a"],"archived":{"hidden":"2026-11-01T10:00:00Z"},"pinned":["a"],"pinsInitialized":true},"books":[{"bookId":"a","contentVersion":"v1","title":"A","readingStateReady":true,"shelfPosition":1,"pinned":true,"resume":{"chapterId":"c","passageId":"p","revision":2,"observedAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T12:00:00Z","label":"First chapter"},"journey":{"status":"reading","lastReadAt":"2026-11-01T09:00:00Z"},"lastReadAt":"2026-11-01T10:00:00Z"}],"archivedBooks":[{"bookId":"hidden","contentVersion":"v1","title":"Hidden"}] }"#.utf8)
        let snapshot = try CloudShelfSnapshot(json: CloudJSON.decode(data), ownerID: owner)
        let restored = try CloudShelfSnapshot(cacheData: snapshot.cacheData(), ownerID: owner)
        XCTAssertEqual(restored, snapshot)
        XCTAssertTrue(restored.isAuthoritative)
        XCTAssertEqual(restored.order, ["b", "a"])
        XCTAssertEqual(restored.archivedBookIDs, ["hidden"])
        XCTAssertEqual(restored.pinnedBookIDs, ["a"])
        XCTAssertEqual(restored.books.first?.resume?.label, "First chapter")
        XCTAssertEqual(restored.books.first?.readingStatus, .reading)
        XCTAssertEqual(restored.books.first?.shelfPosition, 1)
        XCTAssertThrowsError(try CloudShelfSnapshot(cacheData: snapshot.cacheData(), ownerID: UUID().uuidString))
    }
    func testLegacyCachesAreReadableButCannotAuthorizeArchive() throws {
        let snapshot = try CloudShelfSnapshot(cacheData: Data(#"{"books":[{"bookId":"a","contentVersion":"v1","title":"A"}]}"#.utf8), ownerID: owner)
        XCTAssertFalse(snapshot.isAuthoritative)
        XCTAssertTrue(snapshot.archivedBookIDs.isEmpty)
        XCTAssertEqual(snapshot.books.first?.readingStatus, .pending)
        XCTAssertThrowsError(try CloudShelfSnapshot(json: CloudJSON.decode(Data(#"{"user":{"id":"other"},"books":[]}"#.utf8)), ownerID: owner))
    }
    func testActualPositionActivityCompetesWithSessionAndNeverReceiptTime() throws {
        let row = try CloudJSON.decode(Data(#"{"bookId":"a","contentVersion":"v1","title":"A","readingStateReady":true,"resume":{"chapterId":"c","passageId":"p","observedAt":"2026-11-01T09:30:00+01:00","updatedAt":"2026-11-01T23:00:00Z"},"journey":{"status":"reading","lastReadAt":"2026-11-01T09:00:00Z"}}"#.utf8))
        let book = try XCTUnwrap(CloudShelfBook(json: row))
        XCTAssertEqual(book.activityAt, ReadingRecency.date("2026-11-01T09:00:00Z"))
        XCTAssertNil(ReadingRecency.date("garbage"))
        XCTAssertEqual(ReadingRecency.latest([.init(id: "a", activityAt: book.activityAt), .init(id: "b", activityAt: ReadingRecency.date("2026-11-01T09:01:00Z"))])?.id, "b")
    }
    func testUntouchedReadyBookIsUnreadDespiteDefaultJourneyReading() throws {
        let row = try CloudJSON.decode(Data(#"{"bookId":"a","contentVersion":"v1","title":"A","readingStateReady":true,"journey":{"status":"reading"}}"#.utf8))
        XCTAssertEqual(CloudShelfBook(json: row)?.readingStatus, .unread)
    }
    func testActionReceiptRetainsNewerIntentAndConflictRequiresExplicitRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        let old = try await library.enqueueAccountAction(ownerID: owner, action: .pin(bookID: "a", pinned: true), baseRevision: 1)
        let newer = try await library.enqueueAccountAction(ownerID: owner, action: .pin(bookID: "a", pinned: false), baseRevision: 1)
        try await library.acknowledgeAccountAction(old, revision: 2)
        var pending = try await library.accountActions(ownerID: owner)
        XCTAssertEqual(pending.map(\.id), [newer.id])
        XCTAssertEqual(pending.first?.baseRevision, 2)
        try await library.failAccountAction(newer, conflict: true, message: "Changed elsewhere")
        pending = try await library.accountActions(ownerID: owner)
        XCTAssertTrue(try XCTUnwrap(pending.first).conflict)
        let reopened = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        let persisted = try await reopened.accountActions(ownerID: owner)
        XCTAssertEqual(persisted.first?.id, newer.id)
        XCTAssertTrue(try XCTUnwrap(persisted.first).conflict)
        try await reopened.retryAccountAction(newer.id, ownerID: owner, baseRevision: 8)
        let retried = try await reopened.accountActions(ownerID: owner)
        XCTAssertFalse(try XCTUnwrap(retried.first).conflict)
        XCTAssertEqual(retried.first?.baseRevision, 8)
        do { _ = try await reopened.accountActions(ownerID: UUID().uuidString); XCTFail("Wrong owner accepted") } catch {}
    }
    func testActionTransportRejectsReceiptsThatDoNotConfirmTheRequestedIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        let pending = try await library.enqueueAccountAction(ownerID: owner, action: .pin(bookID: "a", pinned: true), baseRevision: 1)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [CloudMockProtocol.self]
        let client = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture"), configuration: configuration)
        CloudMockProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/library/pins")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), self.owner)
            return (200, Data(#"{"revision":2,"pinned":[]}"#.utf8))
        }
        do { _ = try await client.performAccountAction(pending); XCTFail("Mismatched receipt accepted") } catch {}
        let retained = try await library.accountActions(ownerID: owner)
        XCTAssertEqual(retained.map(\.id), [pending.id])
        CloudMockProtocol.handler = { _ in (200, Data(#"{"revision":2,"pinned":["a"]}"#.utf8)) }
        let revision = try await client.performAccountAction(pending)
        XCTAssertEqual(revision, 2)
        try await library.acknowledgeAccountAction(pending, revision: revision)
        let final = try await library.accountActions(ownerID: owner)
        XCTAssertTrue(final.isEmpty)
    }
}
