import XCTest
@testable import LeafhourCore

final class ReaderAutomaticTranslationTests: XCTestCase {
    @MainActor private func fixture() async throws -> (ReaderSession, CloudLibraryClient, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root); ContinuousTranslationProtocol.handler = nil }
        let file = root.appendingPathComponent("book.txt"); try Data("First source paragraph.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        book.cloud = CloudBookIdentity(ownerID: "owner", bookID: "cloud", contentVersion: "v1", sourceFormat: "txt")
        var next = book.chapters[0]; next.id = "next"; next.title = "Next chapter"
        var paragraph = next.passages[0]; paragraph.id = "next-p"; paragraph.text = "Next source paragraph."; next.passages = [paragraph]
        book.chapters.append(next)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: file, directory: root, library: library)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ContinuousTranslationProtocol.self]
        let client = CloudLibraryClient(baseURL: URL(string:"https://leafhour.test")!, credential: CloudCredential(account: CloudAccount(id:"owner",email:nil),token:"isolated-fixture-token"), configuration:configuration)
        return (session,client,root)
    }
    @MainActor func testCurrentThenImmediateNextPublishMatchingReceiptsWithoutMovingPosition() async throws {
        let (session,cloud,_) = try await fixture(), probe = ContinuousProbe()
        ContinuousTranslationProtocol.handler = { request in
            if request.httpMethod == "GET" { return (200,["contentVersion":"v1","sections":[]]) }
            let input = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as! [String:Any]
            let phase = input["phase"] as! String
            probe.phases.append(phase)
            let chapter = session.book.chapters[phase == "current" ? 0 : 1], passage = chapter.passages[0]
            return (200,["contentVersion":"v1","chapterId":chapter.id,"phase":phase,"done":true,"passage":["id":passage.id,"original":passage.text,"translations":["literal":["text":"直译","status":"draft","sourceVersion":"v1"],"interpretive":["text":"意译","status":"draft","sourceVersion":"v1"]]]])
        }
        let anchor = ReadingAnchor(chapterID:session.chapter.id,passageID:session.chapter.passages[0].id,characterOffset:4)
        session.recordVisible(anchor,navigationID:session.navigationID)
        let pipeline = ReaderAutomaticTranslation()
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        XCTAssertEqual(probe.phases,["current","next"])
        XCTAssertEqual(session.translations.count,2)
        XCTAssertEqual(session.currentAnchor,anchor)
        XCTAssertNil(pipeline.error)
    }
    @MainActor func testFailureStaysBlockedUntilExplicitRetryAndSourceModeDoesNotGenerate() async throws {
        let (session,cloud,_) = try await fixture(), probe = ContinuousProbe()
        ContinuousTranslationProtocol.handler = { request in
            if request.httpMethod == "GET" { return (200,["contentVersion":"v1","sections":[]]) }
            probe.phases.append("attempt")
            return (402,["error":"阅读点不足"])
        }
        let pipeline = ReaderAutomaticTranslation()
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        XCTAssertEqual(probe.phases.count,1)
        XCTAssertNotNil(pipeline.error)
        pipeline.retry()
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        XCTAssertEqual(probe.phases.count,2)
        session.state.preferences.textMode = .original
        pipeline.retry()
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        XCTAssertEqual(probe.phases.count,2)
    }
    @MainActor func testStaleReceiptNeverPublishesOrContinuesIntoAnotherChapter() async throws {
        let (session,cloud,_) = try await fixture(), probe = ContinuousProbe()
        ContinuousTranslationProtocol.handler = { request in
            if request.httpMethod == "GET" { return (200,["contentVersion":"v1","sections":[]]) }
            probe.phases.append("attempt")
            return (200,["contentVersion":"different","chapterId":session.chapter.id,"phase":"current","done":false])
        }
        let pipeline = ReaderAutomaticTranslation()
        await pipeline.run(session:session,cloud:cloud,library:nil,active:true)
        XCTAssertEqual(probe.phases.count,1)
        XCTAssertTrue(session.translations.isEmpty)
        XCTAssertNotNil(pipeline.error)
    }
    @MainActor func testOfflineCacheLoadsWithAutomaticPreparationDisabledAndNoCloudClient() async throws {
        let (session,_,root) = try await fixture()
        session.state.preferences.automaticTranslation = false
        let passage = session.chapter.passages[0]
        let cached: CloudJSON = .object(["contentVersion":.string("v1"),"sections":.array([.object(["paragraphs":.array([
            .object(["id":.string(passage.id),"original":.string(passage.text),"translations":.object(["interpretive":.object(["text":.string("已有离线译文"),"status":.string("draft"),"sourceVersion":.string("v1")])])])])])])])
        try JSONEncoder().encode(cached).write(to:root.appendingPathComponent("cloud-content.json"))
        let pipeline = ReaderAutomaticTranslation()
        await pipeline.run(session:session,cloud:nil,library:nil,active:false)
        XCTAssertEqual(session.translations[passage.id]?[.interpretive]?.text,"已有离线译文")
        XCTAssertFalse(pipeline.loading)
    }
}

private final class ContinuousProbe: @unchecked Sendable { var phases:[String] = [] }
private final class ContinuousTranslationProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int,[String:Any]))?
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        do {
            var captured = request
            if captured.httpBody == nil, let stream = captured.httpBodyStream {
                stream.open(); defer { stream.close() }
                var data = Data(), bytes = [UInt8](repeating:0,count:4096)
                while stream.hasBytesAvailable { let count = stream.read(&bytes,maxLength:bytes.count); if count <= 0 { break }; data.append(contentsOf:bytes.prefix(count)) }
                captured.httpBody = data
            }
            let (status,value) = try Self.handler!(captured)
            let response = HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!
            client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:try JSONSerialization.data(withJSONObject:value))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self,didFailWithError:error) }
    }
    override func stopLoading() {}
}
