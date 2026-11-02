import XCTest
import UIKit
@testable import Leafhour

@MainActor final class ChatMarkdownTests: XCTestCase {
    func testBlockMarkdownRetainsReadableTextAndRealStyles() throws {
        let result = ChatMarkdownView.render("# 标题\n\n正文 **强调**。\n\n> 引用\n\n- 第一项\n- 第二项\n\n```swift\nlet value = 1\n```\n\n[来源](https://example.com)", width: 280)
        XCTAssertFalse(result.string.contains("# 标题"))
        XCTAssertTrue(result.string.contains("标题")); XCTAssertTrue(result.string.contains("第一项")); XCTAssertTrue(result.string.contains("let value = 1"))
        let text = result.string as NSString
        let heading = try XCTUnwrap(result.attribute(.font, at: text.range(of: "标题").location, effectiveRange: nil) as? UIFont)
        let body = try XCTUnwrap(result.attribute(.font, at: text.range(of: "正文").location, effectiveRange: nil) as? UIFont)
        XCTAssertGreaterThan(heading.pointSize, body.pointSize)
        let code = try XCTUnwrap(result.attribute(.font, at: text.range(of: "let value").location, effectiveRange: nil) as? UIFont)
        XCTAssertTrue(code.fontDescriptor.symbolicTraits.contains(.traitMonoSpace))
        XCTAssertEqual((result.attribute(.link, at: text.range(of: "来源").location, effectiveRange: nil) as? URL)?.absoluteString, "https://example.com")
    }
}
