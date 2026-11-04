import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor final class ContentsSearchAppTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000511"
    private func fixture() async throws -> (ReaderSession, OfflineLibrary, CloudLibraryClient) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { ContentsSearchProtocol.probe = nil; try? FileManager.default.removeItem(at: root) }
        let input = root.appendingPathComponent("Synthetic.txt")
        try Data("A patient reader can keep going slowly and return to a difficult sentence.".utf8).write(to: input)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .account(UUID(uuidString: owner)!))
        let book = try await library.importFile(input)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ContentsSearchProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string:"https://contents.fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id:owner,email:nil),token:"synthetic-contents-only"), configuration:config)
        return (session,library,cloud)
    }
    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 { if condition() { return }; try? await Task.sleep(for:.milliseconds(5)) }
        XCTFail("Synthetic search did not settle",file:file,line:line)
    }
    func testSemanticSearchUsesItsOwnDraftAndOnlyValidatedSourceDestinations() async throws {
        let (session,library,cloud) = try await fixture(), controller = ContentsAISearch()
        let ordinary = Data(#"{"question":"Keep my ordinary chat draft"}"#.utf8)
        try await library.saveConversationDraft(ordinary,bookID:session.book.id,ownerID:owner)
        let probe = ContentsSearchProbe(owner:owner,book:session.book); ContentsSearchProtocol.probe = probe
        controller.search("How can I continue when this is difficult?",session:session,cloud:cloud,library:library)
        await waitUntil { !controller.running }
        XCTAssertNil(controller.error); XCTAssertEqual(controller.matches.count,1)
        XCTAssertEqual(controller.matches.first?.quote,"patient reader")
        XCTAssertEqual(controller.matches.first?.anchor.passageID,session.chapter.passages.first?.id)
        let unchanged = try await library.conversationDraft(bookID:session.book.id,ownerID:owner)
        XCTAssertEqual(unchanged,ordinary)
        XCTAssertEqual(probe.posts,1); XCTAssertEqual(probe.historyCount,0)
    }
    func testUnconfirmedCancellationRetainsSameRequestAndCannotStartAnotherPaidSearch() async throws {
        let (session,library,cloud) = try await fixture(), controller = ContentsAISearch()
        let probe = ContentsSearchProbe(owner:owner,book:session.book,hold:true,cancelStatus:503); ContentsSearchProtocol.probe = probe
        controller.search("Where should I slow down?",session:session,cloud:cloud,library:library)
        await waitUntil { probe.posts == 1 }
        controller.stop(cloud:cloud)
        await waitUntil { controller.status?.contains("尚未确认") == true }
        XCTAssertTrue(controller.pendingRecovery); XCTAssertTrue(probe.stops > 0)
        let stored = try await library.conversationDraft(bookID:"contents-search:" + session.book.id,ownerID:owner)
        let saved = try XCTUnwrap(stored)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with:saved) as? [String:Any]), pending = try XCTUnwrap(object["retry"] as? [String:Any])
        XCTAssertEqual(pending["id"] as? String,probe.requestID)
        let body = try XCTUnwrap((pending["body"] as? String).flatMap { Data(base64Encoded:$0) })
        XCTAssertEqual(body,probe.requestBody)
        controller.search("A different question",session:session,cloud:cloud,library:library)
        await waitUntil { !controller.running }
        XCTAssertEqual(probe.posts,1); XCTAssertTrue(controller.pendingRecovery)
    }
    func testRecoveryKeepsTheFrozenQuestionSeparateFromNewInputAndReusesItsRequest() async throws {
        let (session,library,cloud) = try await fixture(), controller = ContentsAISearch()
        let probe = ContentsSearchProbe(owner:owner,book:session.book,hold:true,cancelStatus:503); ContentsSearchProtocol.probe = probe
        let original = "Where should I slow down?"
        controller.search(original,session:session,cloud:cloud,library:library)
        await waitUntil { probe.posts == 1 }; controller.stop(cloud:cloud)
        await waitUntil { controller.status?.contains("尚未确认") == true }
        probe.completeHeld()
        controller.search("A different question",session:session,cloud:cloud,library:library,recovering:true)
        await waitUntil { !controller.running }
        XCTAssertNil(controller.error); XCTAssertEqual(controller.submittedQuery,original)
        XCTAssertEqual(controller.matches.count,1); XCTAssertEqual(probe.posts,1)
    }
    func testConfirmedCancellationRetiresOnlyTheIsolatedSearchRequest() async throws {
        let (session,library,cloud) = try await fixture(), controller = ContentsAISearch()
        let probe = ContentsSearchProbe(owner:owner,book:session.book,hold:true); ContentsSearchProtocol.probe = probe
        controller.search("Find a way to keep reading",session:session,cloud:cloud,library:library)
        await waitUntil { probe.posts == 1 }; controller.stop(cloud:cloud)
        await waitUntil { controller.status == "已停止搜索" }
        XCTAssertFalse(controller.pendingRecovery)
        let stored = try await library.conversationDraft(bookID:"contents-search:" + session.book.id,ownerID:owner)
        let data = try XCTUnwrap(stored)
        XCTAssertNil((try JSONSerialization.jsonObject(with:data) as? [String:Any])?["retry"])
    }
}

