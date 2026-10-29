import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class LibraryActivityTests: XCTestCase {
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
        let model = LibraryModel(root: root, cloud: cloud, credential: credential)
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
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}
