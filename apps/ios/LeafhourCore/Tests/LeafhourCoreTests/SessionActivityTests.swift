import XCTest
@testable import LeafhourCore

final class SessionActivityTests: XCTestCase {
    private let owner = "11111111-1111-4111-8111-111111111111"
    private let other = "22222222-2222-4222-8222-222222222222"
    private let origin = URL(string: "https://activity.fixture.invalid")!
    private let now = Date(timeIntervalSince1970: 2_000_000_000)

    override func tearDown() { SessionActivityProtocol.handler = nil; super.tearDown() }

    private func client(signedIn: Bool = true) -> CloudLibraryClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionActivityProtocol.self]
        return CloudLibraryClient(baseURL: origin, credential: signedIn ? CloudCredential(account: CloudAccount(id: owner, email: "reader@example.invalid"), token: "isolated-session") : nil, configuration: configuration)
    }

    private func receipt(owner: String? = nil) -> [String: Any] {
        ["user": ["id": owner ?? self.owner, "email": "reader@example.invalid"], "expiresAt": 2_007_776_000_000, "maxAge": 7_776_000]
    }

    func testEmailAuthenticationRequestsIOSSessionPolicy() async throws {
        SessionActivityProtocol.handler = { [self] request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(try SessionActivityProtocol.body(request)["client"] as? String, "ios")
            XCTAssertTrue(["/api/auth/password", "/api/auth/verify"].contains(request.url!.path))
            return (200, receipt(), ["Set-Cookie": "marginalia_session=isolated-login; Path=/; Secure; HttpOnly"])
        }
        _ = try await client(signedIn: false).signIn(email: "reader@example.invalid", password: "isolated-password")
        _ = try await client(signedIn: false).verifyCode(email: "reader@example.invalid", code: "123456")
    }

    func testActivityPostsOwnCookieOwnerAndIOSMarkerToSameOrigin() async throws {
        SessionActivityProtocol.handler = { [self] request in
            XCTAssertEqual(request.url?.absoluteString, "https://activity.fixture.invalid/api/auth/session/activity")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://activity.fixture.invalid")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "marginalia_session=isolated-session")
            XCTAssertEqual(try SessionActivityProtocol.body(request)["client"] as? String, "ios")
            return (200, receipt(), [:])
        }
        let renewed = try await client().recordSessionActivity(ownerID: owner, now: now)
        XCTAssertTrue(renewed)
    }

    func testInteractionsAreThrottledUntilFiveMinutesAfterAttempt() async throws {
        let client = client(), requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { [self] request in requests.append(request); return (200, receipt(), [:]) }
        let first = try await client.recordSessionActivity(ownerID: owner, now: now)
        let early = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(299))
        let next = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(300))
        XCTAssertTrue(first); XCTAssertFalse(early); XCTAssertTrue(next)
        XCTAssertEqual(requests.count, 2)
    }

    func testUnauthorizedAttemptIsThrottledWithoutDiscardingOfflineCredential() async throws {
        let client = client(), requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { request in requests.append(request); return (401, ["error": "Expired fixture"], [:]) }
        do { _ = try await client.recordSessionActivity(ownerID: owner, now: now); XCTFail("Expired activity claimed success") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 401) }
        for second in 1...8 {
            let skipped = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(Double(second)))
            XCTAssertFalse(skipped)
        }
        let saved = await client.savedCredential()
        XCTAssertEqual(saved?.account.id, owner); XCTAssertEqual(saved?.token, "isolated-session")
        XCTAssertEqual(requests.count, 1)
    }

    func testTemporaryNetworkFailureKeepsCredentialAndRetriesOnlyOnLaterActivity() async throws {
        let client = client(), requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { [self] request in
            requests.append(request)
            if requests.count == 1 { throw URLError(.notConnectedToInternet) }
            return (200, receipt(), [:])
        }
        do { _ = try await client.recordSessionActivity(ownerID: owner, now: now); XCTFail("Offline request claimed renewal") }
        catch let error as URLError { XCTAssertEqual(error.code, .notConnectedToInternet) }
        let early = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(299))
        XCTAssertFalse(early)
        let credential = await client.savedCredential()
        XCTAssertEqual(credential?.account.id, owner)
        let retry = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(300))
        XCTAssertTrue(retry); XCTAssertEqual(requests.count, 2)
    }

    func testWrongOrMissingOwnerNeverReachesActivityEndpoint() async throws {
        SessionActivityProtocol.handler = { _ in XCTFail("Foreign activity reached transport"); return (200, [:], [:]) }
        for client in [client(), client(signedIn: false)] {
            do { _ = try await client.recordSessionActivity(ownerID: other, now: now); XCTFail("Foreign activity accepted") }
            catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
        }
    }

    func testSessionRestoreAndBackgroundReadsDoNotRecordActivity() async throws {
        let client = client(), requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { [self] request in requests.append(request); return (200, receipt(), [:]) }
        _ = try await client.restore()
        _ = try await client.data(path: "/api/library", ownerID: owner)
        XCTAssertEqual(requests.paths, ["/api/auth/session", "/api/library"])
        let firstActivity = try await client.recordSessionActivity(ownerID: owner, now: now)
        XCTAssertTrue(firstActivity)
        XCTAssertEqual(requests.paths.last, "/api/auth/session/activity")
    }

    func testMalformedOrForeignReceiptNeverClaimsRenewal() async throws {
        for invalid in [receipt(owner: other), ["user": ["id": owner]], ["user": ["id": owner], "expiresAt": 1, "maxAge": 7_776_000], ["user": ["id": owner], "expiresAt": 2_007_776_000_000, "maxAge": 2_592_000]] {
            SessionActivityProtocol.handler = { _ in (200, invalid, [:]) }
            do { _ = try await client().recordSessionActivity(ownerID: owner, now: now); XCTFail("Invalid activity receipt claimed success") }
            catch let error as CloudRequestError { XCTAssertEqual(error.status, 502) }
        }
    }

    @MainActor
    func testOnlyForegroundOpeningAndInteractionsRecordActivity() async throws {
        let requests = SessionActivityRequests(), foreground = ForegroundSessionActivity(client: client())
        SessionActivityProtocol.handler = { [self] request in requests.append(request); return (200, receipt(), [:]) }
        let background = try await foreground.record(ownerID: owner, now: now)
        XCTAssertFalse(background)
        foreground.setForeground(true)
        let opening = try await foreground.record(ownerID: owner, now: now)
        XCTAssertTrue(opening)
        foreground.setForeground(false)
        let suspended = try await foreground.record(ownerID: owner, now: now.addingTimeInterval(600))
        XCTAssertFalse(suspended)
        foreground.setForeground(true)
        let interaction = try await foreground.record(ownerID: owner, now: now.addingTimeInterval(601))
        XCTAssertTrue(interaction)
        XCTAssertEqual(requests.count, 2)
    }

    @MainActor
    func testSigningInWhileAlreadyForegroundRecordsFirstActivity() async throws {
        let client = client(signedIn: false), requests = SessionActivityRequests()
        let foreground = ForegroundSessionActivity(client: client)
        foreground.setForeground(true)
        let anonymous = try await foreground.record(ownerID: nil, now: now)
        XCTAssertFalse(anonymous)
        SessionActivityProtocol.handler = { [self] request in
            requests.append(request)
            return (200, receipt(), ["Set-Cookie": "marginalia_session=foreground-login; Path=/; Secure; HttpOnly"])
        }
        let account = try await client.signIn(email: "reader@example.invalid", password: "isolated-password")
        let signedIn = try await foreground.record(ownerID: account.id, now: now)
        XCTAssertTrue(signedIn)
        XCTAssertEqual(requests.paths, ["/api/auth/password", "/api/auth/session/activity"])
    }

    func testSignOutAndSignInResetThrottleEvenForSameOwnerAndToken() async throws {
        let client = client(), requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { [self] request in
            requests.append(request)
            return (200, receipt(), ["Set-Cookie": "marginalia_session=isolated-session; Path=/; Secure; HttpOnly"])
        }
        _ = try await client.recordSessionActivity(ownerID: owner, now: now)
        await client.signOut()
        _ = try await client.signIn(email: "reader@example.invalid", password: "isolated-password")
        let next = try await client.recordSessionActivity(ownerID: owner, now: now)
        XCTAssertTrue(next)
        XCTAssertEqual(requests.paths, ["/api/auth/session/activity", "/api/auth/logout", "/api/auth/password", "/api/auth/session/activity"])
    }

    func testNewClientProcessStartsWithoutPreviousActivityThrottle() async throws {
        let requests = SessionActivityRequests()
        SessionActivityProtocol.handler = { [self] request in requests.append(request); return (200, receipt(), [:]) }
        let previousProcess = try await client().recordSessionActivity(ownerID: owner, now: now)
        let nextProcess = try await client().recordSessionActivity(ownerID: owner, now: now)
        XCTAssertTrue(previousProcess); XCTAssertTrue(nextProcess); XCTAssertEqual(requests.count, 2)
    }

    func testNewAccountRenewsImmediatelyAndOldReceiptCannotResetItsThrottle() async throws {
        let client = client(), requests = SessionActivityRequests()
        let started = expectation(description: "Old owner activity started"), release = DispatchSemaphore(value: 0)
        SessionActivityProtocol.handler = { [self] request in
            requests.append(request)
            if request.url?.path == "/api/auth/password" {
                return (200, receipt(owner: other), ["Set-Cookie": "marginalia_session=new-account; Path=/; Secure; HttpOnly"])
            }
            if request.value(forHTTPHeaderField: "X-Reader-Owner") == owner {
                started.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
                return (200, receipt(), [:])
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), other)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "marginalia_session=new-account")
            return (200, receipt(owner: other), [:])
        }
        let old = Task { try await client.recordSessionActivity(ownerID: owner, now: now) }
        await fulfillment(of: [started], timeout: 2)
        _ = try await client.signIn(email: "other@example.invalid", password: "isolated-password")
        let next = try await client.recordSessionActivity(ownerID: other, now: now)
        XCTAssertTrue(next)
        release.signal()
        do { _ = try await old.value; XCTFail("Old owner receipt was accepted") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
        let throttled = try await client.recordSessionActivity(ownerID: other, now: now.addingTimeInterval(1))
        XCTAssertFalse(throttled)
        let credential = await client.savedCredential()
        XCTAssertEqual(credential?.account.id, other); XCTAssertEqual(credential?.token, "new-account")
        XCTAssertEqual(requests.paths, ["/api/auth/session/activity", "/api/auth/password", "/api/auth/session/activity"])
    }

    func testConcurrentInteractionsSendOnlyOneRequestAndLateSignOutRejectsItsReceipt() async throws {
        let client = client(), requests = SessionActivityRequests()
        let started = expectation(description: "Activity request started"), release = DispatchSemaphore(value: 0)
        SessionActivityProtocol.handler = { [self] request in
            requests.append(request)
            if request.url?.path == "/api/auth/session/activity" {
                started.fulfill()
                guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
            }
            return (200, receipt(), [:])
        }
        let renewal = Task { try await client.recordSessionActivity(ownerID: owner, now: now) }
        await fulfillment(of: [started], timeout: 2)
        let duplicate = try await client.recordSessionActivity(ownerID: owner, now: now.addingTimeInterval(600))
        XCTAssertFalse(duplicate)
        await client.signOut()
        release.signal()
        do { _ = try await renewal.value; XCTFail("Late activity claimed renewal after logout") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
        let credential = await client.savedCredential()
        XCTAssertNil(credential)
        XCTAssertEqual(requests.paths.filter { $0 == "/api/auth/session/activity" }.count, 1)
    }
}

private final class SessionActivityProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, [String: Any], [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "activity.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    static func body(_ request: URLRequest) throws -> [String: Any] {
        if let bytes = request.httpBody { return try JSONSerialization.jsonObject(with: bytes) as? [String: Any] ?? [:] }
        guard let stream = request.httpBodyStream else { return [:] }
        stream.open(); defer { stream.close() }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        return try JSONSerialization.jsonObject(with: bytes) as? [String: Any] ?? [:]
    }
    override func startLoading() {
        DispatchQueue.global().async { [self] in
          do {
            let (status, value, headers) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value))
            client?.urlProtocolDidFinishLoading(self)
          } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { }
}

private final class SessionActivityRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    func append(_ request: URLRequest) { lock.lock(); defer { lock.unlock() }; requests.append(request) }
    var count: Int { lock.lock(); defer { lock.unlock() }; return requests.count }
    var paths: [String] { lock.lock(); defer { lock.unlock() }; return requests.compactMap { $0.url?.path } }
}
