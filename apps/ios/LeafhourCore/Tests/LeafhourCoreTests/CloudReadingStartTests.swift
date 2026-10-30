import XCTest
@testable import LeafhourCore

final class CloudReadingStartTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000328"
    private var roots: [URL] = []
    override func tearDown() {
        for root in roots { try? FileManager.default.removeItem(at: root) }
        CloudStartProtocol.handler = nil
        super.tearDown()
    }
    private var chapters: [BookChapter] {
        [BookChapter(id: "front", title: "Source title page", sourcePath: "front", passages: [Passage(id: "front-p", text: "Synthetic title and author.")]),
         BookChapter(id: "body", title: "Source body", sourcePath: "body", passages: [Passage(id: "body-p", text: "Actual source body 🐿️.")])]
    }
    private var identity: CloudBookIdentity { CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "source-v1", sourceFormat: "epub") }
    private var start: CloudJSON { .object(["chapterId": .string("body"), "passageId": .string("body-p")]) }
    private func library() throws -> OfflineLibrary {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("CloudStart-" + UUID().uuidString)
        roots.append(root)
        return try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
    }
    private func readingCopy(hint: CloudJSON? = nil, bookID: String = "cloud-book", version: String = "source-v1", content: Data? = nil) throws -> CloudReadingCopy {
        var metadata: [String: CloudJSON] = ["bookId": .string(bookID), "contentVersion": .string(version), "sections": .array([])]
        if let hint { metadata["readingStart"] = hint }
        return CloudReadingCopy(identity: identity, title: "Synthetic cloud source", author: "Fixture", chapters: chapters, content: try content ?? CloudJSON.encode(metadata))
    }
    @MainActor private func session(_ book: LocalBook, library: OfflineLibrary, state: ReaderState = ReaderState()) async throws -> ReaderSession {
        ReaderSession(book: book, state: state, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }

    @MainActor func testDownloadedPublisherStartSurvivesCloudTextCopyAndUsesRealSourceIDs() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CloudStartProtocol.self]
        let owner = owner, manifestStart = start, sourceChapters = chapters
        CloudStartProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            if request.url!.lastPathComponent == "reading-manifest" {
                return try CloudJSON.encode(["bookId": .string("cloud-book"), "contentVersion": .string("source-v1"), "source": .object(["format": .string("epub")]), "readingStart": manifestStart,
                    "chapters": .array(sourceChapters.map { .object(["id": .string($0.id), "title": .string($0.title)]) })])
            }
            let chapter = sourceChapters.first { $0.id == request.url!.lastPathComponent }!
            return try CloudJSON.encode(["bookId": .string("cloud-book"), "contentVersion": .string("source-v1"), "chapterId": .string(chapter.id),
                "sections": .array([.object(["chapterId": .string(chapter.id), "paragraphs": .array(chapter.passages.map { .object(["id": .string($0.id), "original": .string($0.text)]) })])])])
        }
        let client = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-cloud-start"), configuration: config)
        let downloaded = try await client.downloadReadingCopy(CloudShelfBook(id: "cloud-book", title: "Synthetic", author: "", contentVersion: "source-v1"), ownerID: owner)
        let library = try library(), book = try await library.importCloud(downloaded)
        XCTAssertEqual(book.kind, .txt)
        XCTAssertEqual(book.cloud?.sourceFormat, "epub")
        XCTAssertEqual(book.chapters.map(\.id), ["front", "body"])
        XCTAssertEqual(book.readingStartAnchor, ReadingAnchor(chapterID: "body", passageID: "body-p"))
        let stored = try JSONDecoder().decode(LocalBook.self, from: Data(contentsOf: try await library.bookDirectory(book.id).appendingPathComponent("book.json")))
        XCTAssertEqual(stored.readingStartAnchor, book.readingStartAnchor)
        let reader = try await session(book, library: library)
        XCTAssertEqual(reader.chapter.id, "body")
        XCTAssertEqual(reader.currentAnchor?.passageID, "body-p")
    }

    @MainActor func testLegacyCloudMetadataStartsAtBodyWithoutRewritingBookManifestOrState() async throws {
        let library = try library(), book = try await library.importCloud(readingCopy(hint: start))
        let folder = try await library.bookDirectory(book.id)
        let paths = ["book.json", "manifest.json", "cloud-content.json"]
        let before = try paths.map { try Data(contentsOf: folder.appendingPathComponent($0)) }
        XCTAssertNil(try JSONDecoder().decode(LocalBook.self, from: before[0]).readingStartAnchor)
        let loaded = try await library.book(book.id)
        XCTAssertEqual(loaded.readingStartAnchor, ReadingAnchor(chapterID: "body", passageID: "body-p"))
        let reader = try await session(loaded, library: library)
        XCTAssertEqual(reader.chapter.id, "body")
        _ = try await library.book(book.id)
        XCTAssertEqual(try paths.map { try Data(contentsOf: folder.appendingPathComponent($0)) }, before)
        let diskState = try await library.state(book.id)
        XCTAssertNil(diskState.anchor)
    }

    @MainActor func testSavedCloudFrontMatterAnchorAlwaysWinsOverPublisherStart() async throws {
        let library = try library(), book = try await library.importCloud(readingCopy(hint: start))
        var state = ReaderState(); let anchor = ReadingAnchor(chapterID: "front", passageID: "front-p", characterOffset: 4)
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "Synthetic", body: "Keep my own words")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "Synthetic", body: "Keep my draft")
        try await library.saveState(state, bookID: book.id)
        let reader = try await session(try await library.book(book.id), library: library, state: try await library.state(book.id))
        XCTAssertEqual(reader.chapter.id, "front")
        XCTAssertEqual(reader.currentAnchor, anchor)
        XCTAssertEqual(reader.state, state)
        XCTAssertEqual(reader.declaredReadingStart()?.passageID, "body-p")
        let unchanged = try await library.state(book.id)
        XCTAssertEqual(unchanged, state)
    }

    @MainActor func testForeignChapterWrongPassageAndMalformedCloudHintsAreIgnored() async throws {
        let bad: [CloudJSON] = [.array([]), .string("body-p"), .object(["chapterId": .string("body")]),
            .object(["chapterId": .string("foreign"), "passageId": .string("body-p")]),
            .object(["chapterId": .string("front"), "passageId": .string("body-p")]),
            .object(["chapterId": .string("body"), "passageId": .string("missing")]),
            .object(["chapterId": .string("body"), "passageId": .string("body-p"), "extra": .bool(true)])]
        for hint in bad {
            let library = try library(), book = try await library.importCloud(readingCopy(hint: hint))
            let loaded = try await library.book(book.id)
            XCTAssertNil(loaded.readingStartAnchor)
            let reader = try await session(loaded, library: library)
            XCTAssertEqual(reader.chapter.id, "front")
        }
    }

    func testLegacyCloudHintMustMatchItsBookAndContentVersion() async throws {
        for value in [try readingCopy(hint: start, bookID: "foreign-book"), try readingCopy(hint: start, version: "stale-version")] {
            let library = try library(), book = try await library.importCloud(value)
            let loaded = try await library.book(book.id)
            XCTAssertNil(loaded.readingStartAnchor)
        }
    }

    func testTypedCloudHintMustMatchCopyOwnerBookVersionAndChapterMembership() async throws {
        var foreignOwner = identity; foreignOwner.ownerID = "00000000-0000-4000-8000-000000000999"
        var foreignBook = identity; foreignBook.bookID = "foreign-book"
        var stale = identity; stale.contentVersion = "stale-version"
        let correct = ReadingAnchor(chapterID: "body", passageID: "body-p")
        for hint in [CloudReadingStartHint(identity: foreignOwner, anchor: correct), CloudReadingStartHint(identity: foreignBook, anchor: correct), CloudReadingStartHint(identity: stale, anchor: correct),
                     CloudReadingStartHint(identity: identity, anchor: ReadingAnchor(chapterID: "front", passageID: "body-p"))] {
            var value = try readingCopy(); value.readingStart = hint
            let library = try library(), book = try await library.importCloud(value)
            XCTAssertNil(book.readingStartAnchor)
            let loaded = try await library.book(book.id)
            XCTAssertNil(loaded.readingStartAnchor)
        }
    }

    func testCloudStartCannotEnterAnotherOwnerOrDeviceScope() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("CloudStart-" + UUID().uuidString); roots.append(root)
        let value = try readingCopy(hint: start)
        for scope in [LibraryScope.device, .account(UUID())] {
            let library = try OfflineLibrary(root: root, scope: scope)
            do { _ = try await library.importCloud(value); XCTFail("Cross-owner copy must be refused") } catch { }
        }
    }

    func testLegacyHintBeyondLargeSectionsStillUsesBoundedMetadataProjection() async throws {
        let padding = String(repeating: "Synthetic source only. ", count: 150_000)
        let content = Data(("{\"sections\":[\"" + padding + "\"],\"bookId\":\"cloud-book\",\"contentVersion\":\"source-v1\",\"readingStart\":{\"chapterId\":\"body\",\"passageId\":\"body-p\"}}").utf8)
        XCTAssertGreaterThan(content.count, 1_048_576)
        let library = try library(), book = try await library.importCloud(readingCopy(content: content))
        let loaded = try await library.book(book.id)
        XCTAssertEqual(loaded.readingStartAnchor?.passageID, "body-p")
    }

    func testCloudMetadataDigestChangeInvalidatesPreparedLegacyStart() async throws {
        let library = try library(), book = try await library.importCloud(readingCopy(hint: start))
        let first = try await library.book(book.id)
        XCTAssertEqual(first.readingStartAnchor?.passageID, "body-p")
        let replacement = try readingCopy(hint: .object(["chapterId": .string("front"), "passageId": .string("front-p")]))
        let replaced = try await library.importCloud(replacement, replaceExisting: true)
        XCTAssertEqual(replaced.id, book.id)
        let current = try await library.book(book.id)
        XCTAssertEqual(current.readingStartAnchor?.passageID, "front-p")
    }
}

private final class CloudStartProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> Data)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let bytes = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
