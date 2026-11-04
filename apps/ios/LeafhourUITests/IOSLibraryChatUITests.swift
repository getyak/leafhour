import XCTest
import Vision

/// Isolated DEBUG fixture acceptance; no real account, paid model, microphone hardware or production claims.
final class IOSLibraryChatUITests: XCTestCase {
    private let app = XCUIApplication()
    private let textTitle = "GET317 合成验收 · 本机文本"
    private let markdownTitle = "GET317 合成验收 · Markdown"
    private var reader: XCUIElement { app.textViews["leafhour-epub-reader"] }

    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { capture(name); app.terminate() }

    private func capture(_ title: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = title; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func require(_ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing UI: \(element)\n\(app.debugDescription)", file: file, line: line)
    }
    private func launch(_ flags: [String] = []) {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + flags
        app.launch()
        if flags.contains("--ios-library-chat-duplicate") {
            require(app.buttons["保留原书"].firstMatch, timeout: 30)
        } else {
            // A full-screen reader retains the underlying shelf in accessibility.
            // Wait for actual seeded, interactive shelf readiness before tapping its controls.
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
                app.staticTexts["6 本书"].exists && app.buttons["书房显示与排序"].isHittable && !reader.exists
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, "Expected a fully seeded, uncovered shelf.\n" + app.debugDescription)
        }
    }
    private func layoutList() {
        app.buttons["书房显示与排序"].tap()
        let option = app.buttons["列表"].firstMatch
        if !option.waitForExistence(timeout: 1) { app.buttons["显示方式"].firstMatch.tap() }
        require(option); option.tap()
    }
    private func filter(_ label: String) {
        app.buttons["书房范围"].tap()
        let choice = app.buttons[label].firstMatch; require(choice); choice.tap()
    }
    private func search(_ value: String) {
        if !app.textFields["library-search-field"].exists { app.buttons["搜索书房"].tap() }
        let field = app.textFields["library-search-field"]; require(field)
        if app.buttons["library-search-clear"].exists { app.buttons["library-search-clear"].tap() }
        field.tap(); field.typeText(value)
        let keyboard = app.keyboards.firstMatch
        if keyboard.buttons["搜索"].exists { keyboard.buttons["搜索"].tap() }
        else if keyboard.buttons["Search"].exists { keyboard.buttons["Search"].tap() }
    }
    private func book(_ title: String, selecting: Bool = false) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", (selecting ? "选择，" : "阅读，") + title)).firstMatch
    }
    private func confirmRemoval() {
        let confirm = app.buttons["移除，保留个人记录"].firstMatch
        require(confirm); confirm.tap()
    }

    func testGlobalChatKeyboardComposerAndDirectMarkdownAnswer() {
        launch(["--ios-library-chat-markdown"])
        app.tabBars.buttons["Chat"].tap()
        let input = app.descendants(matching: .any)["reader-question"], microphone = app.buttons["chat-microphone"], send = app.buttons["reader-question-send"]
        require(input); require(microphone); require(send)
        input.tap(); input.typeText("Show the synthetic Markdown answer.")
        require(app.keyboards.firstMatch)
        XCTAssertTrue(input.isHittable); XCTAssertTrue(send.isHittable)
        XCTAssertLessThan(microphone.frame.midX, input.frame.midX)
        XCTAssertLessThan(input.frame.midX, send.frame.midX)
        XCTAssertLessThanOrEqual(send.frame.maxY, app.keyboards.firstMatch.frame.minY + 2)
        capture("Chat · keyboard keeps growing composer visible")
        send.tap()
        // A rendered text view proves submission completed without interacting with another confirmation.
        let answer = app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "合成 Markdown 回答")).firstMatch
        require(answer)
        XCTAssertTrue(answer.label.contains("列表甲")); XCTAssertTrue(answer.label.contains("引用内容"))
        XCTAssertTrue(answer.label.contains("let orchard = 1")); XCTAssertTrue(answer.label.contains("果园"))
        XCTAssertFalse(answer.label.contains("**")); XCTAssertFalse(answer.label.contains("```"))
        XCTAssertFalse(app.buttons["确认生成"].exists)
        capture("Chat · native Markdown direct answer")
    }

    func testMessageLongPressQuotesLikesAndWakesTheQuietComposer() {
        launch()
        app.tabBars.buttons["Chat"].tap()
        let input = app.textFields["reader-question"]
        require(input); input.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { input.tap() }
        require(app.keyboards.firstMatch); input.typeText("第一句问题")
        app.buttons["reader-question-send"].tap()
        let answer = app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "合成陪读回答")).firstMatch
        require(answer)
        require(app.buttons["chat-wake-composer"])
        answer.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.18)).press(forDuration: 1.1)
        let quote = app.menuItems["引用"].firstMatch; require(quote); quote.tap()
        require(app.descendants(matching: .any)["chat-message-reference"].firstMatch)
        require(input); input.tap(); require(app.keyboards.firstMatch)
        input.typeText("接着解释一下")
        app.buttons["reader-question-send"].tap()
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "回复 松鼠")).firstMatch
        require(saved); XCTAssertTrue(saved.label.contains("合成陪读回答"))
        capture("message-reference-follow-up")
        let latest = app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "合成陪读回答")).allElementsBoundByIndex.last!
        latest.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.18)).press(forDuration: 1.1)
        let like = app.menuItems["点赞"].firstMatch; require(like); like.tap()
        require(app.images["已点赞"].firstMatch)
        latest.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.18)).press(forDuration: 1.1)
        require(app.menuItems["取消点赞"].firstMatch)
        app.menuItems["取消点赞"].firstMatch.tap()
        app.buttons["chat-wake-composer"].tap(); require(input); XCTAssertTrue(input.isHittable)
        capture("quiet-composer-woken")
    }

    func testBrowsingHistoryKeepsItsPositionWhenReplyFinishesAndCanReturnToLatest() {
        verifyLatestNavigation()
    }

    func testAccessibleDarkChatKeepsLatestNavigationAboveTheComposer() {
        verifyLatestNavigation(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleInterfaceStyle", "Dark"])
    }

    private func verifyLatestNavigation(extra: [String] = []) {
        launch(["--reading-craft-history"] + extra)
        app.tabBars.buttons["Chat"].tap()
        let input = app.textFields["reader-question"]
        require(input); input.tap(); input.typeText("第一句合成问题")
        app.buttons["reader-question-send"].tap()
        let wake = app.buttons["chat-wake-composer"], latest = app.buttons["chat-latest"]
        require(wake)
        let history = app.scrollViews["reader-conversation-history"]
        // Wait for the fixture's delayed final response before browsing.
        let answer = app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "合成回答末尾")).firstMatch
        require(answer)
        XCTAssertFalse(latest.exists, "Programmatic layout and incoming replies must not imply browsing")
        let oldAnswer = app.textViews.matching(identifier: answer.identifier)
            .matching(NSPredicate(format: "label CONTAINS %@", "合成回答末尾")).firstMatch
        history.swipeDown()
        require(latest)
        XCTAssertTrue(latest.isHittable)
        XCTAssertGreaterThanOrEqual(latest.frame.height, 44)
        XCTAssertGreaterThanOrEqual(latest.frame.minX, wake.frame.maxX - 1)
        XCTAssertLessThanOrEqual(latest.frame.maxY, wake.frame.maxY + 1)
        capture("history-latest-control")
        latest.tap()
        let atLatest = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !latest.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [atLatest], timeout: 8), .completed)
        wake.tap(); require(input); input.tap(); input.typeText("第二句合成问题")
        app.buttons["reader-question-send"].tap()
        require(app.buttons["停止回答"].firstMatch)
        history.swipeDown()
        require(latest)
        for _ in 0..<4 where !oldAnswer.exists || !oldAnswer.isHittable { history.swipeDown() }
        XCTAssertTrue(oldAnswer.isHittable, "Browse to the same earlier answer before recording its position")
        let oldAnswerY = oldAnswer.frame.minY
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.buttons["停止回答"].firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 20), .completed)
        XCTAssertTrue(latest.exists, "Reply completion must not pull the reader to the bottom")
        XCTAssertEqual(oldAnswer.frame.minY, oldAnswerY, accuracy: 3, "The same earlier answer must stay in the same place through streaming and completion")
        if extra.isEmpty {
            wake.tap(); require(input); input.tap(); require(app.keyboards.firstMatch)
            XCTAssertEqual(oldAnswer.frame.minY, oldAnswerY, accuracy: 3, "Waking the keyboard while browsing must preserve the passage")
            history.swipeDown()
        }
        capture("completed-reply-preserves-browsing")
        latest.tap()
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !latest.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 8), .completed)
        XCTAssertTrue(wake.isHittable || input.isHittable)
        XCTAssertTrue(answer.exists, "Returning to latest must retain the actual answer text")
        if extra.isEmpty {
            if wake.exists { wake.tap() }
            require(input); input.tap(); input.typeText("第三句合成问题")
            app.buttons["reader-question-send"].tap(); require(app.buttons["停止回答"].firstMatch)
            let completed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !self.app.buttons["停止回答"].firstMatch.exists }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 25), .completed)
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate; request.recognitionLanguages = ["zh-Hans", "en-US"]
            do {
                let image = XCUIScreen.main.screenshot().image
                let cgImage = try XCTUnwrap(image.cgImage)
                try VNImageRequestHandler(cgImage: cgImage).perform([request])
                let visible = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined().uppercased()
                    .unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
                XCTAssertTrue(visible.contains("ROUND3END"), "The newest reply's ending must be physically visible, not merely present in accessibility.\n" + visible)
            } catch { XCTFail("Could not verify the visible reply ending: \(error)") }
            capture("third-exchange-latest-ending-visible")
            for _ in 0..<12 where !oldAnswer.exists || !oldAnswer.isHittable { history.swipeDown() }
            XCTAssertTrue(oldAnswer.isHittable, "The first exchange must remain reachable after it moves into older history")
            capture("older-history-remains-readable")
            require(latest); latest.tap()
        }
    }

    func testSingleAndMultipleLocalRemovalRemainRecoverable() {
        launch(); layoutList(); filter("全部"); search(textTitle)
        let actions = app.buttons["书籍操作，" + textTitle]; require(actions); actions.tap()
        app.buttons["从书架移除"].firstMatch.tap(); confirmRemoval()
        filter("已移除")
        let recovery = app.buttons["书籍操作，" + textTitle]; require(recovery); recovery.tap()
        app.buttons["恢复到书架"].firstMatch.tap()
        filter("全部"); require(book(textTitle))
        search("GET317 合成验收")
        app.buttons["library-select-books"].tap()
        for title in [markdownTitle, textTitle] {
            let selected = book(title, selecting: true)
            for _ in 0..<4 where !selected.isHittable {
                if app.collectionViews.firstMatch.exists { app.collectionViews.firstMatch.swipeUp() }
                else { app.swipeUp() }
            }
            require(selected); selected.tap()
        }
        let remove = app.buttons["library-selection-remove-restore"]; require(remove); remove.tap(); confirmRemoval()
        filter("已移除"); require(app.staticTexts["2 本书"])
        capture("Library · removed collection keeps two local books")
        app.buttons["library-select-books"].tap()
        for title in [markdownTitle, textTitle] { let selected = book(title, selecting: true); require(selected); selected.tap() }
        let restore = app.buttons["library-selection-remove-restore"]; require(restore); restore.tap()
        require(app.staticTexts["0 本书"])
        app.buttons["完成"].firstMatch.tap()
        filter("全部"); search(textTitle); require(book(textTitle))
        search(markdownTitle); require(book(markdownTitle))
    }

    func testDuplicateLocalImportOffersAllThreeChoicesThroughRealImportPipeline() {
        for (choice, expectedCount) in [("保留原书", "6 本书"), ("替换书籍", "6 本书"), ("作为新书添加", "7 本书")] {
            launch(["--ios-library-chat-duplicate"])
            for label in ["保留原书", "替换书籍", "作为新书添加"] { require(app.buttons[label].firstMatch) }
            capture("Duplicate source · " + choice)
            app.buttons[choice].firstMatch.tap()
            require(app.buttons["library-import-open"], timeout: 30)
            filter("全部"); require(app.staticTexts[expectedCount])
            app.terminate()
        }
    }

    func testSystemStatusBarHidesOnlyWhileReading() {
        launch(); layoutList(); filter("全部"); search(textTitle)
        let visibleClock = clockInk()
        XCTAssertGreaterThan(visibleClock, 30, "The library screenshot must contain the visible clock")
        book(textTitle).tap(); require(reader)
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.clockInk() < visibleClock / 10 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed, "The clock's actual pixels must disappear while reading")
        capture("Quiet reader · system time and status bar hidden")
        let back = app.buttons["返回书房"]; require(back); back.tap()
        require(app.buttons["书房显示与排序"])
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.clockInk() > 30 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 5), .completed)
        capture("Library · ordinary status bar restored")
    }
    // iOS 26 draws the clock outside the app's accessibility hierarchy. Check
    // the real top-left clock pixels on this portrait iPhone fixture instead.
    private func clockInk() -> Int {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return 0 }
        let rect = CGRect(x: Double(image.width) * 0.08, y: Double(image.height) * 0.02,
                          width: Double(image.width) * 0.22, height: Double(image.height) * 0.035).integral
        guard let clock = image.cropping(to: rect) else { return 0 }
        var pixels = [UInt8](repeating: 0, count: clock.width * clock.height * 4)
        guard let context = CGContext(data: &pixels, width: clock.width, height: clock.height, bitsPerComponent: 8,
                                      bytesPerRow: clock.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
        context.draw(clock, in: CGRect(x: 0, y: 0, width: clock.width, height: clock.height))
        return stride(from: 0, to: pixels.count, by: 4).reduce(0) { count, index in
            count + (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 200 ? 1 : 0)
        }
    }
}
