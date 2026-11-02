import XCTest

/// Isolated synthetic books; no account, paid AI or physical audio acceptance.
final class ImmersiveReaderUITests: XCTestCase {
    private let app = XCUIApplication()
    private var reader: XCUIElement { app.textViews["leafhour-epub-reader"] }
    override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    override func tearDownWithError() throws { capture("final"); XCUIDevice.shared.orientation = .portrait; app.terminate() }
    private func require(_ element: XCUIElement, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), app.debugDescription, file: file, line: line)
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); attachment.name = "Immersive-" + name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func open(_ style: String = "Light", extra: [String] = []) {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-AppleInterfaceStyle", style] + extra
        app.launch()
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.reader.exists || self.app.buttons["书房显示与排序"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        if reader.exists { wake(); app.buttons["返回书房"].tap() }
        require(app.buttons["书房显示与排序"], timeout: 25)
        app.buttons["搜索书房"].tap()
        let search = app.textFields["library-search-field"]; require(search); search.tap(); search.typeText("GET317 合成验收 · 本机文本")
        if app.keyboards.buttons["搜索"].exists { app.keyboards.buttons["搜索"].tap() }
        let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，GET317 合成验收 · 本机文本")).firstMatch
        require(book); book.tap(); require(reader)
    }
    private func wake() {
        let contents = app.buttons["reader-contents"]
        if contents.exists && contents.isHittable { return }
        let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
        if grip.exists && grip.isHittable { grip.tap() }
        else { reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
        require(contents)
    }
    private func select() {
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.3)).press(forDuration: 1.2)
        require(app.descendants(matching: .any)["reader-selection-dock"].firstMatch)
    }
    func testAccessibilitySizeKeepsQuietControlsAndSelectionActionsOnScreen() {
        open(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        wake(); app.buttons["reader-read"].tap()
        let timer = app.buttons["reader-time-capsule"], ai = app.buttons["reader-ai"]
        require(timer); require(ai)
        for control in [timer, ai] {
            XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThanOrEqual(control.frame.minX, 0)
            XCTAssertLessThanOrEqual(control.frame.maxX, app.frame.width)
        }
        capture("accessibility-quiet-footer")
        select(); require(app.buttons["reader-selection-copy"])
        XCTAssertTrue(app.buttons["reader-selection-copy"].isHittable)
        XCTAssertTrue(ai.isHittable)
        capture("accessibility-selection-dock")
    }
    func testListeningJumpDoesNotResumeReadingTime() {
        open(); wake(); app.buttons["reader-listen"].tap()
        require(app.buttons["reader-speech-play"]); app.buttons["reader-speech-play"].tap()
        app.buttons["reader-listening-return"].tap(); require(reader)
        wake(); app.buttons["reader-contents"].tap()
        let current = app.buttons["reader-contents-entry-0"]; require(current); current.tap()
        let timer = app.buttons["reader-time-capsule"]; require(timer)
        XCTAssertTrue(timer.label.contains("已暂停"), timer.label)
        let before = timer.label
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(timer.label, before, "Selecting a chapter while audio plays must not start reading time")
        capture("listening-jump-reading-paused")
    }

    // The host selects the actual simulator appearance before each method;
    // AppleInterfaceStyle launch defaults do not set iOS system appearance.
    func testEveryPaperMatchesNativeGlassInLightSystemAppearance() { verifyThemes("Light") }
    func testEveryPaperMatchesNativeGlassInDarkSystemAppearance() { verifyThemes("Dark") }
    private func verifyThemes(_ style: String) {
        executionTimeAllowance = 300
        open()
        for paper in ["纯白", "青苔", "雾蓝", "麦色", "浅杏", "暮色", "夜读", "系统", "暖纸"] {
            wake(); app.buttons["reader-appearance"].tap()
            let choice = app.buttons[paper == "系统" ? "跟随系统" : paper]; require(choice)
            for _ in 0..<4 where !choice.isHittable { app.swipeUp() }
            XCTAssertTrue(choice.isHittable); choice.tap()
            app.buttons["继续读"].firstMatch.tap(); wake()
            for id in ["reader-contents", "reader-read", "reader-listen", "reader-appearance", "reader-typography"] {
                let control = app.buttons[id]; XCTAssertTrue(control.isHittable, id); XCTAssertGreaterThanOrEqual(control.frame.height, 44)
            }
            capture(style + "-" + paper)
        }
    }
    func testSelectionAIButtonOpensAttributedChatAndReturnsToSameBook() {
        open(); select(); capture("selected-dock")
        app.buttons["reader-ai"].tap()
        require(app.navigationBars["Chat"])
        require(app.staticTexts["选中的原文"])
        require(app.textFields["reader-question"])
        capture("selected-chat")
        app.buttons["reader-chat-return"].tap(); require(reader)
        XCTAssertFalse(app.descendants(matching: .any)["reader-selection-dock"].firstMatch.exists)
    }
    func testDraggingExcerptToAIOpensChatWithoutSubmitting() {
        open(); select()
        let chip = app.descendants(matching: .any)["reader-selection-drag"].firstMatch
        require(chip)
        chip.press(forDuration: 1, thenDragTo: app.buttons["reader-ai"], withVelocity: .slow, thenHoldForDuration: 1)
        require(app.navigationBars["Chat"])
        require(app.staticTexts["选中的原文"])
        XCTAssertFalse(app.staticTexts["GET317 合成 AI 回答样本"].exists)
        capture("dragged-quote-chat")
    }
    func testNativeSelectedTextCanBeDraggedDirectlyIntoAI() {
        open(); select()
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.3))
            .press(forDuration: 1, thenDragTo: app.buttons["reader-ai"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 1)
        require(app.navigationBars["Chat"])
        require(app.staticTexts["选中的原文"])
        capture("native-selection-drag-chat")
    }
    func testListeningStaysFullScreenAndSupportsRotationSpeedAndPause() {
        open(); wake(); app.buttons["reader-listen"].tap()
        require(app.otherElements["reader-listening-portrait"])
        let play = app.buttons["reader-speech-play"]; require(play)
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        app.buttons["reader-listening-settings"].tap()
        let speed = app.sliders["reader-speech-speed"]; require(speed)
        speed.adjust(toNormalizedSliderPosition: 1)
        app.buttons["设为5倍"].tap()
        XCTAssertEqual(app.staticTexts["reader-speech-speed-value"].label, "5×")
        speed.adjust(toNormalizedSliderPosition: 0)
        app.buttons["设为0.5倍"].tap()
        XCTAssertEqual(app.staticTexts["reader-speech-speed-value"].label, "0.5×")
        app.buttons["完成"].tap(); XCTAssertFalse(app.buttons["暂停朗读"].exists)
        play.tap(); require(app.buttons["暂停朗读"])
        require(app.staticTexts["reader-listening-active-sentence"])
        capture("listening-portrait")
        play.tap(); require(app.buttons["继续朗读"])
        XCUIDevice.shared.orientation = .landscapeLeft
        require(app.otherElements["reader-listening-landscape"])
        XCTAssertTrue(play.isHittable)
        capture("listening-landscape")
        XCUIDevice.shared.press(.home); app.activate()
        require(app.buttons["继续朗读"])
        app.buttons["reader-listening-return"].tap(); require(reader)
    }
    func testVisibleTimeOpensBookAndDayHistoryAndCanPause() {
        open(); wake(); app.buttons["reader-read"].tap()
        let capsule = app.buttons["reader-time-capsule"]; require(capsule)
        XCTAssertTrue(capsule.label.contains("前台估计"), capsule.label)
        capsule.tap(); require(app.descendants(matching: .any)["reader-book-time"].firstMatch)
        require(app.staticTexts["按日期查看这本书"])
        require(app.buttons["暂停计时"])
        app.buttons["暂停计时"].tap()
        require(app.buttons["继续计时"])
        capture("book-day-time")
        app.buttons["继续读"].firstMatch.tap(); require(capsule)
        XCTAssertTrue(capsule.label.contains("已暂停"))
    }
}