private final class ContentsSearchProbe: @unchecked Sendable {
    let owner: String, book: LocalBook, hold: Bool, cancelStatus: Int
    private let lock = NSLock(); private var recordedPosts = 0, recordedStops = 0, history = -1
    private var id: String?, body: Data?, recoveryReady = false
    init(owner: String,book: LocalBook,hold: Bool = false,cancelStatus: Int = 200) { self.owner=owner;self.book=book;self.hold=hold;self.cancelStatus=cancelStatus }
    var posts: Int { lock.withLock { recordedPosts } }
    var stops: Int { lock.withLock { recordedStops } }
    var historyCount: Int { lock.withLock { history } }
    var requestID: String? { lock.withLock { id } }
    var requestBody: Data? { lock.withLock { body } }
    func stopped() { lock.withLock { recordedStops += 1 } }
    func completeHeld() { lock.withLock { recoveryReady = true } }
    func response(_ request: URLRequest) -> (Int,[String:Any])? {
        let path = request.url!.path
        if path == "/api/auth/session" { return (200,["user":["id":owner],"billing":["enabled":false]]) }
        if path.hasSuffix("/cancel") { return (cancelStatus,cancelStatus == 200 ? ["id":requestID ?? "", "status":"cancelled"] : ["error":"Synthetic cancellation unavailable"]) }
        if request.httpMethod == "GET" {
            if path != "/api/library/local-chat", lock.withLock({ recoveryReady }) {
                let bytes = requestBody ?? Data(), fields = (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
                return (200,["turn": completed(fields), "pendingTools": []])
            }
            return (200,["available":true])
        }
        var bytes = request.httpBody ?? Data()
        if bytes.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating:0,count:8192)
            while true { let count = stream.read(&buffer,maxLength:buffer.count); if count <= 0 { break }; bytes.append(buffer,count:count) }
        }
        let fields = (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
        lock.withLock { recordedPosts += 1; id=fields["id"] as? String; body=bytes; history=(fields["history"] as? [Any])?.count ?? -1 }
        if hold { return nil }
        return (200,completed(fields))
    }
    private func completed(_ fields: [String:Any]) -> [String:Any] {
        let chapter=book.chapters[0], passage=chapter.passages[0]
        let reference: [String:Any] = ["bookId":book.id,"contentVersion":book.sourceVersion,"sourceVersion":book.sourceVersion,"chapterId":chapter.id,"passageId":passage.id,"layer":"original","source":"local-device","quote":"patient reader"]
        return ["id":fields["id"] ?? "missing", "text":fields["text"] ?? "", "status":"completed","contentVersion":book.sourceVersion,"answer":["summary":"An isolated semantic result","sourceRefs":[reference]]]
    }
}
private final class ContentsSearchProtocol: URLProtocol, @unchecked Sendable {
    static var probe: ContentsSearchProbe?
    override class func canInit(with request:URLRequest) -> Bool { true }
    override class func canonicalRequest(for request:URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let response=Self.probe?.response(request) else { return }
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:response.0,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:(try? JSONSerialization.data(withJSONObject:response.1)) ?? Data());client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { Self.probe?.stopped() }
}
