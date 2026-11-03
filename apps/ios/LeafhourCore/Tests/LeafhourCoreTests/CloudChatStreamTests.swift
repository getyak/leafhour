import XCTest
@testable import LeafhourCore

final class CloudChatStreamTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000831"
    override func tearDown() { ChatStreamProtocol.handler = nil; super.tearDown() }
    func testProgressArrivesBeforeTerminalAndUsesOwnerHeaders() async throws {
        ChatStreamProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/x-ndjson")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), self.owner)
            return (200, "application/x-ndjson", ["{\"type\":\"progress\",\"id\":\"one\",\"sequence\":1,\"text\":\"你好\"}\n", "{\"type\":\"result\",\"turn\":{\"id\":\"one\",\"status\":\"completed\"}}\n"])
        }
        let collector = ChatFrameCollector()
        let result = try await client().streamChat(path: "/api/library/local-chat", body: Data("{}".utf8), ownerID: owner) { await collector.add($0) }
        XCTAssertEqual(result["id"].string, "one")
        let types = await collector.types
        XCTAssertEqual(types, ["progress", "result"])
    }
    func testLostTerminalFailsRatherThanCompletingPartialText() async throws {
        ChatStreamProtocol.handler = { _ in (200, "application/x-ndjson", ["{\"type\":\"progress\",\"text\":\"partial\"}\n"]) }
        do { _ = try await client().streamChat(path: "/api/library/chat", body: Data("{}".utf8), ownerID: owner) { _ in }; XCTFail("Missing receipt must fail") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 502) }
    }
    func testJSONCompatibilityAndOwnerMismatch() async throws {
        ChatStreamProtocol.handler = { _ in (200, "application/json", ["{\"id\":\"legacy\"}"]) }
        let cloud = client()
        let value = try await cloud.streamChat(path: "/api/library/chat", body: Data("{}".utf8), ownerID: owner) { _ in }
        XCTAssertEqual(value["id"].string, "legacy")
        do { _ = try await cloud.streamChat(path: "/api/library/chat", body: Data(), ownerID: "different") { _ in }; XCTFail("Wrong owner") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
    }
    private func client() -> CloudLibraryClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ChatStreamProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://chat.test")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "synthetic"), configuration: config)
    }
}
private actor ChatFrameCollector {
    var types: [String] = []
    func add(_ event: CloudJSON) { types.append(event["type"].string ?? "") }
}
private final class ChatStreamProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, String, [String]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (code, type, chunks) = Self.handler!(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": type])!, cacheStoragePolicy: .notAllowed)
        for chunk in chunks { client?.urlProtocol(self, didLoad: Data(chunk.utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
