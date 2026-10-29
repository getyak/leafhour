import XCTest

/// Runs against the task-owned unsigned local app and public-domain acceptance documents.
/// Seed Alice-complete.epub/pdf into this app's Documents through the guarded setup first.
final class ReadingUITests: XCTestCase {
    let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false; app.terminate(); app.launch() }
    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    /// GET-274 uses a separate task bundle seeded through OfflineLibrary with public-domain text.
    func testCompanionExplicitSummonAndQuietDismissal() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["陪我读"].exists)
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertFalse(app.buttons["陪我读"].exists)
        app.buttons["显示书名、返回与阅读设置"].tap()
        let summon = app.buttons["陪我读"]
        XCTAssertTrue(summon.waitForExistence(timeout: 3)); summon.tap()
        assertCompanionAndDismiss("explicit")
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["陪我读"].exists)
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
        XCTAssertGreaterThan(title.frame.minY, app.windows.firstMatch.frame.height * 0.3,
                             "The companion must leave the upper book visible")
        XCTAssertTrue(app.staticTexts["此设备尚未连接 AI 陪读。原文仍在这里，可以继续阅读。"].exists)
        capture("GET274-" + origin + "-half-sheet-unavailable")
        app.buttons["继续读"].tap()
        capture("GET274-" + origin + "-after-close-tap")
        XCTAssertTrue(title.waitForNonExistence(timeout: 1), app.debugDescription)
        XCTAssertFalse(app.buttons["陪我读"].exists)
        XCTAssertFalse(app.buttons["目录"].exists)
        XCTAssertFalse(app.buttons["阅读设置"].exists)
        capture("GET274-" + origin + "-quiet")
    }
    func progress() {
        let wake = app.buttons["显示阅读进度、目录、搜索与记录"]
        XCTAssertTrue(wake.waitForExistence(timeout: 10)); wake.tap()
    }
    func library() {
        let wake = app.buttons["显示书名、返回与阅读设置"]
        if wake.waitForExistence(timeout: 3) { wake.tap(); app.buttons["返回书房"].tap() }
    }
    func testCompleteEPUBLastChapterAndColdResume() {
        library()
        let book = app.buttons["阅读，Alice’s Adventures in Wonderland"]
        XCTAssertTrue(book.waitForExistence(timeout: 10)); book.tap()
        XCTAssertTrue(app.textViews["leafhour-epub-reader"].waitForExistence(timeout: 10))
        progress(); app.buttons["目录"].tap()
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
        XCTAssertFalse(app.buttons["我的记录"].exists)
        capture("EPUB-cold-resume-pure")
    }
    func testNativeSelectionDraftAndRelaunch() {
        library()
        let book = app.buttons["阅读，Alice’s Adventures in Wonderland"]
        XCTAssertTrue(book.waitForExistence(timeout: 10)); book.tap()
        progress(); app.buttons["目录"].tap(); app.buttons["CHAPTER I."].tap()
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
        progress(); app.buttons["我的记录"].tap()
        let recovered = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", draft)).firstMatch
        XCTAssertTrue(recovered.waitForExistence(timeout: 8), app.debugDescription); recovered.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); XCTAssertEqual(editor.value as? String, expected)
        capture("Native-selected-quote-draft-restored")
    }
    func testPDFSystemImportAndLastPage() {
        library()
        let importButton = app.buttons["导入书籍"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 10)); importButton.tap()
        if app.buttons["Browse"].exists { app.buttons["Browse"].tap() }
        let file = app.cells["Alice-complete, pdf"]
        XCTAssertTrue(file.waitForExistence(timeout: 10), app.debugDescription)
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(app.otherElements["leafhour-pdf-reader"].waitForExistence(timeout: 15), app.debugDescription)
        progress()
        let slider = app.sliders["页码"]
        XCTAssertTrue(slider.exists); slider.adjust(toNormalizedSliderPosition: 1)
        // XCUI normalized slider adjustment is approximate for a stepped 73-page range.
        // Use the actual enabled next-page control to reach the final boundary exactly.
        if !app.buttons["下一页"].exists { progress() }
        let next = app.buttons["下一页"]
        if next.isEnabled { next.tap() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "73 / 73")).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        capture("PDF-page-73-of-73")
    }
    /// GET-272 uses a separate task app seeded through the normal OfflineLibrary import service.
    func testQuietChromeEdgesAndTenSecondIdle() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 15), app.debugDescription)
        let original = reader.value as? String
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)).tap()
        XCTAssertTrue(app.buttons["返回书房"].waitForExistence(timeout: 3), app.debugDescription)
        capture("GET272-native-top-awake")
        Thread.sleep(forTimeInterval: 10)
        XCTAssertFalse(app.buttons["返回书房"].exists)
        XCTAssertFalse(app.buttons["目录"].exists)
        XCTAssertFalse(app.buttons["阅读设置"].exists)
        XCTAssertEqual(reader.value as? String, original)
        capture("GET272-native-idle-ten-seconds")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)).tap()
        XCTAssertTrue(app.buttons["目录"].waitForExistence(timeout: 3), app.debugDescription)
        capture("GET272-native-bottom-awake")
        reader.swipeUp()
        XCTAssertFalse(app.buttons["目录"].waitForExistence(timeout: 0.3))
        capture("GET272-native-scroll-asleep")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertFalse(app.buttons["目录"].exists, "A scrolled middle tap must not wake bottom controls")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)).tap()
        XCTAssertTrue(app.buttons["返回书房"].waitForExistence(timeout: 3), app.debugDescription)
        Thread.sleep(forTimeInterval: 4)
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["目录"].exists)
        capture("GET272-native-cold-resume-asleep")
    }

}
