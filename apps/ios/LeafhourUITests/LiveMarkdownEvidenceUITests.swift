import XCTest
import Vision

/// Explicit, read-only capture of an already submitted real test-workspace answer.
/// No fixture flags, credentials or model submission are supplied by this test.
final class LiveMarkdownEvidenceUITests: XCTestCase {
    private let app = XCUIApplication()
    private var reader: XCUIElement { app.textViews["leafhour-epub-reader"] }

    private func leaveResumedReaderIfNeeded() {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.reader.exists || self.app.buttons["搜索书房"].exists || self.app.tabBars.buttons["我的阅读"].isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 35), .completed)
        if reader.exists {
            let back = app.buttons["返回书房"]
            if !back.isHittable { reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
            XCTAssertTrue(back.waitForExistence(timeout: 8)); back.tap()
        }
    }

    private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    private func alignAnswerTop(_ answer: XCUIElement, history: XCUIElement) {
        let top = app.navigationBars["松鼠"].frame.maxY + 10
        let wake = app.buttons["chat-wake-composer"]
        let bottom = min(history.frame.maxY - 20, wake.exists ? wake.frame.minY - 12 : app.frame.height - 150)
        XCTAssertGreaterThan(bottom - top, 100)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        for _ in 0..<100 {
            let delta = answer.frame.minY - top
            if delta >= -10 && delta <= 24 { return }
            if delta < -(bottom - top) * 1.5 { history.swipeDown(); continue }
            if delta > (bottom - top) * 1.5 { history.swipeUp(); continue }
            let distance = min(abs(delta), (bottom - top) * 0.4)
            let startY = top + (bottom - top) * (delta > 0 ? 0.72 : 0.25)
            let endY = startY + (delta > 0 ? -distance : distance)
            origin.withOffset(CGVector(dx: app.frame.width * 0.55, dy: startY)).press(forDuration: 0.1,
                thenDragTo: origin.withOffset(CGVector(dx: app.frame.width * 0.55, dy: endY)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTFail("Could not align the exact answer within the readable viewport")
    }

    func testRealSupplementAndWholeAnswerCopy() throws {
        guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET385"] == "1" else { throw XCTSkip("Explicit real-workspace acceptance only") }
        continueAfterFailure = false
        app.launchArguments = ["--get385-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch(); defer { app.terminate() }
        leaveResumedReaderIfNeeded()
        app.tabBars.buttons["我的阅读"].tap(); app.buttons["journal-settings"].tap()
        XCTAssertTrue(app.staticTexts["test@cubxxw.com"].waitForExistence(timeout: 20)); app.buttons["完成"].firstMatch.tap()
        app.tabBars.buttons["书房"].tap(); app.buttons["library-companion"].tap()
        let history = app.scrollViews["reader-conversation-history"]
        XCTAssertTrue(history.waitForExistence(timeout: 30))
        let question = "GET385 补充样张：请原样返回下面三句 Markdown，不包代码围栏、不用工具、不重写上一份正文。\n\n***慢一点，也是一种认真。***\n\n~~必须立刻得出结论~~ → 可以先留一个问号。\n\n**可以保留 *尚未完成* 的想法。**\n\n末行写 GET385-EXTRA-END。"
        var sent = app.textViews.matching(NSPredicate(format: "label == %@", question)).firstMatch
        if !sent.exists {
            guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET385_SEND_EXTRA"] == "1" else { XCTFail("No exact prior supplement; submission is disabled"); return }
            let wake = app.buttons["chat-wake-composer"]; XCTAssertTrue(wake.waitForExistence(timeout: 20)); wake.tap()
            let field = app.textFields["reader-question"]; XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText(question)
            XCTAssertTrue((field.value as? String) == question); app.buttons["reader-question-send"].tap()
            sent = app.textViews.matching(NSPredicate(format: "label == %@", question)).firstMatch
            XCTAssertTrue(sent.waitForExistence(timeout: 30))
        }
        let turnID = sent.identifier.replacingOccurrences(of: "chat-user-message-", with: "")
        let supplement = app.textViews["chat-assistant-message-" + turnID]
        XCTAssertTrue(supplement.waitForExistence(timeout: 180))
        XCTAssertTrue(supplement.label.contains("GET385-EXTRA-END")); XCTAssertFalse(supplement.label.contains("合成陪读回答"))
        capture("GET385-real-bold-italic-strike")
        let main = app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "迟疑并不总等于迟钝")).firstMatch
        XCTAssertTrue(main.waitForExistence(timeout: 20))
        alignAnswerTop(main, history: history)
        capture("GET385-real-answer-aligned-for-selection")
        main.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 45, dy: 16)).press(forDuration: 1.2)
        let menu = app.menuItems["复制消息"].firstMatch
        let button = app.buttons["复制消息"].firstMatch
        let copy = menu.waitForExistence(timeout: 5) ? menu : button
        XCTAssertTrue(copy.waitForExistence(timeout: 8))
        capture("GET385-real-native-selection-and-copy")
        copy.tap()
        // The host checks this exact simulator clipboard against the frozen raw
        // response hash; the Runner never requests access to another app's data.
    }

    func testRealBookCompanionAndDraftReturn() throws {
        guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET385"] == "1" else { throw XCTSkip("Explicit real-workspace acceptance only") }
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--get385-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch(); defer { app.terminate() }
        leaveResumedReaderIfNeeded()
        app.tabBars.buttons["我的阅读"].tap()
        let settings = app.buttons["journal-settings"]; XCTAssertTrue(settings.waitForExistence(timeout: 20)); settings.tap()
        XCTAssertTrue(app.staticTexts["test@cubxxw.com"].waitForExistence(timeout: 20)); app.buttons["完成"].firstMatch.tap()
        app.tabBars.buttons["书房"].tap()
        app.buttons["搜索书房"].tap()
        let search = app.textFields["library-search-field"]; XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap(); search.typeText("茶之书")
        let book = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "阅读，茶之书")).firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 20)); book.tap()
        XCTAssertTrue(reader.waitForExistence(timeout: 90))
        let original = reader.value as? String
        XCTAssertTrue((original ?? "").lowercased().contains("tea"), "Use the public English edition, not an unrelated uploaded book")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.3)).press(forDuration: 1.2)
        let ai = app.buttons["reader-ai"]; XCTAssertTrue(ai.waitForExistence(timeout: 15)); ai.tap()
        let navigation = app.navigationBars["旁注"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 15))
        XCTAssertGreaterThan(navigation.frame.minY, app.frame.height * 0.35)
        capture("GET385-book-half-before-send")
        let question = "这里为什么把茶和日常生活放在一起？想听一句页边批注。"
        var sent = app.textViews.matching(NSPredicate(format: "label == %@", question)).firstMatch
        if !sent.exists {
            guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET385_SEND_BOOK"] == "1" else { XCTFail("No prior exact reading case; model submission is not enabled"); return }
            let field = app.textFields["reader-question"]; XCTAssertTrue(field.waitForExistence(timeout: 15)); field.tap(); field.typeText(question)
            XCTAssertTrue((field.value as? String) == question)
            app.buttons["reader-question-send"].tap()
            sent = app.textViews.matching(NSPredicate(format: "label == %@", question)).firstMatch
            XCTAssertTrue(sent.waitForExistence(timeout: 30))
        }
        let turnID = sent.identifier.replacingOccurrences(of: "chat-user-message-", with: "")
        let answer = app.textViews["chat-assistant-message-" + turnID]
        XCTAssertTrue(answer.waitForExistence(timeout: 180), "A completed real answer must arrive; no fixture replaces it")
        XCTAssertFalse(answer.label.isEmpty)
        XCTAssertFalse(answer.label.contains("合成陪读回答"))
        XCTAssertGreaterThan(navigation.frame.minY, app.frame.height * 0.35)
        XCTAssertGreaterThanOrEqual(answer.frame.minY, navigation.frame.maxY - 2, "A marginal note must open at its first sentence, not its ending")
        let evidence = XCTAttachment(string: answer.label); evidence.name = "GET385-book-real-rendered-answer"; evidence.lifetime = .keepAlways; add(evidence)
        capture("GET385-book-real-marginal-note")
        let wake = app.buttons["chat-wake-composer"]
        if wake.exists { wake.tap() }
        let field = app.textFields["reader-question"]; XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap()
        let draft = "这段还想接着想，先把问题留在这里。"
        if (field.value as? String) != draft {
            let value = field.value as? String ?? ""
            XCTAssertTrue(value.isEmpty || value == "写下此刻的问题", "Do not overwrite an unrecognized real draft")
            field.typeText(draft)
        }
        app.buttons["reader-chat-return"].tap()
        XCTAssertTrue(reader.waitForExistence(timeout: 15)); XCTAssertTrue((reader.value as? String) == original)
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(ai.waitForExistence(timeout: 8)); ai.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 15)); XCTAssertTrue((field.value as? String) == draft)
        capture("GET385-book-draft-and-source-restored")
    }

    func testCaptureRealMarkdownAnswer() throws {
        guard ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_GET385"] == "1" else {
            throw XCTSkip("Opt in only on the isolated, signed test-workspace application")
        }
        continueAfterFailure = false
        app.launchArguments = ["--get385-live", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if let size = ProcessInfo.processInfo.environment["LEAFHOUR_LIVE_SIZE"] {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", size]
        }
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer { app.terminate() }
        leaveResumedReaderIfNeeded()
        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30))
        app.tabBars.buttons["我的阅读"].tap()
        let settings = app.buttons["journal-settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 20)); settings.tap()
        XCTAssertTrue(app.staticTexts["test@cubxxw.com"].waitForExistence(timeout: 20), "Capture is restricted to the designated test workspace")
        app.buttons["完成"].firstMatch.tap()
        let companion = tabs.buttons["松鼠"].exists ? tabs.buttons["松鼠"] : tabs.buttons["Chat"]
        companion.tap()
        let answer = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "迟疑并不总等于迟钝", "迟疑并不总等于迟钝")).firstMatch
        if !answer.waitForExistence(timeout: 35) {
            let state = XCTAttachment(string: app.debugDescription); state.name = "Live chat hierarchy"; state.lifetime = .keepAlways; add(state)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "Live chat not found"; shot.lifetime = .keepAlways; add(shot)
            XCTFail("Expected the exact, already-submitted real answer"); return
        }
        let history = app.scrollViews["reader-conversation-history"]
        XCTAssertTrue(history.exists)
        var sawEnding = false, sawTitle = false
        var threeColumnHeaders = Set<String>(), fiveColumnHeaders = Set<String>()
        var sawThreeColumnRow = false, sawFiveColumnRow = false
        var sawSwiftCode = false, sawPythonCode = false, sawLongToken = false
        for page in 0..<120 {
            let shot = XCUIScreen.main.screenshot()
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate; request.recognitionLanguages = ["zh-Hans", "en-US"]
            try VNImageRequestHandler(cgImage: XCTUnwrap(shot.image.cgImage)).perform([request])
            let visible = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined().uppercased()
                .unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
            sawEnding = sawEnding || visible.contains("GET385END")
            if sawEnding {
                let attachment = XCTAttachment(screenshot: shot); attachment.name = String(format: "GET385-reverse-%02d", page); attachment.lifetime = .keepAlways; add(attachment)
                let transcript = XCTAttachment(string: visible); transcript.name = String(format: "GET385-reverse-ocr-%02d", page); transcript.lifetime = .keepAlways; add(transcript)
                for header in ["起点", "适合的时刻", "读后留下什么"] where visible.contains(header) { threeColumnHeaders.insert(header) }
                for header in ["序号", "动作", "时长", "要点", "回望"] where visible.contains(header) { fiveColumnHeaders.insert(header) }
                sawThreeColumnRow = sawThreeColumnRow || visible.contains("起点一句读不懂的话")
                sawFiveColumnRow = sawFiveColumnRow || (visible.contains("序号02") && visible.contains("把疑问抄在页边"))
                sawSwiftCode = sawSwiftCode || visible.contains("STRUCTMARGINALNOTE")
                sawPythonCode = sawPythonCode || visible.contains("DEFHESITATIONSLINES")
                sawLongToken = sawLongToken || visible.contains("THEMARGINALIAROOMOFDELIBERATEREADERS")
                sawTitle = visible.contains("给迟疑者") && visible.contains("页边札记")
                if sawTitle { break }
            }
            // Use the fixed visible viewport. The history/text-view frames can
            // change during native large-text layout and must not end coverage.
            let top = app.navigationBars["松鼠"].frame.maxY + 16
            let wake = app.buttons["chat-wake-composer"]
            let bottom = wake.exists ? wake.frame.minY - 16 : app.frame.maxY - 140
            XCTAssertGreaterThan(bottom - top, 100)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: app.frame.width * 0.55, dy: top + (bottom - top) * 0.3)).press(forDuration: 0.1,
                thenDragTo: origin.withOffset(CGVector(dx: app.frame.width * 0.55, dy: top + (bottom - top) * 0.75)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(sawEnding && sawTitle, "Capture the real ending and title in pixels during one reverse traversal")
        XCTAssertEqual(threeColumnHeaders, Set(["起点", "适合的时刻", "读后留下什么"]), "All three table headers must appear in actual pixels")
        XCTAssertTrue(sawThreeColumnRow, "Capture an actual three-column table row, not just a heading")
        XCTAssertEqual(fiveColumnHeaders, Set(["序号", "动作", "时长", "要点", "回望"]), "All five table headers must appear in actual pixels")
        XCTAssertTrue(sawFiveColumnRow, "Capture the numbered five-column table and its associated action")
        XCTAssertTrue(sawSwiftCode && sawPythonCode && sawLongToken, "Capture actual Swift/Python code and the unchanged long token")
        XCTAssertFalse(app.buttons["停止回答"].exists)
        XCTAssertTrue(app.buttons["chat-wake-composer"].exists)
    }
}
