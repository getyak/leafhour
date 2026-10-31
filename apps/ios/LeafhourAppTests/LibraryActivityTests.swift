import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class LibraryActivityTests: XCTestCase {
    private struct HistoryFixture {
        let model: LibraryModel
        let library: OfflineLibrary
        let source: LocalBook
        let target: LocalBook
        let rows: [ReadingTimeSnapshot]
        let original: Data
        let state: ReaderState
        let probe: HistoryUploadProbe
    }
    private func historyUploadFixture() async throws -> HistoryFixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner = "00000000-0000-4000-8000-000000000344"
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { HistoryUploadProtocol.install(nil); try? FileManager.default.removeItem(at: root) }
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [HistoryUploadProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-history-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://history.leafhour.test")!, credential: credential, configuration: configuration)
        let model = LibraryModel(root: root.appendingPathComponent("library"), cloud: cloud, credential: credential, monitorNetwork: false)
        let library = try XCTUnwrap(model.library)
        let original = Data("A unique invented paragraph for the upload history boundary.".utf8)
        let file = root.appendingPathComponent("Synthetic history.txt"); try original.write(to: file)
        let source = try await library.importFile(file)
        let sourceChapter = try XCTUnwrap(source.chapters.first), passage = try XCTUnwrap(sourceChapter.passages.first)
        let anchor = ReadingAnchor(chapterID: sourceChapter.id, passageID: passage.id)
        let chapters = try JSONDecoder().decode([BookChapter].self, from: JSONSerialization.data(withJSONObject: [["id": "remote-chapter", "title": "Synthetic chapter", "sourcePath": "remote-chapter", "passages": [["id": "remote-passage", "text": passage.text, "heading": false]]]]))
        let identity = CloudBookIdentity(ownerID: owner, bookID: "uploaded-history", contentVersion: "history-v1", sourceFormat: "txt")
        let content: [String: Any] = ["bookId": identity.bookID, "contentVersion": identity.contentVersion, "source": ["format": "txt"], "sections": [["chapterId": "remote-chapter", "paragraphs": [["id": "remote-passage", "original": passage.text, "translations": [:]]]]]]
        // Pre-existing verified copy exercises the real upload/migration path
        // without conflating this queue test with the separate download tests.
        let target = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic history", author: "", chapters: chapters, content: JSONSerialization.data(withJSONObject: content)))
        var rows: [ReadingTimeSnapshot] = []
        let base = Date(timeIntervalSince1970: 1_793_491_200)
        for index in 0..<25 {
            let started = base.addingTimeInterval(Double(index * 10))
            var clock = ReadingActivityClock()
            try clock.start(bookID: source.id, contentVersion: source.sourceVersion, anchor: anchor, timeZone: "UTC", at: started, id: String(format: "history-%02d", index))
            clock.tick(at: started.addingTimeInterval(2))
            let row = try XCTUnwrap(clock.finish(at: started.addingTimeInterval(2)))
            try await library.retainReadingTime(row, bookID: source.id); rows.append(row)
        }
        var state = try await library.state(source.id)
        state.anchor = anchor; state.lastActivityAt = rows.last?.endedAt
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: passage.text, body: "An unfinished synthetic draft stays with the source.")
        try await library.saveState(state, bookID: source.id)
        let probe = HistoryUploadProbe(owner: owner, library: library, targetID: target.id, original: original)
        HistoryUploadProtocol.install(probe)
        await model.reload()
        return HistoryFixture(model: model, library: library, source: source, target: target, rows: rows, original: original, state: state, probe: probe)
    }

    func testUploadingTwentyFiveLocalSessionsDrainsBeforeTheTwentyFirstAndKeepsTheSource() async throws {
        let fixture = try await historyUploadFixture()
        await fixture.model.upload(fixture.source)
        let accepted = await fixture.probe.successfulIDs
        XCTAssertEqual(accepted, fixture.rows.map(\.id))
        XCTAssertEqual(Set(accepted).count, 25, "Every stable session ID must be transferred once")
        let firstPending = await fixture.probe.firstSendPendingCount, firstRetained = await fixture.probe.firstSendRetainedCount
        XCTAssertEqual(firstPending, 20)
        XCTAssertEqual(firstRetained, 20, "The first drain must run before the twenty-first target entry is retained")
        let target = try await fixture.library.readingTimeLedger(bookID: fixture.target.id)
        XCTAssertTrue(target.pending.isEmpty)
        XCTAssertEqual(target.snapshots.map(\.id), fixture.rows.map(\.id))
        XCTAssertTrue(target.snapshots.allSatisfy { $0.bookId == "uploaded-history" && $0.contentVersion == "history-v1" })
        XCTAssertEqual(target.snapshots.map(\.segments), fixture.rows.map(\.segments))
        let source = try await fixture.library.readingTimeLedger(bookID: fixture.source.id)
        XCTAssertEqual(source.pending, fixture.rows)
        let state = try await fixture.library.state(fixture.source.id), originalURL = try await fixture.library.originalURL(fixture.source.id)
        XCTAssertEqual(state, fixture.state)
        XCTAssertEqual(try Data(contentsOf: originalURL), fixture.original)
        XCTAssertFalse(fixture.model.message?.contains("尚未完成") == true, fixture.model.message ?? "")
    }

    func testPartialHistoryBatchFailureRetainsPendingAndSourceThenRetriesStableIDs() async throws {
        let fixture = try await historyUploadFixture()
        await fixture.probe.failAfterSuccessfulWrites(10)
        await fixture.model.upload(fixture.source)
        let target = try await fixture.library.readingTimeLedger(bookID: fixture.target.id)
        XCTAssertEqual(target.pending.map(\.id), Array(fixture.rows.dropFirst(10)).map(\.id))
        XCTAssertEqual(target.snapshots.count, 25)
        let source = try await fixture.library.readingTimeLedger(bookID: fixture.source.id)
        XCTAssertEqual(source.pending, fixture.rows)
        let preservedState = try await fixture.library.state(fixture.source.id)
        XCTAssertEqual(preservedState, fixture.state)
        XCTAssertTrue(fixture.model.message?.contains("阅读时段待同步") == true, fixture.model.message ?? "No pending-history message")
        await fixture.probe.failAfterSuccessfulWrites(nil)
        await fixture.model.upload(fixture.source)
        let accepted = await fixture.probe.successfulIDs
        XCTAssertEqual(accepted, fixture.rows.map(\.id), "A partial retry must reuse stable IDs without re-uploading acknowledged rows")
        let completed = try await fixture.library.readingTimeLedger(bookID: fixture.target.id)
        XCTAssertTrue(completed.pending.isEmpty)
        let preservedRows = try await fixture.library.readingTimeLedger(bookID: fixture.source.id).pending
        let originalURL = try await fixture.library.originalURL(fixture.source.id)
        XCTAssertEqual(preservedRows, fixture.rows)
        XCTAssertEqual(try Data(contentsOf: originalURL), fixture.original)
    }
    func testCompleteAccountSnapshotKeepsArchivedPinsStatusAndCloudOnlyRecentOffline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner = "00000000-0000-4000-8000-000000000344"
        addTeardownBlock { try? FileManager.default.removeItem(at: root); ActivityURLProtocol.respond = nil }
        let wire: [String: Any] = [
            "kind": "leafhour-account-shelf-v1", "user": ["id": owner], "shelfRevision": 4,
            "shelf": ["revision": 4, "order": ["recent"], "archived": ["hidden": "2026-11-01T10:00:00Z"], "pinned": ["recent"], "pinsInitialized": true],
            "books": [["bookId": "recent", "contentVersion": "v1", "title": "Read on another device", "readingStateReady": true, "journey": ["status": "finished"], "lastReadAt": "2026-11-01T11:00:00Z", "resume": ["chapterId": "c1", "passageId": "p1", "label": "A saved chapter", "observedAt": "2026-11-01T11:00:00Z"]]],
            "archivedBooks": [["bookId": "hidden", "contentVersion": "v1", "title": "Hidden book"]]
        ]
        ActivityURLProtocol.respond = { _ in (0, wire) }
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ActivityURLProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://leafhour.test")!, credential: credential, configuration: configuration)
        let model = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        await model.synchronize()
        XCTAssertEqual(model.accountShelf?.archivedBookIDs, ["hidden"])
        XCTAssertEqual(model.accountShelf?.pinnedBookIDs, ["recent"])
        XCTAssertEqual(model.cloudBooks.first?.readingStatus, .finished)
        XCTAssertEqual(model.recentShelfItem?.id, "cloud:recent")
        XCTAssertNil(model.recentShelfItem?.local)
        XCTAssertNil(model.reader, "Refreshing account metadata must not auto-download or open a book")
        ActivityURLProtocol.respond = nil
        let offline = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        await offline.reload(restore: true)
        XCTAssertEqual(offline.accountShelf, model.accountShelf)
        XCTAssertEqual(offline.recentShelfItem?.cloud?.resume?.label, "A saved chapter")
        XCTAssertNil(offline.reader, "Account cold restoration must retain an explicit continuation choice")
    }
    func testShelfReloadKeepsRemoteCoverMetadataOffline() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner="00000000-0000-4000-8000-000000000344", path="/book-covers/alice-640.webp?v=abc123"
        addTeardownBlock { try? FileManager.default.removeItem(at:root);ActivityURLProtocol.respond=nil }
        ActivityURLProtocol.respond = { _ in (0,["user":["id":owner],"books":[["bookId":"alice","title":"Alice","author":"Carroll","contentVersion":"v1","coverImage":path]]]) }
        let configuration=URLSessionConfiguration.ephemeral;configuration.protocolClasses=[ActivityURLProtocol.self]
        let credential=CloudCredential(account:CloudAccount(id:owner,email:nil),token:"isolated-fixture")
        let cloud=CloudLibraryClient(baseURL:URL(string:"https://leafhour.test")!,credential:credential,configuration:configuration)
        let model=LibraryModel(root:root,cloud:cloud,credential:credential,monitorNetwork:false)
        await model.synchronize();await model.reload()
        XCTAssertEqual(model.cloudBooks.first?.coverPath,path,"A successful sync and its reload must retain the actual remote artwork URL")
    }

    func testShelfSyncPersistsAdditionDatesForOfflineReloadWithoutInventingLegacyDates() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner = "00000000-0000-4000-8000-000000000344"
        let timestamp = "2026-10-31T00:30:00.125Z"
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expected = try XCTUnwrap(formatter.date(from: timestamp))
        addTeardownBlock { try? FileManager.default.removeItem(at: root); ActivityURLProtocol.respond = nil }
        ActivityURLProtocol.respond = { _ in
            (0, ["user": ["id": owner], "books": [
                ["bookId": "legacy", "title": "Legacy cache", "author": "", "contentVersion": "v1"],
                ["bookId": "new", "title": "New arrival", "author": "", "contentVersion": "v1", "addedAt": timestamp]
            ]])
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ActivityURLProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://leafhour.test")!, credential: credential, configuration: configuration)
        let model = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        await model.synchronize()

        let library = try XCTUnwrap(model.library)
        let data = try await library.cloudView("shelf")
        let cached = try CloudShelfSnapshot(cacheData: XCTUnwrap(data), ownerID: owner)
        XCTAssertEqual(cached.books.last?.addedAt, expected)
        XCTAssertNil(cached.books.first?.addedAt)

        let reloaded = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        await reloaded.reload()
        XCTAssertEqual(reloaded.cloudBooks.last?.addedAt, expected)
        XCTAssertNil(reloaded.cloudBooks.first?.addedAt)
        XCTAssertEqual(LibraryPresentation.items(local: [], cloud: reloaded.cloudBooks).map(\.id), ["cloud:new", "cloud:legacy"])

        let other = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: "00000000-0000-4000-8000-000000000345")!))
        let otherCache = try await other.cloudView("shelf")
        XCTAssertNil(otherCache, "Shelf metadata must remain in its original account's offline space")
    }

    func testCancellingCloudDownloadDoesNotPublishIncompleteBookOrShowAnError() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root); ActivityURLProtocol.respond = nil }
        let owner = "00000000-0000-4000-8000-000000000317"
        let chapterStarted = expectation(description: "chapter request started")
        ActivityURLProtocol.respond = { request in
            let path = request.url!.path
            if path == "/api/auth/session" { return (0, ["user": ["id": owner]]) }
            if path.hasSuffix("reading-manifest") {
                return (0, ["bookId": "quiet-book", "contentVersion": "v1", "title": "A Quiet Book", "chapters": [["id": "c1", "title": "One"]]])
            }
            if path.contains("/chapters/") {
                chapterStarted.fulfill()
                return (0.3, ["bookId": "quiet-book", "contentVersion": "v1", "chapterId": "c1", "sections": [["chapterId": "c1", "paragraphs": [["id": "p1", "original": "An isolated acceptance passage."]]]]])
            }
            if path == "/api/library" { return (0, ["user": ["id": owner], "books": []]) }
            return (0, ["bookId": "quiet-book", "contentVersion": "v1", "comments": [], "questions": []])
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ActivityURLProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://leafhour.test")!, credential: credential, configuration: configuration)
        let model = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        let work = Task { await model.download(CloudShelfBook(id: "quiet-book", title: "A Quiet Book", author: "", contentVersion: "v1"), openAfter: false) }
        await fulfillment(of: [chapterStarted], timeout: 5)
        model.cancelImport()
        await work.value
        XCTAssertTrue(model.books.isEmpty, "A cancelled partial download must never become an offline book")
        XCTAssertNil(model.message, "User cancellation should not become a failure alert")
        XCTAssertTrue(model.status.contains("取消"))
        XCTAssertFalse(model.busy)
    }
}

