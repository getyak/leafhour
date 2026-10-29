import XCTest
import UIKit
@testable import Leafhour

final class CompanionSheetLayoutTests: XCTestCase {
    func testDockedKeyboardDoesNotAddItsWholeHeightToTheHalfSheet() {
        let layout = CompanionSheetGeometry(windowSize: CGSize(width: 402, height: 874), bottomSafeArea: 34,
                                            keyboardFrame: CGRect(x: 0, y: 540, width: 402, height: 334))
        XCTAssertEqual(layout.keyboardOverlap, 334)
        XCTAssertEqual(layout.detentHeight(minimumContentHeight: 176), 176)
        // The system adds keyboard avoidance to the selected content detent.
        // This leaves enough room for navigation and typing while keeping the book visible.
        let visibleBook = 874 - 334 - 34 - layout.detentHeight(minimumContentHeight: 176)
        XCTAssertGreaterThan(visibleBook, 874 * 0.35)
    }

    func testShortKeyboardUsesOnlyTheSpaceNeededAndHideRestoresHalfHeight() {
        let visible = CompanionSheetGeometry(windowSize: CGSize(width: 402, height: 874), bottomSafeArea: 34,
                                             keyboardFrame: CGRect(x: 0, y: 674, width: 402, height: 200))
        XCTAssertEqual(visible.detentHeight(minimumContentHeight: 176), 203)
        let hidden = CompanionSheetGeometry(windowSize: CGSize(width: 402, height: 874), bottomSafeArea: 34, keyboardFrame: .null)
        XCTAssertEqual(hidden.detentHeight(minimumContentHeight: 176), 403)
    }

    func testFloatingOrOffscreenKeyboardDoesNotShrinkThePanel() {
        for frame in [CGRect(x: 300, y: 450, width: 260, height: 220), CGRect(x: 0, y: 874, width: 1024, height: 334)] {
            let layout = CompanionSheetGeometry(windowSize: CGSize(width: 1024, height: 874), bottomSafeArea: 20, keyboardFrame: frame)
            XCTAssertEqual(layout.keyboardOverlap, 0)
            XCTAssertEqual(layout.detentHeight(minimumContentHeight: 176), 417)
        }
    }

    func testMinimumTypingSpaceCanGrowForAccessibleComposerWithoutExceedingRestingContentHeight() {
        let layout = CompanionSheetGeometry(windowSize: CGSize(width: 402, height: 874), bottomSafeArea: 34,
                                            keyboardFrame: CGRect(x: 0, y: 540, width: 402, height: 334))
        XCTAssertEqual(layout.detentHeight(minimumContentHeight: 220), 220)
        XCTAssertEqual(layout.detentHeight(minimumContentHeight: 900), 403)
    }
}
