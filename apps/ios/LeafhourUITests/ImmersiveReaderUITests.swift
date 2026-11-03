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
    private func open(_ style: String = "Light", extra: [String] = [], title: String = "GET317 合成验收 · 本机文本") {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-AppleInterfaceStyle", style] + extra
        app.launch()
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.reader.exists || self.app.buttons["书房显示与排序"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        if reader.exists { wake(); app.buttons["返回书房"].tap() }
        require(app.buttons["书房显示与排序"], timeout: 25)
        app.buttons["搜索书房"].tap()
        let search = app.textFields["library-search-field"]; require(search); search.tap(); search.typeText(title)
        if app.keyboards.buttons["搜索"].exists { app.keyboards.buttons["搜索"].tap() }
        let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + title)).firstMatch
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
    func testAccessibilitySizeKeepsQuietReadingAndRevealsAIOnlyWithToolsOrSelection() {
        open(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        wake(); app.buttons["reader-read"].tap()
        XCTAssertFalse(app.buttons["reader-time-capsule"].exists)
        XCTAssertFalse(app.buttons["reader-ai"].exists)
        XCTAssertFalse(app.buttons["显示阅读进度、目录、搜索与记录"].exists)
        capture("accessibility-pure-reading")
        wake(); let ai = app.buttons["reader-ai"]; require(ai)
        XCTAssertTrue(ai.isHittable)
        XCTAssertGreaterThanOrEqual(ai.frame.minX, 0)
        XCTAssertLessThanOrEqual(ai.frame.maxX, app.frame.width)
        app.buttons["reader-read"].tap()
        select(); require(app.buttons["reader-selection-copy"])
        XCTAssertTrue(app.buttons["reader-selection-copy"].isHittable)
        XCTAssertTrue(ai.isHittable)
        capture("accessibility-selection-dock")
    }
    func testQuietReaderHasNoFooterAndRapidTapsDoNotSelectText() {
        open(); wake(); app.buttons["reader-read"].tap()
        XCTAssertFalse(app.buttons["reader-ai"].exists)
        XCTAssertFalse(app.buttons["reader-time-capsule"].exists)
        XCTAssertFalse(app.staticTexts["reader-progress-caption"].exists)
        let page = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5))
        page.doubleTap()
        XCTAssertFalse(app.descendants(matching: .any)["reader-selection-dock"].firstMatch.exists)
        XCTAssertFalse(app.buttons["reader-ai"].exists)
        capture("pure-reading-after-rapid-taps")
        wake(); let progress = app.staticTexts["reader-progress-caption"]; require(progress)
        XCTAssertTrue(progress.label.contains("本章 3 /"), progress.label)

    }
    func testExpandedQuoteKeepsComposerVisibleAndRemovalShowsTheCapturedParagraph() {
        open(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        select(); app.buttons["reader-ai"].tap(); require(app.navigationBars["Chat"])
        let quote = app.descendants(matching: .any)["chat-source-context"].firstMatch; require(quote)
        quote.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        let question = app.textFields["reader-question"]; require(question); question.tap(); question.typeText("为什么")
        XCTAssertTrue(question.isHittable)
        let remove = app.buttons["chat-remove-source"]; require(remove); XCTAssertTrue(remove.isHittable)
        capture("expanded-quote-keyboard-accessibility")
        remove.tap(); require(app.staticTexts["当前段落 · 未附加选文"])
        XCTAssertFalse(remove.exists)
        XCTAssertTrue(question.isHittable)
        capture("removed-excerpt-keeps-captured-paragraph")
    }
    func testListeningShowsParagraphComparisonAndCanHideControlsWithoutStoppingAudio() {
        open(title: "GET317 合成验收 · 双译"); wake(); app.buttons["reader-listen"].tap()
        require(app.textViews["reader-listening-comparison"].firstMatch)
        let toggle = app.buttons["reader-listening-comparison-toggle"]; require(toggle)
        XCTAssertEqual(toggle.value as? String, "开启")
        toggle.tap(); XCTAssertFalse(app.textViews["reader-listening-comparison"].firstMatch.exists)
        XCTAssertFalse(app.buttons["暂停朗读"].exists, "Comparison must not autoplay")
        toggle.tap(); require(app.textViews["reader-listening-comparison"].firstMatch)
        capture("bilingual-listening")
        let sentence = app.textViews.matching(NSPredicate(format: "identifier IN %@", ["reader-listening-sentence", "reader-listening-active-sentence"])).firstMatch; require(sentence)
        sentence.tap(); require(app.buttons["暂停朗读"])
        app.buttons["reader-listening-hide"].tap()
        let reveal = app.buttons["reader-listening-reveal"]; require(reveal)
        XCTAssertFalse(app.buttons["reader-speech-play"].exists)
        capture("immersive-listening-hidden-controls")
        reveal.tap(); require(app.buttons["暂停朗读"])
        require(reveal, timeout: 10)
        capture("listening-controls-hide-after-idle")
        reveal.tap(); require(app.buttons["暂停朗读"])
        app.buttons["reader-speech-play"].tap(); require(app.buttons["继续朗读"])
        app.buttons["展开"].tap(); require(app.navigationBars["段落对照"])
        require(app.textViews["reader-listening-comparison"].firstMatch)
        capture("expanded-comparison-frozen-source")
        app.buttons["完成"].tap()
        let text = app.textViews["reader-listening-active-sentence"].firstMatch
        require(text); text.press(forDuration: 1.1)
        XCTAssertTrue(app.menuItems.firstMatch.waitForExistence(timeout: 3) || app.buttons["复制"].exists || app.buttons["Copy"].exists, app.debugDescription)
        capture("listening-native-selection")
    }

    func testReadingChapterButtonsReturnToThePreviousChapter() {
        open(title: "GET317 合成验收 · 双译"); wake()
        let progress = app.staticTexts["reader-progress-caption"], next = app.buttons["reader-next-chapter"]
        require(next); XCTAssertTrue(next.isEnabled)
        let initial = progress.label
        next.tap(); wake(); XCTAssertNotEqual(progress.label, initial)
        let previous = app.buttons["reader-previous-chapter"]; require(previous); XCTAssertTrue(previous.isEnabled)
        previous.tap(); wake(); XCTAssertEqual(progress.label, initial)
        capture("explicit-chapter-navigation")
    }

    func testApprovedPlayerKeepsComparisonAndPlaybackBelowTheTranscript() {
        open(title: "GET317 合成验收 · 双译"); wake(); app.buttons["reader-listen"].tap()
        let comparison = app.otherElements["reader-listening-comparison-region"]
        let transport = app.otherElements["reader-listening-transport"]
        let transcript = app.scrollViews["reader-listening-transcript"]
        require(comparison); require(transport); require(transcript)
        XCTAssertLessThanOrEqual(transcript.frame.maxY, comparison.frame.minY + 1)
        XCTAssertLessThanOrEqual(comparison.frame.maxY, transport.frame.minY + 1)
        transcript.swipeUp()
        XCTAssertFalse(app.buttons["回到朗读"].exists)
        XCTAssertTrue(app.buttons["reader-read"].firstMatch.exists)
        capture("approved-player-comparison-and-transport")
    }

    func testReadingControllerHasChapterAndPageTranslationActions() {
        open(title: "GET317 合成验收 · 双译"); wake()
        let ids = ["reader-previous-chapter", "reader-next-chapter", "reader-page-translation"]
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier IN %@", ids)).count, ids.count, app.debugDescription)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier IN %@", ["reader-previous-page", "reader-next-page"])).count, 0)
        let initial = app.staticTexts["reader-progress-caption"].label
        app.buttons["reader-next-chapter"].tap()
        XCTAssertNotEqual(app.staticTexts["reader-progress-caption"].label, initial)
        app.buttons["reader-previous-chapter"].tap()
        XCTAssertEqual(app.staticTexts["reader-progress-caption"].label, initial)
        app.buttons["reader-page-translation"].tap()
        require(app.staticTexts["当前页翻译"])
        capture("reading-chapter-and-page-translation-controller")
    }

    func testListeningStartsAtChapterChosenWhileIdle() {
        open(title: "GET317 合成验收 · 双译"); wake(); app.buttons["reader-listen"].tap()
        require(app.buttons["reader-speech-play"])
        app.buttons["reader-contents"].firstMatch.tap()
        let next = app.buttons["reader-contents-entry-1"]; require(next); next.tap()
        let chapter = app.staticTexts["reader-listening-chapter-title"]; require(chapter)
        let selected = chapter.label
        XCTAssertTrue(selected.contains("2"), selected)
        app.buttons["reader-speech-play"].tap()
        let status = app.staticTexts["reader-listening-playback-status"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (status.value as? String)?.contains("正在朗读") == true }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        XCTAssertEqual(chapter.label, selected)
        capture("listen-from-selected-chapter")
    }

    func testListeningContinuesInBackgroundWithSystemMediaArtwork() {
        open(); wake(); app.buttons["reader-listen"].tap(); require(app.buttons["reader-speech-play"])
        app.buttons["reader-speech-play"].tap()
        let status = app.staticTexts["reader-listening-playback-status"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (status.value as? String)?.contains("正在朗读") == true }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        let before = status.value as? String
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.01)).press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.72)))
        _ = XCTWaiter.wait(for: [expectation(description: "Observe ongoing local output for five seconds")], timeout: 5)
        capture("system-media-artwork-background")
        XCUIDevice.shared.press(.home); app.activate()
        if app.buttons["reader-listening-reveal"].exists { app.buttons["reader-listening-reveal"].tap() }
        require(app.buttons["暂停朗读"])
        XCTAssertTrue((status.value as? String)?.contains("正在朗读") == true, app.debugDescription)
        XCTAssertNotEqual(status.value as? String, before)
        capture("background-audio-continued")
    }

    func testControlCenterPublishesListeningIdentityWhenSystemControlsAreAvailable() throws {
        open(); wake(); app.buttons["reader-listen"].tap(); require(app.buttons["reader-speech-play"])
        app.buttons["reader-speech-play"].tap()
        let status = app.staticTexts["reader-listening-playback-status"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (status.value as? String)?.contains("正在朗读") == true }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.01)).press(forDuration: 0.1,
            thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.72)))
        capture("control-center-system-availability")
        // Some iOS 26.4 Simulator images render an entirely empty system panel,
        // including no Wi-Fi, brightness or volume controls. That cannot prove
        // either presence or absence of the app's system media tile.
        try XCTSkipIf(springboard.buttons.count == 0 && springboard.sliders.count == 0,
            "Simulator Control Center has no system controls; verify system media presentation on a physical device")
        let media = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "GET317 合成验收")).firstMatch
        XCTAssertTrue(media.waitForExistence(timeout: 10), "Control Center must publish the actual listening identity: " + springboard.debugDescription)
    }

    func testListeningActivityPausesResumesAndEndsWithoutOpeningTheApp() {
        open(); wake(); app.buttons["reader-listen"].tap(); require(app.buttons["reader-speech-play"])
        app.buttons["reader-speech-play"].tap()
        let status = app.staticTexts["reader-listening-playback-status"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (status.value as? String)?.contains("正在朗读") == true }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        require(app.buttons["reader-listening-stop"])
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)).press(forDuration: 0.1,
            thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72)))
        let end = springboard.buttons["结束听书"].firstMatch
        XCTAssertTrue(end.waitForExistence(timeout: 10), springboard.debugDescription)
        let pause = springboard.buttons["暂停"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 5), springboard.debugDescription)
        capture("live-activity-playing")
        pause.tap()
        let resume = springboard.buttons["继续"].firstMatch
        XCTAssertTrue(resume.waitForExistence(timeout: 10), springboard.debugDescription)
        XCTAssertNotEqual(app.state, .runningForeground)
        capture("live-activity-paused")
        resume.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 10), springboard.debugDescription)
        end.tap()
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !end.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 10), .completed)
        capture("live-activity-ended")
        XCUIDevice.shared.press(.home); app.activate()
        if app.buttons["reader-listening-reveal"].exists { app.buttons["reader-listening-reveal"].tap() }
        require(app.buttons["reader-speech-play"])
        XCTAssertFalse(app.buttons["reader-listening-stop"].exists)
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
    }

    func testLargeTextListeningKeepsPlaybackAndSharedReadingActionReachable() {
        open(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        wake(); app.buttons["reader-listen"].tap()
        let play = app.buttons["reader-speech-play"]; require(play); play.tap()
        let read = app.buttons["reader-read"].firstMatch; require(read); read.tap()
        require(reader)
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        capture("large-text-player-returned-to-reading")
    }

    func testListeningWithoutTranslationUsesTheWholeSourceArea() {
        open(); wake(); app.buttons["reader-listen"].tap()
        require(app.buttons["reader-speech-play"])
        let ids = ["reader-listening-comparison-region", "reader-listening-missing-comparison", "reader-listening-comparison-toggle"]
        XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ids)).count, 0, app.debugDescription)
        let source = app.scrollViews["reader-listening-transcript"], transport = app.otherElements["reader-listening-transport"]
        XCTAssertLessThanOrEqual(transport.frame.minY - source.frame.maxY, 24)
        capture("listening-source-only-no-empty-translation")
    }

    func testLocateReturnsToTheLiveSentenceWithoutPausingPlayback() {
        open(); wake(); app.buttons["reader-listen"].tap(); require(app.buttons["reader-speech-play"])
        app.buttons["reader-speech-play"].tap()
        let status = app.staticTexts["reader-listening-playback-status"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (status.value as? String)?.contains("正在朗读") == true }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
        app.scrollViews["reader-listening-transcript"].swipeUp()
        let locate = app.buttons["reader-listening-locate"]; require(locate); locate.tap()
        require(app.buttons["暂停朗读"])
        XCTAssertTrue((status.value as? String)?.contains("正在朗读") == true)
        XCTAssertFalse(locate.exists)
        capture("locate-current-audio-without-restart")
    }

    func testListeningSideControlsSelectChapterWithoutStartingIdleAudio() {
        open(title: "GET317 合成验收 · 双译"); wake(); app.buttons["reader-listen"].tap()
        let next = app.buttons["reader-speech-next-chapter"]; require(next); next.tap()
        let chapter = app.staticTexts["reader-listening-chapter-title"]; require(chapter)
        XCTAssertTrue(chapter.label.contains("2"), chapter.label)
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        let previous = app.buttons["reader-speech-previous-chapter"]; require(previous); previous.tap()
        XCTAssertTrue(chapter.label.contains("1"), chapter.label)
        capture("chapter-transport-no-idle-autoplay")
    }

    func testListeningJumpDoesNotResumeReadingTime() {
        open(); wake(); app.buttons["reader-listen"].tap()
        require(app.buttons["reader-speech-play"]); app.buttons["reader-speech-play"].tap()
        app.buttons["reader-listening-return"].tap(); require(reader)
        wake(); app.buttons["reader-contents"].tap()
        let current = app.buttons["reader-contents-entry-0"]; require(current); current.tap()
        XCTAssertFalse(app.buttons["reader-time-capsule"].exists)
        XCTAssertFalse(app.buttons["reader-ai"].exists)
        XCTAssertFalse(app.buttons["reader-speech-toggle"].exists)
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
        XCTAssertEqual(app.buttons["reader-ai"].label, "AI 引用")
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
        let boost = app.buttons["reader-listening-speed-open"]
        boost.press(forDuration: 1.2)
        XCTAssertEqual(boost.value as? String, "0.5倍")
        XCTAssertFalse(app.sliders["reader-speech-speed"].exists, "A hold must not also open settings")
        require(app.textViews["reader-listening-active-sentence"].firstMatch)
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
    func testQuietAutomaticTimeRemainsAvailableInReadingTools() {
        open(); wake(); app.buttons["reader-read"].tap()
        XCTAssertFalse(app.buttons["reader-time-capsule"].exists)
        wake(); app.buttons["reader-more"].tap()
        let time = app.buttons["阅读计时"]; require(time)
        for _ in 0..<3 where !time.isHittable { app.swipeUp() }
        time.tap(); require(app.buttons["暂停计时"])
        app.buttons["暂停计时"].tap(); require(app.buttons["继续计时"])
        capture("time-in-tools-only")
    }
}
