import XCTest
@testable import LeafhourCore

final class CloudDownloadProgressTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000317"
    override func tearDown() { DownloadProgressProtocol.handler = nil; super.tearDown() }
    private func client() -> CloudLibraryClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DownloadProgressProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture"), configuration: config)
    }
    private func install(_ requested: DownloadEvents) {
        DownloadProgressProtocol.handler = { request in
            let id = request.url!.lastPathComponent
            requested.request(id)
            if id == "reading-manifest" {
                return try CloudJSON.encode(["bookId": .string("book"), "contentVersion": .string("v1"), "chapters": .array(["c1", "c2"].map { .object(["id": .string($0), "title": .string($0)]) })])
            }
            return try CloudJSON.encode(["bookId": .string("book"), "contentVersion": .string("v1"), "chapterId": .string(id), "sections": .array([.object(["chapterId": .string(id), "paragraphs": .array([.object(["id": .string(id + "-p"), "original": .string("An isolated chapter.")])])])])])
        }
    }
    func testProgressCountsOnlyReceivedChaptersAndPreservesOriginalIdentity() async throws {
        let events = DownloadEvents(); install(events)
        let copy = try await client().downloadReadingCopy(CloudShelfBook(id: "book", title: "Book", author: "", contentVersion: "v1"), ownerID: owner) { value in events.record(value) }
        XCTAssertEqual(events.progress.map(\.completedChapters), [0, 1, 2])
        XCTAssertEqual(events.progress.map(\.totalChapters), [2, 2, 2])
        XCTAssertEqual(events.progress.map(\.fraction), [0, 0.5, 1])
        XCTAssertEqual(copy.chapters.map(\.id), ["c1", "c2"])
        XCTAssertEqual(copy.identity.ownerID, owner)
    }
    func testCancellingAfterFirstChapterNeverRequestsTheNextChapterOrReturnsACopy() async throws {
        let events = DownloadEvents(); install(events)
        let client = client(), owner = self.owner
        let work = Task {
            try await client.downloadReadingCopy(CloudShelfBook(id: "book", title: "Book", author: "", contentVersion: "v1"), ownerID: owner) { value in
                events.record(value)
                if value.completedChapters == 1 { withUnsafeCurrentTask { $0?.cancel() } }
            }
        }
        do { _ = try await work.value; XCTFail("Cancelled download returned a complete reading copy") }
        catch is CancellationError { }
        XCTAssertEqual(events.progress.map(\.completedChapters), [0, 1])
        XCTAssertEqual(events.requests, ["reading-manifest", "c1"])
    }
}

private final class DownloadEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [CloudDownloadProgress] = []
    private var paths: [String] = []
    var progress: [CloudDownloadProgress] { lock.lock(); defer { lock.unlock() }; return values }
    var requests: [String] { lock.lock(); defer { lock.unlock() }; return paths }
    func record(_ value: CloudDownloadProgress) { lock.lock(); defer { lock.unlock() }; values.append(value) }
    func request(_ value: String) { lock.lock(); defer { lock.unlock() }; paths.append(value) }
}
private final class DownloadProgressProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> Data)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.lastPathComponent == "native-copy" {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self); return
        }
        do {
            let bytes = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
