import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReadingPreparationTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000344"
    private struct Fixture { let session: ReaderSession; let library: OfflineLibrary; let cloud: CloudLibraryClient }
    private func fixture() async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(UUID(uuidString: owner)!))
        let chapters = try JSONDecoder().decode([BookChapter].self, from: Data(#"[{"id":"c1","title":"One","sourcePath":"1","passages":[{"id":"p1","text":"Original one.","heading":false}]},{"id":"c2","title":"Two","sourcePath":"2","passages":[{"id":"p2","text":"Original two.","heading":false}]},{"id":"c3","title":"Three","sourcePath":"3","passages":[{"id":"p3","text":"Original three.","heading":false}]}]"#.utf8))
        let identity = CloudBookIdentity(ownerID: owner, bookID: "reading-book", contentVersion: "v1", sourceFormat: "text")
        let content: [String:Any] = ["bookId":"reading-book","contentVersion":"v1","source":["format":"text"],"sections": chapters.map { chapter in ["chapterId":chapter.id,"paragraphs":chapter.passages.map { ["id":$0.id,"original":$0.text,"translations":[:]] }] }]
        let book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic book", author: "", chapters: chapters, content: JSONSerialization.data(withJSONObject: content)))
        var state = try await library.state(book.id); state.preferences.viewMode = .translation
        let session = ReaderSession(book: book, state: state, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [PreparationProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string:"https://reading.test")!, credential: CloudCredential(account: CloudAccount(id:owner,email:nil),token:"isolated-fixture"),configuration:configuration)
        return Fixture(session:session,library:library,cloud:cloud)
    }
    private func waitForCompletion(_ reading: ReaderReadingContent) async throws {
        for _ in 0..<300 { if !reading.running { return }; try await Task.sleep(for:.milliseconds(10)) }
        XCTFail("Bounded synthetic translation did not settle")
    }
    override func tearDown() { PreparationProtocol.install(nil); super.tearDown() }

    func testUncertainRequestSurvivesRelaunchUsesSameKeyAndNeverExpandsToThirdChapter() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.failFirst = true; PreparationProtocol.install(probe)
        let first = ReaderReadingContent()
        await first.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        first.confirm(try XCTUnwrap(first.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(first)
        XCTAssertNotNil(first.error)
        let savedData = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let saved = try XCTUnwrap(savedData)
        let pending = try JSONDecoder().decode(ReaderTranslationRun.self,from:saved)
        XCTAssertNotNil(pending.pending)
        let second = ReaderReadingContent()
        await second.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        second.confirm(try XCTUnwrap(second.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(second)
        XCTAssertNil(second.error)
        let generated = probe.snapshot().filter { $0.0.hasSuffix("/translate") }
        XCTAssertEqual(generated.count,3)
        XCTAssertEqual(generated[0].1 as NSDictionary,generated[1].1 as NSDictionary,"The exact uncertain request, quote and idempotency key must be reused")
        XCTAssertEqual(generated.compactMap { $0.1["passageId"] as? String },["p1","p1","p2"])
        XCTAssertEqual(probe.snapshot().filter { $0.0 == "/api/billing/quotes" }.count,2)
        let cached = try await fixture.library.readingTranslations(bookID:fixture.session.book.id)
        XCTAssertEqual(cached["p1"]?.literal,"Literal p1"); XCTAssertEqual(cached["p2"]?.interpretive,"Interpretive p2")
        XCTAssertNil(cached["p3"]?.literal)
        let remaining = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        XCTAssertNil(remaining)
    }

    func testExplicitChapterStreamsOneChapterAndPersistsItsFirstParagraph() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner: owner)
        PreparationProtocol.install(probe)
        let reading = ReaderReadingContent()
        await reading.prepare(fixture.session, cloud: fixture.cloud, library: fixture.library, scope: .chapter)
        XCTAssertEqual(reading.proposed?.plan.chapterIDs, ["c1"])
        reading.confirm(try XCTUnwrap(reading.proposed), session: fixture.session, cloud: fixture.cloud, library: fixture.library)
        try await waitForCompletion(reading)
        XCTAssertNil(reading.error)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.compactMap { $0.1["passageId"] as? String }, ["p1"])
        XCTAssertEqual(reading.completedCount, 1)
        XCTAssertEqual(reading.totalCount, 1)
        XCTAssertEqual(fixture.session.translations["p1"]?.literal, "Literal p1")
        let saved = try await fixture.library.readingTranslations(bookID: fixture.session.book.id)
        XCTAssertEqual(saved["p1"]?.interpretive, "Interpretive p1")
        XCTAssertNil(saved["p2"]?.literal)
        XCTAssertNil(saved["p2"]?.interpretive)
    }
    func testRecoveryRejectsAnEnvelopeWhoseScopeLabelUnderstatesItsActualRange() async throws {
        let fixture = try await fixture()
        let run = ReaderTranslationRun(plan: try ReadingTranslationPlan.make(book: fixture.session.book, chapterIndex: 0, translations: [:]))
        for scope in ["passage", "chapter"] {
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(run)) as? [String: Any])
            var plan = try XCTUnwrap(value["plan"] as? [String: Any]); plan["scope"] = scope; value["plan"] = plan
            let invalid = try JSONDecoder().decode(ReaderTranslationRun.self, from: JSONSerialization.data(withJSONObject: value))
            XCTAssertThrowsError(try ReaderReadingContent.validate(invalid, session: fixture.session))
        }
    }
    func testAuthenticationFailureWhileRecoveringKeepsTheOriginalIdempotencyKey() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.generationStatuses = [503,401]; PreparationProtocol.install(probe)
        for _ in 0..<2 {
            let reading=ReaderReadingContent();await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
            reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
            try await waitForCompletion(reading)
            let savedData=try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
            let saved=try JSONDecoder().decode(ReaderTranslationRun.self,from:XCTUnwrap(savedData))
            XCTAssertNotNil(saved.pending,"An auth failure cannot retire a previously uncertain request")
        }
        let loginConfiguration=URLSessionConfiguration.ephemeral;loginConfiguration.protocolClasses=[PreparationProtocol.self]
        let loggedInAgain=CloudLibraryClient(baseURL:URL(string:"https://reading.test")!,credential:CloudCredential(account:CloudAccount(id:owner,email:nil),token:"isolated-new-login"),configuration:loginConfiguration)
        let resumed=ReaderReadingContent();await resumed.prepare(fixture.session,cloud:loggedInAgain,library:fixture.library)
        resumed.confirm(try XCTUnwrap(resumed.proposed),session:fixture.session,cloud:loggedInAgain,library:fixture.library)
        try await waitForCompletion(resumed)
        XCTAssertNil(resumed.error)
        let requests=probe.snapshot().filter { $0.0.hasSuffix("/translate") }
        XCTAssertEqual(requests.count,4)
        XCTAssertEqual(requests[0].1 as NSDictionary,requests[1].1 as NSDictionary)
        XCTAssertEqual(requests[0].1 as NSDictionary,requests[2].1 as NSDictionary)
        XCTAssertEqual(probe.snapshot().filter { $0.0 == "/api/billing/quotes" }.count,2)
    }
    func testTerminalBillingReceiptAllowsAnUnsubmittedRequestToBeRetired() async throws {
        let fixture=try await fixture(),probe=PreparationProbe(owner:owner)
        probe.generationStatuses=[400];probe.terminalStatus="not_started";PreparationProtocol.install(probe)
        let reading=ReaderReadingContent();await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        try await waitForCompletion(reading)
        let savedData=try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let saved=try JSONDecoder().decode(ReaderTranslationRun.self,from:XCTUnwrap(savedData))
        XCTAssertNil(saved.pending);XCTAssertEqual(saved.next,0)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.count,1)
    }
    func testBackgroundStopsFollowingPassagesAndRetainsSubmittedRequest() async throws {
        let fixture = try await fixture(), probe = PreparationProbe(owner:owner)
        probe.delay = 0.5; PreparationProtocol.install(probe)
        let reading = ReaderReadingContent()
        await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        reading.confirm(try XCTUnwrap(reading.proposed),session:fixture.session,cloud:fixture.cloud,library:fixture.library)
        for _ in 0..<200 {
            if probe.snapshot().contains(where:{ $0.0.hasSuffix("/translate") }) { break }
            try await Task.sleep(for:.milliseconds(10))
        }
        reading.setForeground(false)
        try await waitForCompletion(reading)
        XCTAssertEqual(probe.snapshot().filter { $0.0.hasSuffix("/translate") }.count,1)
        let pendingData = try await fixture.library.pendingReadingTranslation(bookID:fixture.session.book.id)
        let data = try XCTUnwrap(pendingData)
        XCTAssertNotNil(try JSONDecoder().decode(ReaderTranslationRun.self,from:data).pending)
    }
    func testStoppedUnsubmittedOldRangeCanBeReplacedByCurrentChapters() async throws {
        let fixture = try await fixture(), reading = ReaderReadingContent()
        let old = ReaderTranslationRun(plan: try ReadingTranslationPlan.make(book:fixture.session.book,chapterIndex:0,translations:[:]))
        try await fixture.library.savePendingReadingTranslation(JSONEncoder().encode(old),bookID:fixture.session.book.id)
        fixture.session.go(to:2)
        await reading.prepare(fixture.session,cloud:fixture.cloud,library:fixture.library)
        XCTAssertEqual(reading.proposed?.plan.chapterIDs,["c3"])
        XCTAssertEqual(reading.proposed?.plan.passageIDs,["p3"])
    }
}

