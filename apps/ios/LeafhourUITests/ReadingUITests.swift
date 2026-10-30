import XCTest

/// Runs against the task-owned unsigned local app and public-domain acceptance documents.
/// Prepare each case through the guarded legacy HostSeed using the complete public-domain originals.
final class ReadingUITests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "org.leafhour.get317.testing")
    override func setUpWithError() throws {
        continueAfterFailure = false
        // The host prepares each case while this task app is stopped. Never
        // reset here: terminate/launch inside a case must retain real records.
        app.launchArguments = ["--get317-acceptance", "-leafhour.library.layout", "list",
                               "-leafhour.library.filter", "all", "-leafhour.library.sort", "added"]
        app.terminate(); app.launch()
    }
    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private let primaryReaderIDs = ["reader-contents", "reader-listen", "reader-appearance", "reader-typography"]
    private func readerControlIsAwake(_ control: XCUIElement) -> Bool {
        control.exists && control.isEnabled && control.isHittable
    }
    private func waitForReaderControlAwake(_ control: XCUIElement, timeout: TimeInterval) -> Bool {
        if readerControlIsAwake(control) { return true }
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            control.exists && control.isEnabled && control.isHittable
        }, object: nil)
        return XCTWaiter.wait(for: [ready], timeout: timeout) == .completed
    }
    private func requireReaderControlAwake(_ control: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitForReaderControlAwake(control, timeout: timeout), "Reader control must be visible, enabled and hittable: \(control)\n\(app.debugDescription)", file: file, line: line)
    }
    private var readerChromeIsAsleep: Bool {
        let entry = app.buttons["reader-tools"]
        guard entry.exists && entry.isEnabled && entry.isHittable else { return false }
        return !app.navigationBars["阅读工具"].exists
            && !app.navigationBars["陪我读"].exists
            && !app.buttons["reader-contents"].isHittable
    }
    private func waitForReaderChromeAsleep(timeout: TimeInterval) -> Bool {
        if readerChromeIsAsleep { return true }
        let quiet = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.readerChromeIsAsleep }, object: nil)
        return XCTWaiter.wait(for: [quiet], timeout: timeout) == .completed
    }
    /// GET-274 uses a separate task bundle seeded through OfflineLibrary with public-domain text.
    func testCompanionExplicitSummonAndQuietDismissal() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3), "The book opens directly in quiet reading")
        requireReaderControlAwake(app.buttons["reader-tools"])
        XCTAssertGreaterThanOrEqual(app.buttons["reader-tools"].frame.width, 44)
        XCTAssertGreaterThanOrEqual(app.buttons["reader-tools"].frame.height, 44)
        openMoreTool("阅读陪读")
        assertCompanionAndDismiss("explicit")
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertTrue(readerControlIsAwake(app.buttons["reader-tools"]), "The More entry keeps companion tools discoverable after a cold launch")
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 8))
    }
    func testCompanionSystemSelectionAndQuietDismissal() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.48)).press(forDuration: 1.2)
        let explain = app.menuItems["解释这句"]
        XCTAssertTrue(explain.waitForExistence(timeout: 5), app.debugDescription); explain.tap()
        XCTAssertTrue(app.staticTexts["作者原文"].waitForExistence(timeout: 3))
        assertCompanionAndDismiss("selection")
        XCTAssertFalse(app.menuItems["解释这句"].exists)
    }
    private func assertCompanionAndDismiss(_ origin: String) {
        let title = app.navigationBars["陪我读"]
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["作者原文"].exists || app.staticTexts["正在读的原文"].exists,
                      "The compact companion retains the captured source on its independent tool page")
        XCTAssertTrue(app.textFields["reader-question"].exists || app.textViews["reader-question"].exists, "The real conversation composer replaces the old placeholder")
        XCTAssertFalse(app.staticTexts["此设备尚未连接 AI 陪读。原文仍在这里，可以继续阅读。"].exists)
        capture("GET312-" + origin + "-conversation-tool-page")
        app.buttons["继续读"].tap()
        capture("GET274-" + origin + "-after-close-tap")
        XCTAssertTrue(title.waitForNonExistence(timeout: 1), app.debugDescription)
        XCTAssertTrue(readerChromeIsAsleep, "Dismissed companion returns to quiet source and its single tools entry")
        capture("GET274-" + origin + "-quiet")
    }
    func progress() {
        let contents = app.buttons["reader-contents"]
        if readerControlIsAwake(contents) { return }
        let entry = app.buttons["reader-tools"]
        requireReaderControlAwake(entry)
        entry.tap()
        XCTAssertTrue(waitForReaderControlAwake(contents, timeout: 3), app.debugDescription)
    }
    private func revealInPanel(_ control: XCUIElement, scrollingUp: Bool = true) {
        let forms = (app.collectionViews.allElementsBoundByIndex + app.tables.allElementsBoundByIndex)
            .filter { $0.exists && !$0.frame.intersection(app.frame).isEmpty }
        guard let form = forms.last else { XCTFail("No foreground reader panel. \(app.debugDescription)"); return }
        for _ in 0..<8 where !control.isHittable {
            if scrollingUp { form.swipeUp() } else { form.swipeDown() }
        }
        XCTAssertTrue(control.exists && control.isHittable, app.debugDescription)
    }
    private func openMoreTool(_ title: String) {
        progress()
        XCTAssertTrue(app.navigationBars["阅读工具"].waitForExistence(timeout: 3), app.debugDescription)
        let tool = app.buttons[title].firstMatch
        revealInPanel(tool); tool.tap()
    }
    func library() {
        let text = app.textViews["leafhour-epub-reader"]
        let surface = text.exists ? text : app.otherElements["leafhour-pdf-reader"]
        if surface.waitForExistence(timeout: 3) {
            progress()
            let back = app.buttons["reader-return-library"]
            revealInPanel(back); back.tap()
        }
    }
    func testCompleteEPUBLastChapterAndColdResume() {
        library()
        let books = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，Alice’s Adventures in Wonderland，"))
        let book = books.firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        XCTAssertEqual(books.count, 1, "The complete Alice title must identify one readable shelf row")
        book.tap()
        XCTAssertTrue(app.textViews["leafhour-epub-reader"].waitForExistence(timeout: 10))
        progress(); app.buttons["reader-contents"].tap()
        let last = app.buttons["CHAPTER XII."]
        for _ in 0..<8 where !last.isHittable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.86)).press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.54)))
        }
        XCTAssertTrue(last.isHittable, app.debugDescription); last.tap()
        let text = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue((text.value as? String)?.contains("CHAPTER XII.") == true)
        capture("EPUB-last-chapter")
        app.terminate(); app.launch()
        XCTAssertTrue(text.waitForExistence(timeout: 10))
        XCTAssertTrue((text.value as? String)?.contains("CHAPTER XII.") == true)
        XCTAssertTrue(readerControlIsAwake(app.buttons["reader-tools"]), "Reading tools are discoverable on entry")
        capture("EPUB-cold-resume-tools")
        openMoreTool("我的记录")
        XCTAssertTrue(app.navigationBars["我的记录"].waitForExistence(timeout: 3), app.debugDescription)
    }
    func testNativeSelectionDraftAndRelaunch() {
        library()
        let books = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，Alice’s Adventures in Wonderland，"))
        let book = books.firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        XCTAssertEqual(books.count, 1, "The complete Alice title must identify one readable shelf row")
        book.tap()
        progress(); app.buttons["reader-contents"].tap(); app.buttons["CHAPTER I."].tap()
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.48)).press(forDuration: 1.2)
        let note = app.menuItems["记笔记"]
        XCTAssertTrue(note.waitForExistence(timeout: 5), app.debugDescription); note.tap()
        let editor = app.textViews["我的笔记正文"], draft = "Native draft " + UUID().uuidString
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText(draft)
        let expected = editor.value as? String ?? ""
        XCTAssertTrue(expected.contains(draft))
        app.buttons["保留草稿"].tap()
        app.terminate(); app.launch()
        openMoreTool("我的记录")
        let recovered = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", draft)).firstMatch
        XCTAssertTrue(recovered.waitForExistence(timeout: 8), app.debugDescription); recovered.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); XCTAssertEqual(editor.value as? String, expected)
        capture("Native-selected-quote-draft-restored")
    }
    func testPDFSystemImportAndLastPage() {
        library()
        let importButton = app.buttons["导入书籍"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 10)); importButton.tap()
        let file = preparedPDFInSystemFiles()
        XCTAssertTrue(file.exists && file.isHittable, app.debugDescription)
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(app.otherElements["leafhour-pdf-reader"].waitForExistence(timeout: 15), app.debugDescription)
        progress(); app.buttons["reader-contents"].tap()
        let slider = app.sliders["页码"]
        XCTAssertTrue(slider.waitForExistence(timeout: 3)); revealInPanel(slider, scrollingUp: false)
        slider.adjust(toNormalizedSliderPosition: 1)
        // XCUI normalized slider adjustment is approximate for a stepped 73-page range.
        // Use the actual enabled next-page control to reach the final boundary exactly.
        let next = app.buttons["下一页"]
        revealInPanel(next, scrollingUp: false)
        if next.isEnabled { next.tap() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "73 / 73")).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        capture("PDF-page-73-of-73")
        app.buttons["继续读"].tap()
        XCTAssertTrue(app.navigationBars["目录"].waitForNonExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.otherElements["leafhour-pdf-reader"].waitForExistence(timeout: 15))
        progress(); app.buttons["reader-contents"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "73 / 73")).firstMatch.waitForExistence(timeout: 5), "The actual 73-page PDF must cold-resume at its saved last page")
        revealInPanel(next, scrollingUp: false)
        XCTAssertFalse(next.isEnabled, "The cold-restored real PDF is at its true last page")
        capture("PDF-page-73-cold-resume")
    }
    private func preparedPDFInSystemFiles() -> XCUIElement {
        // Files retains its last directory. The real previous run started in
        // GET317AcceptanceExports; Browse alone did not leave that folder.
        // Stay in the prepared task directory and use native breadcrumbs only.
        let files = app.collectionViews["File View"].firstMatch
        XCTAssertTrue(files.waitForExistence(timeout: 15), app.debugDescription)
        let candidates = files.cells.matching(NSPredicate(format: "(identifier BEGINSWITH %@ OR label BEGINSWITH %@) AND (identifier CONTAINS[c] %@ OR label CONTAINS[c] %@)", "Alice-complete", "Alice-complete", "pdf", "pdf"))
        for _ in 0..<6 {
            let visible = candidates.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            if let file = visible.first {
                XCTAssertEqual(visible.count, 1, "Select the unique prepared PDF, not the similarly named EPUB")
                capture("PDF-real-system-source-before-selection")
                return file
            }
            let sources = files.cells.matching(NSPredicate(format: "identifier == %@ OR identifier BEGINSWITH %@ OR label == %@ OR label BEGINSWITH %@", "GET317AcceptanceSources", "GET317AcceptanceSources,", "GET317AcceptanceSources", "GET317AcceptanceSources,")).allElementsBoundByIndex.first { $0.isEnabled && $0.isHittable }
            if let sources { sources.tap(); continue }
            let parent = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"].buttons["BackButton"]
            if parent.exists && parent.isEnabled && parent.isHittable { parent.tap(); continue }
            if let browse = ["浏览", "Browse"].map({ app.buttons[$0] }).first(where: { $0.exists && $0.isHittable && !$0.isSelected }) { browse.tap(); continue }
            XCTFail("The actual Files picker has no visible route to the prepared task PDF. " + app.debugDescription)
            return candidates.firstMatch
        }
        XCTFail("Native Files navigation exceeded its bounded route to GET317AcceptanceSources/Alice-complete.pdf. " + app.debugDescription)
        return candidates.firstMatch
    }
    /// GET-272 uses a separate task app seeded through the normal OfflineLibrary import service.
    func testQuietEntryAndEdgesKeepSourceAndColdResume() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let original = reader.value as? String
        reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: min(22, reader.frame.height / 2))).tap()
        requireReaderControlAwake(app.buttons["reader-contents"], timeout: 3)
        capture("quiet-native-top-edge-tools")
        app.buttons["继续读"].tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        XCTAssertEqual(reader.value as? String, original)
        Thread.sleep(forTimeInterval: 10)
        XCTAssertTrue(readerChromeIsAsleep)
        reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: reader.frame.height - min(22, reader.frame.height / 2))).tap()
        requireReaderControlAwake(app.buttons["reader-contents"], timeout: 3)
        capture("quiet-native-bottom-edge-tools")
        app.buttons["继续读"].tap()
        reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let scrolledOriginal = reader.value as? String
        progress()
        app.buttons["继续读"].tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        XCTAssertEqual(reader.value as? String, scrolledOriginal)
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        requireReaderControlAwake(app.buttons["reader-tools"])
        XCTAssertTrue(readerChromeIsAsleep)
        capture("quiet-native-cold-resume-entry")
    }


}
