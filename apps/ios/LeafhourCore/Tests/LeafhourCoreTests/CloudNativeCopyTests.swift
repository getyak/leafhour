import XCTest
import zlib
@testable import LeafhourCore

final class CloudNativeCopyTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000431"
    private let remote = CloudShelfBook(id: "synthetic-book", title: "Synthetic", author: "Fixture", contentVersion: "v1")
    private var roots: [URL] = []
    override func tearDown() {
        NativeCopyProtocol.handler = nil
        for root in roots { try? FileManager.default.removeItem(at: root) }
        super.tearDown()
    }
    private func client() -> CloudLibraryClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeCopyProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "synthetic-session"), configuration: config)
    }
    private func model(rows: Int = 2, padding: String = "") throws -> Data {
        try CloudJSON.encode(["bookId": .string(remote.id), "contentVersion": .string("v1"), "title": .string("Synthetic novel"), "author": .string("Fixture"), "source": .object(["format": .string("epub")]),
            "chapters": .array([.object(["id": .string("c1"), "title": .string("One")])]), "readingStart": .object(["chapterId": .string("c1"), "passageId": .string("p0")]),
            "sections": .array([.object(["chapterId": .string("c1"), "paragraphs": .array((0..<rows).map { .object(["id": .string("p\($0)"), "original": .string("Synthetic source \($0)." + padding), "translations": .object(["literal": .object(["text": .string("Saved literal"), "status": .string("draft")])])]) })])])])
    }
    private func replacing(_ bytes: Data, _ change: (inout [String: CloudJSON]) -> Void) throws -> Data {
        var object = try CloudJSON.decode(bytes).object; change(&object); return try CloudJSON.encode(object)
    }
    @discardableResult private func install(content: Data, compressed: Data? = nil, planChange: ((inout [String: CloudJSON]) -> Void)? = nil, partChange: ((Data) -> Data)? = nil, verifyChange: ((inout [String: CloudJSON]) -> Void)? = nil, status: Int = 200, requests: NativeCopyRequests = NativeCopyRequests()) throws -> NativeCopyRequests {
        let archive = try compressed ?? Self.gzip(content), hash = Disk.hash(archive), remote = remote
        var plan: [String: CloudJSON] = ["kind": .string("leafhour-native-copy-v1"), "bookId": .string(remote.id), "contentVersion": .string("v1"), "snapshotId": .string(String(repeating: "a", count: 64)), "sha256": .string(hash), "compressedBytes": .number(Double(archive.count)), "uncompressedBytes": .number(Double(content.count)), "partBytes": .number(1_048_576), "encoding": .string("gzip")]
        planChange?(&plan); let planBytes = try CloudJSON.encode(plan)
        var verification: [String: CloudJSON] = ["valid": .bool(true), "bookId": .string(remote.id), "contentVersion": .string("v1"), "snapshotId": .string(String(repeating: "a", count: 64)), "sha256": .string(hash)]
        verifyChange?(&verification); let verificationBytes = try CloudJSON.encode(verification)
        NativeCopyProtocol.handler = { request in
            requests.record(request)
            switch request.url!.lastPathComponent {
            case "native-copy": return (status, planBytes, [:])
            case "part":
                let values = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
                XCTAssertEqual(values.first { $0.name == "archive" }?.value, hash)
                let offset = Int(values.first { $0.name == "offset" }!.value!)!
                XCTAssertEqual(offset % 1_048_576, 0)
                let bytes = archive.subdata(in: offset..<min(archive.count, offset + 1_048_576))
                return (200, partChange?(bytes) ?? bytes, ["Content-Type": "application/octet-stream"])
            case "verify": return (200, verificationBytes, [:])
            case "logout": return (200, Data("{}".utf8), [:])
            default: return (404, Data("{}".utf8), [:])
            }
        }
        return requests
    }
    func testUsesVerifiedGzipCopyAndPreservesSavedContentAndStableIDs() async throws {
        let content = try model(), requests = try install(content: content)
        let copy = try await client().downloadReadingCopy(remote, ownerID: owner)
        XCTAssertEqual(copy.content, content)
        XCTAssertEqual(copy.chapters.map(\.id), ["c1"])
        XCTAssertEqual(copy.chapters[0].passages.map(\.id), ["p0", "p1"])
        XCTAssertEqual(copy.readingStart?.anchor.passageID, "p0")
        XCTAssertEqual(copy.identity.ownerID, owner)
        XCTAssertEqual(requests.paths, ["native-copy", "part", "verify"])
        XCTAssertGreaterThan(requests.requests.first!.timeoutInterval, 45)
        XCTAssertTrue(requests.requests.allSatisfy { $0.value(forHTTPHeaderField: "X-Reader-Owner") == owner })
    }
    func testSupportsMoreThanLegacyPassageAndByteBounds() async throws {
        let content = try model(rows: 100_001, padding: String(repeating: "s", count: 280))
        XCTAssertGreaterThan(content.count, 32 * 1024 * 1024)
        try install(content: content)
        let copy = try await client().downloadReadingCopy(remote, ownerID: owner)
        XCTAssertEqual(copy.chapters[0].passages.count, 100_001)
        XCTAssertEqual(copy.content, content)
    }
    func testDownloadsEveryAlignedPartAtExactlyItsExpectedLength() async throws {
        var seed: UInt64 = 431
        let alphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".utf8)
        let text = String(decoding: (0..<1_600_000).map { _ -> UInt8 in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return alphabet[Int(seed >> 32) % alphabet.count]
        }, as: UTF8.self)
        let content = try model(rows: 1, padding: text), requests = try install(content: content)
        let copy = try await client().downloadReadingCopy(remote, ownerID: owner)
        XCTAssertEqual(copy.content, content)
        let parts = requests.requests.filter { $0.url!.lastPathComponent == "part" }
        XCTAssertEqual(parts.count, 2)
        XCTAssertTrue(parts[1].url!.query!.contains("offset=1048576"))
    }
    func testRejectsInvalidPlanBoundsWithoutDownloadingParts() async throws {
        let mutations: [(inout [String: CloudJSON]) -> Void] = [
            { $0["compressedBytes"] = .number(33 * 1024 * 1024) }, { $0["uncompressedBytes"] = .number(97 * 1024 * 1024) },
            { $0["uncompressedBytes"] = .number(1.5) }, { $0["compressedBytes"] = .number(0) }, { $0["partBytes"] = .number(1) },
            { $0["sha256"] = .string("invalid") }, { $0["snapshotId"] = .string("") }, { $0["bookId"] = .string("foreign") },
            { $0["encoding"] = .string("identity") }, { $0["kind"] = .string("unknown") }
        ]
        for mutation in mutations {
            let requests = try install(content: model(), planChange: mutation)
            await assertRejected()
            XCTAssertEqual(requests.paths, ["native-copy"])
        }
    }
    func testRejectsWrongPartLengthsAndCompressedDigest() async throws {
        for change: (Data) -> Data in [{ $0.dropLast() }, { $0 + Data([0]) }, { bytes in var copy = bytes; copy[copy.startIndex] ^= 1; return copy }] {
            let requests = try install(content: model(), partChange: change)
            await assertRejected()
            XCTAssertFalse(requests.paths.contains("verify"))
        }
    }
    func testRejectsCorruptTruncatedAndTrailingGzipEvenWithCorrectArchiveDigest() async throws {
        let content = try model(), archive = try Self.gzip(content)
        var corrupt = archive; corrupt[corrupt.endIndex - 5] ^= 1
        for bytes in [corrupt, Data(archive.dropLast()), archive + Data([0]), archive + archive] {
            try install(content: content, compressed: bytes)
            await assertRejected()
        }
    }
    func testRejectsGzipOutputBeyondDeclaredBound() async throws {
        try install(content: model(), planChange: { $0["uncompressedBytes"] = .number(32) })
        await assertRejected()
    }
    func testRejectsMissingForeignDuplicateOrUnloadedSourceIdentity() async throws {
        let content = try model()
        var invalid: [Data] = []
        for mutation: (inout [String: CloudJSON]) -> Void in [
            { $0["bookId"] = .string("foreign") }, { $0["contentVersion"] = .string("stale") },
            { $0["chapters"] = .array([.object(["id": .string("c1")]), .object(["id": .string("c1")])]) },
            { $0["chapters"] = .array([.object(["id": .string("missing")])]) },
            { $0["chapters"] = .array([.object(["id": .string("c1")]), .object(["id": .string("absent")])]) },
            { $0["reading"] = .object(["partial": .bool(true)]) }, { $0["sections"] = .array([]) },
            { $0["sections"] = .array([.object(["chapterId": .string("c1"), "paragraphs": .array([.object(["id": .string("dup"), "original": .string("Source")]), .object(["id": .string("dup"), "original": .string("Source")])])])]) },
            { $0["sections"] = .array([.object(["chapterId": .string("c1"), "paragraphs": .array([.object(["id": .string("unloaded"), "unloaded": .bool(true)])])])]) }
        ] { invalid.append(try replacing(content, mutation)) }
        for bytes in invalid { try install(content: bytes); await assertRejected() }
    }
    func testRejectsChangedFinalSnapshotOrIdentity() async throws {
        for mutation: (inout [String: CloudJSON]) -> Void in [
            { $0["valid"] = .bool(false) }, { $0["bookId"] = .string("foreign") }, { $0["contentVersion"] = .string("new-version") },
            { $0["snapshotId"] = .string(String(repeating: "b", count: 64)) }, { $0["sha256"] = .string(String(repeating: "c", count: 64)) }
        ] { try install(content: model(), verifyChange: mutation); await assertRejected() }
    }
    func testPrepareFailureDoesNotFallBackToLegacyChapterTransport() async throws {
        for status in [401, 403, 409, 413, 500] {
            let requests = try install(content: model(), status: status)
            await assertRejected()
            XCTAssertEqual(requests.paths, ["native-copy"])
        }
    }
    func testUnsupportedPrepare404Or405UsesBoundedLegacyChapters() async throws {
        let content = try CloudJSON.decode(model()), remote = remote
        for unsupported in [404, 405] {
            let requests = NativeCopyRequests()
            NativeCopyProtocol.handler = { request in
                requests.record(request)
                if request.url!.lastPathComponent == "native-copy" { return (unsupported, Data("{}".utf8), [:]) }
                if request.url!.lastPathComponent == "reading-manifest" { return (200, try CloudJSON.encode(["bookId": content["bookId"], "contentVersion": content["contentVersion"], "chapters": content["chapters"]]), [:]) }
                return (200, try CloudJSON.encode(["bookId": content["bookId"], "contentVersion": content["contentVersion"], "chapterId": .string("c1"), "sections": content["sections"]]), [:])
            }
            let copy = try await client().downloadReadingCopy(remote, ownerID: owner)
            XCTAssertEqual(copy.chapters[0].passages.map(\.id), ["p0", "p1"])
            XCTAssertEqual(requests.paths, ["native-copy", "reading-manifest", "c1"])
        }
    }
    func testSameOwnerReloginDuringProgressCannotPublishAnEarlierGeneration() async throws {
        let requests = try install(content: model()), original = NativeCopyProtocol.handler!, owner = owner
        NativeCopyProtocol.handler = { request in
            if request.url!.path == "/api/auth/password" {
                requests.record(request)
                return (200, try CloudJSON.encode(["user": .object(["id": .string(owner)])]), ["Set-Cookie": "marginalia_session=synthetic-relogin; Path=/; Secure; HttpOnly"])
            }
            return try original(request)
        }
        let client = client()
        do {
            _ = try await client.downloadReadingCopy(remote, ownerID: owner) { progress in
                if progress.completedChapters == progress.totalChapters {
                    await client.signOut()
                    _ = try? await client.signIn(email: "synthetic@example.invalid", password: "isolated-test-value")
                }
            }
            XCTFail("Earlier account generation returned a copy")
        } catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
        let account = await client.activeAccount(); XCTAssertEqual(account?.id, owner)
        XCTAssertEqual(requests.requests.first { $0.url!.path == "/api/auth/password" }?.timeoutInterval, 45)
    }
    func testGzipChecksCancellationBeforeExpandingAndNeverReturnsBytes() async throws {
        let content = try model(), archive = try Self.gzip(content)
        let work = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try NativeReadingCopyGzip.decode(archive, expectedBytes: content.count)
        }
        do { _ = try await work.value; XCTFail("Cancelled expansion returned bytes") }
        catch is CancellationError { }
    }
    func testCancellationAndOwnerChangeDuringProgressCannotReturnCopy() async throws {
        for cancel in [true, false] {
            let requests = try install(content: model()), client = client(), owner = owner, remote = remote
            let work = Task {
                try await client.downloadReadingCopy(remote, ownerID: owner) { progress in
                    if progress.completedChapters == progress.totalChapters {
                        if cancel { withUnsafeCurrentTask { $0?.cancel() } }
                        else { await client.signOut() }
                    }
                }
            }
            do { _ = try await work.value; XCTFail("Invalidated download returned a copy") }
            catch is CancellationError { XCTAssertTrue(cancel) }
            catch let error as CloudRequestError { XCTAssertFalse(cancel); XCTAssertEqual(error.status, 409) }
            XCTAssertTrue(requests.paths.contains("part"))
        }
    }
    func testSuccessfulPublicationPreservesPrivateStateAndOtherOwnerIsRefused() async throws {
        try install(content: model())
        let copy = try await client().downloadReadingCopy(remote, ownerID: owner)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("NativeCopy-" + UUID().uuidString); roots.append(root)
        let library = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        let book = try await library.importCloud(copy)
        var state = ReaderState(); let anchor = ReadingAnchor(chapterID: "c1", passageID: "p1")
        state.anchor = anchor; state.notes = [ReaderNote(anchor: anchor, quote: "Synthetic", body: "My own words")]
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "Synthetic", body: "My draft")
        try await library.saveState(state, bookID: book.id)
        _ = try await library.importCloud(copy, replaceExisting: true)
        let saved = try await library.state(book.id); XCTAssertEqual(saved, state)
        let other = try OfflineLibrary(root: root, scope: .account(UUID()))
        do { _ = try await other.importCloud(copy); XCTFail("Other owner accepted private content") } catch { }
    }
    private func assertRejected(file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await client().downloadReadingCopy(remote, ownerID: owner); XCTFail("Unverified copy returned", file: file, line: line) }
        catch { }
    }
    private static func gzip(_ bytes: Data) throws -> Data {
        var stream = z_stream()
        guard deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw URLError(.cannotDecodeContentData) }
        defer { deflateEnd(&stream) }
        return try bytes.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            stream.next_in = UnsafeMutablePointer(mutating: raw.bindMemory(to: UInt8.self).baseAddress!); stream.avail_in = UInt32(bytes.count)
            var output = Data(), status: Int32 = Z_OK
            repeat {
                var chunk = Data(count: 65_536); stream.avail_out = UInt32(chunk.count)
                status = chunk.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) in stream.next_out = buffer.bindMemory(to: UInt8.self).baseAddress!; return deflate(&stream, Z_FINISH) }
                guard status == Z_OK || status == Z_STREAM_END else { throw URLError(.cannotDecodeContentData) }
                chunk.count -= Int(stream.avail_out); output.append(chunk)
            } while status != Z_STREAM_END
            return output
        }
    }
}

