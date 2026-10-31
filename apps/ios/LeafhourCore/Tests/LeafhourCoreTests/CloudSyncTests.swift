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
    func testTranslatedNotesAndReadingModeSyncTheirActualLayers() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let anchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one")
        var state = ReaderState(); state.anchor = anchor
        state.preferences.viewMode = .parallel; state.preferences.translationVariant = .interpretive
        state.notes = [ReaderNote(anchor: anchor, quote: "译文引句", body: "自己的想法", quoteOrigin: "translation", quoteVariant: "interpretive")]
        try await library.saveState(state, bookID: book.id)
        let empty = try records()
        CloudMockProtocol.handler = { request in
            guard request.httpMethod == "POST" else { return (200, empty) }
            let value = try CloudJSON.decode(Self.body(request))
            if request.url?.path.hasSuffix("comments") == true {
                XCTAssertEqual(value["quoteOrigin"].string, "translation"); XCTAssertEqual(value["quoteLanguage"].string, "zh")
                XCTAssertEqual(value["quoteVariant"].string, "interpretive")
            } else {
                XCTAssertEqual(value["mode"].string, "parallel"); XCTAssertEqual(value["variant"].string, "interpretive")
            }
            return (200, Data(#"{"revision":1}"#.utf8))
        }
        try await sync.synchronize(book.id)
    }
    func testOlderChapterRefreshDoesNotReplaceReviewedTranslation() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy())
        func row(_ text: String, status: String) -> CloudJSON {
            .object(["id":.string("passage-one"),"original":.string("A quiet page for reading."),"translations":.object(["literal":.object(["text":.string(text),"status":.string(status)]),"interpretive":.object(["text":.string("Independent meaning"),"status":.string(status)])])])
        }
        try await library.cacheCloudPassage(row("Reviewed wording", status: "reviewed"),bookID:book.id)
        try await library.cacheCloudPassages([row("Old draft",status:"draft")],bookID:book.id)
        let cached = try await library.readingTranslations(bookID:book.id)
        XCTAssertEqual(cached["passage-one"]?.literal,"Reviewed wording")
        XCTAssertEqual(cached["passage-one"]?.literalStatus,"reviewed")
    }
    func testChangingReadingModeAtTheSameAnchorStillSynchronizes() async throws {
        let library=try library(owner),book=try await library.importCloud(fixtureCopy()),sync=CloudBookSync(client:client(),library:library)
        let anchor=ReadingAnchor(chapterID:"chapter-one",passageID:"passage-one")
        var state=ReaderState();state.anchor=anchor;try await library.saveState(state,bookID:book.id)
        var revision=0,modes:[String]=[],variants:[String]=[]
        CloudMockProtocol.handler = { request in
            if request.httpMethod == "POST" {
                let value=try CloudJSON.decode(Self.body(request));revision += 1
                modes.append(value["mode"].string ?? "");variants.append(value["variant"].string ?? "")
                return (200,try CloudJSON.encode(["revision":.number(Double(revision))]))
            }
            return (200,try self.records(position:.object(["chapterId":.string(anchor.chapterID),"passageId":.string(anchor.passageID),"contentVersion":.string("version-one"),"withinParagraph":.number(0),"revision":.number(Double(revision))])))
        }
        try await sync.synchronize(book.id)
        state.preferences.viewMode = .parallel;state.preferences.translationVariant = .interpretive
        try await library.saveState(state,bookID:book.id);try await sync.synchronize(book.id)
        XCTAssertEqual(modes,["en","parallel"]);XCTAssertEqual(variants,["literal","interpretive"])
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
    func testCancelledCloudReplacementPreservesTheVerifiedCopyAndPersonalState() async throws {
        let library = try library(owner), copy = try fixtureCopy()
        let book = try await library.importCloud(copy)
        let passage = book.chapters[0].passages[0]
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: passage.id)
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: anchor, quote: passage.text, body: "A local thought to preserve.")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: passage.text, body: "An unfinished local thought.")
        try await library.saveState(state, bookID: book.id)
        let folder = try await library.bookDirectory(book.id)
        let originalContent = try Data(contentsOf: folder.appendingPathComponent("cloud-content.json"))
        var replacement = copy
        var changed = try CloudJSON.decode(copy.content).object
        changed["acceptanceReplacement"] = .bool(true)
        replacement.content = try CloudJSON.encode(changed)
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await library.importCloud(replacement, replaceExisting: true)
        }
        do { _ = try await cancelled.value; XCTFail("Cancelled replacement was published") }
        catch is CancellationError { }
        let actualState = try await library.state(book.id)
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
        XCTAssertEqual(actualState, state)
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("cloud-content.json")), originalContent)
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
    func testSynchronizationDrainsNewEditsAfterInFlightPush() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let first = ReaderNote(anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2), quote: "quiet page", body: "First thought")
        let second = ReaderNote(anchor: first.anchor, quote: first.quote, body: "A later thought")
        var state = ReaderState(); state.notes = [first]; state.anchor = first.anchor
        try await library.saveState(state, bookID: book.id)
        let uploading = expectation(description: "The first snapshot is uploading")
        let release = DispatchSemaphore(value: 0)
        var remoteNotes: [CloudJSON] = [], remotePosition: CloudJSON = .null, revision = 0
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, try self.records(notes: remoteNotes, position: remotePosition)) }
            let value = try CloudJSON.decode(Self.body(request))
            if request.url!.path.hasSuffix("comments") {
                if value["id"].string == first.id.uuidString.lowercased() {
                    uploading.fulfill()
                    guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
                }
                var record = value.object; record["deletedAt"] = .null
                remoteNotes.append(.object(record)); return (201, Data("{}".utf8))
            }
            revision += 1
            var position = value.object; position["revision"] = .number(Double(revision)); remotePosition = .object(position)
            return (200, try CloudJSON.encode(["revision": .number(Double(revision))]))
        }
        let pushing = Task { try await sync.synchronize(book.id, pull: false) }
        await fulfillment(of: [uploading], timeout: 3)
        state.notes.append(second); state.anchor?.characterOffset = 8
        try await library.saveState(state, bookID: book.id)
        try await sync.synchronizeWhileReleasing(book.id, pull: false, release: release)
        try await pushing.value
        let metadata = try await library.cloudMetadata(book.id)
        XCTAssertEqual(metadata.syncedNotes[second.id.uuidString], second.id.uuidString.lowercased(), "An edit saved during a running upload must not wait for another lifecycle event")
        XCTAssertEqual(metadata.lastSyncedAnchor?.characterOffset, 8)
        XCTAssertEqual(remoteNotes.count, 2)
    }
    func testPullRequestedDuringPushIsNotLost() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let fetching = expectation(description: "The push has started reading remote records")
        let release = DispatchSemaphore(value: 0)
        let response = try records(notes: [note("A web thought")])
        var fetches = 0
        CloudMockProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            fetches += 1
            if fetches == 1 {
                fetching.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            }
            return (200, response)
        }
        let pushing = Task { try await sync.synchronize(book.id, pull: false) }
        await fulfillment(of: [fetching], timeout: 3)
        try await sync.synchronizeWhileReleasing(book.id, pull: true, release: release)
        try await pushing.value
        let state = try await library.state(book.id)
        XCTAssertEqual(state.notes.map(\.body), ["A web thought"])
        XCTAssertEqual(fetches, 2, "The upgraded pull should run once after the push")
    }
    func testPullPreservesVerifiedLocalNoteOffset() async throws {
        let library = try library(owner)
        var copy = try fixtureCopy()
        copy.chapters[0].passages[0].text = "🌿 A quiet page for reading."
        let book = try await library.importCloud(copy), sync = CloudBookSync(client: client(), library: library)
        let local = ReaderNote(anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 4), quote: "quiet page", body: "An anchored thought")
        var state = ReaderState(); state.notes = [local]
        try await library.saveState(state, bookID: book.id)
        var remoteNotes: [CloudJSON] = []
        CloudMockProtocol.handler = { request in
            if request.httpMethod == "POST" {
                var record = try CloudJSON.decode(Self.body(request)).object; record["deletedAt"] = .null
                remoteNotes.append(.object(record)); return (201, Data("{}".utf8))
            }
            return (200, try self.records(notes: remoteNotes))
        }
        try await sync.synchronize(book.id, pull: false)
        try await sync.synchronize(book.id)
        let pulled = try await library.state(book.id).notes
        XCTAssertEqual(pulled.count, 1)
        XCTAssertEqual(pulled.first?.anchor, local.anchor, "A cloud receipt without an offset must preserve the verified local selection")
        XCTAssertEqual(pulled.first?.quote, "quiet page")
    }
    func testPullDoesNotReuseLocalOffsetWhenRemoteQuoteChanges() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let local = ReaderNote(id: CloudBookSync.noteID("web-note"), anchor: ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2), quote: "quiet page", body: "A thought")
        var state = ReaderState(); state.notes = [local]
        try await library.saveState(state, bookID: book.id)
        var remote = note("A thought").object; remote["quote"] = .string("for reading.")
        let response = try records(notes: [.object(remote)])
        CloudMockProtocol.handler = { _ in (200, response) }
        try await sync.synchronize(book.id)
        let pulled = try await library.state(book.id).notes.first
        XCTAssertEqual(pulled?.quote, "for reading.")
        XCTAssertEqual(pulled?.anchor.characterOffset, 0, "An offset for a different quotation must not be reused")
    }
    func testFailedInFlightSynchronizationDoesNotAutomaticallyRetryPendingWork() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let fetching = expectation(description: "The first request is running")
        let release = DispatchSemaphore(value: 0)
        var requests = 0
        CloudMockProtocol.handler = { _ in
            requests += 1; fetching.fulfill()
            guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            return (503, Data("{}".utf8))
        }
        let first = Task { try await sync.synchronize(book.id, pull: false) }
        await fulfillment(of: [fetching], timeout: 3)
        do { try await sync.synchronizeWhileReleasing(book.id, pull: false, release: release); XCTFail("Expected the shared request failure") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 503) }
        do { try await first.value; XCTFail("Expected the first request failure") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 503) }
        XCTAssertEqual(requests, 1, "A failed worker must not automatically retry queued requests")
        let response = try records()
        CloudMockProtocol.handler = { _ in requests += 1; return (200, response) }
        try await sync.synchronize(book.id)
        XCTAssertEqual(requests, 2, "A later explicit retry must be allowed to start")
        let metadata = try await library.cloudMetadata(book.id)
        XCTAssertNil(metadata.lastError)
    }
    func testSynchronizationQueuedDuringPositionResolutionKeepsLatestDevicePosition() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let firstAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2)
        var state = ReaderState(); state.anchor = firstAnchor
        try await library.saveState(state, bookID: book.id)
        var metadata = CloudSyncMetadata(); metadata.positionConflict = true; metadata.remotePositionRevision = 4
        metadata.remoteAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 8)
        try await library.saveCloudMetadata(metadata, bookID: book.id)
        let saving = expectation(description: "The explicit device position choice is uploading")
        let release = DispatchSemaphore(value: 0)
        var remotePosition: CloudJSON = .object(["chapterId": .string("chapter-one"), "passageId": .string("passage-one"), "withinParagraph": .number(0.8), "revision": .number(4)])
        var writes = 0
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, try self.records(position: remotePosition)) }
            writes += 1
            if writes == 1 {
                saving.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            }
            var position = try CloudJSON.decode(Self.body(request)).object
            position["revision"] = .number(Double(4 + writes)); remotePosition = .object(position)
            return (200, try CloudJSON.encode(["revision": .number(Double(4 + writes))]))
        }
        let resolving = Task { try await sync.resolvePosition(book.id, useDevice: true) }
        await fulfillment(of: [saving], timeout: 3)
        state.anchor?.characterOffset = 10
        try await library.saveState(state, bookID: book.id)
        try await sync.synchronizeWhileReleasing(book.id, pull: false, release: release)
        try await resolving.value
        try await sync.resolvePosition(book.id, useDevice: true)
        let saved = try await library.cloudMetadata(book.id)
        XCTAssertEqual(saved.lastSyncedAnchor?.characterOffset, 10)
        XCTAssertEqual(writes, 2, "The queued position is saved once; repeating a resolved choice must not write again")
        XCTAssertFalse(saved.positionConflict)
    }
    func testChoosingDevicePositionPublishesItEvenAfterReturningToLastSyncedAnchor() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let deviceAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2)
        var state = ReaderState(); state.anchor = deviceAnchor
        try await library.saveState(state, bookID: book.id)
        var metadata = CloudSyncMetadata(); metadata.positionRevision = 1; metadata.lastSyncedAnchor = deviceAnchor
        metadata.positionConflict = true; metadata.remotePositionRevision = 4
        metadata.remoteAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 8)
        try await library.saveCloudMetadata(metadata, bookID: book.id)
        let response = try records(position: .object(["chapterId": .string("chapter-one"), "passageId": .string("passage-one"), "withinParagraph": .number(0.32), "revision": .number(4)]))
        var writes = 0
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, response) }
            writes += 1
            let body = try CloudJSON.decode(Self.body(request))
            XCTAssertEqual(body["baseRevision"].number, 4)
            XCTAssertEqual(body["withinParagraph"].number, 0.08)
            return (200, Data("{\"revision\":5}".utf8))
        }
        try await sync.resolvePosition(book.id, useDevice: true)
        let saved = try await library.state(book.id), resolved = try await library.cloudMetadata(book.id)
        XCTAssertEqual(saved.anchor, deviceAnchor, "Choosing this device must not pull the cloud anchor instead")
        XCTAssertEqual(resolved.lastSyncedAnchor, deviceAnchor)
        XCTAssertEqual(resolved.positionRevision, 5)
        XCTAssertFalse(resolved.positionConflict)
        XCTAssertEqual(writes, 1)
    }
    func testFailedDevicePositionChoiceKeepsConflictAndPendingDeviceAnchorForRetry() async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let deviceAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2)
        var state = ReaderState(); state.anchor = deviceAnchor
        try await library.saveState(state, bookID: book.id)
        var metadata = CloudSyncMetadata(); metadata.positionRevision = 1; metadata.lastSyncedAnchor = deviceAnchor
        metadata.positionConflict = true; metadata.remotePositionRevision = 4
        metadata.remoteAnchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 8)
        try await library.saveCloudMetadata(metadata, bookID: book.id)
        CloudMockProtocol.handler = { _ in (503, Data("{}".utf8)) }
        do { try await sync.resolvePosition(book.id, useDevice: true); XCTFail("Expected the failed cloud verification") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 503) }
        let failed = try await library.cloudMetadata(book.id)
        XCTAssertTrue(failed.positionConflict, "An unacknowledged device choice must retain its conflict context")
        XCTAssertEqual(failed.remotePositionRevision, 4)
        XCTAssertEqual(failed.remoteAnchor?.characterOffset, 8)
        XCTAssertNotEqual(failed.lastSyncedAnchor, deviceAnchor, "The device position must remain pending until acknowledged")
        let response = try records(position: .object(["chapterId": .string("chapter-one"), "passageId": .string("passage-one"), "withinParagraph": .number(0.32), "revision": .number(4)]))
        var writes = 0
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, response) }
            writes += 1; return (200, Data("{\"revision\":5}".utf8))
        }
        try await sync.synchronize(book.id)
        let retried = try await library.cloudMetadata(book.id), saved = try await library.state(book.id)
        XCTAssertEqual(saved.anchor, deviceAnchor)
        XCTAssertEqual(retried.lastSyncedAnchor, deviceAnchor)
        XCTAssertFalse(retried.positionConflict)
        XCTAssertEqual(writes, 1)
    }
    func testFailedNoteUploadDoesNotAutomaticallyRetryQueuedSynchronization() async throws {
        try await checkQueuedNoteFailure(networkFailure: false)
    }
    func testLostNoteUploadReceiptDoesNotAutomaticallyRetryQueuedSynchronization() async throws {
        try await checkQueuedNoteFailure(networkFailure: true)
    }
    private func checkQueuedNoteFailure(networkFailure: Bool) async throws {
        let library = try library(owner), book = try await library.importCloud(fixtureCopy()), sync = CloudBookSync(client: client(), library: library)
        let anchor = ReadingAnchor(chapterID: "chapter-one", passageID: "passage-one", characterOffset: 2)
        let first = ReaderNote(anchor: anchor, quote: "quiet page", body: "The request with an unconfirmed receipt")
        let second = ReaderNote(anchor: anchor, quote: "quiet page", body: "A later thought")
        var state = ReaderState(); state.notes = [first]
        try await library.saveState(state, bookID: book.id)
        let uploading = expectation(description: "The first note request is running")
        let release = DispatchSemaphore(value: 0), response = try records()
        var writes = 0
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, response) }
            writes += 1
            if writes == 1 {
                uploading.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            }
            if networkFailure { throw URLError(.networkConnectionLost) }
            return (503, Data("{}".utf8))
        }
        let pushing = Task { try await sync.synchronize(book.id, pull: false) }
        await fulfillment(of: [uploading], timeout: 3)
        state.notes.append(second); try await library.saveState(state, bookID: book.id)
        try await sync.synchronizeWhileReleasing(book.id, pull: false, release: release)
        try await pushing.value
        XCTAssertEqual(writes, 1, "Queued work must not automatically resend a failed or unacknowledged note request")
        let failed = try await library.cloudMetadata(book.id)
        XCTAssertNil(failed.syncedNotes[first.id.uuidString])
        XCTAssertNotNil(failed.noteErrors[first.id.uuidString])
        CloudMockProtocol.handler = { request in
            if request.httpMethod != "POST" { return (200, response) }
            writes += 1; return (201, Data("{}".utf8))
        }
        try await sync.synchronize(book.id, pull: false)
        let retried = try await library.cloudMetadata(book.id)
        XCTAssertEqual(writes, 3, "A later explicit synchronization may retry the first note and upload the new one")
        XCTAssertNotNil(retried.syncedNotes[first.id.uuidString])
        XCTAssertNotNil(retried.syncedNotes[second.id.uuidString])
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

private extension CloudBookSync {
    /// This actor-inherited task releases the blocked transport only after synchronize
    /// has entered the actor and suspended on the existing worker. No timing sleep is needed.
    func synchronizeWhileReleasing(_ bookID: String, pull: Bool, release: DispatchSemaphore) async throws {
        let releasing = Task { [self] in _ = self; release.signal() }
        try await synchronize(bookID, pull: pull)
        await releasing.value
    }
}

private final class CloudMockProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.lastPathComponent == "native-copy" {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self); return
        }
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
            let (status, bytes) = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
