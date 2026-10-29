import XCTest
@testable import LeafhourCore

final class CloudSyncTests: XCTestCase {
    private let owner = "11111111-1111-4111-8111-111111111111"
    private let other = "22222222-2222-4222-8222-222222222222"
    private var roots: [URL] = []
    override func tearDown() {
        for root in roots { try? FileManager.default.removeItem(at: root) }
        roots = []; CloudMockProtocol.handler = nil
        super.tearDown()
    }
    private func library(_ account: String? = nil) throws -> OfflineLibrary {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        roots.append(root)
        return try OfflineLibrary(root: root, scope: account.map { .account(UUID(uuidString: $0)!) } ?? .device)
    }
    private func client() -> CloudLibraryClient {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [CloudMockProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: "reader@example.invalid"), token: "isolated-fixture-session"), configuration: configuration)
    }
    private func fixtureCopy() throws -> CloudReadingCopy {
        let identity = CloudBookIdentity(ownerID: owner, bookID: "book-one", contentVersion: "version-one", sourceFormat: "md")
        let sections: [CloudJSON] = [.object(["chapterId": .string("chapter-one"), "paragraphs": .array([.object(["id": .string("passage-one"), "original": .string("A quiet page for reading."), "translations": .object([:])])])])]
        return CloudReadingCopy(identity: identity, title: "Quiet book", author: "Author", chapters: [BookChapter(id: "chapter-one", title: "One", sourcePath: "chapter-one", passages: [Passage(id: "passage-one", text: "A quiet page for reading.")])], content: try CloudJSON.encode(["bookId": .string("book-one"), "contentVersion": .string("version-one"), "sections": .array(sections)]))
    }
    private func records(notes: [CloudJSON] = [], position: CloudJSON = .null) throws -> Data {
        try CloudJSON.encode(["bookId": .string("book-one"), "contentVersion": .string("version-one"), "comments": .array(notes), "questions": .array([]), "position": position])
    }
    private func note(_ text: String, deleted: Bool = false) -> CloudJSON {
        .object(["id": .string("web-note"), "origin": .string("user"), "passageId": .string("passage-one"), "text": .string(text), "quote": .string("quiet page"), "deletedAt": deleted ? .string("2026-10-29T01:00:00.000Z") : .null])
    }
    func testCloudCopiesCannotEnterDeviceOrOtherAccount() async throws {
        let device = try library(), another = try library(other), value = try fixtureCopy()
        do { _ = try await device.importCloud(value); XCTFail("Device scope accepted private account content") } catch {}
        do { _ = try await another.importCloud(value); XCTFail("Wrong owner accepted private account content") } catch {}
        let own = try library(owner), book = try await own.importCloud(value)
        XCTAssertEqual(book.cloud?.ownerID, owner)
        XCTAssertEqual(book.chapters[0].passages[0].id, "passage-one")
        let verified = try await own.verify(book.id)
        XCTAssertTrue(verified)
    }
    func testClientFencesWrongOwnerBeforeNetwork() async throws {
        CloudMockProtocol.handler = { _ in XCTFail("Wrong owner reached network"); return (200, Data("{}".utf8)) }
        do { _ = try await client().data(path: "/api/library", ownerID: other); XCTFail("Expected owner refusal") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
    }
    func testClientSuppliesOwnOriginAndOwnerAndPrivateCookie() async throws {
        CloudMockProtocol.handler = { [owner] request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://fixture.invalid")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "marginalia_session=isolated-fixture-session")
            return (200, Data("{}".utf8))
        }
        _ = try await client().data(path: "/api/library", ownerID: owner)
    }
    func testLateAccountResponseIsRejectedAfterSignOut() async throws {
        let client = client(), received = expectation(description: "Old account request started")
        let release = DispatchSemaphore(value: 0)
        CloudMockProtocol.handler = { request in
            if request.url!.path == "/api/library" {
                received.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            }
            return (200, Data("{}".utf8))
        }
        let read = Task { try await client.data(path: "/api/library", ownerID: owner) }
        await fulfillment(of: [received], timeout: 3)
        let logout = Task { await client.signOut() }
        try await Task.sleep(for: .milliseconds(80))
        let account = await client.activeAccount()
        XCTAssertNil(account)
        release.signal()
        do { _ = try await read.value; XCTFail("Stale account response escaped the generation fence") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
        await logout.value
    }
    func testFailedNoteUploadRemainsPendingAndRetryUsesSameID() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), client = client(), sync = CloudBookSync(client: client, library: library)
        var state = ReaderState()
        let note = ReaderNote(anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one"), quote: "quiet page", body: "My thought")
        state.notes = [note]; try await library.saveState(state, bookID: book.id)
        let records = try records()
        CloudMockProtocol.handler = { request in request.httpMethod == "POST" ? (503, Data("{}".utf8)) : (200, records) }
        try await sync.synchronize(book.id)
        let pending = try await library.cloudMetadata(book.id)
        XCTAssertNil(pending.syncedNotes[note.id.uuidString])
        XCTAssertNotNil(pending.noteErrors[note.id.uuidString])
        let assertionValue1 = try await library.state(book.id).notes
        XCTAssertEqual(assertionValue1, [note])
        CloudMockProtocol.handler = { request in
            if request.httpMethod == "POST" {
                let bytes = try Self.body(request), value = try CloudJSON.decode(bytes)
                XCTAssertEqual(value["id"].string, note.id.uuidString.lowercased())
                return (201, Data("{}".utf8))
            }
            return (200, records)
        }
        try await sync.synchronize(book.id)
        let assertionValue2 = try await library.cloudMetadata(book.id).syncedNotes[note.id.uuidString]
        XCTAssertEqual(assertionValue2, note.id.uuidString.lowercased())
    }
    func testRemoteNoteEditAndDeletionReachUnmodifiedLocalCopy() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        var response = try records(notes: [note("First thought")])
        CloudMockProtocol.handler = { _ in (200, response) }
        try await sync.synchronize(book.id)
        let assertionValue3 = try await library.state(book.id).notes.first?.body
        XCTAssertEqual(assertionValue3, "First thought")
        response = try records(notes: [note("Edited on web")]); try await sync.synchronize(book.id)
        let assertionValue4 = try await library.state(book.id).notes.first?.body
        XCTAssertEqual(assertionValue4, "Edited on web")
        response = try records(notes: [note("Edited on web", deleted: true)]); try await sync.synchronize(book.id)
        let assertionValue5 = try await library.state(book.id).notes.isEmpty
        XCTAssertTrue(assertionValue5)
    }
    func testOversizeNoteDoesNotBlockOtherNotesOrProgress() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let anchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2)
        let long = ReaderNote(anchor: anchor, quote: "quiet page", body: String(repeating: "🌿", count: 1001))
        let short = ReaderNote(anchor: anchor, quote: String(repeating: "q", count: 4001), body: "A bounded thought")
        var state = ReaderState(); state.notes = [long, short]; state.anchor = anchor
        try await library.saveState(state, bookID: book.id)
        let empty = try records()
        CloudMockProtocol.handler = { request in
            if request.httpMethod == "POST" {
                let value = try CloudJSON.decode(Self.body(request))
                if request.url!.path.hasSuffix("comments") {
                    XCTAssertEqual(value["text"].string, short.body)
                    XCTAssertEqual(value["quote"], .null)
                    return (201, Data("{}".utf8))
                }
                XCTAssertTrue(request.url!.path.hasSuffix("progress"))
                return (200, Data("{\"revision\":1}".utf8))
            }
            return (200, empty)
        }
        try await sync.synchronize(book.id)
        let metadata = try await library.cloudMetadata(book.id)
        XCTAssertNil(metadata.syncedNotes[long.id.uuidString])
        XCTAssertNotNil(metadata.noteErrors[long.id.uuidString])
        XCTAssertNotNil(metadata.syncedNotes[short.id.uuidString])
        XCTAssertEqual(metadata.positionRevision, 1)
        let saved = try await library.state(book.id)
        XCTAssertEqual(saved.notes, [long, short])
    }
    func testConcurrentNoteEditKeepsLocalVersionAndReportsConflict() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        var response = try records(notes: [note("Baseline")])
        CloudMockProtocol.handler = { _ in (200, response) }
        try await sync.synchronize(book.id)
        var state = try await library.state(book.id); state.notes[0].body = "Local edit"; try await library.saveState(state, bookID: book.id)
        response = try records(notes: [note("Web edit")]); try await sync.synchronize(book.id)
        let assertionValue6 = try await library.state(book.id).notes.first?.body
        XCTAssertEqual(assertionValue6, "Local edit")
        let assertionValue7 = try await library.cloudMetadata(book.id).noteConflict
        XCTAssertTrue(assertionValue7)
    }
    func testChangedCloudPositionDoesNotSilentlyOverwriteDevice() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        var state = ReaderState(); state.anchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 8)
        try await library.saveState(state, bookID: book.id)
        let remote = try records(position: .object(["chapterId": .string("chapter-one"), "passageId": .string("passage-one"), "withinParagraph": .number(0.8), "revision": .number(4)]))
        CloudMockProtocol.handler = { request in XCTAssertEqual(request.httpMethod, "GET"); return (200, remote) }
        try await sync.synchronize(book.id)
        let assertionValue8 = try await library.state(book.id).anchor
        XCTAssertEqual(assertionValue8, state.anchor)
        let assertionValue9 = try await library.cloudMetadata(book.id).positionConflict
        XCTAssertTrue(assertionValue9)
        try await sync.resolvePosition(book.id, useDevice: false)
        let assertionValue10 = try await library.state(book.id).anchor
        XCTAssertNotEqual(assertionValue10, state.anchor)
    }
    func testTranslationCacheRetainsManifestIntegrityAndPrivateState() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy())
        var state = ReaderState(); state.notes = [ReaderNote(anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one"), quote: "quiet page", body: "Keep this thought")]
        try await library.saveState(state, bookID: book.id)
        try await library.cacheCloudPassage(.object(["id": .string("passage-one"), "original": .string("A quiet page for reading."), "translations": .object(["literal": .object(["text": .string("一页安静的阅读时光。"), "status": .string("draft")])])]), bookID: book.id)
        let assertionValue11 = try await library.verify(book.id)
        XCTAssertTrue(assertionValue11)
        let assertionValue12 = try await library.state(book.id)
        XCTAssertEqual(assertionValue12, state)
        let directory = try await library.bookDirectory(book.id)
        let cached = try CloudJSON.decode(Data(contentsOf: directory.appendingPathComponent("cloud-content.json")))
        XCTAssertEqual(cached["sections"].array[0]["paragraphs"].array[0]["translations"]["literal"]["text"].string, "一页安静的阅读时光。")
    }
    func testOpeningWaitsForExistingPullBeforeSavingReaderEdits() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let received = expectation(description: "First pull captured the old disk state")
        let openingStarted = expectation(description: "Second caller starts opening")
        let release = DispatchSemaphore(value: 0)
        let response = try records(notes: [note("Web thought")])
        CloudMockProtocol.handler = { _ in
            received.fulfill()
            guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            return (200, response)
        }
        let first = Task { try await sync.synchronize(book.id) }
        await fulfillment(of: [received], timeout: 3)
        let localNote = ReaderNote(anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one"), quote: "quiet page", body: "Written after opening")
        let opening = Task {
            openingStarted.fulfill()
            try await sync.synchronize(book.id)
            var state = try await library.state(book.id)
            state.notes.append(localNote)
            try await library.saveState(state, bookID: book.id)
        }
        await fulfillment(of: [openingStarted], timeout: 3)
        // Give the old skip-on-running implementation a chance to write too early.
        try await Task.sleep(for: .milliseconds(80))
        release.signal()
        try await first.value; try await opening.value
        let state = try await library.state(book.id)
        XCTAssertTrue(state.notes.contains(localNote))
        XCTAssertTrue(state.notes.contains(where: { $0.body == "Web thought" }))
    }
    func testDownloadRejectsDuplicateParagraphIDs() async throws {
        let manifest = try CloudJSON.encode(["bookId": .string("book-one"), "contentVersion": .string("version-one"), "chapters": .array([.object(["id": .string("chapter-one"), "title": .string("One")])])])
        let passage = CloudJSON.object(["id": .string("duplicate"), "original": .string("Text")])
        let chapter = try CloudJSON.encode(["bookId": .string("book-one"), "contentVersion": .string("version-one"), "chapterId": .string("chapter-one"), "sections": .array([.object(["chapterId": .string("chapter-one"), "paragraphs": .array([passage, passage])])])])
        CloudMockProtocol.handler = { request in (200, request.url!.path.hasSuffix("reading-manifest") ? manifest : chapter) }
        do { _ = try await client().downloadReadingCopy(CloudShelfBook(id: "book-one", title: "Book", author: "", contentVersion: "version-one"), ownerID: owner); XCTFail("Duplicate IDs accepted") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
    }
    private static func body(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(buffer, count: count) }
        return data
    }
}

private final class CloudMockProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
            let (status, bytes) = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
