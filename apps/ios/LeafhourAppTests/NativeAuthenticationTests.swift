import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor final class NativeAuthenticationTests: XCTestCase {
    private let owner = "11111111-1111-4111-8111-111111111111"
    private let token = String(repeating: "F", count: 43)
    private var roots: [URL] = []
    override func tearDown() { roots.forEach { try? FileManager.default.removeItem(at: $0) }; NativeAppAuthProtocol.handler = nil; super.tearDown() }
    private func client(link: Bool = false) -> CloudLibraryClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeAppAuthProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://native-app.fixture.invalid")!, credential: link ? credential : nil, configuration: config)
    }
    private var credential: CloudCredential { CloudCredential(account: CloudAccount(id: owner, email: "verified@example.invalid"), token: token) }
    private func start(_ client: CloudLibraryClient, mode: NativeOAuthMode = .signIn) async throws -> NativeOAuthFlow {
        NativeAppAuthProtocol.handler = { request in
            if request.url!.path.hasSuffix("cancel") { return (200, [:], [:]) }
            return (200, ["url": "https://native-app.fixture.invalid/api/auth/native/authorize?ticket=" + String(repeating: "D", count: 43), "transactionId": String(repeating: "C", count: 43), "expiresIn": 600], [:])
        }
        return try await client.beginNativeOAuth(provider: .apple, mode: mode)
    }
    func testSystemBrowserStartFailureAndSinglePendingCancellationAreRecoverable() async throws {
        let client = client(), flow = try await start(client), stub = NativeSessionStub()
        let browser = NativeProviderAuthentication(factory: { _, _ in stub })
        // Keep the presentation anchor alive, as the production coordinator deliberately retains it weakly.
        let window = UIWindow(); browser.setAnchor(window)
        stub.succeeds = false
        do { _ = try await browser.authenticate(flow); XCTFail("Browser start failure succeeded") } catch { }
        XCTAssertFalse(browser.isActive)
        stub.succeeds = true
        let started = expectation(description: "System browser started"); stub.onStart = { started.fulfill() }
        let first = Task { try await browser.authenticate(flow) }
        await fulfillment(of: [started], timeout: 2)
        do { _ = try await browser.authenticate(flow); XCTFail("Two browsers became pending") } catch { }
        browser.cancel()
        do { _ = try await first.value; XCTFail("Cancelled browser returned a callback") } catch is CancellationError { }
        XCTAssertEqual(stub.cancels, 1)
        XCTAssertFalse(browser.isActive)
        _ = window
    }
    func testLateBrowserCallbackAfterCancellationCannotResumeTheOperation() async throws {
        let client = client(), flow = try await start(client), stub = NativeSessionStub()
        var completion: ((URL?, Error?) -> Void)?
        let browser = NativeProviderAuthentication(factory: { _, callback in completion = callback; return stub })
        let window = UIWindow(); browser.setAnchor(window)
        let started = expectation(description: "Started"); stub.onStart = { started.fulfill() }
        let task = Task { try await browser.authenticate(flow) }
        await fulfillment(of: [started], timeout: 2)
        browser.cancel()
        completion?(URL(string: "com.cubxxw.reader://auth/callback?code=" + String(repeating: "E", count: 43) + "&state=" + String(repeating: "A", count: 43))!, nil)
        do { _ = try await task.value; XCTFail("Late callback adopted") } catch is CancellationError { }
        await Task.yield()
        XCTAssertFalse(browser.isActive)
        let account = await client.activeAccount(); XCTAssertNil(account)
        _ = window
    }
    func testExpiredBrowserOperationClosesWithoutWaitingForAProvider() async throws {
        let client = client(), flow = try await start(client), stub = NativeSessionStub()
        let browser = NativeProviderAuthentication(factory: { _, _ in stub }), window = UIWindow()
        browser.setAnchor(window)
        let started = expectation(description: "Started before expiry"); stub.onStart = { started.fulfill() }
        let task = Task { try await browser.authenticate(flow) }
        await fulfillment(of: [started], timeout: 2)
        browser.checkExpiry(now: .distantFuture)
        do { _ = try await task.value; XCTFail("Expired browser remained active") } catch { XCTAssertTrue(error.localizedDescription.contains("过期")) }
        XCTAssertEqual(stub.cancels, 1); XCTAssertFalse(browser.isActive)
        _ = window
    }
    func testLinkSuccessKeepsExistingLibraryReaderDraftsAndOpaqueToken() async throws {
        let client = client(link: true), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        roots.append(root); try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let model = LibraryModel(root: root, cloud: client, credential: credential, monitorNetwork: false)
        let library = try XCTUnwrap(model.library), file = root.appendingPathComponent("local.txt")
        try Data("A private reading thought.".utf8).write(to: file)
        let book = try await library.importFile(file), original = try await library.originalURL(book.id), directory = try await library.bookDirectory(book.id)
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id)
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: "A private reading thought.", body: "Keep this draft")
        let reader = ReaderSession(book: book, state: state, original: original, directory: directory, library: library)
        model.reader = reader; model.books = [book]; model.notebookEntries = [.string("Existing records")]
        var nativeState = "", linked = false
        NativeAppAuthProtocol.handler = { [self] request in
            switch request.url!.path {
            case "/api/auth/session": return (200, ["user": ["id": owner, "email": "verified@example.invalid"], "nativeOAuth": ["version": 1], "providers": ["apple": true, "google": true]], [:])
            case "/api/auth/identities": return (200, ["user": ["id": owner], "identities": linked ? [["provider": "email", "email": "verified@example.invalid", "emailVerified": true], ["provider": "apple", "email": "relay@example.invalid", "emailVerified": true]] : [["provider": "email", "email": "verified@example.invalid", "emailVerified": true]]], [:])
            case "/api/auth/native/start":
                nativeState = try NativeAppAuthProtocol.body(request)["state"] as? String ?? ""
                return (200, ["url": "https://native-app.fixture.invalid/api/auth/native/authorize?ticket=" + String(repeating: "D", count: 43), "transactionId": String(repeating: "C", count: 43), "expiresIn": 600], [:])
            case "/api/auth/native/exchange": linked = true; return (200, ["user": ["id": owner, "email": "verified@example.invalid"]], ["Set-Cookie": "marginalia_session=\(token); Path=/; Secure; HttpOnly"])
            default: XCTFail("Unexpected native link request"); return (404, [:], [:])
            }
        }
        await model.loadAuthenticationOptions()
        let stub = NativeSessionStub()
        let browser = NativeProviderAuthentication(factory: { _, callback in
            stub.onStart = { callback(URL(string: "com.cubxxw.reader://auth/callback?code=" + String(repeating: "E", count: 43) + "&state=" + nativeState)!, nil) }; return stub
        })
        let window = UIWindow(); browser.setAnchor(window)
        try await model.authenticate(provider: .apple, browser: browser)
        XCTAssertEqual(model.account?.id, owner)
        XCTAssertTrue(model.library === library); XCTAssertTrue(model.reader === reader)
        XCTAssertEqual(model.books, [book]); XCTAssertEqual(model.notebookEntries, [.string("Existing records")])
        XCTAssertEqual(reader.state.drafts[anchor.key]?.body, "Keep this draft")
        XCTAssertTrue(model.linkedIdentities.contains { $0.provider == "apple" })
        XCTAssertFalse(model.nativeAuthenticating)
        let after = await client.savedCredential(); XCTAssertEqual(after?.token, token)
        _ = window
    }
}

@MainActor private final class NativeSessionStub: NativeAuthenticationSession {
    var succeeds = true, cancels = 0
    var onStart: (() -> Void)?
    func start() -> Bool { onStart?(); return succeeds }
    func cancel() { cancels += 1 }
}
private final class NativeAppAuthProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, [String: Any], [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native-app.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    static func body(_ request: URLRequest) throws -> [String: Any] {
        var bytes = request.httpBody
        if bytes == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(contentsOf: buffer.prefix(n)) }; bytes = data
        }
        return try bytes.map { try JSONSerialization.jsonObject(with: $0) as? [String: Any] ?? [:] } ?? [:]
    }
    override func startLoading() {
        do {
            let (status, value, headers) = try XCTUnwrap(Self.handler)(request)
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
