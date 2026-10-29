import XCTest
import LeafhourCore
@testable import Leafhour

final class ReaderWebPolicyTests: XCTestCase {
    let origin = URL(string: "https://leafhour.com")!
    func testOnlyExactHTTPSOriginEmbeds() {
        XCTAssertTrue(ReaderWebPolicy.sameOrigin(URL(string: "https://leafhour.com/read?book=one")!, origin))
        XCTAssertTrue(ReaderWebPolicy.sameOrigin(URL(string: "https://leafhour.com:443/read")!, origin))
        for candidate in ["http://leafhour.com/read", "https://leafhour.com:444/read", "https://sub.leafhour.com/read", "https://leafhour.com.evil.test/read", "https://user:secret@leafhour.com/read", "file:///tmp/read", "javascript:alert(1)", "data:text/html,hello"] {
            XCTAssertFalse(ReaderWebPolicy.sameOrigin(URL(string: candidate)!, origin), candidate)
        }
    }
    func testOnlyHumanActivatedExternalMainFrameLinksMayLeaveTheApp() {
        let external = URL(string: "https://gutenberg.org/book")!
        XCTAssertEqual(ReaderWebPolicy.navigation(external, origin: origin, userActivated: true, mainFrame: true), .external)
        XCTAssertEqual(ReaderWebPolicy.navigation(external, origin: origin, userActivated: false, mainFrame: true), .blocked, "Redirects cannot open a system browser")
        XCTAssertEqual(ReaderWebPolicy.navigation(external, origin: origin, userActivated: true, mainFrame: false), .blocked, "Subframes cannot launch a system browser")
        XCTAssertEqual(ReaderWebPolicy.navigation(URL(string: "https://leafhour.com/read")!, origin: origin, userActivated: false, mainFrame: true), .embedded)
    }
    func testUnsafeSchemesNeverOpenEvenAfterATap() {
        for candidate in ["file:///tmp/private.txt", "javascript:alert(1)", "data:text/html,hello", "mailto:reader@example.com", "leafhour://book/one"] {
            XCTAssertEqual(ReaderWebPolicy.navigation(URL(string: candidate)!, origin: origin, userActivated: true, mainFrame: true), .blocked, candidate)
        }
        XCTAssertEqual(ReaderWebPolicy.navigation(nil, origin: origin, userActivated: true, mainFrame: true), .blocked)
    }
    func testInitialURLPinsBookAndPassageAsQueryValues() throws {
        let url = try XCTUnwrap(ReaderWebPolicy.initialURL(origin: URL(string: "https://leafhour.com/old?ignored=yes#fragment")!, bookID: "book-one&other=two", passageID: "paragraph-1"))
        XCTAssertEqual(url.path, "/read")
        XCTAssertNil(url.fragment)
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.queryItems?.count, 2)
        XCTAssertEqual(components.queryItems?.first?.name, "book")
        XCTAssertEqual(components.queryItems?.first?.value, "book-one&other=two")
        XCTAssertEqual(components.queryItems?.last?.value, "paragraph-1")
        XCTAssertNil(ReaderWebPolicy.initialURL(origin: URL(string: "http://leafhour.com")!, bookID: "one", passageID: nil))
    }
    func testCookieCredentialRequiresTheBooksExactOwnerAndSafeToken() {
        let identity = CloudBookIdentity(ownerID: "owner-one", bookID: "book-one", contentVersion: "v1", sourceFormat: "txt")
        let matching = CloudCredential(account: CloudAccount(id: "owner-one", email: nil), token: "isolated-token.123")
        XCTAssertTrue(ReaderWebPolicy.credentialMatches(matching, identity: identity))
        XCTAssertFalse(ReaderWebPolicy.credentialMatches(nil, identity: identity))
        XCTAssertFalse(ReaderWebPolicy.credentialMatches(CloudCredential(account: CloudAccount(id: "owner-two", email: nil), token: "token"), identity: identity))
        for token in ["", "token; Domain=evil.test", "token\r\nOther: value"] {
            XCTAssertFalse(ReaderWebPolicy.credentialMatches(CloudCredential(account: matching.account, token: token), identity: identity))
        }
    }
}
