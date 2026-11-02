#if DEBUG
import Foundation
import LeafhourCore

/// Local-only source acceptance. Metadata is supplied outside Git after current
/// authentication of the requested test identity. No live cloud data is read here.
enum SelectedSourceAcceptanceFixture {
    struct Input: Decodable {
        let ownerID: String
        let email: String
        let filename: String
        var source: URL {
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("SelectedSource").appendingPathComponent(filename)
        }
    }
    static func input() throws -> Input? {
        guard Bundle.main.bundleIdentifier == "org.leafhour.selectedsource.testing" else { return nil }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let file = documents.appendingPathComponent("selected-source.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let value = try JSONDecoder().decode(Input.self, from: Data(contentsOf: file))
        guard value.email == "test@cubxxw.com", UUID(uuidString: value.ownerID) != nil,
              !value.filename.contains("/"), !value.filename.contains(".."), FileManager.default.fileExists(atPath: value.source.path) else {
            throw LibraryError.invalid("Selected-source acceptance metadata is invalid")
        }
        return value
    }
    @MainActor static func makeModelIfRequested() -> LibraryModel? {
        guard ProcessInfo.processInfo.arguments.contains("--selected-source-acceptance") else { return nil }
        do {
            guard let input = try input() else { return nil }
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("SelectedSourceAcceptance")
            SelectedSourceTransport.user = input
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [SelectedSourceTransport.self]
            let credential = CloudCredential(account: CloudAccount(id: input.ownerID, email: input.email), token: "isolated-offline-source-acceptance")
            let client = CloudLibraryClient(baseURL: URL(string: "https://selected-source.invalid")!, credential: credential, configuration: configuration)
            return LibraryModel(root: root, cloud: client, credential: credential, monitorNetwork: false)
        } catch { preconditionFailure("Private source fixture could not initialize") }
    }
}
private final class SelectedSourceTransport: URLProtocol, @unchecked Sendable {
    static var user: SelectedSourceAcceptanceFixture.Input?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let user = Self.user, let url = request.url else { client?.urlProtocol(self, didFailWithError: URLError(.badURL)); return }
        let value: [String: Any] = ["user": ["id": user.ownerID, "email": user.email], "books": [], "archivedBooks": [], "accountShelf": ["version": 1, "books": [], "archivedBooks": []]]
        let status = ["/api/auth/session", "/api/library"].contains(url.path) ? 200 : 404
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: (try? JSONSerialization.data(withJSONObject: value)) ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
