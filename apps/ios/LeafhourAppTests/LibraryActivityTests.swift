import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class LibraryActivityTests: XCTestCase {
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
        let cached = try CloudJSON.decode(XCTUnwrap(data))
        XCTAssertEqual(cached["books"].array.last?["addedAt"].string, timestamp)
        XCTAssertNil(cached["books"].array.first?["addedAt"].string)

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