private actor HistoryUploadProbe {
    let owner: String
    let library: OfflineLibrary
    let targetID: String
    let original: Data
    private var position: [String: Any] = [:]
    private var failureThreshold: Int?
    private(set) var successfulIDs: [String] = []
    private(set) var firstSendPendingCount: Int?
    private(set) var firstSendRetainedCount: Int?
    init(owner: String, library: OfflineLibrary, targetID: String, original: Data) { self.owner = owner; self.library = library; self.targetID = targetID; self.original = original }
    func failAfterSuccessfulWrites(_ count: Int?) { failureThreshold = count }
    func handle(_ request: URLRequest) async throws -> (Int, Data) {
        let path = request.url!.path
        func reply(_ status: Int, _ value: [String: Any]) throws -> (Int, Data) { (status, try JSONSerialization.data(withJSONObject: value)) }
        if path == "/api/auth/session" { return try reply(200, ["user": ["id": owner]]) }
        guard request.value(forHTTPHeaderField: "X-Reader-Owner") == owner else { return try reply(403, ["error": "Synthetic owner mismatch"]) }
        if path == "/api/library/upload/start" { return try reply(404, ["error": "Use the isolated legacy upload fixture"]) }
        let body = Self.requestBody(request)
        if path == "/api/library/upload" {
            let value = try JSONSerialization.jsonObject(with: body) as! [String: Any]
            guard let base64 = value["base64"] as? String, Data(base64Encoded: base64) == original else { return try reply(400, ["error": "Synthetic original changed"]) }
            return try reply(200, ["bookId": "uploaded-history", "contentVersion": "history-v1"])
        }
        if path == "/api/library" {
            return try reply(200, ["kind": "leafhour-account-shelf-v1", "user": ["id": owner], "shelfRevision": 0,
                "shelf": ["revision": 0, "order": [], "archived": [:], "pinned": [], "pinsInitialized": true],
                "books": [["bookId": "uploaded-history", "contentVersion": "history-v1", "title": "Synthetic history", "readingStateReady": true]], "archivedBooks": []])
        }
        if path.hasSuffix("/reading-sessions") {
            let row = try ReadingTimeSnapshot(wireData: body)
            guard row.bookId == "uploaded-history", row.contentVersion == "history-v1" else { return try reply(409, ["error": "Synthetic version mismatch"]) }
            if firstSendPendingCount == nil {
                let ledger = try await library.readingTimeLedger(bookID: targetID)
                firstSendPendingCount = ledger.pending.count; firstSendRetainedCount = ledger.snapshots.count
            }
            if let threshold = failureThreshold, successfulIDs.count >= threshold { return try reply(503, ["error": "Synthetic batch interruption"]) }
            successfulIDs.append(row.id)
            return (201, body)
        }
        if path.hasSuffix("/records") {
            return try reply(200, ["bookId": "uploaded-history", "contentVersion": "history-v1", "comments": [], "questions": [], "position": position.isEmpty ? NSNull() : position])
        }
        if path.hasSuffix("/progress") {
            var value = try JSONSerialization.jsonObject(with: body) as! [String: Any]
            value.removeValue(forKey: "baseRevision"); value["revision"] = (position["revision"] as? Int ?? 0) + 1
            position = value; return try reply(200, value)
        }
        return try reply(404, ["error": "Unexpected synthetic route: " + path])
    }
    private static func requestBody(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        return data
    }
}

private final class HistoryUploadProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var probe: HistoryUploadProbe?
    private var work: Task<Void, Never>?
    static func install(_ value: HistoryUploadProbe?) { lock.lock(); probe = value; lock.unlock() }
    private static func current() -> HistoryUploadProbe? { lock.lock(); defer { lock.unlock() }; return probe }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let probe = Self.current() else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return }
        work = Task {
            do {
                let (status, bytes) = try await probe.handle(request)
                guard !Task.isCancelled else { return }
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { work?.cancel() }
}

private final class ActivityURLProtocol: URLProtocol, @unchecked Sendable {
    static var respond: ((URLRequest) -> (TimeInterval, [String: Any]))?
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let respond = Self.respond else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return }
        let (delay, json) = respond(request)
        let bytes = try! JSONSerialization.data(withJSONObject: json)
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [self] in
            lock.lock(); defer { lock.unlock() }
            guard !stopped else { return }
            let status = request.url!.path.hasSuffix("/native-copy") ? 404 : 200
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}
