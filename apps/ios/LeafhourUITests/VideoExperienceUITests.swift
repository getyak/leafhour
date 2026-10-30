import XCTest
import UIKit

/// GET-317 synthetic native acceptance. These tests do not establish real-cloud,
/// paid-model, physical-device, TestFlight, or production acceptance.
final class VideoExperienceUITests: XCTestCase {
    private let app = XCUIApplication()
    private let textTitle = "GET317 合成验收 · 本机文本"
    private let markdownTitle = "GET317 合成验收 · Markdown"
    private let translatedTitle = "GET317 合成验收 · 双译"
    private let pdfTitle = "GET317 合成验收 · PDF"
    private let cloudTitle = "GET317 合成验收 · 云端未下载"
    private let slowTitle = "GET317 合成验收 · 慢速下载"
    private var reader: XCUIElement { app.textViews["leafhour-epub-reader"] }
    private var shelfSearch: XCUIElement {
        app.searchFields.matching(NSPredicate(format: "label IN %@ OR placeholderValue IN %@", ["书名或作者", "搜索书名或作者"], ["书名或作者", "搜索书名或作者"])).firstMatch
    }
    private var originalSearch: XCUIElement {
        app.searchFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "搜索原文", "搜索原文")).firstMatch
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        print("GET317 native runner input: \(#filePath) | \(Bundle(for: Self.self).bundlePath)")
    }
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
    @MainActor private func auditVisibleInterface() throws {
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        try app.performAccessibilityAudit(for: .all) { issue in
            let details = "\(issue.auditType.rawValue) · \(issue.compactDescription)\n\(issue.detailedDescription)\n\(issue.element?.debugDescription ?? "No matching accessibility element")"
            let attachment = XCTAttachment(string: details)
            attachment.name = "GET317 accessibility issue details"
            attachment.lifetime = .keepAlways
            self.add(attachment)
            print("GET317 accessibility issue: " + details)
            return false
        }
    }
    private func require(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        // Avoid XCTest's initial polling delay for an element that is already
        // present. A missing element still receives the full declared wait.
        if element.exists { return }
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "Missing UI: \(element)\n\(app.debugDescription)", file: file, line: line)
    }
    private func containsText(_ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
    private func launch(_ flags: [String] = []) {
        app.launchArguments = ["--get317-acceptance", "--get317-reset", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"] + flags
        app.launch()
        require(app.buttons["书房显示与排序"], timeout: 25)
        setLayout("列表")
        app.segmentedControls.buttons["全部"].tap()
        // A lazy List need not create its third row at accessibility sizes.
        // The exact aggregate count proves seed completion; each flow then
        // searches and operates its own real book instead of requiring it onscreen.
        require(app.staticTexts[flags.contains("--get317-cloud-error") ? "4 本书" : "6 本书"], timeout: 25)
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
        let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
        guard grip.exists && grip.isEnabled && grip.isHittable else { return false }
        let queries = primaryReaderIDs.map { app.buttons.matching(identifier: $0) } + [
            app.buttons.matching(identifier: "reader-book-title"),
            app.buttons.matching(identifier: "reader-more"),
            app.buttons.matching(NSPredicate(format: "label == %@", "返回书房"))
        ]
        // Keep every matching node, including retained/unused layout children.
        // Hierarchy existence is not visibility or VoiceOver focus membership.
        return queries.allSatisfy { query in
            query.allElementsBoundByIndex.allSatisfy { control in
                !control.exists || (!control.isEnabled && !control.isHittable)
            }
        }
    }
    private func waitForReaderChromeAsleep(timeout: TimeInterval) -> Bool {
        if readerChromeIsAsleep { return true }
        let quiet = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.readerChromeIsAsleep }, object: nil)
        return XCTWaiter.wait(for: [quiet], timeout: timeout) == .completed
    }
    private func wakeTools() {
        if readerControlIsAwake(app.buttons["reader-contents"]) { return }
        let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
        if waitForReaderControlAwake(grip, timeout: 1) { grip.tap() }
        else {
            let surface = reader.exists ? reader : app.otherElements["leafhour-pdf-reader"]
            surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        requireReaderControlAwake(app.buttons["reader-contents"], timeout: 4)
    }
    private func wakeTop() {
        if readerControlIsAwake(app.buttons["返回书房"]) { return }
        let surface = reader.exists ? reader : app.otherElements["leafhour-pdf-reader"]
        // Tap the center of the renderer's actual 44 pt edge region. A 1%
        // proportional point sits only 7.8 pt below the status area on Primary.
        surface.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: surface.frame.width / 2, dy: min(22, surface.frame.height / 2))).tap()
        requireReaderControlAwake(app.buttons["返回书房"], timeout: 4)
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
    private let primaryReaderIDs = ["reader-contents", "reader-read", "reader-listen", "reader-appearance", "reader-typography"]
    private var primaryReaderButtons: [XCUIElement] { primaryReaderIDs.map { app.buttons[$0] } }
    private var readerControlsTop: CGFloat {
        let controls = primaryReaderButtons + [app.staticTexts["reader-progress-caption"]]
        return controls.filter { $0.exists }.map(\.frame).filter { !$0.isEmpty }.map(\.minY).min() ?? app.frame.maxY
    }
    private func openTool(_ title: String) {
        if title == "翻译" || title == "我的记录" { openMoreLink(title); return }
        wakeTools()
        let control = title == "更多" ? app.buttons["reader-more"] : app.buttons[title]
        requireReaderControlAwake(control); control.tap()
    }
    private func openMoreLink(_ title: String) {
        openTool("更多")
        let link = app.buttons[title].firstMatch
        scrollTo(link, in: foregroundForm()); require(link); link.tap()
    }
    private func chooseNavigation(_ title: String) {
        openTool("阅读设置"); expandPanel()
        let choice = app.segmentedControls.buttons[title]
        scrollTo(choice, in: foregroundForm(), direction: .down)
        choice.tap(); XCTAssertTrue(choice.isSelected)
        closePanel()
        require(reader.exists ? reader : app.otherElements["leafhour-pdf-reader"])
    }
    private func settledOriginalBand() throws -> Data {
        var previous: Data?, settled: Data?
        let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let current = try? self.bodyBand() else { return false }
            if current == previous { settled = current; return true }
            previous = current; return false
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [stable], timeout: 8), .completed, "Measure the real original after native scrolling/reflow settles")
        return try XCTUnwrap(settled)
    }
    private func selectOriginal() {
        require(reader)
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.30)).press(forDuration: 1.2)
        waitForSystemEditMenu(timeout: 5)
    }
    private var nativeReadingActions: Set<String> { ["解释这句", "记笔记", "核对原文", "查看译文", "问陪读"] }
    private var nativeEditingActions: Set<String> { ["Copy", "复制", "Paste", "粘贴", "Look Up", "查询", "Translate", "翻译", "Search Web", "搜索网页", "Share…", "共享…", "Select", "选择", "Select All", "全选", "AutoFill", "自动填充", "Writing Tools", "书写工具"] }
    private func visibleInApp(_ element: XCUIElement) -> Bool {
        element.exists && !element.frame.isEmpty && !element.frame.intersection(app.frame).isEmpty
    }
    private func visibleNativeMenuItems() -> [XCUIElement] {
        let actions = app.menuItems.allElementsBoundByIndex.filter {
            visibleInApp($0) && (nativeReadingActions.contains($0.label) || nativeEditingActions.contains($0.label))
        }
        // At the largest type size, one real MenuItem (often Copy) can fill
        // the entire native page. Its MenuItem role and visible action label
        // distinguish it from all of the underlying reader's ordinary Buttons.
        return actions
    }
    private func hasVisibleNativeMenuItem() -> Bool {
        // This is an existence oracle: stop after the first confirmed visible
        // native action instead of resolving every later MenuItem by index.
        return app.menuItems.allElementsBoundByIndex.contains {
            visibleInApp($0) && (nativeReadingActions.contains($0.label) || nativeEditingActions.contains($0.label))
        }
    }
    private func nativeButtonEditMenu() -> XCUIElement? {
        // Filter inside XCTest's query before resolving any collection/button
        // properties. Covered shelf collections are not native edit overlays.
        let titles = Array(nativeReadingActions.union(nativeEditingActions))
        let descendant = NSPredicate(format: "elementType == %@ AND label IN %@",
            NSNumber(value: XCUIElement.ElementType.button.rawValue), titles)
        let candidates = app.collectionViews.containing(descendant).allElementsBoundByIndex
        guard !candidates.isEmpty else { return nil }
        let screen = app.frame
        for collection in candidates.reversed() {
            guard collection.exists else { continue }
            let frame = collection.frame
            guard !frame.isEmpty, !frame.intersection(screen).isEmpty else { continue }
            let actions = collection.buttons.matching(NSPredicate(format: "label IN %@ AND enabled == true", titles))
            var reading = Set<String>(), editing = Set<String>()
            for action in actions.allElementsBoundByIndex {
                guard action.exists else { continue }
                let frame = action.frame
                guard !frame.isEmpty, !frame.intersection(screen).isEmpty else { continue }
                let label = action.label
                if nativeReadingActions.contains(label) { reading.insert(label) }
                if nativeEditingActions.contains(label) { editing.insert(label) }
                // The system's expanded AX5 overlay uses Buttons, which need
                // not report isHittable. Preserve its actual visible action group.
                if reading.count >= 2 || editing.count >= 2 { return collection }
            }
        }
        return nil
    }
    private func waitForSystemEditMenu(timeout: TimeInterval) {
        let present = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // A native edit-menu window can temporarily hide the underlying
            // reader from existence queries. Verify the actual overlay roles
            // and action group rather than requiring both AX layers at once.
            return self.hasVisibleNativeMenuItem()
                || self.nativeButtonEditMenu() != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [present], timeout: timeout), .completed, "No actual native edit-menu overlay. \(app.debugDescription)")
    }
    private func systemEditAction(_ titles: [String]) {
        waitForSystemEditMenu(timeout: 5)
        func tapConfirmedVisibleAction(_ action: XCUIElement) -> Bool {
            guard visibleInApp(action), action.isEnabled else { return false }
            let center = CGPoint(x: action.frame.midX, y: action.frame.midY)
            guard app.frame.contains(center) else { return false }
            if action.isHittable { action.tap() }
            else {
                // Native popover AX can report false even for its visible 44 pt
                // actions. Only an already-confirmed edit overlay may use this
                // physical center tap; no clipboard or selection state is set.
                app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: center.x - app.frame.minX, dy: center.y - app.frame.minY)).tap()
            }
            return true
        }
        func tapActionIfVisible() -> Bool {
            let menuItems = visibleNativeMenuItems()
            for title in titles {
                if let action = menuItems.first(where: { $0.label == title }), tapConfirmedVisibleAction(action) { return true }
            }
            if let overlay = nativeButtonEditMenu() {
                for title in titles {
                    let action = overlay.buttons[title]
                    if tapConfirmedVisibleAction(action) { return true }
                }
            }
            return false
        }
        func turnPage(_ aliases: [String]) -> Bool {
            guard let item = visibleNativeMenuItems().first else { return false }
            let menuFrame = item.frame
            let candidates = app.buttons.matching(NSPredicate(format: "label IN %@", aliases)).allElementsBoundByIndex
            guard let page = candidates.first(where: {
                visibleInApp($0) && $0.isEnabled
                    && $0.frame.midY >= menuFrame.minY && $0.frame.midY <= menuFrame.maxY
            }) else { return false }
            guard tapConfirmedVisibleAction(page) else { return false }
            waitForSystemEditMenu(timeout: 3); return true
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
        let bars = app.navigationBars.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        let foreground = bars.enumerated().max { lhs, rhs in
            let left = lhs.element.frame.minY, right = rhs.element.frame.minY
            return left == right ? lhs.offset < rhs.offset : left < right
        }?.element
        guard let top = foreground else { XCTFail("No hittable foreground sheet navigation bar. \(app.debugDescription)"); return }
        let expandedY = app.frame.height * 0.25
        for _ in 0..<2 {
            if top.frame.minY <= expandedY { return }
            top.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
                .press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)))
            let expanded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in top.exists && top.frame.minY <= expandedY }, object: nil)
            if XCTWaiter.wait(for: [expanded], timeout: 2) == .completed { return }
        }
        XCTAssertLessThanOrEqual(top.frame.minY, expandedY, "The actual foreground sheet must expand")
    }
    private func foregroundForm() -> XCUIElement {
        let screen = app.frame
        let bars = app.navigationBars.allElementsBoundByIndex.filter { $0.exists && !$0.frame.intersection(screen).isEmpty }
        let frontBar = bars.enumerated().max { lhs, rhs in
            let left = lhs.element.frame.minY, right = rhs.element.frame.minY
            return left == right ? lhs.offset < rhs.offset : left < right
        }?.element
        let visible = (app.collectionViews.allElementsBoundByIndex + app.tables.allElementsBoundByIndex)
            .filter { $0.exists && !$0.frame.intersection(screen).isEmpty }
        // SwiftUI's CollectionView can report isHittable == false while its
        // sliders are visibly hittable. Match the front navigation region and
        // hierarchy order; individual controls still require real hit points.
        let frontBoundary = frontBar.map { $0.frame.minY - max(64, $0.frame.height) } ?? screen.minY
        let associated = visible.filter { $0.frame.minY >= frontBoundary }
        let candidates = associated.isEmpty ? visible : associated
        let form = candidates.enumerated().max { lhs, rhs in
            let left = lhs.element.frame.minY, right = rhs.element.frame.minY
            return left == right ? lhs.offset < rhs.offset : left < right
        }?.element
        guard let form else { XCTFail("No visible foreground Form/List. \(app.debugDescription)"); return app.collectionViews["GET317 missing foreground form"] }
        return form
    }
    private enum ScrollDirection { case up, down }
    private func scrollTo(_ element: XCUIElement, in surface: XCUIElement? = nil, direction: ScrollDirection = .up) {
        let surface = surface ?? foregroundForm()
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            if direction == .up { surface.swipeUp() } else { surface.swipeDown() }
        }
        XCTAssertTrue(element.exists && element.isHittable, "Could not reach \(element). \(app.debugDescription)")
    }
    private func nudgeContent(_ surface: XCUIElement, by delta: CGFloat, inside viewport: CGRect) {
        guard viewport.height > 80 else { XCTFail("No usable foreground scrolling viewport"); return }
        let travel = min(abs(delta), viewport.height - 48)
        guard travel > 1 else { return }
        let start = CGPoint(x: viewport.midX, y: delta > 0 ? viewport.minY + 24 : viewport.maxY - 24)
        let end = CGPoint(x: start.x, y: start.y + (delta > 0 ? travel : -travel))
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: start.x - app.frame.minX, dy: start.y - app.frame.minY))
            .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: end.x - app.frame.minX, dy: end.y - app.frame.minY)),
                   withVelocity: .slow, thenHoldForDuration: 0.2)
    }
    /// Profile tests measure the actual scroll surface and visible native bars.
    /// A control's 44 pt minimum is not a system bottom inset.
    private func recordProfileContentViewport(_ surface: XCUIElement, navigationTitle: String, topLimit: CGFloat? = nil) -> CGRect {
        let frame = surface.frame.intersection(app.frame)
        let navigation = app.navigationBars[navigationTitle]
        let top = max(frame.minY, max(navigation.exists ? navigation.frame.maxY : frame.minY, topLimit ?? frame.minY))
        var bottom = frame.maxY
        for occluder in app.keyboards.allElementsBoundByIndex + app.tabBars.allElementsBoundByIndex {
            if occluder.exists && !occluder.frame.intersection(frame).isEmpty && occluder.frame.minY > top {
                bottom = min(bottom, occluder.frame.minY)
            }
        }
        return CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
    }
    private func nudgeRecordProfileContent(_ surface: XCUIElement, by delta: CGFloat, inside viewport: CGRect) {
        guard viewport.height > 96 else { XCTFail("No actual profile scrolling viewport"); return }
        // A 4 pt clipping correction formerly produced a 10 pt gesture that
        // repeatedly left the content unchanged. Start a real pan, then measure
        // the new target frame again. The inset gutter avoids sliders and text.
        // Keep the physical pan inside the scrollable content. Its AX frame
        // includes the bottom system area; y=850 in an 874 pt window does not
        // scroll this Form even though its entire text target can be visible.
        let travel = min(max(abs(delta), 48), viewport.height * 0.5)
        let start = CGPoint(x: viewport.minX + min(8, viewport.width / 4), y: viewport.minY + viewport.height * (delta > 0 ? 0.25 : 0.75))
        let end = CGPoint(x: start.x, y: start.y + (delta > 0 ? travel : -travel))
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: start.x - app.frame.minX, dy: start.y - app.frame.minY))
            .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: end.x - app.frame.minX, dy: end.y - app.frame.minY)),
                   withVelocity: .slow, thenHoldForDuration: 0.2)
    }
    private func selectOriginalForSavedRecordProfile() throws {
        require(reader)
        reader.swipeUp()
        let viewport = reader.frame.intersection(app.frame)
        let paragraphs = reader.descendants(matching: .textView).matching(NSPredicate(format: "label BEGINSWITH %@", "GET317 synthetic paragraph")).allElementsBoundByIndex
        let paragraph = try XCTUnwrap(paragraphs.first {
            let visible = $0.frame.intersection(viewport)
            return !visible.isEmpty && visible.width > 40 && visible.height > 64
        }, "Select from a real visible source paragraph, rather than the reader's blank page inset")
        let visible = paragraph.frame.intersection(viewport)
        let point = CGPoint(x: visible.minX + min(32, visible.width / 4), y: visible.minY + min(32, visible.height / 4))
        let details = "paragraph=\(paragraph.frame), visible=\(visible), nativeLongPress=\(point), source=\(paragraph.label.prefix(80))"
        let attachment = XCTAttachment(string: details)
        attachment.name = "GET317-UI42-real-paragraph-selection-target"
        attachment.lifetime = .keepAlways
        add(attachment)
        capture("GET317-UI42-before-native-paragraph-selection")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x - app.frame.minX, dy: point.y - app.frame.minY)).press(forDuration: 1.2)
        waitForSystemEditMenu(timeout: 5)
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
    private func openAccountSheet() {
        let profile = app.buttons["我的账号"]
        if profile.exists && profile.isHittable { profile.tap() }
        else {
            let entry = app.buttons["我的笔记与阅读记录"]
            scrollTo(entry, in: foregroundForm()); entry.tap()
        }
        require(app.navigationBars["我的账号"])
    }
    private func waitForEnabledState(_ element: XCUIElement, enabled: Bool) {
        require(element)
        let state = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in element.exists && element.isEnabled == enabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [state], timeout: 8), .completed, "Expected enabled=\(enabled): \(element). \(app.debugDescription)")
    }
    private var systemFilesRoot: XCUIElement { app.otherElements["Browse View (Picker)"] }
    private func nativeFilesItem(_ titles: [String], cellsOnly: Bool = false) -> XCUIElement? {
        let root: XCUIElement = systemFilesRoot.exists ? systemFilesRoot : app
        for title in titles {
            let predicate = NSPredicate(format: "label == %@ OR label BEGINSWITH %@", title, title + ", ")
            for query in (cellsOnly ? [root.cells] : [root.cells, root.buttons]) {
                let matches = query.matching(predicate)
                for index in 0..<matches.count {
                    // Keep a live query: Files can replace AX node identities as
                    // its provider list finishes loading after presentation.
                    let item = matches.element(boundBy: index)
                    guard item.exists else { continue }
                    let label = item.label, frame = item.frame
                    // Folder-title menus are navigation context, not the cell
                    // that opens a folder. Opening one obscures the actual file.
                    if label.contains("操作菜单") || label.contains("Actions Menu") { continue }
                    if item.isEnabled && !frame.isEmpty && app.frame.intersects(frame) && item.isHittable { return item }
                }
            }
        }
        return nil
    }
    private func waitForNativeFiles() {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.systemFilesRoot.exists || self.app.navigationBars["FullDocumentManagerViewControllerNavigationBar"].exists
                || self.nativeFilesItem(["浏览", "Browse", "最近项目", "Recents", "最近使用", "取消", "Cancel", "关闭", "Close", "导出", "Export", "存储", "保存", "Save", "我的 iPhone", "我的iPhone", "On My iPhone"]) != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed, "The actual system Files UI must finish presenting before navigation")
    }
    private func openRecordExporterFromDetails() {
        let export = app.buttons["导出我的笔记与草稿"]
        let form = app.collectionViews["book-details-list"]
        require(form)
        for _ in 0..<6 {
            if export.exists && export.isHittable && export.frame.maxY <= app.frame.maxY - 44 { break }
            form.swipeUp()
        }
        require(export)
        XCTAssertTrue(export.isHittable && export.frame.maxY <= app.frame.maxY - 44, "The complete export button must be above the home-indicator area before tapping")
        export.tap()
        waitForNativeFiles()
    }
    private func navigateNativeFiles(to folder: String, selecting file: String? = nil) {
        waitForNativeFiles()
        for _ in 0..<10 {
            if let file, nativeFilesItem([file, file + ".txt"]) != nil { return }
            let current = app.navigationBars[folder]
            let folderMenu = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", folder + ", ")).firstMatch
            if current.exists || (folderMenu.exists && folderMenu.label.contains("操作菜单")) {
                if let file {
                    let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                        self.nativeFilesItem([file, file + ".txt"], cellsOnly: true) != nil
                    }, object: nil)
                    XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 15), .completed, "The selected folder must load its real source file")
                }
                return
            }
            if let destination = nativeFilesItem([folder], cellsOnly: true) { destination.tap(); continue }
            if let appFolder = nativeFilesItem(["Leafhour"], cellsOnly: true) { appFolder.tap(); continue }
            if let device = nativeFilesItem(["我的 iPhone", "我的iPhone", "On My iPhone"]) { device.tap(); continue }
            // Files remembers the last directory. Export may start in the
            // previous import's Sources folder, so take the actual system
            // breadcrumb to its parent before looking for the sibling Exports.
            let parent = systemFilesRoot.navigationBars["FullDocumentManagerViewControllerNavigationBar"].buttons["BackButton"]
            if parent.exists && parent.isEnabled && parent.isHittable { parent.tap(); continue }
            if let browse = nativeFilesItem(["浏览", "Browse", "位置", "Locations"]) { browse.tap(); continue }
            capture("GET317-system-files-route-unavailable")
            XCTFail("System Files has no reachable route to the synthetic folder \(folder). \(app.debugDescription)")
            return
        }
        XCTFail("System Files navigation exceeded its bounded route to \(folder). \(app.debugDescription)")
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
        try auditVisibleInterface()
        openBook(textTitle)
        reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        try auditVisibleInterface()
    }

    func test33NativeSelectionMenuSurvivesTheChromeIdleInterval() {
        launch(); openBook(textTitle)
        reader.swipeUp()
        let back = app.buttons["返回书房"]
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        wakeTop(); XCTAssertTrue(readerControlIsAwake(back), "Confirm the top controls are awake before starting the selection")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.30)).press(forDuration: 1.2)
        waitForSystemEditMenu(timeout: 3)
        Thread.sleep(forTimeInterval: 8)
        waitForSystemEditMenu(timeout: 3)
        XCTAssertTrue(readerControlIsAwake(back), "Selecting text must keep its controls and menu stable")
        systemEditAction(["复制", "Copy"])
        require(reader)
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
        let form = foregroundForm()
        let font = app.sliders["正文字号"], spacing = app.sliders["正文行间距"]
        scrollTo(font, in: form, direction: .down); font.adjust(toNormalizedSliderPosition: 0.75)
        let savedFont = font.value as? String
        scrollTo(spacing, in: form)
        spacing.adjust(toNormalizedSliderPosition: 0.75)
        let savedSpacing = spacing.value as? String
        XCTAssertNotEqual(savedFont, "22 磅")
        let night = app.segmentedControls.buttons["夜读"]
        scrollTo(night, in: form); night.tap(); closePanel()
        coldRelaunch(); require(reader, timeout: 20); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let restoredForm = foregroundForm()
        scrollTo(font, in: restoredForm, direction: .down); XCTAssertEqual(font.value as? String, savedFont)
        scrollTo(spacing, in: restoredForm); XCTAssertEqual(spacing.value as? String, savedSpacing)
        scrollTo(night, in: restoredForm); XCTAssertTrue(night.isSelected)
    }

    func test14ResetTypographyKeepsTheChosenTheme() {
        launch(); openBook(textTitle); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let form = foregroundForm(), font = app.sliders["正文字号"], night = app.segmentedControls.buttons["夜读"]
        scrollTo(font, in: form, direction: .down); font.adjust(toNormalizedSliderPosition: 0.9)
        scrollTo(night, in: form); night.tap()
        let reset = app.buttons["恢复默认排版"]
        scrollTo(reset, in: form, direction: .down); reset.tap()
        scrollTo(font, in: form, direction: .down); XCTAssertEqual(font.value as? String, "22 磅")
        let defaultStatus = app.staticTexts["当前为默认排版"]
        scrollTo(defaultStatus, in: form); require(defaultStatus)
        XCTAssertFalse(reset.exists)
        scrollTo(night, in: form); XCTAssertTrue(night.isSelected)
    }

    func test15MiddleTapRevealsAndHidesControlsWithoutMovingTheOriginal() throws {
        launch(); openBook(textTitle); reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let before = try bodyBand()
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        requireReaderControlAwake(app.buttons["reader-contents"])
        requireReaderControlAwake(app.buttons["reader-more"])
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        XCTAssertEqual(try bodyBand(), before, "Showing and hiding controls must not move the original")
        wakeTools(); requireReaderControlAwake(app.buttons["目录"])
    }

    func test16OpeningAndClosingToolsDoesNotMoveTheVisibleText() throws {
        launch(); openBook(textTitle); reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let before = try bodyBand()
        openTool("更多"); require(app.buttons["搜索原文"])
        closePanel(); require(reader)
        XCTAssertEqual(try bodyBand(), before, "Closing tools must preserve the visible original")
    }

    func test17TranslationVariantsKeepSourceAndDraftIdentity() {
        launch(); openBook(translatedTitle); openTool("翻译"); expandPanel()
        require(app.staticTexts["当前段 · 作者原文"])
        let form = foregroundForm()
        scrollTo(containsText("GET317 合成直译样本"), in: form)
        require(containsText("GET317 合成直译样本"))
        let variants = app.segmentedControls["reader-translation-variant"]
        scrollTo(variants, in: form, direction: .down)
        require(variants); variants.buttons["意译"].tap()
        scrollTo(containsText("GET317 合成意译样本"), in: form)
        require(containsText("GET317 合成意译样本"))
        XCTAssertFalse(containsText("GET317 合成直译样本").exists)
        require(containsText("草稿 · 尚未复核"))
        scrollTo(variants, in: form, direction: .down)
        variants.buttons["直译"].tap()
        scrollTo(containsText("GET317 合成直译样本"), in: form); require(containsText("GET317 合成直译样本"))
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
        let form = foregroundForm()
        scrollTo(app.buttons["完整阅读原文"], in: form)
        require(app.buttons["完整阅读原文"])
        scrollTo(app.staticTexts["此设备暂无可显示的直译"], in: form)
        require(app.staticTexts["此设备暂无可显示的直译"])
        scrollTo(app.staticTexts["此设备暂无可显示的意译"], in: form)
        require(app.staticTexts["此设备暂无可显示的意译"])
        let generate = app.buttons["翻译这一段"]
        scrollTo(generate, in: form); XCTAssertFalse(generate.isEnabled)
    }

    func test20CompanionHalfSheetKeepsComposerAboveKeyboard() {
        launch(); openBook(translatedTitle); openMoreLink("阅读陪读")
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
        launch(); openBook(translatedTitle); openMoreLink("阅读陪读")
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
        launch(); openBook(textTitle); openTool("听书"); expandPanel()
        let form = foregroundForm()
        let play = app.buttons["reader-speech-play"]
        scrollTo(play, in: form); play.tap()
        let firstPassage = app.staticTexts["第 1 / 35 段"]
        require(app.buttons["暂停朗读"], timeout: 8)
        require(firstPassage, timeout: 5)
        play.tap()
        require(app.buttons["继续朗读"])
        require(firstPassage)
        let speed = app.segmentedControls.buttons["1.5×"]
        scrollTo(speed, in: form); speed.tap()
        scrollTo(play, in: form, direction: .down)
        require(app.buttons["继续朗读"])
        require(firstPassage)
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        let stop = app.buttons["结束听书"]
        scrollTo(stop, in: form); stop.tap()
        scrollTo(play, in: form, direction: .down)
        require(app.buttons["从当前段开始朗读"])
    }

    func test23ExistingSyntheticPDFReachesLastPageAndColdRestores() {
        launch(); openBook(pdfTitle); openTool("目录"); expandPanel()
        let slider = app.sliders["页码"]
        require(slider); slider.adjust(toNormalizedSliderPosition: 1)
        let next = app.buttons["下一页"]
        require(next)
        for _ in 0..<3 where next.isEnabled { next.tap() }
        XCTAssertFalse(next.isEnabled); XCTAssertTrue(app.buttons["上一页"].isEnabled)
        capture("GET317-synthetic-PDF-page-3")
        coldRelaunch(); require(app.otherElements["leafhour-pdf-reader"], timeout: 20)
        openTool("目录"); expandPanel(); XCTAssertFalse(app.buttons["下一页"].isEnabled)
    }

    func test24BookDetailsExposeOriginalAndRecordExports() {
        launch(); searchShelf(textTitle)
        let details = app.buttons[textTitle + "，书籍详情"]
        require(details); details.tap()
        require(app.buttons["导出我的笔记与草稿"])
        require(app.buttons["导出原件"])
        openRecordExporterFromDetails()
        capture("GET317-native-record-export-picker")
        let picker = systemFilesRoot
        require(picker)
        // The iOS 26 save picker exposes a Back/Save bar in a subfolder,
        // rather than a Cancel button. Exercise its native sheet dismissal.
        picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01))
            .press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.96)))
        XCTAssertTrue(picker.waitForNonExistence(timeout: 10), "Native dismissal must actually close the system exporter")
        require(app.buttons["导出我的笔记与草稿"])
        XCTAssertTrue(app.buttons["导出我的笔记与草稿"].isHittable)
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
        launch(["--get317-gated-download"]); searchShelf(slowTitle)
        let download = app.buttons["下载并阅读，" + slowTitle]
        require(download); download.tap(); require(app.buttons["library-activity-cancel"])
        let progress = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "书籍处理进度")).firstMatch
        require(progress)
        // The first chapter is held until this actual local-book action creates
        // the reader. Keep the shelf unfiltered so A's completed row is observable.
        clearShelfSearch()
        let localBook = app.buttons["阅读，" + textTitle + "，已下载可离线阅读"]
        scrollTo(localBook, in: foregroundForm()); localBook.tap(); require(reader)
        let source = reader.value as? String
        XCTAssertTrue(source?.contains("GET317 synthetic paragraph 1") == true, "The real local-book action must open B")
        let savedDownload = app.buttons["阅读，" + slowTitle + "，已下载可离线阅读"]
        require(savedDownload, timeout: 20)
        XCTAssertTrue(progress.waitForNonExistence(timeout: 20), "Wait for download publication and task teardown, not a fixed delay")
        XCTAssertFalse(app.buttons["library-activity-cancel"].exists)
        XCTAssertTrue(reader.exists)
        XCTAssertEqual(reader.value as? String, source, "A completed background download replaced the currently open book")
        XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph 1") == true)
        shelf(); clearShelfSearch(); searchShelf(slowTitle)
        require(savedDownload)
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
        require(app.staticTexts["暂无已记录时长的书"])
        let records = foregroundForm()
        XCTAssertFalse(records.staticTexts["这本书还没有个人笔记"].exists)
        XCTAssertFalse(records.staticTexts[translatedTitle].exists, "The foreground records must omit books without recorded time; the covered shelf may still expose its own title in AX")
    }

    func test29CloudShelfFailureStillAllowsLocalReading() {
        launch(["--get317-cloud-error"])
        require(containsText("GET317 合成云书房读取失败"))
        openBook(textTitle)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph") == true)
    }

    func test30SystemImporterCanOpenAndCancelWithoutChangingShelf() {
        launch(); app.buttons["导入书籍"].tap()
        waitForNativeFiles()
        let picker = systemFilesRoot
        require(picker); capture("GET317-native-file-importer")
        if let cancel = nativeFilesItem(["取消", "Cancel"]), cancel.isEnabled && cancel.isHittable {
            cancel.tap()
        } else {
            // Files remembers the previous directory. Its nested iOS 26 picker
            // may expose only Back/More, so use the same real native dismissal
            // gesture verified for the exporter instead of requiring Cancel.
            picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01))
                .press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.96)))
        }
        XCTAssertTrue(picker.waitForNonExistence(timeout: 10), "Cancelling must dismiss the actual system Files picker")
        require(app.staticTexts["6 本书"])
        XCTAssertTrue(app.buttons["导入书籍"].isHittable)
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

    func test34SystemFilesActuallyImportsSyntheticTextAndColdRestoresIt() {
        launch()
        let title = "GET317-System-Picker-Import"
        XCTAssertFalse(app.buttons["阅读，" + title + "，已下载可离线阅读"].exists)
        app.buttons["导入书籍"].tap()
        capture("GET317-system-import-before-file-selection")
        navigateNativeFiles(to: "GET317AcceptanceSources", selecting: title)
        guard let file = nativeFilesItem([title, title + ".txt"]) else {
            XCTFail("The actual system picker cannot find the prepared synthetic source. \(app.debugDescription)"); return
        }
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        require(reader, timeout: 20)
        XCTAssertTrue((reader.value as? String)?.contains("GET317_SYSTEM_PICKER_IMPORT_SUCCESS") == true)
        XCTAssertTrue((reader.value as? String)?.contains("GET317_SYSTEM_PICKER_IMPORT_END") == true)
        coldRelaunch(); require(reader, timeout: 20)
        XCTAssertTrue((reader.value as? String)?.contains("GET317_SYSTEM_PICKER_IMPORT_SUCCESS") == true)
        shelf(); clearShelfSearch(); searchShelf(title)
        require(app.buttons["阅读，" + title + "，已下载可离线阅读"])
    }

    func test35PersonalRecordsActuallySaveThroughTheSystemFileExporter() {
        launch(); openBook(textTitle)
        let editor = noteEditor()
        let sentinel = "GET317_UI35_EXPORT_CONTENT_" + UUID().uuidString
        editor.tap(); editor.typeText(sentinel); app.buttons["保存笔记"].tap()
        shelf(); clearShelfSearch(); searchShelf(textTitle)
        let details = app.buttons[textTitle + "，书籍详情"]
        require(details); details.tap()
        openRecordExporterFromDetails()
        capture("GET317-system-export-before-save")
        navigateNativeFiles(to: "GET317AcceptanceExports")
        guard let save = nativeFilesItem(["保存", "导出", "Export", "存储", "Save", "移动", "Move"]) else {
            XCTFail("The actual system exporter has no reachable save action. \(app.debugDescription)"); return
        }
        save.tap()
        let replace = app.alerts.buttons.matching(NSPredicate(format: "label IN %@", ["替换", "Replace"])).firstMatch
        if replace.waitForExistence(timeout: 2) { replace.tap() }
        XCTAssertTrue(systemFilesRoot.waitForNonExistence(timeout: 10), "The actual system Files picker must dismiss after saving, regardless of its navigation-bar identifier")
        require(app.buttons["导出我的笔记与草稿"])
        XCTAssertTrue(app.buttons["导出我的笔记与草稿"].isHittable)
        XCTAssertFalse(app.alerts["书房提示"].exists)
        // Host-side verification must independently read the actual saved
        // Documents/GET317AcceptanceExports/Leafhour-records.json and validate
        // format, book identity and this unique note sentinel. The fixture never
        // writes that JSON. This test does not claim JSON restore is implemented.
        XCTContext.runActivity(named: "Saved note sentinel: " + sentinel) { _ in capture("GET317-system-export-after-save") }
    }

    func test36AvailableAccountProvidersDisableOnlyWhileABookTaskIsBusy() {
        launch(["--get317-native-auth", "--get317-gated-download"])
        openAccountSheet()
        let apple = app.buttons["leafhour-link-apple"], google = app.buttons["leafhour-link-google"]
        waitForEnabledState(apple, enabled: true); waitForEnabledState(google, enabled: true)
        capture("GET317-providers-available-before-download")
        app.buttons["完成"].tap()
        searchShelf(slowTitle)
        let download = app.buttons["下载并阅读，" + slowTitle]
        require(download); download.tap(); require(app.buttons["library-activity-cancel"])
        clearShelfSearch(); openAccountSheet()
        waitForEnabledState(apple, enabled: false); waitForEnabledState(google, enabled: false)
        require(app.descendants(matching: .any)["leafhour-auth-book-processing"])
        capture("GET317-providers-disabled-during-gated-download")
        app.buttons["完成"].tap()
        let cancel = app.buttons["library-activity-cancel"]
        require(cancel); cancel.tap(); XCTAssertTrue(cancel.waitForNonExistence(timeout: 8))
        openAccountSheet()
        waitForEnabledState(apple, enabled: true); waitForEnabledState(google, enabled: true)
        XCTAssertFalse(app.descendants(matching: .any)["leafhour-auth-book-processing"].exists)
    }

    func test37RejectedAccountLinkShowsItsErrorWithoutChangingTheAccount() {
        launch(["--get317-native-auth"]); openAccountSheet()
        let google = app.buttons["leafhour-link-google"]
        scrollTo(google, in: foregroundForm())
        waitForEnabledState(google, enabled: true); google.tap()
        let error = app.staticTexts["leafhour-account-auth-error"]
        let form = foregroundForm()
        scrollTo(error, in: form); require(error)
        XCTAssertTrue(error.label.contains("GET317 合成账号关联被拒绝"))
        capture("GET317-rejected-link-error-visible-in-signed-in-account")
        let account = containsText("get317-synthetic@example.invalid")
        scrollTo(account, in: form, direction: .down); require(account)
        scrollTo(google, in: form)
        waitForEnabledState(google, enabled: true)
        XCTAssertFalse(app.staticTexts["登录方式已关联到这间书房。"].exists)
    }

    @MainActor
    func test38SavedRecordsAndExpandedSettingsPassNativeAccessibilityAudits() throws {
        launch(); openBook(textTitle)
        let editor = noteEditor(), note = "GET317 UI38 saved note for native sheet accessibility"
        editor.tap(); editor.typeText(note); app.buttons["保存笔记"].tap()
        openTool("我的记录"); expandPanel()
        let records = app.staticTexts[note]
        scrollTo(records, in: foregroundForm())
        require(app.navigationBars["我的记录"])
        XCTAssertTrue(records.isHittable)
        records.tap()
        require(app.navigationBars["我的记录"])
        capture("GET317-a11y-saved-records-foreground-sheet")
        try auditVisibleInterface()

        closePanel(); wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let settings = foregroundForm()
        scrollTo(app.sliders["正文字号"], in: settings, direction: .down)
        require(app.navigationBars["阅读设置"])
        capture("GET317-a11y-settings-foreground-top")
        try auditVisibleInterface()

        let systemTheme = app.segmentedControls.buttons["跟随系统"]
        scrollTo(systemTheme, in: settings)
        settings.swipeUp()
        XCTAssertTrue(systemTheme.exists && systemTheme.isHittable, "Audit the exposed theme controls in the actual foreground Form")
        capture("GET317-a11y-settings-foreground-bottom")
        try auditVisibleInterface()
    }

    @MainActor
    func test39AwakeReaderControlsKeepNativeTapTargetsDuringSelection() throws {
        launch(); openBook(translatedTitle); openTool("目录")
        let chapter = app.buttons["GET317 合成第 2 章"]
        require(chapter); chapter.tap(); require(reader)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c2 paragraph") == true)
        reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        wakeTools()
        selectOriginal()
        systemEditAction(["复制", "Copy"])
        let menuDismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.visibleNativeMenuItems().isEmpty && self.nativeButtonEditMenu() == nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [menuDismissed], timeout: 3), .completed, "Copy must dismiss the actual native edit menu before auditing the reader")

        // Real UIKit selection must keep the controls awake beyond their ordinary
        // six-second idle interval. No test flag or synthetic selection is used.
        Thread.sleep(forTimeInterval: 8)
        let titles = ["返回书房", "更多", "目录", "阅读", "听书", "外观", "阅读设置"]
        func assertAwakeControls() {
            for title in titles {
                let control = app.buttons[title]
                XCTAssertTrue(control.exists, "The selected original must keep \(title) awake")
                XCTAssertTrue(control.isEnabled, "Chapter two must expose an enabled \(title) control")
                XCTAssertTrue(control.isHittable, "The actual \(title) button must be reachable")
                XCTAssertGreaterThanOrEqual(control.frame.width, 44, "\(title) must expose a native tap target at least 44 points wide")
                XCTAssertGreaterThanOrEqual(control.frame.height, 44, "\(title) must expose a native tap target at least 44 points high")
            }
        }
        assertAwakeControls()
        capture("GET317-a11y-awake-reader-five-controls")
        try auditVisibleInterface()
        assertAwakeControls()
    }

    @MainActor
    func test40SystemTypeProfileKeepsTheFullTitleAndEveryReadingToolUsable() throws {
        executionTimeAllowance = 300
        // The host changes the real simulator preference before launching XCTest.
        // Read that OS setting; a shell environment flag need not reach this process.
        let category = UIApplication.shared.preferredContentSizeCategory
        let largeTraits = UITraitCollection(preferredContentSizeCategory: .large)
        var evidence: [[String: Any]] = [["systemCategory": category.rawValue, "accessibilityCategory": category.isAccessibilityCategory]]
        defer {
            do {
                let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
                let text = String(decoding: data, as: UTF8.self)
                let attachment = XCTAttachment(string: text)
                attachment.name = "GET317-UI40-system-type-profile-frames.json"
                attachment.lifetime = .keepAlways
                add(attachment)
                print("GET317 UI40 profile frames: " + text)
            } catch { XCTFail("Could not retain the actual UI40 frame evidence: \(error)") }
        }
        func record(_ key: String, _ element: XCUIElement) {
            let frame = element.frame
            evidence.append(["key": key, "x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)])
        }
        func reachable(_ element: XCUIElement) {
            require(element)
            XCTAssertTrue(element.isEnabled && element.isHittable, "The real profile must leave this control actionable: \(element)")
        }
        func stabilizeToolsWithNativeSelection() {
            // Select while the chrome sleeps, then use the real Copy action.
            // Selection holds the existing idle guard while slow AX snapshots
            // measure the controls; the production timer is never overridden.
            reader.swipeUp()
            reader.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.5)).press(forDuration: 1.2)
            waitForSystemEditMenu(timeout: 5); systemEditAction(["复制", "Copy"])
            wakeTools()
        }
        func inspectPrimaryControls() {
            for control in primaryReaderButtons {
                reachable(control)
                XCTAssertTrue(app.frame.insetBy(dx: -1, dy: -1).contains(control.frame))
                XCTAssertGreaterThanOrEqual(control.frame.width, 44)
                XCTAssertGreaterThanOrEqual(control.frame.height, 44)
                record("primary." + control.identifier, control)
                let visibleText: String? = control.identifier == "reader-read" ? "阅读" : control.identifier == "reader-listen" ? "听书" : control.identifier == "reader-typography" ? "Aa" : nil
                if let visibleText {
                    let text = control.staticTexts[visibleText]
                    evidence.append(["key": "primary.text-semantics", "control": control.identifier, "text": visibleText, "hasSeparateTextLeaf": text.exists])
                    if text.exists {
                        record("primary.text." + control.identifier, text)
                        if category.isAccessibilityCategory {
                            let style: UIFont.TextStyle = visibleText == "Aa" ? .body : .subheadline
                            let ordinary = UIFont.preferredFont(forTextStyle: style, compatibleWith: largeTraits)
                            XCTAssertGreaterThan(text.frame.height, ordinary.lineHeight * 1.5, "Actual visible Read/Listen/Aa text must follow the OS size preference")
                        }
                    }
                }
            }
            capture("GET328-UI40-all-primary-controls")
        }

        launch()
        searchShelf("本机文本")
        let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + textTitle)).firstMatch
        scrollTo(book, in: foregroundForm()); reachable(book)
        let shelfTitle = app.staticTexts[textTitle].firstMatch
        require(shelfTitle); record("shelf.title", shelfTitle)
        capture("GET317-UI40-search-and-shelf")
        book.tap(); require(reader)
        stabilizeToolsWithNativeSelection()
        let back = app.buttons["返回书房"], more = app.buttons["reader-more"]
        reachable(back); reachable(more); inspectPrimaryControls()
        let title = app.buttons["reader-book-title"]
        reachable(title); XCTAssertEqual(title.label, textTitle)
        record("reader.title-button", title)
        // A native SwiftUI Button can merge its Text into the button's full
        // accessible label. That is the same live text, not a missing child.
        let separateTitleLabel = title.staticTexts[textTitle]
        let titleLabel = separateTitleLabel.exists ? separateTitleLabel : title
        record("reader.title-label", titleLabel)
        evidence.append(["key": "reader.title-semantics", "separateStaticText": separateTitleLabel.exists, "fullAccessibleLabel": title.label == textTitle])
        let backFrame = back.frame, moreFrame = more.frame, titleFrame = title.frame
        let currentFont = UIFont.preferredFont(forTextStyle: .subheadline)
        let lineCount: CGFloat = category.isAccessibilityCategory ? 2 : 1
        XCTAssertGreaterThanOrEqual(titleFrame.width, 44)
        XCTAssertGreaterThanOrEqual(titleFrame.height, 44)
        XCTAssertLessThanOrEqual(titleFrame.height, max(44, currentFont.lineHeight * lineCount + 4), "The navigation title must remain bounded while its full text stays available in Book Information")
        evidence.append(["key": "reader.title-layout", "maximumLines": Int(lineCount), "availableWidth": Double(titleFrame.width), "systemFontPointSize": Double(currentFont.pointSize)])
        if category.isAccessibilityCategory {
            XCTAssertGreaterThanOrEqual(titleFrame.minY, max(backFrame.maxY, moreFrame.maxY) - 1, "Accessibility navigation controls must have their own row above the title")
            XCTAssertGreaterThanOrEqual(titleFrame.width, reader.frame.width - 24, "The accessibility title must use the full reader width")
            let ordinary = UIFont.preferredFont(forTextStyle: .subheadline, compatibleWith: largeTraits)
            XCTAssertGreaterThan(titleLabel.frame.height, max(44, ordinary.lineHeight * 1.5), "The actual title label must grow beyond its ordinary 44 pt minimum under the OS accessibility preference")
        } else {
            XCTAssertGreaterThanOrEqual(titleFrame.minX, backFrame.maxX)
            XCTAssertLessThanOrEqual(titleFrame.maxX, moreFrame.minX)
            XCTAssertLessThan(abs(titleFrame.midY - backFrame.midY), max(8, backFrame.height / 2), "Ordinary type must retain the familiar single navigation row")
        }
        capture("GET317-UI40-bounded-reader-title")
        title.tap(); require(app.navigationBars["书籍信息"])
        let fullTitle = app.staticTexts["reader-book-full-title"]
        require(fullTitle); XCTAssertEqual(fullTitle.label, textTitle)
        closePanel(); require(reader)
        for (tool, panelTitle) in [("目录", "目录"), ("听书", "听一会儿"), ("外观", "外观"), ("阅读设置", "阅读设置"), ("翻译", "这一段的译文"), ("我的记录", "我的记录"), ("更多", "阅读工具")] {
            openTool(tool)
            require(app.navigationBars[panelTitle])
            capture("GET317-UI40-opened-panel-" + tool)
            closePanel(); require(reader)
        }
    }

    @MainActor
    func test44LongBookTitleKeepsReadableNavigationAndCopyableCompleteInformation() throws {
        executionTimeAllowance = 300
        let longTitle = "GET317 · " + String(repeating: "长书名依然完整保留着", count: 7)
        let category = UIApplication.shared.preferredContentSizeCategory
        var evidence: [[String: Any]] = [["systemCategory": category.rawValue, "accessibilityCategory": category.isAccessibilityCategory, "titleUTF8Bytes": longTitle.utf8.count, "filenameUTF8Bytes": (longTitle + ".txt").utf8.count]]
        defer {
            do {
                let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
                let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
                attachment.name = "GET317-UI44-long-title-profile-frames.json"
                attachment.lifetime = .keepAlways
                add(attachment)
            } catch { XCTFail("Could not retain the actual UI44 frame evidence: \(error)") }
        }
        func record(_ key: String, _ element: XCUIElement) {
            let frame = element.frame
            evidence.append(["key": key, "x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)])
        }

        launch(["--get317-long-title"]); openBook(longTitle)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph") == true)
        // A real visible selection proves the body is operable and keeps its
        // existing idle guard while the AX tree measures the awake navigation.
        reader.swipeUp(); try selectOriginalForSavedRecordProfile(); systemEditAction(["复制", "Copy"]); wakeTools()
        let title = app.buttons["reader-book-title"]
        requireReaderControlAwake(title); XCTAssertTrue(title.isEnabled && title.isHittable)
        XCTAssertEqual(title.label, longTitle)
        let titleFrame = title.frame
        let currentFont = UIFont.preferredFont(forTextStyle: .subheadline)
        let maximumLines: CGFloat = category.isAccessibilityCategory ? 2 : 1
        XCTAssertGreaterThanOrEqual(titleFrame.width, 44)
        XCTAssertGreaterThanOrEqual(titleFrame.height, 44)
        XCTAssertLessThanOrEqual(titleFrame.height, max(44, currentFont.lineHeight * maximumLines + 4), "Even a valid 70-CJK filename must leave the navigation bounded")
        let back = app.buttons["返回书房"], more = app.buttons["reader-more"]
        requireReaderControlAwake(back); requireReaderControlAwake(more)
        if category.isAccessibilityCategory {
            XCTAssertGreaterThanOrEqual(titleFrame.minY, max(back.frame.maxY, more.frame.maxY) - 1)
            XCTAssertGreaterThanOrEqual(titleFrame.width, reader.frame.width - 24)
        } else {
            XCTAssertGreaterThanOrEqual(titleFrame.minX, back.frame.maxX)
            XCTAssertLessThanOrEqual(titleFrame.maxX, more.frame.minX)
        }
        for control in primaryReaderButtons {
            requireReaderControlAwake(control); XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThanOrEqual(control.frame.width, 44); XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        }
        let readableHeight = min(readerControlsTop - 12, reader.frame.maxY) - max(titleFrame.maxY + 16, reader.frame.minY)
        XCTAssertGreaterThanOrEqual(readableHeight, 120, "The awake header and dock must still leave a real body viewport")
        record("reader.bounded-title", title); record("reader.controls-boundary", app.buttons["reader-contents"])
        evidence.append(["key": "reader.visible-body", "height": Double(readableHeight), "realNativeSelectionReached": true])
        capture("GET317-UI44-long-title-leaves-readable-body")

        // Dismiss once to clear that native selection before comparing pixels.
        // The anchor comparison must not mistake removed selection highlighting
        // for a changed reading position.
        title.tap(); require(app.navigationBars["书籍信息"]); closePanel(); require(reader)
        let before = try bodyBand()
        wakeTop(); app.buttons["reader-book-title"].tap()
        require(app.navigationBars["书籍信息"]); expandPanel()
        let information = app.scrollViews["reader-book-information"]
        require(information)
        func viewport() -> CGRect {
            let frame = information.frame.intersection(app.frame)
            let top = max(frame.minY, app.navigationBars["书籍信息"].frame.maxY)
            return CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, frame.maxY - top))
        }
        func revealShort(_ element: XCUIElement, key: String) {
            for _ in 0..<20 {
                let visible = viewport()
                if element.exists {
                    let frame = element.frame
                    if visible.insetBy(dx: -1, dy: -1).contains(frame) && element.isHittable { break }
                    let delta = frame.minY < visible.minY ? visible.minY - frame.minY + 6 : visible.maxY - frame.maxY - 6
                    nudgeRecordProfileContent(information, by: delta, inside: visible)
                } else { information.swipeUp() }
            }
            require(element)
            XCTAssertTrue(element.isHittable && viewport().insetBy(dx: -1, dy: -1).contains(element.frame), "The actual information field must scroll completely into view: \(key)")
            record(key, element)
        }
        func revealTextEnd(_ element: XCUIElement, key: String, font: UIFont) {
            require(element)
            let required = (element.label as NSString).boundingRect(with: CGSize(width: element.frame.width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
            XCTAssertGreaterThanOrEqual(element.frame.height + font.lineHeight * 0.35, required.height, "The complete metadata text must render without a line limit: \(key)")
            for _ in 0..<24 {
                let visible = viewport(), frame = element.frame
                if frame.maxY <= visible.maxY + 1 && frame.maxY >= visible.minY + min(font.lineHeight, visible.height / 2) { break }
                nudgeRecordProfileContent(information, by: visible.maxY - frame.maxY - 6, inside: visible)
            }
            let visible = viewport(), frame = element.frame
            XCTAssertLessThanOrEqual(frame.maxY, visible.maxY + 1, "The end of the full text must be reachable by real scrolling: \(key)")
            XCTAssertGreaterThan(frame.maxY, visible.minY, "The final line must remain inside the foreground sheet: \(key)")
            record(key, element); capture("GET317-UI44-" + key + "-last-line")
        }

        let completeTitle = information.staticTexts["reader-book-full-title"]
        require(completeTitle); XCTAssertEqual(completeTitle.label, longTitle)
        revealTextEnd(completeTitle, key: "information.complete-title", font: UIFont.preferredFont(forTextStyle: .title2))
        for (key, value) in [("author-label", "作者"), ("author-value", "未提供作者"), ("source-label", "来源格式"), ("source-value", "TXT"), ("chapter-label", "章节数"), ("chapter-value", "1"), ("filename-label", "原始文件名")] {
            revealShort(information.staticTexts[value].firstMatch, key: "information." + key)
        }
        let filename = information.staticTexts[longTitle + ".txt"]
        require(filename); XCTAssertEqual(filename.label, longTitle + ".txt")
        revealTextEnd(filename, key: "information.complete-filename", font: UIFont.preferredFont(forTextStyle: .body))
        let copy = information.buttons["reader-copy-book-title"]
        revealShort(copy, key: "information.copy-title")
        XCTAssertEqual(copy.label, "复制完整书名")
        XCTAssertGreaterThanOrEqual(copy.frame.width, 44); XCTAssertGreaterThanOrEqual(copy.frame.height, 44)
        copy.tap()
        capture("GET317-UI44-copy-complete-title-action")
        closePanel(); require(reader)
        XCTAssertEqual(try bodyBand(), before, "Scrolling, copying and closing Book Information must retain the exact visible original")
        evidence.append(["key": "information.dismissal", "bodyBandPreserved": true])

        // No test code reads or writes UIPasteboard. Only the real information
        // button copies; entering the note editor selects original text without
        // invoking Copy, so the system Paste must retain the complete title.
        try selectOriginalForSavedRecordProfile(); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"]
        require(editor); editor.tap(); editor.press(forDuration: 1.2); systemEditAction(["粘贴", "Paste"])
        let pasted = editor.value as? String ?? ""
        XCTAssertEqual(pasted, longTitle, "Native Paste must insert the exact complete book title copied by the product")
        evidence.append(["key": "information.native-paste", "exactTitle": pasted == longTitle, "pastedUTF8Bytes": pasted.utf8.count])
        capture("GET317-UI44-full-title-pasted-in-real-note-editor")
        app.buttons["保留草稿"].tap(); require(reader)
    }

    @MainActor
    func test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable() throws {
        executionTimeAllowance = 300
        let category = UIApplication.shared.preferredContentSizeCategory
        let ordinaryTraits = UITraitCollection(preferredContentSizeCategory: .large)
        var evidence: [[String: Any]] = [["systemCategory": category.rawValue, "accessibilityCategory": category.isAccessibilityCategory]]
        defer {
            do {
                let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
                let text = String(decoding: data, as: UTF8.self)
                let attachment = XCTAttachment(string: text)
                attachment.name = "GET317-UI41-system-type-profile-frames.json"
                attachment.lifetime = .keepAlways
                add(attachment)
                print("GET317 UI41 profile frames: " + text)
            } catch { XCTFail("Could not retain the actual UI41 frame evidence: \(error)") }
        }
        func record(_ key: String, _ element: XCUIElement) {
            let frame = element.frame
            evidence.append(["key": key, "x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)])
        }
        launch(); openBook(textTitle)
        wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let settings = app.collectionViews["reader-preferences-form"], preview = app.staticTexts["reading-type-preview"]
        require(settings)
        func settingsViewport() -> CGRect {
            recordProfileContentViewport(settings, navigationTitle: "阅读设置")
        }
        func showFullText(_ element: XCUIElement) {
            for _ in 0..<12 {
                let viewport = settingsViewport()
                if element.exists {
                    let frame = element.frame
                    if !frame.isEmpty && viewport.insetBy(dx: -1, dy: -1).contains(frame) { return }
                    if frame.isEmpty { settings.swipeUp(); continue }
                    let delta = frame.minY < viewport.minY ? viewport.minY - frame.minY + 6 : viewport.maxY - frame.maxY - 6
                    nudgeRecordProfileContent(settings, by: delta, inside: viewport)
                } else { settings.swipeUp() }
            }
            XCTFail("The complete settings text must fit in the real foreground viewport: \(element). \(app.debugDescription)")
        }
        func recordText(_ key: String, _ element: XCUIElement, style: UIFont.TextStyle, monospaced: Bool = false) {
            showFullText(element); require(element)
            let frame = element.frame, viewport = settingsViewport()
            let current = UIFont.preferredFont(forTextStyle: style)
            let ordinary = UIFont.preferredFont(forTextStyle: style, compatibleWith: ordinaryTraits)
            let measuredFont = monospaced ? UIFont.monospacedDigitSystemFont(ofSize: current.pointSize, weight: .regular) : current
            let ordinaryFont = monospaced ? UIFont.monospacedDigitSystemFont(ofSize: ordinary.pointSize, weight: .regular) : ordinary
            let text = element.label
            func requiredHeight(_ font: UIFont) -> CGFloat {
                (text as NSString).boundingRect(with: CGSize(width: max(1, frame.width), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
            }
            let expected = requiredHeight(measuredFont), ordinaryExpected = requiredHeight(ordinaryFont)
            record(key, element)
            evidence.append(["key": key + ".text-layout", "text": text, "semanticStyle": style.rawValue,
                             "monospacedDigits": monospaced, "systemFontPointSize": Double(current.pointSize),
                             "systemLineHeight": Double(current.lineHeight), "ordinaryLineHeight": Double(ordinary.lineHeight),
                             "expectedTextHeight": Double(expected), "ordinaryExpectedTextHeight": Double(ordinaryExpected),
                             "viewportX": Double(viewport.minX), "viewportY": Double(viewport.minY),
                             "viewportWidth": Double(viewport.width), "viewportHeight": Double(viewport.height),
                             "fullyVisible": viewport.insetBy(dx: -1, dy: -1).contains(frame), "hittable": element.isHittable])
            XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(frame), "The whole \(key) text must be visible outside the navigation bar")
            // A Label may expose its complete row, so the fixed 52 pt normal row
            // is not itself evidence of font growth. Also require enough space
            // for the actual current system font, retaining both profile frames.
            XCTAssertGreaterThanOrEqual(frame.height + 2, expected, "\(key) must receive space for its actual system font and full text")
            if category.isAccessibilityCategory {
                XCTAssertGreaterThan(frame.height, ordinary.lineHeight * 1.5, "\(key) must expand beyond ordinary semantic text at accessibility sizes")
            }
            capture("GET317-UI41-fully-visible-" + key)
        }
        func showPreviewStart() {
            for _ in 0..<10 {
                if preview.exists {
                    let frame = preview.frame
                    let viewport = settingsViewport()
                    if frame.minY >= viewport.minY - 1 && frame.intersection(viewport).height >= min(120, frame.height) { return }
                }
                settings.swipeDown()
            }
            XCTFail("The full-size original preview must expose its beginning in the actual foreground settings viewport")
        }
        showPreviewStart(); record("settings.preview-before", preview)
        let initialPreviewHeight = preview.frame.height
        capture("GET317-UI41-settings-preview-before")
        let font = app.sliders["正文字号"]
        scrollTo(font, in: settings)
        XCTAssertTrue(font.isEnabled && font.isHittable)
        font.adjust(toNormalizedSliderPosition: 0.75)
        showPreviewStart(); record("settings.preview-after", preview)
        XCTAssertGreaterThan(preview.frame.height, initialPreviewHeight * 1.1, "Changing the real base-size slider must grow the rendered original-text preview")
        capture("GET317-UI41-settings-preview-grown")
        let reset = app.buttons["恢复默认排版"]
        scrollTo(reset, in: settings)
        XCTAssertTrue(reset.isEnabled && reset.isHittable); reset.tap()
        let defaults = app.staticTexts["当前为默认排版"]
        scrollTo(defaults, in: settings); require(defaults); record("settings.default-state", defaults)
        XCTAssertFalse(reset.exists)
        recordText("settings.body-label", settings.staticTexts["字号"], style: .body)
        recordText("settings.body-value", settings.staticTexts["22 pt"], style: .body, monospaced: true)
        recordText("settings.spacing-label", settings.staticTexts["行间距"], style: .body)
        recordText("settings.spacing-value", settings.staticTexts["9 pt"], style: .body, monospaced: true)
        recordText("settings.default-state", defaults, style: .body)
        recordText("settings.system-type-footnote", settings.staticTexts["字号随系统大字设置继续缩放。更改会自动保存到此设备。"], style: .subheadline)
        capture("GET317-UI41-restored-default-settings")
        closePanel(); require(reader)
    }

    @MainActor
    func test42SystemTypeProfileKeepsSavedNotesReturnActionAndNativeContinueUsable() throws {
        executionTimeAllowance = 300
        let category = UIApplication.shared.preferredContentSizeCategory
        let ordinaryTraits = UITraitCollection(preferredContentSizeCategory: .large)
        var evidence: [[String: Any]] = [["systemCategory": category.rawValue, "accessibilityCategory": category.isAccessibilityCategory]]
        defer {
            do {
                let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
                let text = String(decoding: data, as: UTF8.self)
                let attachment = XCTAttachment(string: text)
                attachment.name = "GET317-UI42-system-type-profile-frames.json"
                attachment.lifetime = .keepAlways
                add(attachment)
                print("GET317 UI42 profile frames: " + text)
            } catch { XCTFail("Could not retain the actual UI42 frame evidence: \(error)") }
        }
        func record(_ key: String, _ element: XCUIElement) {
            let frame = element.frame
            evidence.append(["key": key, "label": element.label, "x": Double(frame.minX), "y": Double(frame.minY),
                             "width": Double(frame.width), "height": Double(frame.height),
                             "enabled": element.isEnabled, "hittable": element.isHittable])
        }
        func viewport(_ form: XCUIElement, title: String) -> CGRect {
            recordProfileContentViewport(form, navigationTitle: title)
        }
        func showFull(_ element: XCUIElement, in form: XCUIElement, title: String) {
            for _ in 0..<12 {
                let visible = viewport(form, title: title)
                if element.exists {
                    let frame = element.frame
                    if !frame.isEmpty && visible.insetBy(dx: -1, dy: -1).contains(frame) { return }
                    if frame.isEmpty { form.swipeUp(); continue }
                    let delta = frame.minY < visible.minY ? visible.minY - frame.minY + 6 : visible.maxY - frame.maxY - 6
                    nudgeRecordProfileContent(form, by: delta, inside: visible)
                } else { form.swipeUp() }
            }
            XCTFail("The complete saved-record element must fit in the actual foreground viewport: \(element). \(app.debugDescription)")
        }
        func recordBodyText(_ key: String, _ element: XCUIElement) {
            require(element); record(key, element)
            let current = UIFont.preferredFont(forTextStyle: .body)
            let ordinary = UIFont.preferredFont(forTextStyle: .body, compatibleWith: ordinaryTraits)
            let required = (element.label as NSString).boundingRect(with: CGSize(width: max(1, element.frame.width), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: current], context: nil)
            evidence.append(["key": key + ".text-layout", "systemFontPointSize": Double(current.pointSize),
                             "systemLineHeight": Double(current.lineHeight), "ordinaryLineHeight": Double(ordinary.lineHeight),
                             "expectedTextHeight": Double(required.height)])
            XCTAssertGreaterThanOrEqual(element.frame.height + 2, required.height, "\(key) must display its full text at the real system body size")
            if category.isAccessibilityCategory {
                XCTAssertGreaterThan(element.frame.height, ordinary.lineHeight * 1.5, "\(key) must expand beyond ordinary body text under the OS accessibility preference")
            }
        }
        func recordNativeContinue(_ key: String, title: String) -> XCUIElement {
            let navigation = app.navigationBars[title], button = navigation.buttons["继续读"].firstMatch
            require(button); record(key, button)
            XCTAssertTrue(button.isEnabled && button.isHittable, "The actual native Continue action must remain reachable")
            XCTAssertTrue(navigation.frame.intersection(app.frame).insetBy(dx: -1, dy: -1).contains(button.frame), "Continue must remain inside its visible native navigation bar")
            let text = button.staticTexts["继续读"].firstMatch
            evidence.append(["key": key + ".native-toolbar", "hasSeparateTextLeaf": text.exists,
                             "axFrameAtLeast44Points": button.frame.width >= 44 && button.frame.height >= 44,
                             "systemBodyPointSize": Double(UIFont.preferredFont(forTextStyle: .body).pointSize),
                             "ordinaryBodyPointSize": Double(UIFont.preferredFont(forTextStyle: .body, compatibleWith: ordinaryTraits).pointSize)])
            // A native toolbar may cap its visual text or AX wrapper. Preserve
            // the actual dimensions and screenshots; no glyph-scale or 44 pt
            // product verdict can be inferred from that wrapper alone.
            if text.exists { record(key + ".text-leaf", text) }
            capture("GET317-UI42-" + key)
            return button
        }

        launch(); openBook(textTitle)
        try selectOriginalForSavedRecordProfile(); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"], note = "GET317 UI42 saved note"
        require(editor)
        editor.tap(); editor.typeText(note); app.buttons["保存笔记"].tap()
        openTool("我的记录"); expandPanel()
        let records = app.collectionViews["reader-records-list"], body = records.staticTexts[note]
        require(records)
        showFull(body, in: records, title: "我的记录")
        recordBodyText("records.note-body", body)
        evidence.append(["key": "records.note-body.viewport", "fullyVisible": viewport(records, title: "我的记录").insetBy(dx: -1, dy: -1).contains(body.frame)])
        capture("GET317-UI42-saved-note-body")
        _ = recordNativeContinue("records.continue", title: "我的记录")
        let returnAction = records.buttons["回到原句"].firstMatch
        showFull(returnAction, in: records, title: "我的记录")
        record("records.return-action", returnAction)
        XCTAssertTrue(returnAction.isEnabled && returnAction.isHittable)
        XCTAssertGreaterThanOrEqual(returnAction.frame.width, 44)
        XCTAssertGreaterThanOrEqual(returnAction.frame.height, 44)
        let returnText = returnAction.staticTexts["回到原句"].firstMatch
        recordBodyText("records.return-label", returnText)
        XCTAssertTrue(viewport(records, title: "我的记录").insetBy(dx: -1, dy: -1).contains(returnText.frame), "The entire actual Return label must remain visible at this profile")
        capture("GET317-UI42-return-to-source-before-action")
        returnAction.tap(); require(reader)
        XCTAssertTrue(app.navigationBars["我的记录"].waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.buttons["继续读"].exists)
        evidence.append(["key": "records.return-action.result", "readerRestored": reader.exists, "recordsDismissed": !app.navigationBars["我的记录"].exists])
        capture("GET317-UI42-return-to-source-after-action")

        wakeTop(); app.buttons["阅读设置"].tap(); expandPanel()
        let continueReading = recordNativeContinue("settings.continue", title: "阅读设置")
        continueReading.tap(); require(reader)
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForNonExistence(timeout: 5))
        evidence.append(["key": "settings.continue.result", "readerRestored": reader.exists, "settingsDismissed": !app.navigationBars["阅读设置"].exists])
        capture("GET317-UI42-native-continue-after-action")
    }
    @MainActor
    func test43GridDownloadDetailsAndReadingKeepFullNativeTapTargets() throws {
        executionTimeAllowance = 300
        let category = UIApplication.shared.preferredContentSizeCategory
        var evidence: [[String: Any]] = [["systemCategory": category.rawValue, "accessibilityCategory": category.isAccessibilityCategory]]
        defer {
            do {
                let text = String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted]), as: UTF8.self)
                let attachment = XCTAttachment(string: text)
                attachment.name = "GET317-UI43-system-type-profile-targets.json"
                attachment.lifetime = .keepAlways
                add(attachment)
                print("GET317 UI43 profile targets: " + text)
            } catch { XCTFail("Could not retain the actual UI43 target evidence: \(error)") }
        }
        launch(["--get317-gated-download"]); setLayout("封面网格")
        let grid = app.scrollViews["library-shelf-grid"]
        require(grid)
        func gridViewport() -> CGRect {
            let filter = app.segmentedControls.buttons["全部"], menu = app.buttons["书房显示与排序"].firstMatch
            // The production filter row has 8 pt vertical padding. Its actual
            // controls plus that padding, rather than a guessed target size,
            // determine the top edge that can cover the grid.
            let filterBottom = max(filter.frame.maxY, menu.frame.maxY) + 8
            return recordProfileContentViewport(grid, navigationTitle: "我的书房", topLimit: filterBottom)
        }
        func fullyReachable(_ button: XCUIElement) {
            for _ in 0..<12 {
                let viewport = gridViewport()
                if button.exists {
                    let frame = button.frame
                    if viewport.insetBy(dx: -1, dy: -1).contains(frame) && button.isHittable { break }
                    if frame.isEmpty { grid.swipeUp() }
                    else {
                        let delta = frame.minY < viewport.minY ? viewport.minY - frame.minY + 6 : viewport.maxY - frame.maxY - 6
                        nudgeRecordProfileContent(grid, by: delta, inside: viewport)
                    }
                } else { grid.swipeUp() }
            }
            require(button)
            let frame = button.frame, viewport = gridViewport()
            evidence.append(["key": "grid.target", "label": button.label, "x": Double(frame.minX), "y": Double(frame.minY),
                             "width": Double(frame.width), "height": Double(frame.height), "hittable": button.isHittable,
                             "viewportX": Double(viewport.minX), "viewportY": Double(viewport.minY),
                             "viewportWidth": Double(viewport.width), "viewportHeight": Double(viewport.height),
                             "fullyVisible": viewport.insetBy(dx: -1, dy: -1).contains(frame), "windowBottomClearance": Double(app.frame.maxY - frame.maxY)])
            XCTAssertTrue(button.isEnabled && button.isHittable)
            XCTAssertGreaterThanOrEqual(frame.width, 44)
            XCTAssertGreaterThanOrEqual(frame.height, 44)
            XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(frame), "The complete 44 pt or larger action must fit in the actual visible grid surface")
            if category.isAccessibilityCategory {
                // One full-width card: 20 pt grid padding and 16 pt card padding
                // on either side. This also rejects an accidental two-column AX
                // grid instead of assuming that one search result proves it.
                XCTAssertEqual(frame.width, grid.frame.width - 2 * 20 - 2 * 16, accuracy: 1, "The AX action must occupy the actual single-column card width")
            }
        }
        searchShelf(slowTitle)
        let download = grid.buttons["下载并阅读，" + slowTitle]
        fullyReachable(download)
        capture("GET317-UI43-grid-download-target")
        download.tap()
        let cancel = app.buttons["library-activity-cancel"]
        require(cancel)
        let cancelFrame = cancel.frame
        evidence.append(["key": "grid.download-cancel", "x": Double(cancelFrame.minX), "y": Double(cancelFrame.minY),
                         "width": Double(cancelFrame.width), "height": Double(cancelFrame.height), "hittable": cancel.isHittable])
        XCTAssertTrue(cancel.isEnabled && cancel.isHittable)
        XCTAssertGreaterThanOrEqual(cancelFrame.width, 44)
        XCTAssertGreaterThanOrEqual(cancelFrame.height, 44)
        XCTAssertTrue(app.frame.insetBy(dx: -1, dy: -1).contains(cancelFrame))
        capture("GET317-UI43-grid-download-cancel-target")
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 8))
        XCTAssertFalse(reader.exists, "Cancelling the gated grid download must not publish or open a readable book")
        evidence.append(["key": "grid.download-cancel.result", "cancelDismissed": !cancel.exists, "readerAbsent": !reader.exists])

        clearShelfSearch(); searchShelf(textTitle)
        let reads = grid.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + textTitle))
        let readCount = reads.count
        XCTAssertGreaterThan(readCount, 0)
        for index in 0..<readCount { fullyReachable(reads.element(boundBy: index)) }
        let details = grid.buttons[textTitle + "，书籍详情"]
        fullyReachable(details); capture("GET317-UI43-grid-reading-and-details-targets"); details.tap()
        require(app.navigationBars["书籍详情"])
        require(app.collectionViews["book-details-list"])
        evidence.append(["key": "grid.details.result", "detailsOpened": app.navigationBars["书籍详情"].exists])
        app.navigationBars["书籍详情"].buttons["BackButton"].tap(); require(grid)
        for index in 0..<readCount {
            let read = reads.element(boundBy: index)
            fullyReachable(read)
            capture("GET317-UI43-grid-reading-target-\(index)")
            read.tap(); require(reader)
            XCTAssertTrue((reader.value as? String)?.contains("GET317 synthetic paragraph 1") == true)
            evidence.append(["key": "grid.read.result", "targetIndex": index, "readerOpened": reader.exists])
            capture("GET317-UI43-grid-opened-book-from-target-\(index)")
            if index + 1 < readCount {
                shelf()
                XCTAssertTrue(reader.waitForNonExistence(timeout: 5))
                require(grid)
            }
        }
        capture("GET317-UI43-grid-opens-the-actual-local-book")
    }

    @MainActor
    func test45NativeRotationKeepsReadableParagraphWidthCopyAndPortraitPosition() throws {
        executionTimeAllowance = 300
        let device = XCUIDevice.shared, originalOrientation = XCUIDevice.shared.orientation
        var evidence: [[String: Any]] = [["originalDeviceOrientation": originalOrientation.rawValue,
                                         "systemCategory": UIApplication.shared.preferredContentSizeCategory.rawValue]]
        defer {
            device.orientation = originalOrientation
            do {
                let text = String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted]), as: UTF8.self)
                let attachment = XCTAttachment(string: text)
                attachment.name = "GET317-UI45-native-rotation-frames.json"
                attachment.lifetime = .keepAlways
                add(attachment)
                print("GET317 UI45 rotation evidence: " + text)
            } catch { XCTFail("Could not retain the actual UI45 rotation evidence: \(error)") }
        }
        func record(_ key: String, _ frame: CGRect) {
            evidence.append(["key": key, "x": Double(frame.minX), "y": Double(frame.minY),
                             "width": Double(frame.width), "height": Double(frame.height)])
        }
        func paragraphs() -> [XCUIElement] {
            reader.descendants(matching: .textView)
                .matching(NSPredicate(format: "label BEGINSWITH %@", "GET317 synthetic paragraph")).allElementsBoundByIndex
        }
        func saveBand(_ key: String, _ data: Data) {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
            attachment.name = "GET317-UI45-" + key
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        func stableBodyBand(_ key: String) throws -> Data {
            var previous: Data?, settled: Data?, failure: Error?
            let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                do {
                    let current = try self.bodyBand()
                    if current == previous { settled = current; return true }
                    previous = current
                } catch { failure = error }
                return false
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [stable], timeout: 10), .completed, "The real \(key) body must stop moving before its position is measured: \(String(describing: failure))")
            let data = try XCTUnwrap(settled)
            saveBand(key, data)
            return data
        }
        func measureTextColumn(_ key: String) throws {
            let frame = reader.frame, viewport = frame.intersection(app.frame)
            let available = max(1, frame.width - 48), expectedWidth = min(680, available)
            let margin = 24 + max(0, (available - expectedWidth) / 2)
            let visible = paragraphs().filter { !$0.frame.intersection(viewport).isEmpty }
            XCTAssertFalse(visible.isEmpty, "Measure actual UIKit paragraph text bounds in \(key), not the full-screen reader wrapper")
            record(key + ".reader", frame)
            evidence.append(["key": key + ".column", "expectedMaximumWidth": Double(expectedWidth), "expectedSideMargin": Double(margin), "visibleParagraphCount": visible.count])
            // ReflowTextView uses UIKit's real text accessibility children. The
            // source sets lineFragmentPadding=0 and a centered text container
            // of min(680, bounds.width-48); no custom AX frame is supplied.
            for paragraph in visible {
                let textFrame = paragraph.frame
                record(key + ".paragraph", textFrame)
                XCTAssertGreaterThan(textFrame.width, 0)
                XCTAssertLessThanOrEqual(textFrame.width, expectedWidth + 1, "Actual paragraph lines must stay inside the readable column in \(key)")
                XCTAssertGreaterThanOrEqual(textFrame.minX, frame.minX + margin - 1)
                XCTAssertLessThanOrEqual(textFrame.maxX, frame.maxX - margin + 1)
            }
            capture("GET317-UI45-" + key + "-readable-column")
        }
        func clearSelectionUsingBookInformation() {
            wakeTop()
            let title = app.buttons["reader-book-title"]
            requireReaderControlAwake(title); title.tap()
            require(app.navigationBars["书籍信息"])
            closePanel(); require(reader)
            XCTAssertTrue(waitForReaderChromeAsleep(timeout: 5), "Closing the real panel must clear selection and leave quiet original text for comparison")
        }
        func verifyNativeCopy(_ key: String) throws {
            wakeTop()
            let title = app.buttons["reader-book-title"]
            requireReaderControlAwake(title)
            let frame = reader.frame.intersection(app.frame)
            let top = max(frame.minY, title.frame.maxY + 16)
            let bottom = min(frame.maxY, readerControlsTop - 12)
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            let paragraph = try XCTUnwrap(paragraphs().first {
                let visible = $0.frame.intersection(viewport)
                return !visible.isEmpty && visible.height > 32
            }, "The \(key) reader must expose real selectable original text outside its controls")
            let visible = paragraph.frame.intersection(viewport)
            let point = CGPoint(x: visible.minX + min(32, visible.width / 4), y: visible.midY)
            evidence.append(["key": key + ".native-selection", "x": Double(point.x), "y": Double(point.y), "paragraph": String(paragraph.label.prefix(80))])
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x - app.frame.minX, dy: point.y - app.frame.minY)).press(forDuration: 1.2)
            waitForSystemEditMenu(timeout: 5)
            systemEditAction(["复制", "Copy"])
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.visibleNativeMenuItems().isEmpty && self.nativeButtonEditMenu() == nil
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, "The actual \(key) native Copy action must complete and dismiss its menu")
            evidence.append(["key": key + ".native-copy", "systemActionInvoked": true])
            // Dismiss the product's real information panel to clear UIKit's
            // selection without scrolling the selected original elsewhere.
            clearSelectionUsingBookInformation()
        }

        device.orientation = .portrait
        launch(); openBook(textTitle)
        let portrait = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.reader.exists && self.reader.frame.height > self.reader.frame.width
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [portrait], timeout: 10), .completed)
        reader.swipeUp()
        try verifyNativeCopy("portrait")
        // Capture an ordinary scrolled reading position with no selected range,
        // edit menu or awake chrome in the body-band comparison.
        reader.swipeUp()
        let beforeBand = try stableBodyBand("portrait-before-body-band")
        let portraitFrame = reader.frame
        try measureTextColumn("portrait-before")
        let beforeBandFrame = CGRect(x: portraitFrame.minX, y: portraitFrame.minY + portraitFrame.height * 0.28,
                                     width: portraitFrame.width, height: portraitFrame.height * 0.32)
        let beforeParagraph = try XCTUnwrap(paragraphs().max {
            $0.frame.intersection(beforeBandFrame).height < $1.frame.intersection(beforeBandFrame).height
        })
        let beforeParagraphFrame = beforeParagraph.frame, sourceLabel = beforeParagraph.label
        XCTAssertGreaterThan(beforeParagraphFrame.intersection(beforeBandFrame).height, 0)
        let markerRange = try XCTUnwrap(sourceLabel.range(of: "ORCHARD_[0-9]+", options: .regularExpression))
        let sourceMarker = String(sourceLabel[markerRange])
        evidence.append(["key": "portrait-before.visible-source", "marker": sourceMarker,
                         "paragraphRelativeY": Double(beforeParagraphFrame.minY - portraitFrame.minY)])

        device.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.reader.exists && self.reader.frame.width > self.reader.frame.height && self.reader.frame.width > portraitFrame.width + 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 10), .completed, "The actual UIKit reader must resize after native landscape rotation")
        _ = try stableBodyBand("landscape-body-band")
        try measureTextColumn("landscape")
        try verifyNativeCopy("landscape")

        device.orientation = .portrait
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.reader.exists && abs(self.reader.frame.width - portraitFrame.width) <= 1 && abs(self.reader.frame.height - portraitFrame.height) <= 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed, "The native reader must return to its original portrait viewport")
        clearSelectionUsingBookInformation()
        let afterBand = try stableBodyBand("portrait-restored-body-band")
        try measureTextColumn("portrait-restored")
        let afterReaderFrame = reader.frame
        let afterParagraph = reader.descendants(matching: .textView).matching(NSPredicate(format: "label == %@", sourceLabel)).firstMatch
        require(afterParagraph)
        let afterParagraphFrame = afterParagraph.frame
        let afterBandFrame = CGRect(x: afterReaderFrame.minX, y: afterReaderFrame.minY + afterReaderFrame.height * 0.28,
                                    width: afterReaderFrame.width, height: afterReaderFrame.height * 0.32)
        XCTAssertGreaterThan(afterParagraphFrame.intersection(afterBandFrame).height, 0, "The same actual source paragraph \(sourceMarker) must return to the middle reading band")
        // Coordinator.restore aligns a source glyph's line; it does not retain
        // fractional scroll pixels. Keep exact band equality as an observation,
        // while requiring the same visible paragraph and no more than one
        // rendered line of vertical change at the original portrait width.
        let base = UIFont.systemFont(ofSize: 22)
        let serif = UIFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor, size: 22)
        let actualFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: serif)
        let oneLine = actualFont.lineHeight + 9
        let verticalChange = abs((afterParagraphFrame.minY - afterReaderFrame.minY) - (beforeParagraphFrame.minY - portraitFrame.minY))
        XCTAssertLessThanOrEqual(verticalChange, oneLine + 1, "Rotation must restore \(sourceMarker)'s visible position within the source renderer's one-line anchor quantization")
        evidence.append(["key": "portrait-restored.position", "marker": sourceMarker, "exactBodyBandEqual": beforeBand == afterBand,
                         "paragraphRelativeY": Double(afterParagraphFrame.minY - afterReaderFrame.minY), "verticalChange": Double(verticalChange),
                         "renderedLineHeight": Double(actualFont.lineHeight), "sourceLineSpacing": 9, "maximumOneLineChange": Double(oneLine)])
        capture("GET317-UI45-portrait-position-restored")
    }

    @MainActor
    func test46CenterTapShowsAllFiveCompactControlsAndKeepsTheOriginal() throws {
        launch(); openBook(textTitle)
        wakeTools(); app.buttons["reader-read"].tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let before = try settledOriginalBand()
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        requireReaderControlAwake(app.buttons["reader-contents"])
        for control in primaryReaderButtons {
            requireReaderControlAwake(control); XCTAssertTrue(control.isEnabled && control.isHittable)
            XCTAssertTrue(app.frame.insetBy(dx: -1, dy: -1).contains(control.frame))
            XCTAssertGreaterThanOrEqual(control.frame.width, 44); XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        }
        XCTAssertEqual(primaryReaderButtons.map(\.label), ["目录", "阅读", "听书", "外观", "阅读设置"])
        capture("GET328-UI46-five-real-primary-controls")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        XCTAssertEqual(try settledOriginalBand(), before)
        chooseNavigation("左右翻页")
        coldRelaunch(); require(reader, timeout: 20)
        openTool("阅读设置"); expandPanel()
        require(app.segmentedControls.buttons["左右翻页"])
        XCTAssertTrue(app.segmentedControls.buttons["左右翻页"].isSelected)
        closePanel()
    }

    @MainActor
    func test47HorizontalSwipesTurnTheActualTextWithinTheSameChapter() throws {
        launch(["--get341-unique-source"]); openBook(translatedTitle); chooseNavigation("左右翻页")
        let source = reader.value as? String ?? ""
        XCTAssertTrue(source.contains("SYNTHETIC c1 paragraph"))
        let first = try settledOriginalBand()
        reader.swipeLeft()
        let second = try settledOriginalBand()
        XCTAssertNotEqual(second, first, "A native single-finger left swipe must move the real visible source")
        XCTAssertEqual(reader.value as? String, source, "Turning one screen within a chapter must retain its full original source")
        reader.swipeRight()
        XCTAssertEqual(try settledOriginalBand(), first, "A native right swipe must return to the preceding actual reading screen")
        XCTAssertEqual(reader.value as? String, source)
        capture("GET328-UI47-native-page-round-trip")
    }

    @MainActor
    func test48HorizontalChapterBoundaryAndColdResumeKeepTheActualSource() throws {
        executionTimeAllowance = 300
        launch(); openBook(translatedTitle); chooseNavigation("左右翻页")
        openTool("目录"); expandPanel()
        let chapterTwo = app.buttons["GET317 合成第 2 章"]
        scrollTo(chapterTwo, in: foregroundForm()); chapterTwo.tap(); require(reader)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c2 paragraph") == true)
        let nextChapterStart = try settledOriginalBand()
        reader.swipeRight()
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c1 paragraph") == true, "A right swipe from chapter two's first screen must reach chapter one's last screen")
        reader.swipeLeft()
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c2 paragraph") == true)
        XCTAssertEqual(try settledOriginalBand(), nextChapterStart)
        coldRelaunch(); require(reader, timeout: 20)
        XCTAssertTrue((reader.value as? String)?.contains("SYNTHETIC c2 paragraph") == true)
        XCTAssertEqual(try settledOriginalBand(), nextChapterStart, "Cold resume must preserve the actual page source position")
        openTool("阅读设置"); expandPanel()
        XCTAssertTrue(app.segmentedControls.buttons["左右翻页"].isSelected)
        closePanel(); capture("GET328-UI48-chapter-boundary-cold-resume")
    }

    @MainActor
    func test49ReadingPausesTheExistingSpeechAndListenDoesNotAutoplay() throws {
        launch(); openBook(textTitle); openTool("听书"); expandPanel()
        require(app.buttons["从当前段开始朗读"])
        XCTAssertFalse(app.buttons["暂停朗读"].exists, "Opening Listen alone must not start the synthesizer")
        let play = app.buttons["reader-speech-play"]
        scrollTo(play, in: foregroundForm(), direction: .down); play.tap()
        require(app.buttons["暂停朗读"], timeout: 8)
        let passage = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "第 ", " / 35 段")).firstMatch
        require(passage); let currentPassage = passage.label
        closePanel(); wakeTools()
        let read = app.buttons["reader-read"]
        require(read); read.tap()
        require(app.buttons["听书已暂停"])
        openTool("听书"); expandPanel()
        require(app.buttons["继续朗读"])
        require(app.staticTexts[currentPassage])
        XCTAssertFalse(app.buttons["从当前段开始朗读"].exists, "Read must pause the existing utterance, not stop and discard its session")
        XCTAssertFalse(app.buttons["暂停朗读"].exists)
        closePanel(); openTool("听书")
        require(app.buttons["继续朗读"])
        XCTAssertFalse(app.buttons["暂停朗读"].exists, "Reopening Listen must retain explicit pause intent")
        capture("GET328-UI49-read-pauses-with-resume-position")
    }

    @MainActor
    func test50AppearanceSecondaryToolsAndNativeCopyRemainReachable() throws {
        executionTimeAllowance = 300
        launch(); openBook(textTitle); openTool("外观"); expandPanel()
        let night = app.buttons["夜读"], paper = app.buttons["清纸"]
        scrollTo(night, in: foregroundForm()); night.tap(); XCTAssertTrue(night.isSelected)
        paper.tap(); XCTAssertTrue(paper.isSelected); closePanel()
        for (tool, title) in [("翻译", "这一段的译文"), ("我的记录", "我的记录")] {
            openTool(tool); require(app.navigationBars[title]); closePanel(); require(reader)
        }
        openMoreLink("搜索原文"); require(app.navigationBars["书内搜索"]); closePanel()
        openMoreLink("阅读陪读"); require(app.navigationBars["陪我读"]); closePanel()
        let source = reader.value as? String ?? ""
        try selectOriginalForSavedRecordProfile(); systemEditAction(["复制", "Copy"]); wakeTools()
        Thread.sleep(forTimeInterval: 8)
        for control in primaryReaderButtons {
            requireReaderControlAwake(control); XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThanOrEqual(control.frame.width, 44); XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        }
        try selectOriginalForSavedRecordProfile(); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"]
        require(editor); editor.tap(); editor.press(forDuration: 1.2); systemEditAction(["粘贴", "Paste"])
        let copied = (editor.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertFalse(copied.isEmpty); XCTAssertTrue(source.contains(copied), "Paste must contain actual selected original text, without test clipboard injection")
        capture("GET328-UI50-native-copy-and-secondary-tools")
        app.buttons["保留草稿"].tap(); require(reader)
    }

    @MainActor
    func test53PDFHorizontalSwipesReportActualPagesAndColdResume() throws {
        executionTimeAllowance = 180
        launch(); openBook(pdfTitle); chooseNavigation("左右翻页")
        let pdf = app.otherElements["leafhour-pdf-reader"]
        require(pdf)
        func page(_ index: Int, stage: String) {
            wakeTools()
            let contents = app.buttons["reader-contents"]
            let actualPage = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                contents.exists && (contents.value as? String)?.contains("第 \(index) / 3 页") == true
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [actualPage], timeout: 6), .completed, "The real PDFKit page must update the directory control's actual page value")
            let title = app.buttons["reader-book-title"]
            requireReaderControlAwake(title)
            XCTAssertGreaterThanOrEqual(pdf.frame.minY + 1, title.frame.maxY, "The PDF's original page must stay below the awake header")
            XCTAssertLessThanOrEqual(pdf.frame.maxY, readerControlsTop + 1, "The PDF's original page must stay above the awake bottom controls")
            let receipt: [String: Any] = ["stage": stage, "actualContentsValue": contents.value as? String ?? "",
                "pdfX": Double(pdf.frame.minX), "pdfY": Double(pdf.frame.minY), "pdfWidth": Double(pdf.frame.width), "pdfHeight": Double(pdf.frame.height)]
            let data = (try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys, .prettyPrinted])) ?? Data()
            let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
            attachment.name = "GET328-UI53-" + stage + "-actual-page.json"; attachment.lifetime = .keepAlways; add(attachment)
            capture("GET328-UI53-" + stage)
        }
        page(1, stage: "initial-page-one")
        pdf.swipeLeft(); page(2, stage: "single-left-page-two")
        pdf.swipeRight(); page(1, stage: "single-right-page-one")
        pdf.swipeLeft(); page(2, stage: "before-cold-resume-page-two")
        coldRelaunch(); require(pdf, timeout: 20)
        page(2, stage: "cold-restored-page-two")
        openTool("阅读设置"); expandPanel()
        require(app.segmentedControls.buttons["左右翻页"])
        XCTAssertTrue(app.segmentedControls.buttons["左右翻页"].isSelected)
        closePanel()
    }

    @MainActor
    func test54PagedNativeCopyAndReflowKeepTheVisibleSourceParagraph() throws {
        executionTimeAllowance = 300
        let device = XCUIDevice.shared, originalOrientation = XCUIDevice.shared.orientation
        defer { device.orientation = originalOrientation }
        var requestedLandscape = false
        func captureRotationDiagnostics(_ stage: String, waitResult: String? = nil) {
            func frame(_ value: CGRect) -> [String: Any] {
                func number(_ value: CGFloat) -> Any {
                    if value.isFinite { return Double(value) }
                    return String(describing: value)
                }
                return ["x": number(value.minX), "y": number(value.minY), "width": number(value.width), "height": number(value.height), "isNull": value.isNull]
            }
            let present = app.exists, readerPresent = reader.exists
            var details: [String: Any] = ["stage": stage, "capturedAt": Date().timeIntervalSince1970,
                "deviceOrientationRawValue": device.orientation.rawValue, "originalDeviceOrientationRawValue": originalOrientation.rawValue,
                "appExists": present, "readerExists": readerPresent]
            if let waitResult { details["waitResult"] = waitResult }
            if present {
                details["appFrame"] = frame(app.frame)
                details["windowFrames"] = app.windows.allElementsBoundByIndex.map { frame($0.frame) }
                if readerPresent { details["readerFrame"] = frame(reader.frame) }
                let appShot = app.screenshot(), screenShot = XCUIScreen.main.screenshot()
                func screenshot(_ name: String, _ value: XCUIScreenshot) {
                    let image = value.image
                    details[name] = ["width": Double(image.size.width), "height": Double(image.size.height),
                        "imageOrientationRawValue": image.imageOrientation.rawValue,
                        "pixelWidth": image.cgImage?.width ?? 0, "pixelHeight": image.cgImage?.height ?? 0]
                    let attachment = XCTAttachment(screenshot: value)
                    attachment.name = "GET328-UI54-rotation-" + stage + "-" + name
                    attachment.lifetime = .keepAlways; add(attachment)
                }
                screenshot("appScreenshot", appShot); screenshot("screenScreenshot", screenShot)
                let tree = XCTAttachment(string: app.debugDescription)
                tree.name = "GET328-UI54-rotation-" + stage + "-AX-tree"
                tree.lifetime = .keepAlways; add(tree)
            }
            details["captureFinishedAt"] = Date().timeIntervalSince1970
            let data = try? JSONSerialization.data(withJSONObject: details, options: [.sortedKeys, .prettyPrinted])
            let attachment = XCTAttachment(string: data.map { String(decoding: $0, as: UTF8.self) } ?? String(describing: details))
            attachment.name = "GET328-UI54-rotation-" + stage + "-geometry.json"
            attachment.lifetime = .keepAlways; add(attachment)
        }
        // Registered after the original restoration defer, so diagnostics run
        // first and retain the failing geometry before orientation is restored.
        defer { if requestedLandscape { captureRotationDiagnostics("before-defer-restore") } }
        device.orientation = .portrait
        launch(); openBook(textTitle); chooseNavigation("左右翻页")
        let first = try settledOriginalBand()
        reader.swipeLeft()
        XCTAssertNotEqual(try settledOriginalBand(), first, "Copy is exercised on an actual subsequent screen, not the opening screen")
        wakeTools()
        func bodyViewport() -> CGRect {
            let frame = reader.frame.intersection(app.frame)
            let title = app.buttons["reader-book-title"]
            let top = max(frame.minY, title.exists ? title.frame.maxY + 16 : frame.minY)
            let bottom = min(frame.maxY, readerControlsTop - 12)
            return CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
        }
        let viewport = bodyViewport()
        let paragraph = try XCTUnwrap(reader.descendants(matching: .textView)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "GET317 synthetic paragraph")).allElementsBoundByIndex.first {
                let visible = $0.frame.intersection(viewport)
                return !visible.isEmpty && visible.height > 64 && visible.width > 64
            }, "Choose a real paragraph inside the unobscured second reading screen")
        let sourceLabel = paragraph.label, beforeFrame = paragraph.frame, portraitWidth = reader.frame.width
        let markerRange = try XCTUnwrap(sourceLabel.range(of: "ORCHARD_[0-9]+", options: .regularExpression))
        let marker = String(sourceLabel[markerRange])
        let beforeRelativeY = beforeFrame.minY - reader.frame.minY
        let visible = beforeFrame.intersection(viewport)
        let point = CGPoint(x: visible.minX + min(32, visible.width / 4), y: visible.minY + min(32, visible.height / 4))
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let nativePoint = origin.withOffset(CGVector(dx: point.x - app.frame.minX, dy: point.y - app.frame.minY))
        nativePoint.press(forDuration: 1.2); waitForSystemEditMenu(timeout: 5); systemEditAction(["复制", "Copy"])
        // Reopen this actual selected source's system menu, then create its note.
        // No Copy occurs while opening the editor; Paste must use the prior action.
        nativePoint.press(forDuration: 1.2); waitForSystemEditMenu(timeout: 5); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"]
        require(editor); editor.tap(); editor.press(forDuration: 1.2); systemEditAction(["粘贴", "Paste"])
        let copied = (editor.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertFalse(copied.isEmpty)
        XCTAssertTrue(sourceLabel.contains(copied), "The actual copied words must belong to the visible second-screen paragraph, not merely somewhere in the full chapter")
        capture("GET328-UI54-second-screen-native-copy-paste")
        app.buttons["保留草稿"].tap(); require(reader)
        func assertVisibleSource(_ stage: String) {
            wakeTools()
            let current = reader.descendants(matching: .textView).matching(NSPredicate(format: "label == %@", sourceLabel)).firstMatch
            require(current)
            let currentViewport = bodyViewport(), frame = current.frame
            XCTAssertGreaterThan(frame.intersection(currentViewport).height, 0, "The same actual source paragraph \(marker) must remain inside the reading viewport after \(stage)")
            let relativeY = frame.minY - reader.frame.minY
            let oneLine = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 24)).lineHeight + 9
            let maximumChange = max(viewport.height, currentViewport.height) + oneLine
            XCTAssertLessThanOrEqual(abs(relativeY - beforeRelativeY), maximumChange, "Reflow may quantize within one real reading viewport, not jump to another source location")
            let evidence: [String: Any] = ["stage": stage, "paragraphMarker": marker, "paragraphIntersectsViewport": !frame.intersection(currentViewport).isEmpty,
                "paragraphY": Double(relativeY), "beforeParagraphY": Double(beforeRelativeY), "maximumViewportQuantization": Double(maximumChange)]
            let data = (try? JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])) ?? Data()
            let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
            attachment.name = "GET328-UI54-" + stage + "-visible-source.json"; attachment.lifetime = .keepAlways; add(attachment)
            capture("GET328-UI54-" + stage)
        }
        assertVisibleSource("after-native-note")
        openTool("阅读设置"); expandPanel()
        let font = app.sliders["正文字号"]
        scrollTo(font, in: foregroundForm()); font.adjust(toNormalizedSliderPosition: 0.4)
        closePanel(); assertVisibleSource("after-type-reflow")
        openTool("外观"); expandPanel()
        let night = app.buttons["夜读"]
        scrollTo(night, in: foregroundForm()); night.tap(); XCTAssertTrue(night.isSelected)
        closePanel(); assertVisibleSource("after-night-paper")
        chooseNavigation("上下滚动"); assertVisibleSource("after-scroll-mode")
        chooseNavigation("左右翻页"); assertVisibleSource("after-paged-mode")
        requestedLandscape = true
        device.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.reader.frame.width > self.reader.frame.height }, object: nil)
        let landscapeResult = XCTWaiter.wait(for: [landscape], timeout: 8)
        captureRotationDiagnostics("after-landscape-wait", waitResult: String(describing: landscapeResult))
        XCTAssertEqual(landscapeResult, .completed)
        capture("GET328-UI54-real-landscape-reflow")
        device.orientation = .portrait
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in abs(self.reader.frame.width - portraitWidth) <= 1 && self.reader.frame.height > self.reader.frame.width }, object: nil)
        let portraitResult = XCTWaiter.wait(for: [restored], timeout: 8)
        captureRotationDiagnostics("after-portrait-wait", waitResult: String(describing: portraitResult))
        XCTAssertEqual(portraitResult, .completed)
        _ = try settledOriginalBand()
        assertVisibleSource("after-portrait-return")
        coldRelaunch(); require(reader, timeout: 20)
        _ = try settledOriginalBand()
        assertVisibleSource("after-cold-resume")
    }

    @MainActor
    func test55CloudPublisherStartUsesTheActualPassageAndSavedChapterWinsAfterColdResume() throws {
        executionTimeAllowance = 300
        launch(["--get328-cloud-reading-start"]); openBook(translatedTitle)
        func visiblePassage(chapter: String, number: Int, stage: String) throws -> (XCUIElement, CGRect) {
            wakeTools()
            let prefix = "GET317 SYNTHETIC \(chapter) paragraph \(number)."
            let paragraph = reader.descendants(matching: .textView)
                .matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
            require(paragraph)
            XCTAssertTrue(paragraph.label.contains("CLOUD_ORCHARD_\(chapter)_\(number)"))
            let title = app.buttons["reader-book-title"]
            requireReaderControlAwake(title)
            let frame = reader.frame.intersection(app.frame)
            let top = max(frame.minY, title.frame.maxY + 16), bottom = min(frame.maxY, readerControlsTop - 12)
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            let visible = paragraph.frame.intersection(viewport)
            XCTAssertGreaterThan(visible.height, 32, "The declared or saved source must actually be visible after \(stage)")
            XCTAssertGreaterThan(visible.width, 64)
            let oneLine = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 22)).lineHeight + 9
            XCTAssertLessThanOrEqual(abs(paragraph.frame.minY - viewport.minY), oneLine + 16, "The actual requested passage must return to the reading top, within one source line")
            let details: [String: Any] = ["stage": stage, "sourcePrefix": prefix,
                "paragraphY": Double(paragraph.frame.minY), "viewportY": Double(viewport.minY), "visibleHeight": Double(visible.height)]
            let data = try JSONSerialization.data(withJSONObject: details, options: [.sortedKeys, .prettyPrinted])
            let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
            attachment.name = "GET328-UI55-" + stage + "-actual-source.json"; attachment.lifetime = .keepAlways; add(attachment)
            capture("GET328-UI55-" + stage)
            return (paragraph, visible)
        }
        XCTAssertTrue((reader.value as? String)?.contains("GET317 SYNTHETIC c2 paragraph") == true)
        _ = try visiblePassage(chapter: "c2", number: 4, stage: "publisher-c2-p4")
        openTool("目录"); expandPanel()
        let firstChapter = app.buttons["GET317 合成第 1 章"]
        scrollTo(firstChapter, in: foregroundForm(), direction: .down); firstChapter.tap(); require(reader)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 SYNTHETIC c1 paragraph") == true)
        let (_, visible) = try visiblePassage(chapter: "c1", number: 1, stage: "user-selected-c1")
        let point = CGPoint(x: visible.minX + min(32, visible.width / 4), y: visible.minY + min(32, visible.height / 4))
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: point.x - app.frame.minX, dy: point.y - app.frame.minY)).press(forDuration: 1.2)
        waitForSystemEditMenu(timeout: 5); systemEditAction(["记笔记"])
        let editor = app.textViews["我的笔记正文"], draft = "GET328 cloud publisher start keeps my personal draft."
        require(editor); editor.tap(); editor.typeText(draft)
        XCTAssertEqual(editor.value as? String, draft)
        app.buttons["保留草稿"].tap(); require(reader)
        coldRelaunch(); require(reader, timeout: 20)
        XCTAssertTrue((reader.value as? String)?.contains("GET317 SYNTHETIC c1 paragraph") == true, "The saved chapter must win over a publisher hint after cold launch")
        _ = try visiblePassage(chapter: "c1", number: 1, stage: "cold-saved-c1")
        openTool("我的记录"); expandPanel()
        let navigation = app.navigationBars["我的记录"]
        require(navigation)
        XCTAssertEqual(navigation.buttons.matching(NSPredicate(format: "label == %@", "继续读")).count, 1, "A pushed tool keeps its native Back and exactly one direct Continue action")
        require(navigation.buttons["阅读工具"])
        let recovered = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", draft)).firstMatch
        scrollTo(recovered, in: foregroundForm()); recovered.tap(); require(editor)
        XCTAssertEqual(editor.value as? String, draft)
        app.buttons["保留草稿"].tap(); require(navigation)
        closePanel(); require(reader)
        _ = try visiblePassage(chapter: "c1", number: 1, stage: "draft-restored-and-continued")
    }


    @MainActor
    func test56ShelfCloudUpdateIsVisibleAndReadActionsAnnounceItsRealStatus() throws {
        executionTimeAllowance = 300
        let author = "GET317 合成作者甲", status = "已下载 · 云端有更新"
        let accessibilityCategory = UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory
        var evidence: [[String: Any]] = []
        defer {
            do {
                let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
                let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
                attachment.name = "GET328-UI56-cloud-update-native-actions.json"
                attachment.lifetime = .keepAlways; add(attachment)
            } catch { XCTFail("Could not retain actual cloud-update action evidence: \(error)") }
        }
        launch(["--get328-cloud-update"])
        for layout in ["列表", "封面网格"] {
            setLayout(layout)
            clearShelfSearch(); require(app.staticTexts["6 本书"])
            searchShelf(translatedTitle); require(app.staticTexts["1 本书"])
            let identifier = layout == "列表" ? "library-shelf-list" : "library-shelf-grid"
            let surface = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            require(surface)
            func viewport() -> CGRect {
                let filter = app.segmentedControls.buttons["全部"], menu = app.buttons["书房显示与排序"]
                return recordProfileContentViewport(surface, navigationTitle: "我的书房", topLimit: max(filter.frame.maxY, menu.frame.maxY) + 8)
            }
            func fullyReachable(_ element: XCUIElement) {
                for _ in 0..<12 {
                    let visible = viewport()
                    if element.exists {
                        let frame = element.frame
                        if !frame.isEmpty && visible.insetBy(dx: -1, dy: -1).contains(frame) && element.isHittable { break }
                        if frame.isEmpty { surface.swipeUp() }
                        else {
                            let delta = frame.minY < visible.minY ? visible.minY - frame.minY + 6 : visible.maxY - frame.maxY - 6
                            nudgeRecordProfileContent(surface, by: delta, inside: visible)
                        }
                    } else { surface.swipeUp() }
                }
                require(element)
                XCTAssertFalse(element.frame.isEmpty)
                XCTAssertTrue(viewport().insetBy(dx: -1, dy: -1).contains(element.frame), "The complete actual text or action must be visible in the shelf viewport")
                XCTAssertTrue(element.isHittable)
            }
            // Verify the real visual text as well as the reading action's
            // separate VoiceOver label. A changed catalog must not add a book.
            for text in [translatedTitle, author, status] {
                let visibleText = surface.staticTexts[text].firstMatch
                fullyReachable(visibleText)
                XCTAssertEqual(visibleText.label, text)
                evidence.append(["layout": layout, "kind": "visible-text", "label": visibleText.label,
                    "x": Double(visibleText.frame.minX), "y": Double(visibleText.frame.minY),
                    "width": Double(visibleText.frame.width), "height": Double(visibleText.frame.height)])
                capture("GET328-UI56-\(layout)-\(text)")
            }
            let reads = surface.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "阅读，" + translatedTitle))
            let count = reads.count
            XCTAssertEqual(count, layout == "列表" || accessibilityCategory ? 1 : 2, "Check every actual reading entry, including both regular grid actions")
            for index in 0..<count {
                let read = reads.element(boundBy: index)
                fullyReachable(read)
                let frame = read.frame
                evidence.append(["layout": layout, "kind": "reading-action", "index": index,
                    "label": read.label, "value": read.value as? String ?? "", "hittable": read.isHittable,
                    "x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)])
                capture("GET328-UI56-\(layout)-reading-action-\(index)")
                XCTAssertTrue(read.label.hasPrefix("阅读，" + translatedTitle + "，"), "The reading action must retain the complete book title")
                XCTAssertTrue(read.label.contains("云端有更新"), "VoiceOver must announce the same update status that the shelf visibly presents")
                if layout == "列表" || accessibilityCategory { XCTAssertEqual(read.value as? String, author) }
                XCTAssertGreaterThanOrEqual(frame.width, 44)
                XCTAssertGreaterThanOrEqual(frame.height, 44)
                XCTAssertTrue(read.isEnabled && read.isHittable)
                read.tap(); require(reader)
                XCTAssertTrue((reader.value as? String)?.contains("CLOUD_ORCHARD_c1_1") == true, "An update notice must keep the actual existing offline copy readable")
                shelf(); require(surface)
                fullyReachable(surface.staticTexts[status].firstMatch)
            }
            clearShelfSearch(); require(app.staticTexts["6 本书"])
        }
    }

    @MainActor
    func test57PagedPaperMarginsRejectInvisibleSelectionAndKeepTapAndPaging() throws {
        launch(); openBook(textTitle); chooseNavigation("左右翻页")
        reader.swipeLeft()
        let original = reader.value as? String
        func pageNumber() throws -> Int {
            wakeTools()
            for identifier in ["reader-contents", "reader-read", "reader-listen", "reader-appearance", "reader-typography"] {
                XCTAssertEqual(app.buttons.matching(identifier: identifier).count, 1, "Only the fitted, visible control may be exposed")
            }
            let value = try XCTUnwrap(app.buttons["reader-contents"].value as? String)
            let suffix = try XCTUnwrap(value.components(separatedBy: "本章第 ").dropFirst().first)
            return try XCTUnwrap(Int(suffix.components(separatedBy: " / ")[0]))
        }
        var page = try pageNumber()
        XCTAssertEqual(page, 2, "Begin on a real middle screen, where adjacent source exists in both margins")
        for edge in ["top", "bottom"] {
            reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
            XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
            for identifier in ["reader-read", "reader-listen", "reader-appearance", "reader-typography", "reader-book-title", "reader-more"] {
                for control in app.buttons.matching(identifier: identifier).allElementsBoundByIndex {
                    if control.exists {
                        XCTAssertFalse(control.isEnabled, "Sleeping retained controls must be disabled")
                        XCTAssertFalse(control.isHittable, "Sleeping retained controls must not accept a tap")
                    }
                }
            }
            let height = reader.frame.height
            let y: CGFloat = edge == "top" ? 22 : height - 22
            let point = reader.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: reader.frame.width * 0.25, dy: y))
            point.press(forDuration: 1.2)
            let invisibleSelection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !self.visibleNativeMenuItems().isEmpty || self.nativeButtonEditMenu() != nil
            }, object: nil)
            invisibleSelection.isInverted = true
            XCTAssertEqual(XCTWaiter.wait(for: [invisibleSelection], timeout: 1.5), .completed,
                           "Long-pressing reserved paper must not select a hidden adjacent line")
            XCTAssertTrue(readerChromeIsAsleep, "A long press must keep the grip available and every reading control noninteractive instead of being mistaken for the next short tap")
            capture("GET328-UI57-" + edge + "-paper-after-long-press")
            point.tap()
            requireReaderControlAwake(app.buttons["reader-contents"])
            XCTAssertEqual(try pageNumber(), page, "A margin tap reveals tools without moving the source")
            reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
            XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
            let start = reader.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: reader.frame.width * 0.8, dy: y))
            let end = reader.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: reader.frame.width * 0.2, dy: y))
            start.press(forDuration: 0.1, thenDragTo: end)
            XCTAssertEqual(try pageNumber(), page + 1, "The same paper band must still accept a real horizontal page turn after its long press")
            page += 1
            XCTAssertEqual(reader.value as? String, original, "Margin interactions retain the complete original chapter")
        }
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        selectOriginal(); systemEditAction(["复制", "Copy"])
        capture("GET328-UI57-visible-body-keeps-native-copy")
    }

    @MainActor
    func test58PDFNativeCopyPastesActualSourceIntoNotesInBothReadingModes() throws {
        // Fresh drafts and PDF -> SYNTHETIC -> PDF prove both modes replace
        // the prior clipboard content without any test clipboard access.
        let sourceLine = "GET317 SYNTHETIC PDF"
        let font = UIFont.systemFont(ofSize: 20) // VideoAcceptanceFixture's PDF renderer.
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let lineWidth = (sourceLine as NSString).size(withAttributes: attributes).width
        var evidence: [[String: Any]] = []
        func frame(_ rect: CGRect) -> [String: Double] {
            ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
        }
        func attachGeometry(_ mode: String, _ pdf: XCUIElement) {
            let attachment = XCTAttachment(string: pdf.debugDescription + "\n\n" + app.debugDescription)
            attachment.name = "GET328-UI58-" + mode + "-actual-PDF-AX.txt"
            attachment.lifetime = .keepAlways; add(attachment)
            capture("GET328-UI58-" + mode + "-actual-source-geometry")
        }
        for (round, scenario) in [("上下滚动", "PDF"), ("左右翻页", "SYNTHETIC"), ("上下滚动", "PDF")].enumerated() {
            let (mode, word) = scenario
            let stage = "round-\(round + 1)-" + mode
            app.terminate(); launch(); openBook(pdfTitle); chooseNavigation(mode)
            let pdf = app.otherElements["leafhour-pdf-reader"]
            require(pdf)
            XCTAssertTrue(waitForReaderChromeAsleep(timeout: 8), "Select actual source without chrome covering it")
            let viewport = pdf.frame.intersection(app.frame)
            let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
            let gripFrame = grip.frame
            func usable(_ rect: CGRect) -> Bool {
                !rect.isEmpty && [rect.minX, rect.minY, rect.width, rect.height].allSatisfy { $0.isFinite }
                    && viewport.contains(rect) && !rect.intersects(gripFrame)
            }
            var target: (point: CGPoint, rect: CGRect, label: String, kind: String)?
            // Prefer a real word-level source accessibility frame. A full-page
            // aggregate is not accepted as a word rectangle.
            let wordWidth = (word as NSString).size(withAttributes: attributes).width
            for node in pdf.staticTexts.matching(NSPredicate(format: "label == %@", word)).allElementsBoundByIndex {
                let rect = node.frame
                let scale = rect.width / wordWidth
                guard usable(rect), scale > 0,
                      rect.height >= font.lineHeight * scale * 0.4,
                      rect.height <= font.lineHeight * scale * 1.75 else { continue }
                target = (CGPoint(x: rect.midX, y: rect.midY), rect, node.label, "actual-word-AX-frame")
                break
            }
            // An exact single-line AX frame is also source geometry. Project
            // the renderer's measured word advances into that observed line;
            // never infer a page rectangle from the PDFView's overall bounds.
            if target == nil {
                for node in pdf.staticTexts.matching(NSPredicate(format: "label == %@", sourceLine)).allElementsBoundByIndex {
                    let rect = node.frame
                    let scale = rect.width / lineWidth
                    guard usable(rect), scale > 0,
                          rect.height >= font.lineHeight * scale * 0.4,
                          rect.height <= font.lineHeight * scale * 1.75,
                          let range = sourceLine.range(of: word) else { continue }
                    let prefix = String(sourceLine[..<range.lowerBound])
                    let advance = (prefix as NSString).size(withAttributes: attributes).width
                    let x = rect.minX + (advance + wordWidth / 2) * scale
                    let point = CGPoint(x: x, y: rect.midY)
                    guard rect.contains(point) else { continue }
                    target = (point, rect, node.label, "actual-line-AX-frame-and-fixture-font-advances")
                    break
                }
            }
            attachGeometry(stage, pdf)
            let actual = try XCTUnwrap(target, "PDFKit must expose an actual visible source word/line frame. A whole-page aggregate or missing source frame is a geometry failure, not permission to guess a selection point.")
            XCTAssertTrue(viewport.contains(actual.point))
            evidence.append(["round": round + 1, "mode": mode, "expectedSourceWord": word, "geometry": actual.kind,
                "sourceAXLabel": actual.label, "sourceAXFrame": frame(actual.rect), "pdfFrame": frame(pdf.frame),
                "visibleViewport": frame(viewport), "pressX": Double(actual.point.x), "pressY": Double(actual.point.y)])
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: actual.point.x - app.frame.minX, dy: actual.point.y - app.frame.minY))
                .press(forDuration: 1.2)
            waitForSystemEditMenu(timeout: 5)
            systemEditAction(["复制", "Copy"])
            // PDF's note action is the real selected-source toolbar Button,
            // rather than a custom native edit-menu item used by text readers.
            require(app.staticTexts["已选择原文"])
            let notes = app.buttons.matching(NSPredicate(format: "label == %@", "记笔记"))
            XCTAssertEqual(notes.count, 1, "Use the unique actual PDF selected-source note action")
            let note = notes.firstMatch
            requireReaderControlAwake(note); note.tap()
            let noteBar = app.navigationBars["记下自己的想法"]
            require(noteBar)
            let editor = app.textViews["我的笔记正文"]
            require(editor)
            // The sheet's actual source quote must match this PDF selection.
            // Underlying PDF words are excluded by foreground hit testing and
            // the visible region between this note bar and this editor.
            let barFrame = noteBar.frame, editorFrame = editor.frame
            let quoteRegion = CGRect(x: barFrame.minX, y: barFrame.maxY,
                width: barFrame.width, height: max(0, editorFrame.minY - barFrame.maxY))
            let quote = try XCTUnwrap(app.staticTexts.matching(NSPredicate(format: "label == %@", word))
                .allElementsBoundByIndex.first { node in
                    node.exists && node.isEnabled && node.isHittable && !node.frame.isEmpty
                        && app.frame.contains(node.frame) && quoteRegion.contains(node.frame)
                }, "The foreground Note panel must show this exact selected PDF source above its editor, rather than matching a covered PDF word")
            XCTAssertEqual(quote.label, word)
            evidence.append(["round": round + 1, "mode": mode, "foregroundSelectedQuote": quote.label,
                "noteBarFrame": frame(barFrame), "noteEditorFrame": frame(editorFrame), "quoteFrame": frame(quote.frame)])
            XCTAssertEqual(try XCTUnwrap(editor.value as? String), "", "Fresh mode setup must not supply an existing note or draft")
            editor.tap(); editor.press(forDuration: 1.2)
            systemEditAction(["粘贴", "Paste"])
            let pasted = try XCTUnwrap(editor.value as? String)
            XCTAssertEqual(pasted, word, "Native Paste must insert the exact synthetic PDF source word selected and copied in this mode")
            evidence.append(["round": round + 1, "mode": mode, "nativePasteMatchesActualSource": pasted == word, "pastedSourceWord": pasted])
            capture("GET328-UI58-" + stage + "-native-PDF-copy-paste")
            app.buttons["保留草稿"].tap()
            XCTAssertTrue(editor.waitForNonExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["已选择原文"].waitForNonExistence(timeout: 5), "Returning from Notes must clear the transient PDF selection toolbar")
            require(pdf)
        }
        let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
        let attachment = XCTAttachment(string: String(decoding: data, as: UTF8.self))
        attachment.name = "GET328-UI58-PDF-native-copy-paste-source-evidence.json"
        attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor
    func test59PagedSideTapsTurnRealSourceAndCenterKeepsThePage() throws {
        launch(["--get341-unique-source"]); openBook(translatedTitle); chooseNavigation("左右翻页")
        let source = reader.value as? String
        let first = try settledOriginalBand()
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap()
        wakeTools()
        let actualPage = app.buttons["reader-contents"].value as? String ?? "missing"
        let actualPageAttachment = XCTAttachment(string: actualPage)
        actualPageAttachment.name = "GET341 UI59 actual page after right tap"; actualPageAttachment.lifetime = .keepAlways; add(actualPageAttachment)
        print("GET341 UI59 actual page after right tap: " + actualPage)
        XCTAssertTrue(actualPage.contains("本章第 2 /"), "A real right tap must advance the independently reported TextKit screen")
        app.buttons["reader-read"].tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        let second = try settledOriginalBand()
        XCTAssertNotEqual(second, first, "A real short tap on the right must turn the actual source screen")
        XCTAssertEqual(reader.value as? String, source)
        capture("GET341 right tap advances actual source")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)).tap()
        XCTAssertEqual(try settledOriginalBand(), first, "Left tap must return to the exact original reading band")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        requireReaderControlAwake(app.buttons["reader-contents"])
        XCTAssertEqual(try settledOriginalBand(), first, "Center disclosure must not turn or reflow source")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap()
        XCTAssertEqual(try settledOriginalBand(), second)
        coldRelaunch(); require(reader, timeout: 20)
        XCTAssertEqual(try settledOriginalBand(), second, "A tap-created source checkpoint survives cold reopening")
        capture("GET341 tap-created checkpoint cold restore")
    }

    @MainActor
    func test60PDFSideTapsRespectBookEndsAndColdRestoreTheActualPage() throws {
        launch(); openBook(pdfTitle); chooseNavigation("左右翻页")
        let pdf = app.otherElements["leafhour-pdf-reader"]
        require(pdf)
        func expectPage(_ index: Int) {
            wakeTools()
            let contents = app.buttons["reader-contents"]
            let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                contents.exists && (contents.value as? String)?.contains("第 \(index) / 3 页") == true
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 6), .completed)
            app.buttons["reader-read"].tap()
            XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        }
        expectPage(1)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)).tap(); expectPage(1)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap(); expectPage(2)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)).tap(); expectPage(1)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap(); expectPage(2)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap(); expectPage(3)
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap(); expectPage(3)
        coldRelaunch(); require(pdf, timeout: 20); expectPage(3)
        capture("GET341 native PDF taps and final page cold restore")
    }

    @MainActor
    func test61NativeSideLongPressCopyAndSelectionDismissalDoNotTurnThePage() throws {
        launch(); openBook(textTitle); chooseNavigation("左右翻页")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap()
        wakeTools()
        let before = try XCTUnwrap(app.buttons["reader-contents"].value as? String)
        XCTAssertTrue(before.contains("本章第 2 /"))
        app.buttons["reader-read"].tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3))
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.4)).press(forDuration: 1.2)
        systemEditAction(["复制", "Copy"])
        capture("GET341 real side selection and native Copy")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.4)).tap()
        wakeTools()
        XCTAssertEqual(app.buttons["reader-contents"].value as? String, before, "Dismissing the system selection must not also advance the book")
    }

}
