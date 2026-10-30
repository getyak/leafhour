import XCTest
@testable import LeafhourCore

final class CloudCoverTests: XCTestCase {
    func testShelfDecodesRemoteCoverAndRetainsLegacyMetadata() throws {
        let metadata = try CloudJSON.decode(Data(#"{"bookId":"alice","contentVersion":"v1","title":"Alice","coverImage":"/book-covers/alice-640.webp?v=abc123"}"#.utf8))
        XCTAssertEqual(CloudShelfBook(json: metadata)?.coverPath, "/book-covers/alice-640.webp?v=abc123")
        let legacy = CloudShelfBook(id: "old", title: "Old", author: "", contentVersion: "v1")
        XCTAssertNil(legacy.coverPath)
        XCTAssertNil(try JSONDecoder().decode(CloudShelfBook.self, from: Data(#"{"id":"old","title":"Old","author":"","contentVersion":"v1"}"#.utf8)).coverPath)
    }
    func testCoverPathRejectsExternalTraversalAndArbitraryAPI() {
        for path in ["https://evil.test/image.webp", "//evil.test/image.webp", "/api/auth/session", "/book-covers/../secret.webp", "/book-covers/a-640.webp?redirect=https://evil.test", "/api/library/books/a/cover/extra"] {
            XCTAssertFalse(CloudCoverPath.isAllowed(path), path)
        }
        XCTAssertTrue(CloudCoverPath.isAllowed("/book-covers/alice-640.webp?v=abc123"))
        XCTAssertTrue(CloudCoverPath.isAllowed("/api/library/books/private-a/cover?v=v1"))
    }
}