final class CloudShelfAddedAtTests: XCTestCase {
    func testServiceUsesExplicitAdditionOrPrivateCreationButIgnoresPublicBuildDate() throws {
        let date = "2026-10-30T10:11:12.123Z"
        for input in [#"{"bookId":"book","contentVersion":"v1","addedAt":"\#(date)"}"#, #"{"bookId":"book","contentVersion":"v1","visibility":"private","createdAt":"\#(date)"}"#] {
            let book = try XCTUnwrap(CloudShelfBook(json: CloudJSON.decode(Data(input.utf8))))
            let encoded = try CloudJSON.decode(JSONEncoder().encode(book))
            XCTAssertNotEqual(encoded["addedAt"], .null)
            XCTAssertEqual(try JSONDecoder().decode(CloudShelfBook.self, from: JSONEncoder().encode(book)), book)
        }
        let publicBook = try XCTUnwrap(CloudShelfBook(json: CloudJSON.decode(Data(#"{"bookId":"public","contentVersion":"v1","visibility":"public","createdAt":"2026-10-30T10:11:12Z"}"#.utf8))))
        XCTAssertEqual(try CloudJSON.decode(JSONEncoder().encode(publicBook))["addedAt"], .null)
        _ = try JSONDecoder().decode(CloudShelfBook.self, from: Data(#"{"id":"old","title":"Old","author":"","contentVersion":"v1"}"#.utf8))
    }
}

private final class NativeCopyRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    func record(_ request: URLRequest) { lock.lock(); defer { lock.unlock() }; values.append(request) }
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return values }
    var paths: [String] { requests.map { $0.url!.lastPathComponent } }
}
private final class NativeCopyProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, Data, [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, bytes, headers) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
