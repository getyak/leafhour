import XCTest
import Foundation
@testable import LeafhourCore

final class CloudUploadCapacityTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000000344"
    private func client(_ handler: @escaping (URLRequest, Data) throws -> (Int, [String: Any])) -> CloudLibraryClient {
        UploadCapacityProtocol.handler = handler
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [UploadCapacityProtocol.self]
        return CloudLibraryClient(baseURL: URL(string: "https://upload.test")!, credential: CloudCredential(account: CloudAccount(id: owner, email: nil), token: "synthetic-upload-session"), configuration: config)
    }
    override func tearDown() { UploadCapacityProtocol.handler = nil; super.tearDown() }

    func testTwentyFourMiBTXTUsesSignedStorageAndCompactReceipt() async throws {
        let bytes = Data(repeating: 97, count: 24 * 1024 * 1024)
        let operation = UUID(uuidString: "00000000-0000-4000-8000-000000000345")!
        let cloud = client { [self] request, body in
            let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
            switch request.url!.path {
            case "/api/library/upload/start":
                XCTAssertEqual(json["filename"] as? String, "Synthetic.TXT")
                XCTAssertEqual(json["bytes"] as? Int, bytes.count)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-Reader-Owner"), owner)
                return (200, ["id": "signed-fixture", "url": "https://storage.test/storage/v1/object/upload/sign/synthetic"])
            case "/storage/v1/object/upload/sign/synthetic":
                XCTAssertEqual(request.httpMethod, "PUT")
                XCTAssertEqual(body, bytes)
                for header in ["Cookie", "Authorization", "X-Reader-Owner", "Origin"] { XCTAssertNil(request.value(forHTTPHeaderField: header), header) }
                return (200, [:])
            case "/api/library/upload/complete":
                XCTAssertEqual(json["id"] as? String, "signed-fixture")
                XCTAssertEqual(json["receiptOnly"] as? Bool, true)
                XCTAssertEqual(json["duplicatePolicy"] as? String, "new")
                XCTAssertEqual(json["operationId"] as? String, operation.uuidString.lowercased())
                return (200, ["bookId": "synthetic-book", "contentVersion": "v1"])
            default: XCTFail("Unexpected upload route"); return (500, [:])
            }
        }
        let receipt = try await cloud.uploadOriginal(bytes, filename: "Synthetic.TXT", ownerID: owner, duplicatePolicy: .new, operationID: operation)
        XCTAssertEqual(receipt, .object(["bookId": .string("synthetic-book"), "contentVersion": .string("v1")]))
    }

    func testFallbackRequestsCompactReceiptAndKeepsFrozenOperation() async throws {
        let operation = UUID(uuidString: "00000000-0000-4000-8000-000000000346")!
        let cloud = client { request, body in
            if request.url!.path.hasSuffix("/start") { return (404, ["error": "Use fallback"]) }
            XCTAssertEqual(request.url!.path, "/api/library/upload")
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["receiptOnly"] as? Bool, true)
            XCTAssertEqual(json["duplicatePolicy"] as? String, "replace")
            XCTAssertEqual(json["operationId"] as? String, operation.uuidString.lowercased())
            XCTAssertEqual(json["base64"] as? String, Data("Synthetic source".utf8).base64EncodedString())
            return (200, ["bookId": "fallback-book", "contentVersion": "v2"])
        }
        for _ in 0..<2 {
            let receipt = try await cloud.uploadOriginal(Data("Synthetic source".utf8), filename: "Synthetic.md", ownerID: owner, duplicatePolicy: .replace, operationID: operation)
            XCTAssertEqual(receipt["bookId"].string, "fallback-book")
        }
    }

    func testOversizedEPUBAndTXTStopBeforeAnyNetworkRequest() async throws {
        let cloud = client { _, _ in XCTFail("Oversized source must be rejected locally"); return (500, [:]) }
        for (name, limit) in [("Synthetic.epub", 20), ("Synthetic.txt", 64)] {
            do {
                _ = try await cloud.uploadOriginal(Data(repeating: 97, count: limit * 1024 * 1024 + 1), filename: name, ownerID: owner)
                XCTFail("Oversized source was accepted")
            } catch let error as CloudRequestError { XCTAssertEqual(error.status, 413) }
        }
    }
}

private final class UploadCapacityProtocol: URLProtocol {
    static var handler: ((URLRequest, Data) throws -> (Int, [String: Any]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var body = request.httpBody ?? Data()
            if request.httpBody == nil, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 65536)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; body.append(contentsOf: buffer.prefix(count)) }
            }
            let (status, json) = try XCTUnwrap(Self.handler)(request, body)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: json)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
