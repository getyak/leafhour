import XCTest
final class ReadingUITests: XCTestCase {
    func testGET313OffsetsAndColdQuote() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--get313-probe"]; app.terminate(); app.launch()
        let done = app.textViews["get313-probe-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 45), app.debugDescription)
        print("GET313-COMPONENT-EXECUTED", done.label)
        XCTAssertEqual(done.label, "all-preserved")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "GET313-component-and-reflow"; a.lifetime = .keepAlways; add(a)
        done.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.48)).press(forDuration: 1.2)
        let note = app.menuItems["记笔记"]
        XCTAssertTrue(note.waitForExistence(timeout: 5), app.debugDescription); note.tap()
        let editor = app.textViews["我的笔记正文"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); editor.tap(); editor.typeText("GET313 exact native quote draft")
        XCTAssertTrue((editor.value as? String)?.contains("GET313 exact native quote draft") == true)
        app.buttons["保留草稿"].tap()
        app.terminate(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.textViews["leafhour-epub-reader"].waitForExistence(timeout: 10))
        if !app.buttons["我的记录"].exists { app.buttons["显示阅读进度、目录、搜索与记录"].tap() }
        app.buttons["我的记录"].tap()
        let draft = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "GET313 exact native quote draft")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 5), app.debugDescription); draft.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); XCTAssertEqual(editor.value as? String, "GET313 exact native quote draft")
        let b = XCTAttachment(screenshot: app.screenshot()); b.name = "GET313-cold-draft-exact-quote"; b.lifetime = .keepAlways; add(b)
        print("GET313-COLD-DRAFT-EXECUTED")
        app.buttons["保留草稿"].tap(); app.terminate()
    }
}
