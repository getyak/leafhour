import XCTest
@testable import LeafhourCore

final class BookSharingTests: XCTestCase {
    private let owner = "11111111-1111-4111-8111-111111111111"
    override func tearDown() { BookSharingTransport.handler = nil; super.tearDown() }
    private func client() -> CloudLibraryClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BookSharingTransport.self]
        configuration.httpAdditionalHeaders = ["Authorization": "must-not-enter-public-preview"]
        return CloudLibraryClient(baseURL: URL(string: "https://sharing.fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: "reader@example.invalid"), token: "fixture-session"), configuration: configuration)
    }
    private func giftJSON() -> [String: Any] {
        let token = String(repeating: "a", count: 43)
        return ["token": token, "bookId": "book", "title": ["en": "A book"], "author": "Author", "includeTranslations": false, "shareUrl": "/gift/" + token]
    }
    func testRecognizedGiftLinksKeepOnlyTheExactOpaqueToken() throws {
        let token = String(repeating: "a", count: 43)
        XCTAssertEqual(try NativeBookLink(URL(string: "https://leafhour.com/gift/" + token)!), .gift(token))
        XCTAssertEqual(try NativeBookLink(URL(string: "leafhour://gift/" + token)!), .gift(token))
        XCTAssertEqual(try NativeBookLink(URL(string: "https://leafhour.com/gift/" + token + "?ui=ja")!), .gift(token))
    }

    func testRejectsOtherHostsCredentialsAmbiguousParametersAndUnexpectedPaths() {
        for raw in ["https://leafhour.com.evil.invalid/gift/" + String(repeating: "a", count: 43),
                    "https://user@leafhour.com/read?book=alice", "https://leafhour.com/read?book=alice&book=other",
                    "http://leafhour.com/read?book=alice", "leafhour://auth/callback?code=private",
                    "leafhour://gift/short", "https://leafhour.com/read?book=alice&redirect=https://evil.invalid",
                    "https://leafhour.com/read?book=alice#private", "https://leafhour.com:444/read?book=alice"] {
            XCTAssertThrowsError(try NativeBookLink(URL(string: raw)!), raw)
        }
    }

    func testPublicReaderLinkRetainsAnExactSourceAnchor() throws {
        XCTAssertEqual(try NativeBookLink(URL(string: "https://leafhour.com/read?book=gutenberg-alice&passage=ch01-p002&ui=zh-Hans")!),
                       .read(bookID: "gutenberg-alice", passageID: "ch01-p002"))
        XCTAssertEqual(try NativeBookLink(URL(string: "leafhour://read?book=gutenberg-alice&passage=ch01-p002")!),
                       .read(bookID: "gutenberg-alice", passageID: "ch01-p002"))
    }

    func testOnlyExplicitPublicShelfMetadataProducesAReaderShareURL() throws {
        let unknown = CloudShelfBook(id: "private-book", title: "Private", author: "Author", contentVersion: "v1")
        XCTAssertNil(unknown.publicReadingURL())
        let privateBook = try CloudShelfBook(json: CloudJSON.decode(Data(#"{"bookId":"private-book","title":"Private","contentVersion":"v1","visibility":"private"}"#.utf8)))
        XCTAssertNil(privateBook?.publicReadingURL())
        let publicBook = try XCTUnwrap(CloudShelfBook(json: CloudJSON.decode(Data(#"{"bookId":"gutenberg-alice","title":"Alice","contentVersion":"v1","visibility":"public"}"#.utf8))))
        XCTAssertEqual(publicBook.publicReadingURL()?.absoluteString, "https://leafhour.com/read?book=gutenberg-alice")
        let decoded = try JSONDecoder().decode(CloudShelfBook.self, from: JSONEncoder().encode(publicBook))
        XCTAssertEqual(decoded.publicReadingURL(), publicBook.publicReadingURL())
    }

    func testGiftReceiptsCannotSubstituteAnArbitraryLinkOrAnotherToken() throws {
        let token = String(repeating: "a", count: 43)
        let raw: [String: CloudJSON] = ["token": .string(token), "shareUrl": .string("/gift/" + token), "bookId": .string("book"), "title": .string("Book"), "includeTranslations": .bool(false)]
        let gift = try BookGift(json: .object(raw))
        XCTAssertEqual(gift.url().absoluteString, "https://leafhour.com/gift/" + token)
        var wrong = raw; wrong["shareUrl"] = .string("https://evil.invalid/gift/" + token)
        XCTAssertThrowsError(try BookGift(json: .object(wrong)))
        wrong["shareUrl"] = .string("/gift/" + String(repeating: "b", count: 43))
        XCTAssertThrowsError(try BookGift(json: .object(wrong)))
    }

    func testPublicPreviewUsesTheConfiguredTransportWithoutAnyAccountCredentials() async throws {
        let cloud = client(), token = String(repeating: "a", count: 43)
        BookSharingTransport.handler = { [self] transport, request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/book-gifts/" + token)
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Reader-Owner"))
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            transport.reply(giftJSON())
        }
        let preview = try await cloud.bookGift(token: token)
        XCTAssertEqual(preview.token, token)
        let active = await cloud.activeAccount()
        XCTAssertEqual(active?.id, owner)
    }

    func testCreateAcceptAndRevokeUseTheExistingAuthenticatedGiftContracts() async throws {
        let cloud = client(), token = String(repeating: "a", count: 43)
        var paths: [String] = []
        BookSharingTransport.handler = { [self] transport, request in
            let path = request.url!.path; paths.append(path)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "marginalia_session=fixture-session")
            if path == "/api/library/books/book/gifts" {
                do {
                    let body = try BookSharingTransport.body(request)
                    XCTAssertEqual(body["includeTranslations"] as? Bool, false)
                    XCTAssertEqual(Set(body.keys), ["includeTranslations", "message", "recipient"])
                    transport.reply(giftJSON())
                } catch { transport.fail(error) }
            } else if path.hasSuffix("/accept") { transport.reply(["bookId": "book", "alreadyOwned": true, "readUrl": "/read?book=book"]) }
            else if path.hasSuffix("/revoke") { transport.reply(["revoked": true]) }
            else { transport.reply(["error": "Unexpected path"], status: 404) }
        }
        _ = try await cloud.createBookGift(bookID: "book", ownerID: owner, includeTranslations: false)
        let accepted = try await cloud.acceptBookGift(token: token, ownerID: owner)
        XCTAssertTrue(accepted.alreadyOwned)
        try await cloud.revokeBookGift(token: token, ownerID: owner)
        XCTAssertEqual(paths, ["/api/library/books/book/gifts", "/api/book-gifts/" + token + "/accept", "/api/book-gifts/" + token + "/revoke"])
    }

    func testAnArchivedBookIsAuthorizedByItsManifestWithoutRestoringOrListingTheShelf() async throws {
        let cloud = client()
        BookSharingTransport.handler = { transport, request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/library/books/archived-public/reading-manifest")
            transport.reply(["bookId": "archived-public", "contentVersion": "v1", "title": "Archived public book", "visibility": "public"])
        }
        let book = try await cloud.readableBook(bookID: "archived-public", ownerID: owner)
        XCTAssertEqual(book.id, "archived-public")
        XCTAssertEqual(book.visibility, "public")
    }

    func testAnAcceptResponseCannotSurviveAnAccountGenerationChange() async throws {
        let cloud = client(), token = String(repeating: "a", count: 43)
        let started = expectation(description: "accept request is in flight")
        var held: BookSharingTransport?
        BookSharingTransport.handler = { transport, request in
            if request.url!.path.hasSuffix("/accept") { held = transport; started.fulfill() }
            else { transport.reply(["ok": true]) }
        }
        let pending = Task { try await cloud.acceptBookGift(token: token, ownerID: owner) }
        await fulfillment(of: [started], timeout: 3)
        await cloud.signOut()
        held?.reply(["bookId": "book", "alreadyOwned": false, "readUrl": "/read?book=book"])
        do { _ = try await pending.value; XCTFail("A stale owner accepted the gift response") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
    }
}

private final class BookSharingTransport: URLProtocol {
    static var handler: ((BookSharingTransport, URLRequest) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "sharing.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { fail(URLError(.unsupportedURL)); return }
        handler(self, request)
    }
    func reply(_ json: [String: Any], status: Int = 200) {
        do {
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: json)); client?.urlProtocolDidFinishLoading(self)
        } catch { fail(error) }
    }
    func fail(_ error: Error) { client?.urlProtocol(self, didFailWithError: error) }
    override func stopLoading() { }
    static func body(_ request: URLRequest) throws -> [String: Any] {
        if let data = request.httpBody { return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:] }
        guard let stream = request.httpBodyStream else { return [:] }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let size = stream.read(&buffer, maxLength: buffer.count); if size <= 0 { break }; data.append(contentsOf: buffer.prefix(size)) }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }
}
