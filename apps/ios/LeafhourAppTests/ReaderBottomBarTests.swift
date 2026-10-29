import XCTest
import SwiftUI
import UIKit
@testable import Leafhour

/// Real SwiftUI layout probes. Native button hit regions and action routing
/// still require the reader's XCUITest; image bounds do not establish those.
@MainActor
final class ReaderBottomBarTests: XCTestCase {
    private func renderedSize(width: CGFloat, typeSize: DynamicTypeSize = .large, colorScheme: ColorScheme = .light) throws -> CGSize {
        let bar = ReaderBottomBar(mode: .reading, chapterAccessibilityValue: "第 2 章，共 7 章",
                                  onContents: {}, onRead: {}, onListen: {}, onAppearance: {}, onTypography: {})
            .frame(width: width)
            .environment(\.dynamicTypeSize, typeSize)
            .environment(\.colorScheme, colorScheme)
        let renderer = ImageRenderer(content: bar)
        return try XCTUnwrap(renderer.uiImage, "Render the real controls at their proposed viewport").size
    }

    func testNarrowViewportUsesMoreVerticalSpaceInsteadOfShrinkingTheControls() throws {
        let wide = try renderedSize(width: 378)
        let narrow = try renderedSize(width: 240)
        XCTAssertEqual(wide.width, 378, accuracy: 0.5)
        XCTAssertEqual(narrow.width, 240, accuracy: 0.5)
        XCTAssertGreaterThan(narrow.height, wide.height * 1.5, "A narrow reader must wrap the actual controls rather than squeeze their labels into a single row")
    }

    func testAccessibilityTypeUsesVerticalSpaceForTheCompleteControls() throws {
        let ordinary = try renderedSize(width: 296)
        let accessible = try renderedSize(width: 296, typeSize: .accessibility5)
        XCTAssertEqual(accessible.width, 296, accuracy: 0.5)
        XCTAssertGreaterThan(accessible.height, ordinary.height * 1.5, "The largest system text size must grow and stack the real controls")
    }

    func testNightAppearanceKeepsTheSameControlLayout() throws {
        for typeSize in [DynamicTypeSize.large, .accessibility5] {
            let light = try renderedSize(width: 296, typeSize: typeSize)
            let dark = try renderedSize(width: 296, typeSize: typeSize, colorScheme: .dark)
            XCTAssertEqual(dark.width, light.width, accuracy: 0.5)
            XCTAssertEqual(dark.height, light.height, accuracy: 0.5)
        }
    }
    func testCompactPortraitBudgetStillLeavesRoomForTheReadingBodyAtAX5() throws {
        let bar = try renderedSize(width: 296, typeSize: .accessibility5)
        // A 568 pt compact portrait reserves 62 pt above content, 34 pt below,
        // and a 156 pt enlarged header. The two-row controls must leave at
        // least the same 120 pt unobscured body budget checked by native UI44.
        let unobscuredBody = 568 - 62 - 34 - 156 - bar.height
        XCTAssertGreaterThanOrEqual(unobscuredBody, 120, "Accessibility controls must not consume the compact reader's entire body")
    }

}
