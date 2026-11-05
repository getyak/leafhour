import XCTest

/// Local isolated data only; does not establish physical-device acceptance.
final class JournalUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        app.terminate()
    }
    private func launch(_ extra: [String] = []) {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "--get358-journal", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + extra
        app.launch()
        let reader = app.textViews["leafhour-epub-reader"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in reader.exists || self.app.buttons["书房显示与排序"].isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        if reader.exists {
            let back = app.buttons["返回书房"]
            if !back.isHittable { reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: 22)).tap() }
            XCTAssertTrue(back.waitForExistence(timeout: 5)); back.tap()
        }
        XCTAssertTrue(app.tabBars.buttons["我的阅读"].waitForExistence(timeout: 30))
        app.tabBars.buttons["我的阅读"].tap()
        XCTAssertTrue(app.staticTexts["journal-week-duration"].waitForExistence(timeout: 15))
    }
    private func section(_ name: String) { app.buttons["journal-section-" + name].tap() }
    private func snapshot(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    func testOverviewOpensADayAndCalendarNavigatesMonths() {
        launch()
        let total = app.staticTexts["journal-week-duration"]
        let ready = NSPredicate(format: "label CONTAINS %@", "3 小时 24 分")
        expectation(for: ready, evaluatedWith: total); waitForExpectations(timeout: 20)
        snapshot("GET358-overview")
        var c = Calendar(identifier: .gregorian); c.timeZone = .current
        let date = c.dateComponents([.year, .month, .day], from: Date())
        let key = String(format: "%04d-%02d-%02d", date.year!, date.month!, date.day!)
        app.descendants(matching: .any)["journal-spine-" + key].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["journal-day-duration"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["journal-day-duration"].label, "42 分钟")
        snapshot("GET358-day")
        app.navigationBars.buttons.firstMatch.tap()
        section("calendar")
        XCTAssertTrue(app.buttons["journal-day-" + key].waitForExistence(timeout: 5))
        app.buttons["journal-previous-month"].tap()
        XCTAssertTrue(app.buttons["journal-next-month"].isEnabled)
        snapshot("GET358-calendar")
        app.buttons["journal-next-month"].tap()
        XCTAssertFalse(app.buttons["journal-next-month"].isEnabled)
    }
    func testNotesSearchAndReturnToVerifiedOriginal() {
        launch(); section("notes")
        let field = app.textFields["journal-note-search"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText("慢下来\n")
        let note = app.buttons["journal-note-get317-translated:note:get358-note"]
        XCTAssertTrue(note.waitForExistence(timeout: 10)); note.tap()
        XCTAssertTrue(app.buttons["journal-note-source"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["作者原文"].exists)
        snapshot("GET358-note-detail")
        app.buttons["journal-note-source"].tap()
        XCTAssertTrue(app.textViews["leafhour-epub-reader"].waitForExistence(timeout: 30))
        snapshot("GET358-source-return")
    }
    func testSettingsRemainReachableAndSearchSurvivesTabSwitch() {
        launch(); app.buttons["journal-settings"].tap()
        XCTAssertTrue(app.buttons["settings-reading-style"].waitForExistence(timeout: 10))
        app.buttons["完成"].tap()
        section("notes")
        let field = app.textFields["journal-note-search"]; field.tap(); field.typeText("not found\n")
        app.tabBars.buttons["书房"].tap(); app.tabBars.buttons["我的阅读"].tap()
        XCTAssertEqual(field.value as? String, "not found")
    }
    func testInitialFailureDoesNotPretendThereAreNoRecords() {
        launch(["--get317-records-error"])
        XCTAssertTrue(app.buttons["重新读取阅读记录"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.staticTexts["journal-week-duration"].label, "—")
        XCTAssertFalse(app.staticTexts["还没有这类笔记"].exists)
        snapshot("GET358-error")
    }
    func testAccessibilityTextKeepsNavigationAndSettingsReachable() {
        launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        XCTAssertTrue(app.buttons["journal-settings"].isHittable)
        section("calendar")
        XCTAssertTrue(app.buttons["journal-previous-month"].isHittable)
        snapshot("GET358-accessibility-calendar")
    }
}
