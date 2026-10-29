import XCTest
@testable import LeafhourCore

final class NativeOAuthTests: XCTestCase {
    let owner = "11111111-1111-4111-8111-111111111111"
    let state = String(repeating: "A", count: 43)
    let verifier = String(repeating: "B", count: 43)
    let transaction = String(repeating: "C", count: 43)
    let ticket = String(repeating: "D", count: 43)
    let code = String(repeating: "E", count: 43)
    let token = String(repeating: "F", count: 43)
    let origin = URL(string: "https://native.fixture.invalid")!
    override func tearDown() { NativeOAuthProtocol.handler = nil; super.tearDown() }
    func client(signedIn: Bool = false) -> CloudLibraryClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeOAuthProtocol.self]
        return CloudLibraryClient(baseURL: origin, credential: signedIn ? CloudCredential(account: CloudAccount(id: owner, email: "verified@example.invalid"), token: token) : nil, configuration: config)
    }
    func startResponse() -> [String: Any] { ["url": origin.absoluteString + "/api/auth/native/authorize?ticket=" + ticket, "transactionId": transaction, "expiresIn": 600] }
    func callback() -> URL { URL(string: "com.cubxxw.reader://auth/callback?code=\(code)&state=\(state)")! }
    func testS256RFC7636VectorAndSecureProofShapes() throws {
        XCTAssertEqual(NativeOAuthProof.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let first = try NativeOAuthProof.generate(), second = try NativeOAuthProof.generate()
        XCTAssertTrue(NativeOAuthPolicy.isOpaque(first.state)); XCTAssertTrue(NativeOAuthPolicy.isOpaque(first.codeVerifier))
        XCTAssertNotEqual(first.state, second.state); XCTAssertNotEqual(first.state, first.codeVerifier)
    }
    func testLaunchAndCallbackRejectOriginDriftDuplicateOrLeakedParameters() throws {
        let valid = origin.appendingPathComponent("api/auth/native/authorize").absoluteString + "?ticket=" + ticket
        XCTAssertNoThrow(try NativeOAuthPolicy.launchURL(valid, origin: origin))
        for candidate in [valid + "&ticket=" + ticket, valid + "&token=secret", valid + "#fragment", valid.replacingOccurrences(of: "https://", with: "http://"), valid.replacingOccurrences(of: "native.fixture.invalid", with: "native.fixture.invalid.evil.test"), valid.replacingOccurrences(of: "/authorize?", with: "/different?")] {
            XCTAssertThrowsError(try NativeOAuthPolicy.launchURL(candidate, origin: origin), candidate)
        }
        XCTAssertEqual(try NativeOAuthPolicy.callback(callback(), expectedState: state), .code(code))
        for candidate in [callback().absoluteString + "&state=" + state, callback().absoluteString + "&access_token=secret", callback().absoluteString + "#token", callback().absoluteString.replacingOccurrences(of: "://auth/", with: "://elsewhere/"), callback().absoluteString.replacingOccurrences(of: "/callback?", with: "/other?"), "com.cubxxw.reader://auth/callback?error=raw-provider-diagnostic&state=" + state] {
            XCTAssertThrowsError(try NativeOAuthPolicy.callback(URL(string: candidate)!, expectedState: state), candidate)
        }
        XCTAssertThrowsError(try NativeOAuthPolicy.callback(callback(), expectedState: String(repeating: "Z", count: 43)))
    }
    func testSignInExchangesOverHTTPSAndOnlyThenAdoptsOpaqueCredential() async throws {
        let client = client(), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            let body = try NativeOAuthProtocol.body(request)
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            if request.url!.path.hasSuffix("start") {
                XCTAssertEqual(body["mode"] as? String, "sign-in"); XCTAssertEqual(body["codeChallenge"] as? String, proof.codeChallenge)
                XCTAssertNil(body["codeVerifier"]); return (200, startResponse(), [:])
            }
            XCTAssertEqual(request.url!.path, "/api/auth/native/exchange")
            XCTAssertEqual(body["codeVerifier"] as? String, verifier); XCTAssertEqual(body["state"] as? String, state)
            return (200, ["user": ["id": owner, "email": "verified@example.invalid"]], ["Set-Cookie": "marginalia_session=\(token); Path=/; Secure; HttpOnly; SameSite=Strict"])
        }
        let flow = try await client.beginNativeOAuth(provider: .google, mode: .signIn, proof: proof)
        let before = await client.activeAccount(); XCTAssertNil(before)
        let account = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback())
        XCTAssertEqual(account.id, owner)
        let credential = await client.savedCredential(); XCTAssertEqual(credential?.token, token)
        do { _ = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback()); XCTFail("Native callback replay succeeded") } catch { }
    }
    func testLinkRejectsDifferentUIDAndPreservesExistingCredential() async throws {
        let client = client(signedIn: true), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            return (200, ["user": ["id": "22222222-2222-4222-8222-222222222222", "email": "other@example.invalid"]], ["Set-Cookie": "marginalia_session=\(token); Path=/; Secure; HttpOnly"])
        }
        let flow = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof)
        do { _ = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback()); XCTFail("Link changed UID") } catch { }
        let credential = await client.savedCredential(); XCTAssertEqual(credential?.account.id, owner); XCTAssertEqual(credential?.token, token)
    }
    func testCancelAndProviderFailureNeverExchangeOrDiscardGoodLinkSession() async throws {
        let client = client(signedIn: true), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            XCTAssertEqual(request.url!.path, "/api/auth/native/cancel")
            return (200, [:], [:])
        }
        let flow = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof)
        await client.cancelNativeOAuth(flowID: flow.id)
        do { _ = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback()); XCTFail("Cancelled callback adopted") } catch { }
        let credential = await client.savedCredential(); XCTAssertEqual(credential?.token, token)
        let next = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof)
        do { _ = try await client.completeNativeOAuth(flowID: next.id, callbackURL: URL(string: "com.cubxxw.reader://auth/callback?error=linking_disabled&state=" + state)!); XCTFail("Failure adopted") } catch { }
        let after = await client.savedCredential(); XCTAssertEqual(after?.token, token)
    }
    func testPersistenceFailureDoesNotInstallNewCredential() async throws {
        let client = client(), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            return (200, ["user": ["id": owner]], ["Set-Cookie": "marginalia_session=\(token); Path=/; Secure; HttpOnly"])
        }
        let flow = try await client.beginNativeOAuth(provider: .google, mode: .signIn, proof: proof)
        do { _ = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback(), persist: { _ in throw LibraryError.invalid("Fixture keychain unavailable") }); XCTFail("Persistence failure ignored") } catch { }
        let after = await client.activeAccount(); XCTAssertNil(after)
    }
    func testLateExchangeAfterCancellationAndSignOutCannotAdoptCredential() async throws {
        let client = client(signedIn: true), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        let started = expectation(description: "Exchange reached the server"), release = DispatchSemaphore(value: 0)
        NativeOAuthProtocol.handler = { [self] request in
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            if request.url!.path.hasSuffix("exchange") {
                started.fulfill(); guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
                return (200, ["user": ["id": owner]], ["Set-Cookie": "marginalia_session=\(token); Path=/; Secure; HttpOnly"])
            }
            return (200, [:], [:])
        }
        let flow = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof)
        let exchange = Task { try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback()) }
        await fulfillment(of: [started], timeout: 2)
        let logout = Task { await client.signOut() }
        try await Task.sleep(for: .milliseconds(80)); release.signal()
        await logout.value
        do { _ = try await exchange.value; XCTFail("Cancelled late exchange adopted a credential") } catch { }
        let after = await client.activeAccount(); XCTAssertNil(after)
    }
    func testLinkRejectsRotatedOpaqueTokenEvenForSameUID() async throws {
        let client = client(signedIn: true), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            return (200, ["user": ["id": owner]], ["Set-Cookie": "marginalia_session=\(String(repeating: "G", count: 43)); Path=/; Secure; HttpOnly"])
        }
        let flow = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof)
        do { _ = try await client.completeNativeOAuth(flowID: flow.id, callbackURL: callback()); XCTFail("Link replaced its parent session") } catch { }
        let after = await client.savedCredential(); XCTAssertEqual(after?.token, token)
    }
    func testOnlyOnePendingFlowAndIdentityOwnerMustMatch() async throws {
        let client = client(signedIn: true), proof = try NativeOAuthProof(state: state, codeVerifier: verifier)
        NativeOAuthProtocol.handler = { [self] request in
            if request.url!.path.hasSuffix("start") { return (200, startResponse(), [:]) }
            return (200, ["user": ["id": "22222222-2222-4222-8222-222222222222"], "identities": [["provider": "google", "email": "other@example.invalid", "emailVerified": true]]], [:])
        }
        _ = try await client.beginNativeOAuth(provider: .google, mode: .link, proof: proof)
        do { _ = try await client.beginNativeOAuth(provider: .apple, mode: .link, proof: proof); XCTFail("A second pending flow began") } catch { }
        do { _ = try await client.linkedIdentities(ownerID: owner); XCTFail("Another account's identities were accepted") } catch { }
        let after = await client.savedCredential(); XCTAssertEqual(after?.account.id, owner)
    }
}

private final class NativeOAuthProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, [String: Any], [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    static func body(_ request: URLRequest) throws -> [String: Any] {
        if let data = request.httpBody { return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:] }
        guard let stream = request.httpBodyStream else { return [:] }
        stream.open(); defer { stream.close() }; var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }
    override func startLoading() {
        do {
            let (status, value, headers) = try XCTUnwrap(Self.handler)(request)
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: value)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
