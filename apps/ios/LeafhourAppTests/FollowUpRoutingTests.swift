import XCTest
import Foundation
import LeafhourCore
@testable import Leafhour

@MainActor
final class FollowUpRoutingTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000514"
    override func tearDown() { FollowUpRoutingURLProtocol.probe = nil; super.tearDown() }

    func testGlobalChatFollowUpUsesRestoredLibraryIdentityAndPreservesComposerOnDuplicateTap() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try OfflineLibrary(root: root, scope: .account(try XCTUnwrap(UUID(uuidString: owner))))
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FollowUpRoutingURLProtocol.self]
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://follow-up-routing.test")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "isolated-routing-token"), configuration: configuration)
        let probe = FollowUpRoutingProbe(owner: owner); FollowUpRoutingURLProtocol.probe = probe
        let tools = ReaderCloudTools(), identity = ReaderCloudTools.libraryChatIdentity(ownerID: owner)
        // Exactly the default GlobalChatScreen opening path: there is no book
        // and no chatContext to provide a fictional source paragraph.
        await tools.restoreConversationDraft(identity: identity, library: library)
        await tools.loadLibraryConversation(ownerID: owner, cloud: cloud)
        XCTAssertNil(tools.chatContext)
        let parent = try XCTUnwrap(tools.turns.first), item = try XCTUnwrap(parent.followUpSuggestions.first)
        let originalReference = ReaderMessageReference(turnId: "unsent-reference", role: "user", text: "Unsent reference")
        let voice = ChatVoiceReceipt(id: UUID().uuidString.lowercased(), mimeType: "audio/x-caf", bytes: 16, sha256: String(repeating: "a", count: 64), durationMs: 1200)
        tools.question = "My unsent transcript"; tools.pendingVoice = voice; tools.pendingMessageReference = originalReference
        let sending = Task { await tools.sendFollowUp(item, parent: parent, cloud: cloud) }
        for _ in 0..<100 where !tools.sendingFollowUp { await Task.yield() }
        XCTAssertTrue(tools.sendingFollowUp)
        tools.question = "A newer draft during generation"
        await tools.sendFollowUp(item, parent: parent, cloud: cloud)
        await sending.value
        let requests = probe.posts
        XCTAssertEqual(requests.count, 1)
        let body = try XCTUnwrap(requests.first)
        XCTAssertEqual(body["text"] as? String, item.text)
        XCTAssertEqual(body["contentVersion"] as? String, ReaderCloudTools.libraryChatVersion)
        XCTAssertEqual(body["passageId"] as? String, ReaderCloudTools.libraryChatPassage)
        XCTAssertEqual((body["replyTo"] as? [String: String])?["turnId"], parent.id)
        XCTAssertEqual((body["replyTo"] as? [String: String])?["role"], "assistant")
        XCTAssertNil(body["voice"]); XCTAssertNil(body["localBook"]); XCTAssertNil(body["quote"]); XCTAssertNil(body["guideContext"])
        XCTAssertEqual(tools.question, "A newer draft during generation"); XCTAssertEqual(tools.pendingVoice, voice)
        XCTAssertEqual(tools.pendingMessageReference?.turnId, originalReference.turnId)
        XCTAssertNil(tools.error); XCTAssertNil(tools.retry)
        let saved = await tools.flushConversationDraft(); XCTAssertTrue(saved)
        let restored = ReaderCloudTools(); await restored.restoreConversationDraft(identity: identity, library: library)
        XCTAssertEqual(restored.question, tools.question); XCTAssertEqual(restored.pendingVoice, voice)
    }

    func testFollowUpWithoutValidConversationIdentityReportsAnErrorAndKeepsDraft() async throws {
        let tools = ReaderCloudTools()
        tools.conversationAvailable = true; tools.question = "Keep this draft"
        let parent = ReaderConversationTurn(id: "parent", question: "A question", answer: "Finite games have an end.", status: "completed")
        tools.turns = [parent]
        let cloud = CloudLibraryClient(baseURL: URL(string: "https://follow-up-routing.test")!)
        await tools.sendFollowUp(try XCTUnwrap(parent.followUpSuggestions.first), parent: parent, cloud: cloud)
        XCTAssertNotNil(tools.error); XCTAssertEqual(tools.question, "Keep this draft"); XCTAssertNil(tools.retry)
    }
}

private final class FollowUpRoutingProbe: @unchecked Sendable {
    let owner: String
    private let lock = NSLock()
    private var captured: [[String: Any]] = []
    init(owner: String) { self.owner = owner }
    var posts: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return captured }
    func response(_ request: URLRequest, body: [String: Any]) throws -> [String: Any] {
        if request.url!.path == "/api/auth/session" {
            Thread.sleep(forTimeInterval: 0.05)
            return ["user": ["id": owner], "billing": ["enabled": false]]
        }
        XCTAssertEqual(request.url!.path, "/api/library/chat")
        if request.httpMethod == "GET" {
            return ["bookId": "leafhour-library-chat", "contentVersion": "library-chat-v1", "scope": ["mode": "library", "revision": 0], "available": true,
                    "turns": [["id": "global-parent", "text": "What is a finite game?", "contentVersion": "library-chat-v1", "status": "completed", "answer": ["summary": "Finite games end with a winner."]]]]
        }
        lock.lock(); captured.append(body); lock.unlock()
        return ["id": body["id"]!, "text": body["text"]!, "contentVersion": "library-chat-v1", "status": "completed", "answer": ["summary": "The game has an agreed boundary."]]
    }
}

private final class FollowUpRoutingURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var probe: FollowUpRoutingProbe?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "follow-up-routing.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var data = request.httpBody ?? Data()
            if data.isEmpty, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            }
            let body: [String: Any] = data.isEmpty ? [:] : ((try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:])
            let value = try XCTUnwrap(Self.probe).response(request, body: body)
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
