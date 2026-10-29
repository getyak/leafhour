import XCTest
import UIKit

/// GET-317 synthetic native acceptance. These tests do not establish real-cloud,
/// paid-model, physical-device, TestFlight, or production acceptance.
final class VideoExperienceUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "org.leafhour.get317.testing")
    private let textTitle = "GET317 合成验收 · 本机文本"
    private let markdownTitle = "GET317 合成验收 · Markdown"
    private let translatedTitle = "GET317 合成验收 · 双译"
    private let pdfTitle = "GET317 合成验收 · PDF"
    private let cloudTitle = "GET317 合成验收 · 云端未下载"
    private let slowTitle = "GET317 合成验收 · 慢速下载"
    private var reader: XCUIElement { app.textViews["leafhour-epub-reader"] }
    private var shelfSearch: XCUIElement {
        app.searchFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "搜索书名或作者", "搜索书名或作者")).firstMatch
    }
    private var originalSearch: XCUIElement {
        app.searchFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "搜索原文", "搜索原文")).firstMatch
    }

    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        capture(name)
        app.terminate()
    }

    private func capture(_ title: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = title
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func require(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing UI: \(element)\n\(app.debugDescription)", file: file, line: line)
    }
    private func containsText(_ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
    private func launch(_ flags: [String] = []) {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + flags
        app.launch()
        require(app.staticTexts[translatedTitle], timeout: 25)
        setLayout("列表")
        app.segmentedControls.buttons["全部"].tap()
        require(app.buttons["阅读，" + translatedTitle + "，已下载可离线阅读"], timeout: 25)
        require(app.staticTexts[flags.contains("--get317-cloud-error") ? "4 本书" : "6 本书"], timeout: 15)
    }
    private func coldRelaunch() {
        app.terminate()
        app.launchArguments.removeAll { $0 == "--get317-reset" }
        app.launch()
    }
    private func menuChoice(_ title: String, submenu: String) {
        let menu = app.buttons["书房显示与排序"]
        require(menu); menu.tap()
        var choice = app.buttons[title].firstMatch
        if !choice.waitForExistence(timeout: 1) {
            let group = app.buttons[submenu].firstMatch
            require(group); group.tap()
            choice = app.buttons[title].firstMatch
        }
        require(choice); choice.tap()
    }
    private func setLayout(_ title: String) { menuChoice(title, submenu: "显示方式") }
    private func searchShelf(_ text: String) {
        let search = shelfSearch
        require(search); search.tap(); search.typeText(text)
        dismissSearchKeyboardIfAvailable()
    }
    private func clearShelfSearch() {
        let search = shelfSearch
        require(search)
        if let value = search.value as? String, !value.isEmpty && value != search.placeholderValue {
            search.tap()
            let clear = search.buttons.firstMatch
            require(clear); clear.tap()
            dismissSearchKeyboardIfAvailable()
        }
    }
    private func dismissSearchKeyboardIfAvailable() {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        for title in ["搜索", "Search", "search"] {
            let submit = keyboard.buttons[title]
            if submit.exists && submit.isHittable { submit.tap(); return }
        }
        // Search results are live. A disappearing keyboard needs no synthetic
        // return key sent to a field that may no longer own keyboard focus.
    }
    private func openBook(_ title: String) {
        clearShelfSearch(); searchShelf(title)
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + title)).firstMatch
        require(button); button.tap()
        require(title == pdfTitle ? app.otherElements["leafhour-pdf-reader"] : reader)
    }
    private func wakeTools() {
        if app.buttons["目录"].exists { return }
        let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
        if grip.waitForExistence(timeout: 1) { grip.tap() }
        else {
            let surface = reader.exists ? reader : app.otherElements["leafhour-pdf-reader"]
            surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)).tap()
        }
        require(app.buttons["目录"], timeout: 4)
    }
    private func wakeTop() {
        if app.buttons["返回书房"].exists { return }
        let surface = reader.exists ? reader : app.otherElements["leafhour-pdf-reader"]
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)).tap()
        require(app.buttons["返回书房"], timeout: 4)
    }
    private func shelf() {
        wakeTop(); app.buttons["返回书房"].tap()
        require(app.buttons["书房显示与排序"])
    }
    private func closePanel() {
        let close = app.buttons["继续读"].firstMatch
        require(close); close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
    }
    private func openTool(_ title: String) { wakeTools(); app.buttons[title].tap() }
    private func openMoreLink(_ title: String) {
        openTool("更多")
        let link = app.buttons[title].firstMatch
        require(link); link.tap()
    }
    private func selectOriginal() {
        require(reader)
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.30)).press(forDuration: 1.2)
        require(app.menuItems.firstMatch, timeout: 5)
    }
    private func systemEditAction(_ titles: [String]) {
        require(app.menuItems.firstMatch, timeout: 5)
        func tapActionIfVisible() -> Bool {
            for title in titles {
                let action = app.menuItems[title]
                if action.exists && action.isEnabled && action.isHittable { action.tap(); return true }
            }
            return false
        }
        func turnPage(_ aliases: [String]) -> Bool {
            let item = app.menuItems.firstMatch
            guard item.exists else { return false }
            let menuFrame = item.frame
            let candidates = app.buttons.matching(NSPredicate(format: "label IN %@", aliases)).allElementsBoundByIndex
            guard let page = candidates.first(where: {
                $0.exists && $0.isEnabled && $0.isHittable
                    && $0.frame.midY >= menuFrame.minY && $0.frame.midY <= menuFrame.maxY
            }) else { return false }
            page.tap(); return true
        }
        let forward = ["Forward", "Show more items", "显示更多项目", "显示更多菜单项", "更多菜单项", "更多项目", "Next", "下一项"]
        let backward = ["Back", "Show previous items", "显示上一组项目", "Previous", "上一项"]
        for aliases in [forward, backward] {
            for _ in 0..<8 {
                if tapActionIfVisible() { return }
                guard turnPage(aliases) else { break }
            }
        }
        if tapActionIfVisible() { return }
        XCTFail("Native edit action is not reachable: \(titles). \(app.debugDescription)")
    }
    private func noteEditor() -> XCUIElement {
        selectOriginal(); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"]
        require(editor); return editor
    }
    private func expandPanel() {
        let top = app.navigationBars.firstMatch
        if top.exists && top.frame.minY > app.frame.height * 0.25 {
            top.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.10)))
        }
    }
    private func scrollTo(_ element: XCUIElement, in surface: XCUIElement? = nil) {
        let surface = surface ?? app.tables.firstMatch
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            if surface.exists { surface.swipeUp() } else { app.swipeUp() }
        }
        XCTAssertTrue(element.exists && element.isHittable, "Could not reach \(element). \(app.debugDescription)")
    }
    /// A stable middle viewport band detects scroll movement without claiming
    /// that UITextView's full-chapter accessibility value is a visible anchor.
    private func bodyBand(_ element: XCUIElement? = nil) throws -> Data {
        let image = try XCTUnwrap((element ?? reader).screenshot().image.cgImage)
        let crop = CGRect(x: Double(image.width) * 0.12, y: Double(image.height) * 0.28, width: Double(image.width) * 0.76, height: Double(image.height) * 0.32).integral
        let band = try XCTUnwrap(image.cropping(to: crop))
        // Encode the logical crop; a CGImage data provider may retain backing
        // bytes outside the crop, including the clock or floating controls.
        return try XCTUnwrap(UIImage(cgImage: band).pngData())
    }
    private func accountRecords() {
        app.buttons["我的账号"].tap()
        let records = app.buttons["我的笔记与阅读记录"]
        require(records); records.tap()
    }

    func test01SyntheticShelfShowsLocalAndCloudWithoutDuplicateTranslatedBook() {
        launch()
        require(app.staticTexts[textTitle])
        require(app.staticTexts["6 本书"])
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + translatedTitle)).count, 1)
        require(app.buttons["下载并阅读，" + cloudTitle])
    }

    @MainActor
    func test32ShelfAndQuietReaderPassNativeAccessibilityAudits() throws {
        launch()
        try app.performAccessibilityAudit(for: .all)
        openBook(textTitle)
        reader.swipeUp()
        XCTAssertTrue(app.buttons["目录"].waitForNonExistence(timeout: 3))
        try app.performAccessibilityAudit(for: .all)
    }

    func test02AuthorSearchAndClearRestoreTheShelf() {
        launch(); searchShelf("合成作者甲")
        require(app.staticTexts[translatedTitle])
        XCTAssertFalse(app.staticTexts[textTitle].exists)
        clearShelfSearch()
        require(app.staticTexts[textTitle]); require(app.staticTexts["6 本书"])
    }

    func test03DownloadedScopeOnlyShowsOfflineBooks() {
        launch(); app.segmentedControls.buttons["已下载"].tap()
        require(app.staticTexts["4 本书"])
        require(app.staticTexts[textTitle])
        XCTAssertFalse(app.buttons["下载并阅读，" + cloudTitle].exists)
        app.segmentedControls.buttons["全部"].tap(); require(app.staticTexts["6 本书"])
    }

    func test04GridAndListChoicePersistsAcrossColdLaunch() {
        launch(); setLayout("封面网格")
        let gridRead = app.buttons["阅读，" + translatedTitle]
        require(gridRead)
        coldRelaunch(); require(gridRead, timeout: 20)
        setLayout("列表")
        XCTAssertFalse(gridRead.exists)
        coldRelaunch(); require(app.buttons["阅读，" + translatedTitle + "，已下载可离线阅读"], timeout: 20)
    }

    func test05SortMenuKeepsTheSearchAndFilter() {
        launch(); app.segmentedControls.buttons["已下载"].tap(); searchShelf("GET317")
        menuChoice("书名", submenu: "排列书籍"); require(app.staticTexts["4 本书"])
        menuChoice("作者", submenu: "排列书籍"); require(app.staticTexts["4 本书"])
        XCTAssertEqual(shelfSearch.value as? String, "GET317")
        XCTAssertTrue(app.segmentedControls.buttons["已下载"].isSelected)
    }

    func test06ZeroSearchExplainsAndCanRecover() {
        launch(); searchShelf("GET317-no-such-synthetic-book")
        require(app.staticTexts["没有找到这本书"])
        app.buttons["清除搜索"].tap()
        require(app.staticTexts[textTitle]); require(app.staticTexts["6 本书"])
    }

    func test07TextAndMarkdownOpenThroughRealBookActions() {
        launch(); openBook(textTitle)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph 1") == true)
        shelf(); openBook(markdownTitle)
        XCTAssertTrue((reader.value as? String)?.contains("bold orchard") == true)
        XCTAssertFalse((reader.value as? String)?.contains("**bold orchard**") == true)
    }

    func test08NativeCopyCanBePastedIntoTheRealNoteEditor() {
        launch(); openBook(textTitle)
        let source = reader.value as? String ?? ""
        selectOriginal(); systemEditAction(["复制", "Copy"])
        let editor = noteEditor(); editor.tap()
        editor.press(forDuration: 1.2); systemEditAction(["粘贴", "Paste"])
        let copied = (editor.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertFalse(copied.isEmpty)
        XCTAssertTrue(source.contains(copied), "Pasted note must match actual selected original")
        app.buttons["保留草稿"].tap()
    }

    func test09SelectedQuoteDraftSurvivesColdRelaunch() {
        launch(); openBook(textTitle)
        let editor = noteEditor(), draft = "GET317 durable draft at the orchard"
        editor.tap(); editor.typeText(draft)
        app.buttons["保留草稿"].tap()
        coldRelaunch(); require(reader, timeout: 20)
        openTool("我的记录")
        let recovered = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", draft)).firstMatch
        require(recovered); recovered.tap(); require(editor)
        XCTAssertEqual(editor.value as? String, draft)
    }

    func test10SavedNoteAndReturnToQuoteWork() {
        launch(); openBook(textTitle)
        let editor = noteEditor(), note = "GET317 saved personal note"
        editor.tap(); editor.typeText(note); app.buttons["保存笔记"].tap()
        openTool("我的记录"); require(app.staticTexts[note])
        let back = app.buttons["回到原句"].firstMatch
        scrollTo(back); back.tap(); require(reader)
        XCTAssertFalse(app.buttons["继续读"].exists)
        coldRelaunch(); require(reader, timeout: 20)
        openTool("我的记录"); require(app.staticTexts[note])
    }

    func test11ContentsJumpAndColdResumeKeepTheChapter() {
        launch(); openBook(translatedTitle); openTool("目录")
        let chapter = app.buttons["GET317 合成第 3 章"]
        require(chapter); chapter.tap(); require(reader)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c3 paragraph") == true)
        coldRelaunch(); require(reader, timeout: 20)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c3 paragraph") == true)
    }

    func test12WholeBookSearchJumpsToMatchingChapter() {
        launch(); openBook(translatedTitle); openMoreLink("搜索原文")
        let search = originalSearch
        require(search); search.tap(); search.typeText("CLOUD_ORCHARD_c3_7")
        dismissSearchKeyboardIfAvailable()
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "CLOUD_ORCHARD_c3_7")).firstMatch
        require(result); result.tap(); require(reader)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c3 paragraph") == true)
        capture("GET317-search-result-location")
    }

    func test13FontSpacingAndThemePersistAcrossColdLaunch() {
        launch(); openBook(textTitle); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let font = app.sliders["正文字号"], spacing = app.sliders["正文行间距"]
        require(font); font.adjust(toNormalizedSliderPosition: 0.75)
        spacing.adjust(toNormalizedSliderPosition: 0.75)
        let savedFont = font.value as? String, savedSpacing = spacing.value as? String
        XCTAssertNotEqual(savedFont, "22 磅")
        app.segmentedControls.buttons["夜读"].tap(); closePanel()
        coldRelaunch(); require(reader, timeout: 20); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        require(font); XCTAssertEqual(font.value as? String, savedFont); XCTAssertEqual(spacing.value as? String, savedSpacing)
        XCTAssertTrue(app.segmentedControls.buttons["夜读"].isSelected)
    }

    func test14ResetTypographyKeepsTheChosenTheme() {
        launch(); openBook(textTitle); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        app.sliders["正文字号"].adjust(toNormalizedSliderPosition: 0.9)
        app.segmentedControls.buttons["夜读"].tap()
        let reset = app.buttons["恢复默认排版"]
        require(reset); reset.tap()
        XCTAssertEqual(app.sliders["正文字号"].value as? String, "22 磅")
        XCTAssertFalse(reset.isEnabled)
        XCTAssertTrue(app.segmentedControls.buttons["夜读"].isSelected)
    }

    func test15MiddleTapDoesNotWakeSleepingToolsButTheEdgeDoes() throws {
        launch(); openBook(textTitle); reader.swipeUp()
        XCTAssertTrue(app.buttons["目录"].waitForNonExistence(timeout: 3))
        let before = try bodyBand()
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertFalse(app.buttons["目录"].exists)
        XCTAssertEqual(try bodyBand(), before, "Middle tap must not move the text")
        wakeTools(); require(app.buttons["目录"])
    }

    func test16OpeningAndClosingToolsDoesNotMoveTheVisibleText() throws {
        launch(); openBook(textTitle); reader.swipeUp()
        XCTAssertTrue(app.buttons["目录"].waitForNonExistence(timeout: 3))
        let before = try bodyBand()
        openTool("更多"); require(app.buttons["搜索原文"])
        closePanel(); require(reader)
        XCTAssertEqual(try bodyBand(), before, "Closing tools must preserve the visible original")
    }

    func test17TranslationVariantsKeepSourceAndDraftIdentity() {
        launch(); openBook(translatedTitle); openTool("翻译"); expandPanel()
        require(app.staticTexts["当前段 · 作者原文"])
        require(containsText("GET317 合成直译样本"))
        let variants = app.segmentedControls["reader-translation-variant"]
        require(variants); variants.buttons["意译"].tap()
        require(containsText("GET317 合成意译样本"))
        XCTAssertFalse(containsText("GET317 合成直译样本").exists)
        require(containsText("草稿 · 尚未复核"))
        variants.buttons["直译"].tap(); require(containsText("GET317 合成直译样本"))
    }

    func test18ExpandedLongTranslationReachesItsEndAndReturns() throws {
        launch(); openBook(translatedTitle); openTool("翻译"); expandPanel()
        let expand = app.buttons["展开阅读直译"]
        scrollTo(expand); expand.tap()
        let end = containsText("GET317_LITERAL_END")
        let text = app.scrollViews.firstMatch
        require(text)
        let initialBand = try bodyBand(text)
        for _ in 0..<10 { text.swipeUp() }
        let endBand = try bodyBand(text)
        text.swipeUp()
        XCTAssertNotEqual(initialBand, endBand, "Expanded text must actually scroll")
        XCTAssertEqual(try bodyBand(text), endBand, "Extra upward swipe must remain at the bottom boundary")
        require(end)
        capture("GET317-long-translation-bottom-boundary")
        closePanel(); require(reader)
    }

    func test19LocalMissingTranslationNeverPretendsToExist() {
        launch(); openBook(textTitle); openTool("翻译"); expandPanel()
        require(app.staticTexts["此设备暂无可显示的直译"])
        require(app.staticTexts["此设备暂无可显示的意译"])
        require(app.buttons["完整阅读原文"])
        let generate = app.buttons["翻译这一段"]
        scrollTo(generate); XCTAssertFalse(generate.isEnabled)
    }

    func test20CompanionHalfSheetKeepsComposerAboveKeyboard() {
        launch(); openBook(translatedTitle); wakeTop(); app.buttons["陪我读"].tap()
        let question = app.descendants(matching: .any)["reader-question"]
        require(question)
        let navigation = app.navigationBars["陪我读"]
        require(navigation)
        XCTAssertGreaterThan(navigation.frame.minY, app.frame.height * 0.4)
        question.tap(); question.typeText("GET317 question remains visible")
        require(app.keyboards.firstMatch)
        XCTAssertTrue(question.isHittable)
        XCTAssertLessThanOrEqual(question.frame.maxY, app.keyboards.firstMatch.frame.minY + 3)
        XCTAssertGreaterThan(navigation.frame.minY, app.frame.height * 0.35, "Keyboard must not turn the companion into a full-page sheet")
        app.buttons["收起键盘"].tap()
        XCTAssertTrue((question.value as? String)?.contains("GET317 question remains visible") == true)
    }

    func test21CompanionExplicitSubmissionReturnsLabelledSyntheticAnswer() {
        launch(); openBook(translatedTitle); wakeTop(); app.buttons["陪我读"].tap()
        let question = app.descendants(matching: .any)["reader-question"]
        require(question); question.tap(); question.typeText("GET317 explain this synthetic orchard")
        let send = app.buttons["reader-question-send"]
        require(send); XCTAssertTrue(send.isEnabled); send.tap()
        let confirmation = app.alerts["向陪读提问"]
        require(confirmation); require(confirmation.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "私人笔记不会发送")).firstMatch)
        confirmation.buttons["确认提交"].tap()
        require(containsText("GET317 合成 AI 回答样本"))
        require(app.staticTexts["AI 陪读"])
        let remaining = question.value as? String ?? ""
        XCTAssertTrue(remaining.isEmpty || remaining == "写下此刻的问题", "Delivered question should leave an empty composer")
    }

    func test22ListeningPauseAndSpeedDoNotResumeUnexpectedly() {
        launch(); openBook(textTitle); openTool("听书")
        let play = app.buttons["reader-speech-play"]
        require(play); play.tap()
        require(app.buttons["暂停朗读"], timeout: 8); play.tap()
        require(app.buttons["继续朗读"])
        app.segmentedControls.buttons["1.5×"].tap()
        require(app.buttons["继续朗读"])
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        require(app.buttons["结束听书"]); app.buttons["结束听书"].tap()
        require(app.buttons["从当前段开始朗读"])
    }

    func test23ExistingSyntheticPDFReachesLastPageAndColdRestores() {
        launch(); openBook(pdfTitle); wakeTools(); app.buttons["调整阅读进度"].tap()
        let slider = app.sliders["页码"]
        require(slider); slider.adjust(toNormalizedSliderPosition: 1)
        let next = app.buttons["下一页"]
        require(next)
        for _ in 0..<3 where next.isEnabled { next.tap() }
        XCTAssertFalse(next.isEnabled); XCTAssertTrue(app.buttons["上一页"].isEnabled)
        capture("GET317-synthetic-PDF-page-3")
        coldRelaunch(); require(app.otherElements["leafhour-pdf-reader"], timeout: 20)
        wakeTools(); XCTAssertFalse(app.buttons["下一页"].isEnabled)
    }

    func test24BookDetailsExposeOriginalAndRecordExports() {
        launch(); searchShelf(textTitle)
        let details = app.buttons[textTitle + "，书籍详情"]
        require(details); details.tap()
        require(app.buttons["导出我的笔记与草稿"])
        require(app.buttons["导出原件"])
        app.buttons["导出我的笔记与草稿"].tap()
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"])).firstMatch
        require(cancel); capture("GET317-native-record-export-picker"); cancel.tap()
        require(app.buttons["导出我的笔记与草稿"])
    }

    func test25SlowDownloadCanCancelWithoutPublishingAnOfflineBook() {
        launch(["--get317-slow-download"]); searchShelf(slowTitle)
        let download = app.buttons["下载并阅读，" + slowTitle]
        require(download); download.tap()
        let cancel = app.buttons["library-activity-cancel"]
        require(cancel); require(containsText("正在下载"))
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 8))
        require(download)
        XCTAssertFalse(app.buttons["阅读，" + slowTitle + "，已下载可离线阅读"].exists)
        XCTAssertFalse(app.alerts["书房提示"].exists)
    }

    func test26FinishingAnotherDownloadDoesNotHijackCurrentReading() {
        launch(["--get317-slow-download"]); searchShelf(slowTitle)
        let download = app.buttons["下载并阅读，" + slowTitle]
        require(download); download.tap(); require(app.buttons["library-activity-cancel"])
        clearShelfSearch(); openBook(textTitle)
        let source = reader.value as? String
        let unchanged = NSPredicate { _, _ in self.reader.exists && (self.reader.value as? String) == source }
        // The delayed download has three 2-second chapter responses. Wait past its
        // completion instead of asserting immediately while it is still running.
        Thread.sleep(forTimeInterval: 8)
        XCTAssertTrue(unchanged.evaluate(with: nil), "A completed background download replaced the currently open book")
        shelf(); clearShelfSearch(); searchShelf(slowTitle)
        require(app.buttons["阅读，" + slowTitle + "，已下载可离线阅读"])
    }

    func test27AccountRecordFailureIsNotPresentedAsAnEmptyNotebook() {
        launch(["--get317-records-error"]); accountRecords()
        require(containsText("GET317 合成记录读取失败"))
        XCTAssertFalse(app.staticTexts["还没有笔记"].exists)
        XCTAssertFalse(app.staticTexts["这本书还没有个人笔记"].exists)
        app.segmentedControls.buttons["阅读记录"].tap()
        require(containsText("GET317 合成记录读取失败"))
        XCTAssertFalse(app.staticTexts["0 秒"].exists)
    }

    func test28SuccessfulEmptyRecordsShowAnHonestEmptyState() {
        launch(); accountRecords()
        require(app.staticTexts["还没有笔记"])
        XCTAssertFalse(containsText("GET317 合成记录读取失败").exists)
        app.segmentedControls.buttons["阅读记录"].tap()
        XCTAssertFalse(app.staticTexts["这本书还没有个人笔记"].exists)
        XCTAssertFalse(app.staticTexts[translatedTitle].exists)
    }

    func test29CloudShelfFailureStillAllowsLocalReading() {
        launch(["--get317-cloud-error"])
        require(containsText("GET317 合成云书房读取失败"))
        openBook(textTitle)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph") == true)
    }

    func test30SystemImporterCanOpenAndCancelWithoutChangingShelf() {
        launch(); app.buttons["导入书籍"].tap()
        let files = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["最近项目", "Recents", "浏览", "Browse"])).firstMatch
        require(files)
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"])).firstMatch
        require(cancel); capture("GET317-native-file-importer"); cancel.tap()
        require(app.staticTexts["6 本书"])
        XCTAssertFalse(app.alerts["书房提示"].exists)
    }

    func test31ExplicitSyntheticTranslationSavesBothVariantsAndColdRestores() {
        launch(); searchShelf(cloudTitle)
        let download = app.buttons["下载并阅读，" + cloudTitle]
        require(download); download.tap(); require(reader, timeout: 20)
        openTool("翻译"); expandPanel()
        let variants = app.segmentedControls["reader-translation-variant"]
        require(variants); variants.buttons["直译"].tap()
        require(app.staticTexts["这一段尚无直译"])
        let generate = app.buttons["翻译这一段"]
        scrollTo(generate); XCTAssertTrue(generate.isEnabled); generate.tap()
        let confirmation = app.alerts["翻译这一段"]
        require(confirmation)
        require(confirmation.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "只处理当前段落")).firstMatch)
        capture("GET317-synthetic-translation-consent")
        confirmation.buttons["确认提交"].tap()
        require(containsText("GET317 合成直译样本"))
        variants.buttons["意译"].tap()
        require(containsText("GET317 合成意译样本"))
        closePanel(); coldRelaunch(); require(reader, timeout: 20)
        openTool("翻译"); expandPanel()
        variants.buttons["直译"].tap(); require(containsText("GET317 合成直译样本"))
        variants.buttons["意译"].tap(); require(containsText("GET317 合成意译样本"))
    }
}