private final class PreparationProbe: @unchecked Sendable {
    let owner: String
    var failFirst = false
    var generationStatuses: [Int] = []
    var terminalStatus: String?
    var delay: TimeInterval = 0
    private let lock = NSLock()
    private var requests: [(String,[String:Any])] = []
    private var generationCount = 0
    init(owner:String) { self.owner=owner }
    func snapshot() -> [(String,[String:Any])] { lock.lock(); defer { lock.unlock() }; return requests }
    func reply(_ request:URLRequest, body:[String:Any]) -> (Int,[String:Any],TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        let path=request.url!.path; requests.append((path,body))
        if path == "/api/auth/session" { return (200,["user":["id":owner],"billing":["enabled":true,"mode":"test","unitsPerPoint":1_000_000,"prices":["translation":1_000_000]]],0) }
        if path == "/api/billing/quotes" {
            let input=body["input"] as? [String:Any] ?? [:]
            return (200,["id":"quote-"+(input["id"] as? String ?? ""),"ownerId":owner,"action":"translation","mode":"test","units":1_000_000,"expiresAt":ISO8601DateFormatter().string(from:Date().addingTimeInterval(300)),"scope":["bookId":"reading-book","contentVersion":"v1","requestId":input["id"] ?? "","passageId":input["passageId"] ?? ""]],0)
        }
        if path.hasSuffix("/translate") {
            generationCount += 1
            let status = generationStatuses.indices.contains(generationCount-1) ? generationStatuses[generationCount-1] : failFirst && generationCount == 1 ? 503 : 200
            if status != 200 {
                var value: [String:Any] = ["error":"Synthetic rejected recovery"]
                if let terminalStatus { value["billingOperation"]=["status":terminalStatus] }
                return (status,value,0)
            }
            let id=body["passageId"] as? String ?? "", source=id=="p1" ? "Original one." : id=="p2" ? "Original two." : "Original three."
            return (200,["id":id,"original":source,"translations":["literal":["text":"Literal "+id,"status":"draft"],"interpretive":["text":"Interpretive "+id,"status":"draft"]]],delay)
        }
        return (404,["error":"Unconfigured synthetic endpoint"],0)
    }
}
private final class PreparationProtocol: URLProtocol, @unchecked Sendable {
    private static let lock=NSLock()
    private static var probe:PreparationProbe?
    private var work:DispatchWorkItem?
    static func install(_ probe:PreparationProbe?) { lock.lock(); Self.probe=probe; lock.unlock() }
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let probe=Self.probe; Self.lock.unlock()
        guard let probe else { client?.urlProtocol(self,didFailWithError:URLError(.notConnectedToInternet)); return }
        let bytes=request.httpBody ?? request.httpBodyStream.map { stream -> Data in
            stream.open(); defer { stream.close() }; var data=Data(),buffer=[UInt8](repeating:0,count:4096)
            while stream.hasBytesAvailable { let count=stream.read(&buffer,maxLength:buffer.count); if count<=0 { break }; data.append(buffer,count:count) }; return data
        } ?? Data()
        let body=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
        let (status,value,delay)=probe.reply(request,body:body)
        let work=DispatchWorkItem { [weak self] in
            guard let self, let response=HTTPURLResponse(url:self.request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"]), let data=try? JSONSerialization.data(withJSONObject:value) else { return }
            self.client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            self.client?.urlProtocol(self,didLoad:data); self.client?.urlProtocolDidFinishLoading(self)
        }; self.work=work; DispatchQueue.global().asyncAfter(deadline:.now()+delay,execute:work)
    }
    override func stopLoading() { work?.cancel() }
}
