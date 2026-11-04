import XCTest

/// Isolated fixture: verifies actual UIKit drag and tab semantics, not real-account data.
final class RootTabGestureUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        app.terminate()
    }
    private func launch() {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "--get358-journal", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.app.textViews["leafhour-epub-reader"].exists || self.app.buttons["library-avatar"].isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        if app.textViews["leafhour-epub-reader"].exists {
            let reader = app.textViews["leafhour-epub-reader"], back = app.buttons["返回书房"]
            if !back.isHittable { reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: 22)).tap() }
            XCTAssertTrue(back.waitForExistence(timeout: 5)); back.tap()
        }
        XCTAssertTrue(app.tabBars.buttons["书房"].waitForExistence(timeout: 20))
    }
    private func capture(_ label: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = label; shot.lifetime = .keepAlways; add(shot)
    }
    private func drag(left: Bool) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.82 : 0.18, dy: 0.40))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.18 : 0.82, dy: 0.40))
        start.press(forDuration: 0.05, thenDragTo: end)
    }
    func testHorizontalPagingUpdatesNativeTabsInBothDirections() {
        launch(); drag(left: true)
        XCTAssertTrue(app.otherElements["global-chat-screen"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["松鼠"].isSelected)
        drag(left: true)
        XCTAssertTrue(app.staticTexts["journal-week-duration"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["我的阅读"].isSelected)
        capture("Journal · real cached overview")
        drag(left: false)
        XCTAssertTrue(app.tabBars.buttons["松鼠"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["松鼠"].isSelected)
    }
    func testAvatarGallerySelectionAndCancelAreReachable() {
        launch(); app.buttons["library-avatar"].tap()
        let edit = app.buttons["account-change-avatar"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10)); edit.tap()
        let preset = app.buttons["avatar-preset-3"]
        XCTAssertTrue(preset.waitForExistence(timeout: 5)); preset.tap()
        XCTAssertTrue(preset.isSelected)
        XCTAssertTrue(app.buttons["avatar-photo-picker"].isHittable)
        capture("Avatar · bundled gallery and photo choice")
        app.navigationBars["选择头像"].buttons["完成"].tap()
        XCTAssertTrue(app.buttons["account-change-avatar"].waitForExistence(timeout: 5))
    }
    func testRepeatedVerticalOverscrollReturnsToTheSameBoundary() {
        launch(); app.tabBars.buttons["我的阅读"].tap()
        let duration = app.staticTexts["journal-week-duration"]
        XCTAssertTrue(duration.waitForExistence(timeout: 10))
        let scroll = app.scrollViews["journal-history"]
        for _ in 0..<4 { scroll.swipeUp() }
        let bottom = duration.frame.minY
        scroll.swipeUp(); scroll.swipeUp()
        XCTAssertEqual(duration.frame.minY, bottom, accuracy: 3, "Native bounce must settle without accumulating blank space")
        capture("Journal · settled bottom after repeated overscroll")
    }

}
