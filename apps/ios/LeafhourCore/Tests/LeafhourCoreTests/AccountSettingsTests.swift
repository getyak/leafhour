import XCTest
@testable import LeafhourCore

final class AccountSettingsTests: XCTestCase {
    override func tearDown() { AccountSettingsProtocol.handler = nil; super.tearDown() }
    func testOldCredentialsDecodeAndProfileNamePersistsWithoutReplacingIdentity() async throws {
        let owner = UUID().uuidString.lowercased()
        let old = Data("{\"id\":\"\(owner)\",\"email\":\"reader@example.invalid\"}".utf8)
        XCTAssertNil(try JSONDecoder().decode(CloudAccount.self, from: old).displayName)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AccountSettingsProtocol.self]
        let client = CloudLibraryClient(baseURL: URL(string: "https://settings.fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: "reader@example.invalid"), token: "fixture-session"), configuration: config)
        AccountSettingsProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/account/profile")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "marginalia_session=fixture-session")
            return (200, Data("{\"displayName\":\"读者\",\"avatarUrl\":null}".utf8))
        }
        let account = try await client.saveDisplayName("读者", ownerID: owner)
        XCTAssertEqual(account.id, owner); XCTAssertEqual(account.displayName, "读者")
        let savedCredential = await client.savedCredential()
        let credential = try XCTUnwrap(savedCredential)
        XCTAssertEqual(credential.token, "fixture-session")
        XCTAssertEqual(try JSONDecoder().decode(CloudCredential.self, from: JSONEncoder().encode(credential)).account.displayName, "读者")
    }
    func testDeviceExportIncludesExactConversationDraftsOnlyFromItsOwnScope() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID(), other = UUID()
        let library = try OfflineLibrary(root: root, scope: .account(owner)), foreign = try OfflineLibrary(root: root, scope: .account(other))
        let original = Data("{\"question\":\"unsent question\",\"turns\":[{\"answer\":\"saved answer\"}]}".utf8)
        try await library.saveConversationDraft(original, bookID: "leafhour-library-chat", ownerID: owner.uuidString)
        try await foreign.saveConversationDraft(Data("other account".utf8), bookID: "leafhour-library-chat", ownerID: other.uuidString)
        let exported = try await library.exportDeviceRecords()
        let drafts = exported["conversationDrafts"].array
        XCTAssertEqual(drafts.count, 1)
        XCTAssertEqual(Data(base64Encoded: drafts[0]["base64"].string ?? ""), original)
        let settings = try await library.exportDeviceRecords(settingsOnly: true)
        XCTAssertEqual(settings["conversationDrafts"], .null)
        do { _ = try await library.exportDeviceRecords(maximumBytes: 1); XCTFail("Must not silently create a partial file") } catch { }
    }
    func testAccountExportRejectsAChangedBookPartBeforeProducingData() async throws {
        let owner = UUID().uuidString.lowercased(), config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AccountSettingsProtocol.self]
        let client = CloudLibraryClient(baseURL: URL(string: "https://settings.fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "fixture-session"), configuration: config)
        AccountSettingsProtocol.handler = { request in
            let object: [String: CloudJSON]
            switch request.url!.path {
            case "/api/account/export": object = ["kind": .string("leafhour-account-data"), "schemaVersion": .number(1)]
            case "/api/account/export/manifest": object = ["kind": .string("marginalia-export-manifest"), "schemaVersion": .number(1), "books": .array([.object(["bookId": .string("book"), "contentVersion": .string("v1")])])]
            default: object = ["kind": .string("marginalia-book-export-part"), "schemaVersion": .number(1), "bookId": .string("book"), "contentVersion": .string("v2")]
            }
            return (200, try CloudJSON.encode(object))
        }
        do { _ = try await client.exportPersonalData(ownerID: owner); XCTFail("Version drift must reject the export") }
        catch let error as CloudRequestError { XCTAssertEqual(error.status, 409) }
    }
    func testAccountExportReadsMoreThanOneLegacyBackupOfBooks() async throws {
        let owner = UUID().uuidString.lowercased(), config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AccountSettingsProtocol.self]
        let client = CloudLibraryClient(baseURL: URL(string: "https://settings.fixture.invalid")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "fixture-session"), configuration: config)
        let rows = (0..<101).map { CloudJSON.object(["bookId": .string("book-\($0)"), "contentVersion": .string("v1")]) }
        AccountSettingsProtocol.handler = { request in
            let object: [String: CloudJSON]
            switch request.url!.path {
            case "/api/account/export": object = ["kind": .string("leafhour-account-data"), "schemaVersion": .number(1)]
            case "/api/account/export/manifest": object = ["kind": .string("marginalia-export-manifest"), "schemaVersion": .number(1), "books": .array(rows)]
            default:
                let id = request.url!.path.split(separator: "/")[3]
                let bytes = try CloudJSON.encode(["book": .object(["bookId": .string(String(id)), "contentVersion": .string("v1")])])
                object = ["kind": .string("marginalia-book-export-part"), "schemaVersion": .number(1), "bookId": .string(String(id)), "contentVersion": .string("v1"), "offset": .number(0), "totalBytes": .number(Double(bytes.count)), "snapshot": .string(Disk.hash(bytes)), "data": .string(bytes.base64EncodedString()), "nextOffset": .null]
            }
            return (200, try CloudJSON.encode(object))
        }
        let exported = try await client.exportPersonalData(ownerID: owner)
        XCTAssertEqual(exported["library"]["kind"], .string("leafhour-account-library"))
        XCTAssertEqual(exported["library"]["books"].array.count, 101)
    }
}

private final class AccountSettingsProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, bytes) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
