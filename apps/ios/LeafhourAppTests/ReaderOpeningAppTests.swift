import Foundation
import XCTest
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderOpeningAppTests: XCTestCase {
    func testNewDownloadPresentsSavedSourceBeforeHeldRecords() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner = "00000000-0000-4000-8000-000000000345"
        let gate = OpeningRecordsGate(); OpeningRecordsProtocol.gate = gate
        defer { gate.release(); OpeningRecordsProtocol.gate = nil; try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OpeningRecordsProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-opening-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://opening.fixture.invalid")!, credential: credential, configuration: config)
        let model = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        let start = ContinuousClock.now
        let work = Task { await model.download(CloudShelfBook(id: "opening-book", title: "Synthetic opening", author: "", contentVersion: "v1")) }
        for _ in 0..<100 {
            if model.reader != nil { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertNotNil(model.reader, "Records cannot block a newly saved and authorized source")
        XCTAssertEqual(model.books.first?.cloud?.bookID, "opening-book", "The saved book must already be discoverable on the shelf")
        XCTAssertEqual(model.reader?.chapter.passages.first?.text, "An invented first paragraph.")
        print("OPENING_DOWNLOADED readerBeforeRecords=\(model.reader != nil) elapsed=\(start.duration(to: .now))")
        gate.release(); await work.value
    }

    func testCachedReaderAppearsBeforeHeldCloudRecordsAndLateSyncKeepsNewWork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let owner = "00000000-0000-4000-8000-000000000345"
        let gate = OpeningRecordsGate()
        OpeningRecordsProtocol.gate = gate
        defer { gate.release(); OpeningRecordsProtocol.gate = nil; try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OpeningRecordsProtocol.self]
        let credential = CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-opening-fixture")
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://opening.fixture.invalid")!, credential: credential, configuration: config)
        let model = LibraryModel(root: root, cloud: cloud, credential: credential, monitorNetwork: false)
        let library = try XCTUnwrap(model.library)
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c1","title":"Synthetic","sourcePath":"c1","passages":[{"id":"p1","text":"An invented first paragraph.","heading":false},{"id":"p2","text":"An invented second paragraph.","heading":false}]}]"#.utf8))
        let content = Data(#"{"bookId":"opening-book","contentVersion":"v1","sections":[{"chapterId":"c1","paragraphs":[{"id":"p1","original":"An invented first paragraph.","translations":{}},{"id":"p2","original":"An invented second paragraph.","translations":{}}]}]}"#.utf8)
        let identity = CloudBookIdentity(ownerID: owner, bookID: "opening-book", contentVersion: "v1", sourceFormat: "txt")
        let book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic opening", author: "", chapters: chapters, content: content))
        let opening = Task { await model.open(book) }
        let start = ContinuousClock.now
        for _ in 0..<100 {
            if model.reader != nil { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertNotNil(model.reader, "A held /records request cannot delay an authorized local page")
        print("OPENING_GATED readerBeforeRelease=\(model.reader != nil) elapsed=\(start.duration(to: .now))")
        let session = model.reader
        if let session {
            session.go(to: 0, anchor: ReadingAnchor(chapterID: "c1", passageID: "p2"))
            session.state.notes.append(ReaderNote(anchor: ReadingAnchor(chapterID: "c1", passageID: "p2"), quote: "second paragraph", body: "New local work while network waits."))
            session.save(); _ = await session.flush()
        }
        gate.release()
        await opening.value
        for _ in 0..<100 {
            if model.syncIssues[book.id]?.remoteAnchor != nil { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        if let session {
            XCTAssertTrue(model.reader === session)
            XCTAssertEqual(session.currentAnchor?.passageID, "p2")
            XCTAssertEqual(session.state.notes.first?.body, "New local work while network waits.")
            let saved = try await library.state(book.id)
            XCTAssertEqual(saved.anchor?.passageID, "p2")
            XCTAssertEqual(saved.notes.first?.body, "New local work while network waits.")
            XCTAssertTrue(model.syncIssues[book.id]?.positionConflict == true, "The existing position choice must stay explicit")
        }
    }
}

private final class OpeningRecordsGate: @unchecked Sendable {
    private let lock = NSLock()
    private var released = false
    private var deliveries: [() -> Void] = []
    func hold(_ delivery: @escaping () -> Void) {
        lock.lock()
        if released { lock.unlock(); delivery() }
        else { deliveries.append(delivery); lock.unlock() }
    }
    func release() {
        lock.lock(); released = true; let pending = deliveries; deliveries = []; lock.unlock()
        pending.forEach { $0() }
    }
}

private final class OpeningRecordsProtocol: URLProtocol, @unchecked Sendable {
    static var gate: OpeningRecordsGate?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let respond = { [weak self] in
            guard let self else { return }
            let path = self.request.url!.path
            let body: String, status: Int
            if path.hasSuffix("/native-copy") { status = 404; body = #"{"error":"Use isolated chapter transport"}"# }
            else if path.hasSuffix("/reading-manifest") {
                status = 200; body = #"{"bookId":"opening-book","contentVersion":"v1","title":"Synthetic opening","source":{"format":"txt"},"chapters":[{"id":"c1","title":"Synthetic"}]}"#
            } else if path.contains("/chapters/") {
                status = 200; body = #"{"bookId":"opening-book","contentVersion":"v1","chapterId":"c1","sections":[{"chapterId":"c1","paragraphs":[{"id":"p1","original":"An invented first paragraph.","translations":{}},{"id":"p2","original":"An invented second paragraph.","translations":{}}]}]}"#
            } else if path.hasSuffix("/records") {
                status = 200; body = #"{"bookId":"opening-book","contentVersion":"v1","comments":[],"questions":[],"position":{"chapterId":"c1","passageId":"p1","revision":3}}"#
            } else { status = 503; body = #"{"error":"Synthetic offline endpoint"}"# }
            let response = HTTPURLResponse(url: self.request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: Data(body.utf8)); self.client?.urlProtocolDidFinishLoading(self)
        }
        if request.url?.path.hasSuffix("/records") == true, let gate = Self.gate { gate.hold(respond) }
        else { respond() }
    }
    override func stopLoading() {}
}
