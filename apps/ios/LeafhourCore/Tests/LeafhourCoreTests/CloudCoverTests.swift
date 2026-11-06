import XCTest
@testable import LeafhourCore

final class CloudCoverTests: XCTestCase {
    func testGeneratedCoverSurvivesCacheRestartAndOfflineTransport() async throws {
        let owner = "isolated-offline-cover", config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoverProtocol.self]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); CoverProtocol.handler = nil }
        let client = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-test"), configuration: config)
        let path = "/api/library/books/private-txt/cover?v=source-hash", bytes = Data([1, 2, 3])
        CoverProtocol.handler = { _ in (200, bytes) }
        let first = try await CloudCoverCache(directory: root).data(path: path, ownerID: owner, client: client)
        XCTAssertEqual(first, bytes)
        CoverProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let reopened = try await CloudCoverCache(directory: root).data(path: path, ownerID: owner, client: client)
        XCTAssertEqual(reopened, bytes)
        do { _ = try await CloudCoverCache(directory: root).data(path: path, ownerID: "another-owner", client: client); XCTFail("Another owner must not read this cover") } catch { }
    }
    func testLegacyTXTMetadataFindsItsGeneratedCoverWithoutChangingTheSourceVersion() throws {
        for format in ["txt", "md", "markdown"] {
            let metadata = try CloudJSON.decode(Data("{\"bookId\":\"private-old\",\"contentVersion\":\"original-version\",\"visibility\":\"private\",\"source\":{\"format\":\"\(format)\",\"sha256\":\"source-hash\"},\"title\":\"Old text\"}".utf8))
            let book = try XCTUnwrap(CloudShelfBook(json: metadata))
            XCTAssertEqual(book.coverPath, "/api/library/books/private-old/cover?v=source-hash")
            XCTAssertEqual(book.contentVersion, "original-version")
        }
    }
    func testPrivateCoverAllowsTheImageProviderTimeToFinish() async throws {
        let owner = "isolated-cover-owner", config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoverProtocol.self]
        CoverProtocol.handler = { request in
            XCTAssertEqual(request.timeoutInterval, 120)
            return (200, Data([1, 2, 3]))
        }
        defer { CoverProtocol.handler = nil }
        let client = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-test"), configuration: config)
        _ = try await client.coverData(path: "/api/library/books/private-a/cover?v=v1", ownerID: owner)
    }
    func testShelfDecodesRemoteCoverAndRetainsLegacyMetadata() throws {
        let metadata = try CloudJSON.decode(Data(#"{"bookId":"alice","contentVersion":"v1","title":"Alice","coverImage":"/book-covers/alice-640.webp?v=abc123"}"#.utf8))
        XCTAssertEqual(CloudShelfBook(json: metadata)?.coverPath, "/book-covers/alice-640.webp?v=abc123")
        let legacy = CloudShelfBook(id: "old", title: "Old", author: "", contentVersion: "v1")
        XCTAssertNil(legacy.coverPath)
        XCTAssertNil(try JSONDecoder().decode(CloudShelfBook.self, from: Data(#"{"id":"old","title":"Old","author":"","contentVersion":"v1"}"#.utf8)).coverPath)
    }
    func testPrivateCoverRetriesWhenAnotherRequestIsStillGenerating() async throws {
        let owner = "isolated-pending-cover", config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoverProtocol.self]
        var requests = 0
        CoverProtocol.handler = { _ in requests += 1; return (requests == 1 ? 503 : 200, Data([1, 2, 3])) }
        defer { CoverProtocol.handler = nil }
        let client = CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-test"), configuration: config)
        let result = try await client.coverData(path: "/api/library/books/private-a/cover?v=v1", ownerID: owner)
        XCTAssertEqual(result, Data([1, 2, 3])); XCTAssertEqual(requests, 2)
    }
    func testCoverPathRejectsExternalTraversalAndArbitraryAPI() {
        for path in ["https://evil.test/image.webp", "//evil.test/image.webp", "/api/auth/session", "/book-covers/../secret.webp", "/book-covers/a-640.webp?redirect=https://evil.test", "/api/library/books/a/cover/extra"] {
            XCTAssertFalse(CloudCoverPath.isAllowed(path), path)
        }
        XCTAssertTrue(CloudCoverPath.isAllowed("/book-covers/alice-640.webp?v=abc123"))
        XCTAssertTrue(CloudCoverPath.isAllowed("/api/library/books/private-a/cover?v=v1"))
    }
}

private final class CoverProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
            let (status, data) = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "image/webp"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
