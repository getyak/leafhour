import XCTest
import SwiftUI
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderGuideContextTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000413"
    override func tearDown() { GuideContextURLProtocol.respond = nil; super.tearDown() }

    func testGuideFollowUpKeepsUserQuestionSeparateAndRestoresAIContextWithoutSendingDraftVoice() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("fixture.txt"); try Data("Fixture opening.".utf8).write(to: source)
        let library = try OfflineLibrary(root: root, scope: .account(try XCTUnwrap(UUID(uuidString: owner))))
        var book = try await library.importFile(source)
        let identity = CloudBookIdentity(ownerID: owner, bookID: "cloud-book", contentVersion: "v1", sourceFormat: "txt")
        book.cloud = identity
        let session = ReaderSession(book: book, state: ReaderState(), original: source, directory: try await library.bookDirectory(book.id), library: library)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [GuideContextURLProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://guide-context.test")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-fixture-token"), configuration: configuration)
        let guideData: [String: Any] = ["kind": "leafhour-reading-guide", "schemaVersion": 1, "id": "guide-fixture", "bookId": "cloud-book", "contentVersion": "v1", "sourceKind": "cloud", "locale": "zh-Hans", "origin": "ai", "status": "draft", "scope": "opening-sample", "opening": "开篇讨论有限游戏。", "method": "比较游戏结束的条件。", "readingQuestion": "谁决定游戏结束？", "sampleRanges": [["passageId": book.chapters[0].passages[0].id, "chapterId": book.chapters[0].id, "charOffset": 0, "charEnd": 8]], "model": "fixture-model", "createdAt": "2026-11-05T00:00:00Z"]
        let guide = try JSONDecoder().decode(ReadingGuide.self, from: JSONSerialization.data(withJSONObject: guideData))
        let item = try XCTUnwrap(guide.followUps.first)
        GuideContextURLProtocol.respond = { [owner] request, body in
            if request.url!.path == "/api/auth/session" { return ["user": ["id": owner], "billing": ["enabled": false]] }
            if request.httpMethod == "GET" { return ["available": true, "turns": []] }
            XCTAssertEqual(body["text"] as? String, item.text); XCTAssertNil(body["voice"]); XCTAssertNil(body["replyTo"])
            var context = try XCTUnwrap(body["guideContext"] as? [String: Any])
            XCTAssertEqual(context["origin"] as? String, "ai"); XCTAssertEqual(context["guideId"] as? String, guide.id)
            XCTAssertNil(context["opening"]); XCTAssertNil(context["method"])
            context["opening"] = guide.opening; context["method"] = guide.method; context["readingQuestion"] = guide.readingQuestion
            return ["id": body["id"]!, "text": body["text"]!, "contentVersion": "v1", "guideContext": context, "status": "completed", "answer": ["summary": "A guide follow-up answer."]]
        }
        let previous = ReaderCloudTools(); previous.configure(library: library, localBookID: book.id)
        await previous.restoreConversationDraft(identity: identity, library: library)
        previous.question = "My unsent transcript"
        let tools = ReaderCloudTools()
        _ = await previous.flushConversationDraft()
        await tools.prepareGuideConversation(session, cloud: cloud, library: library)
        XCTAssertEqual(tools.question, "My unsent transcript", "The actual cold guide entry restores its existing composer before sending")
        let voice = ChatVoiceReceipt(id: UUID().uuidString.lowercased(), mimeType: "audio/x-caf", bytes: 16, sha256: String(repeating: "a", count: 64), durationMs: 900)
        previous.pendingVoice = voice; _ = await previous.flushConversationDraft()
        let cold = ReaderCloudTools()
        await cold.prepareGuideConversation(session, cloud: cloud, library: library)
        XCTAssertEqual(cold.pendingVoice, voice)
        tools.pendingVoice = voice
        await tools.sendGuideFollowUp(item, guide: guide, cloud: cloud)
        XCTAssertEqual(tools.turns.last?.question, item.text); XCTAssertEqual(tools.turns.last?.guideContext?.method, guide.method)
        XCTAssertEqual(tools.question, "My unsent transcript"); XCTAssertEqual(tools.pendingVoice, voice)
        let saved = await tools.flushConversationDraft(); XCTAssertTrue(saved)
        let restored = ReaderCloudTools(); await restored.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(restored.turns.last?.guideContext?.origin, "ai"); XCTAssertEqual(restored.turns.last?.question, item.text)
        XCTAssertEqual(restored.pendingVoice, voice)
        // A failed availability refresh may still have captured the valid book
        // context. Clicking the guide must preserve a separate recoverable intent.
        tools.conversationAvailable = false
        GuideContextURLProtocol.respond = { _, _ in throw URLError(.notConnectedToInternet) }
        await tools.sendGuideFollowUp(item, guide: guide, cloud: cloud)
        XCTAssertEqual(tools.retry?.preparing, true)
        let frozen = try XCTUnwrap(tools.retry).body
        let pending = try XCTUnwrap(try JSONSerialization.jsonObject(with: frozen) as? [String: Any])
        XCTAssertEqual(pending["text"] as? String, item.text); XCTAssertNotNil(pending["guideContext"])
        XCTAssertEqual(tools.question, "My unsent transcript"); XCTAssertEqual(tools.pendingVoice, voice)
        XCTAssertNotNil(tools.error)
        _ = await tools.flushConversationDraft()
        let pendingCold = ReaderCloudTools()
        await pendingCold.prepareGuideConversation(session, cloud: cloud, library: library)
        XCTAssertEqual(pendingCold.retry?.body, frozen)
        XCTAssertEqual(pendingCold.question, "My unsent transcript"); XCTAssertEqual(pendingCold.pendingVoice, voice)
    }

    func testPreloadedConversationDoesNotInvokeAutomaticLoadAgain() async throws {
        let tools = ReaderCloudTools(), loaded = expectation(description: "normal opening invokes load")
        let normal = ChatConversationView(tools: tools, cloud: nil, bookTitle: "Fixture", source: "", load: { loaded.fulfill() }, send: {})
        let first = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844)); first.rootViewController = UIHostingController(rootView: normal); first.makeKeyAndVisible()
        await fulfillment(of: [loaded], timeout: 2)
        first.isHidden = true; first.rootViewController = nil
        let duplicate = expectation(description: "preloaded opening does not invoke load"); duplicate.isInverted = true
        let preloaded = ChatConversationView(tools: tools, cloud: nil, bookTitle: "Fixture", source: "", autoLoad: false, load: { duplicate.fulfill() }, send: {})
        let second = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844)); second.rootViewController = UIHostingController(rootView: preloaded); second.makeKeyAndVisible()
        defer { second.isHidden = true; second.rootViewController = nil }
        await fulfillment(of: [duplicate], timeout: 0.2)
    }
}

private final class GuideContextURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var respond: ((URLRequest, [String: Any]) throws -> [String: Any])?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "guide-context.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var data = httpBodyData()
            if data.isEmpty { data = Data("{}".utf8) }
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let value = try XCTUnwrap(Self.respond)(request, body)
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    private func httpBodyData() -> Data {
        if let bytes = request.httpBody { return bytes }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }; var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        return data
    }
    override func stopLoading() {}
}
