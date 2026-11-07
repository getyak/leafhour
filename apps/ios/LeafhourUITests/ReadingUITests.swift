import XCTest
import Vision

/// Runs against the task-owned unsigned local app and public-domain acceptance documents.
/// Prepare each case through the guarded legacy HostSeed using the complete public-domain originals.
final class ReadingUITests: XCTestCase {
    let app = GET328CurrentAcceptance.application(legacy: true)
    override func setUpWithError() throws {
        continueAfterFailure = false
        GET328CurrentAcceptance.attachRunnerTypeProfile(to: self)
        // The host prepares each case while this task app is stopped. Never
        // reset here: terminate/launch inside a case must retain real records.
        app.launchArguments = ["--get317-acceptance", "-leafhour.library.layout", "list",
                               "-leafhour.library.filter", "all", "-leafhour.library.sort", "added"] + GET328CurrentAcceptance.launchArguments
        app.terminate(); app.launch()
    }
    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private let primaryReaderIDs = ["reader-contents", "reader-read", "reader-listen", "reader-appearance", "reader-typography"]
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
    /// GET-274 uses a separate task bundle seeded through OfflineLibrary with public-domain text.
    func testCompanionExplicitSummonAndQuietDismissal() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 8), "Entry tools become quiet after a short idle")
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["reader-more"], timeout: 3), "A middle tap reveals the reading tools")
        openMoreTool("阅读陪读")
        assertCompanionAndDismiss("explicit")
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertTrue(readerControlIsAwake(app.buttons["reader-more"]), "The More entry keeps companion tools discoverable after a cold launch")
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 8))
    }
    func testCompanionSystemSelectionAndQuietDismissal() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.48)).press(forDuration: 1.2)
        let explain = app.menuItems["解释这句"]
        XCTAssertTrue(explain.waitForExistence(timeout: 5), app.debugDescription); explain.tap()
        XCTAssertTrue(app.staticTexts["选中的原文"].waitForExistence(timeout: 3))
        assertCompanionAndDismiss("selection")
        XCTAssertFalse(app.menuItems["解释这句"].exists)
    }
    private func assertCompanionAndDismiss(_ origin: String) {
        let title = app.navigationBars["Chat"]
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        XCTAssertLessThan(title.frame.minY, app.windows.firstMatch.frame.height * 0.25,
                             "Chat opens as a full-height conversation")
        XCTAssertTrue(app.textFields["reader-question"].exists || app.textViews["reader-question"].exists, "The real conversation composer replaces the old placeholder")
        XCTAssertFalse(app.staticTexts["此设备尚未连接 AI 陪读。原文仍在这里，可以继续阅读。"].exists)
        capture("GET312-" + origin + "-conversation-half-sheet")
        app.buttons["继续读"].tap()
        capture("GET274-" + origin + "-after-close-tap")
        XCTAssertTrue(title.waitForNonExistence(timeout: 1), app.debugDescription)
        XCTAssertTrue(readerChromeIsAsleep, "Dismissed companion leaves the real grip available and all retained chrome controls noninteractive")
        capture("GET274-" + origin + "-quiet")
    }
    func progress() {
        let contents = app.buttons["reader-contents"]
        if readerControlIsAwake(contents) { return }
        let text = app.textViews["leafhour-epub-reader"]
        let surface = text.exists ? text : app.otherElements["leafhour-pdf-reader"]
        XCTAssertTrue(surface.waitForExistence(timeout: 10), app.debugDescription)
        let grip = app.buttons["显示阅读进度、目录、搜索与记录"]
        if readerControlIsAwake(grip) { grip.tap() }
        else { surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
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
        let more = app.buttons["reader-more"]
        XCTAssertTrue(waitForReaderControlAwake(more, timeout: 3), app.debugDescription); more.tap()
        XCTAssertTrue(app.navigationBars["阅读工具"].waitForExistence(timeout: 3), app.debugDescription)
        let tool = app.buttons[title].firstMatch
        revealInPanel(tool); tool.tap()
    }
    func library() {
        if readerControlIsAwake(app.buttons["返回书房"]) { app.buttons["返回书房"].tap(); return }
        let text = app.textViews["leafhour-epub-reader"]
        let surface = text.exists ? text : app.otherElements["leafhour-pdf-reader"]
        if surface.waitForExistence(timeout: 3) { progress(); requireReaderControlAwake(app.buttons["返回书房"], timeout: 3); app.buttons["返回书房"].tap() }
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
        XCTAssertTrue(readerControlIsAwake(app.buttons["reader-more"]), "Reading tools are discoverable on entry")
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
        func requirePage(_ page: Int) {
            progress()
            let prefix = "第 \(page) / 73 页 · "
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let contents = self.app.buttons["reader-contents"]
                return contents.exists && (contents.value as? String)?.hasPrefix(prefix) == true
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed,
                           "The actual PDF page must be \(page) of exactly 73. \(app.debugDescription)")
        }
        func retainOriginalPage(_ page: Int, name: String) {
            guard waitForReaderChromeAsleep(timeout: 8) else {
                capture(name + "-chrome-not-quiet")
                XCTFail("Inspect the original PDF without reader controls covering it. \(app.debugDescription)")
                return
            }
            let original = app.otherElements["leafhour-pdf-reader"]
            let diagnostics = XCTAttachment(string: "Diagnostic native AX only; not an original-page oracle.\n" +
                                            (original.exists ? original.debugDescription : app.debugDescription))
            diagnostics.name = name + "-native-AX.txt"; diagnostics.lifetime = .keepAlways; add(diagnostics)
            if GET328CurrentAcceptance.enabled {
                let marker = "GET328_PUBLIC_ALICE_PAGE_\(page)_OF_73"
                func normalized(_ text: String) -> String {
                    text.uppercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
                }
                let expectedMarker = normalized(marker)
                let otherMarker = normalized("GET328_PUBLIC_ALICE_PAGE_\(page == 72 ? 73 : 72)_OF_73")
                var screenshots: [XCUIScreenshot] = []
                var observations: [String] = []
                var matched = false
                var recognitionError: String?
                var attempts = 0
                let rendered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    if matched || recognitionError != nil { return true }
                    guard attempts < 12 else { return false }
                    attempts += 1
                    let pdf = self.app.otherElements["leafhour-pdf-reader"]
                    guard pdf.exists && !pdf.frame.isEmpty else {
                        observations.append("Attempt \(attempts): original PDFView is not available")
                        return false
                    }
                    let screenshot = pdf.screenshot()
                    screenshots.append(screenshot)
                    let request = VNRecognizeTextRequest()
                    request.recognitionLevel = .accurate; request.recognitionLanguages = ["en-US"]
                    do {
                        let image = screenshot.image
                        let cgImage = try XCTUnwrap(image.cgImage)
                        try VNImageRequestHandler(cgImage: cgImage).perform([request])
                        let raw = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                        let visible = normalized(raw)
                        // Match the complete normalized source-page marker,
                        // with no fuzzy spelling or metadata/AX fallback.
                        let pageMatches = visible.contains(expectedMarker) && !visible.contains(otherMarker)
                        let endingMatches = page != 73 || (visible.contains(normalized("happy summer days")) && visible.contains(normalized("THE END")))
                        matched = pageMatches && endingMatches
                        observations.append("Attempt \(attempts), screenshot \(screenshots.count): marker=\(pageMatches), ending=\(endingMatches)\nRAW OCR:\n\(raw)\nNORMALIZED OCR:\n\(visible)")
                    } catch {
                        // Recognition errors are terminal raw failures, not
                        // permission to accept metadata or silently retry OCR.
                        recognitionError = String(describing: error)
                        observations.append("Attempt \(attempts), screenshot \(screenshots.count): OCR ERROR: \(error)")
                    }
                    return matched || recognitionError != nil
                }, object: nil)
                let result = XCTWaiter.wait(for: [rendered], timeout: 12)
                for (index, screenshot) in screenshots.enumerated() {
                    let attachment = XCTAttachment(screenshot: screenshot)
                    attachment.name = name + "-render-attempt-\(index + 1)"
                    attachment.lifetime = .keepAlways; add(attachment)
                }
                let receipt = XCTAttachment(string: "Expected visible marker: \(marker)\nExpected ending: \(page == 73 ? "happy summer days; THE END" : "not required on page 72")\nWait result: \(result)\n" + observations.joined(separator: "\n\n"))
                receipt.name = name + "-OCR.txt"; receipt.lifetime = .keepAlways; add(receipt)
                if let screenshot = screenshots.last {
                    // This is the actual original-PDFView image supplied to
                    // Vision, retained even when its raw OCR check failed.
                    let attachment = XCTAttachment(screenshot: screenshot)
                    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
                } else { capture(name + "-original-surface-unavailable") }
                if let recognitionError {
                    XCTFail("Could not verify the visible original PDF page \(page): \(recognitionError)")
                    return
                }
                XCTAssertEqual(result, .completed, "The actual rendered original PDF must become OCR-readable within the bounded wait")
                XCTAssertTrue(matched, "The visible original PDF must contain \(marker)\(page == 73 ? ", happy summer days, and THE END" : ""). Raw OCR and screenshots are retained.")
            } else {
                XCTAssertTrue(original.exists && !original.frame.isEmpty, app.debugDescription)
                let attachment = XCTAttachment(screenshot: original.screenshot())
                attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
            }
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "reader-pdf-source-fallback").firstMatch.exists,
                           "Read the original PDF, rather than a missing-translation fallback")
        }
        library()
        let importButton = app.buttons["导入书籍"]
        XCTAssertTrue(importButton.waitForExistence(timeout: 10)); importButton.tap()
        let file = preparedPDFInSystemFiles()
        XCTAssertTrue(file.exists && file.isEnabled && file.isHittable, app.debugDescription)
        file.tap()
        XCTAssertTrue(app.collectionViews["File View"].waitForNonExistence(timeout: 15), "The real system picker must dismiss after selecting the exact PDF")
        XCTAssertTrue(app.otherElements["leafhour-pdf-reader"].waitForExistence(timeout: 15), app.debugDescription)
        requirePage(1)
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["reader-book-title"], timeout: 3), app.debugDescription)
        let pdfTitle = app.buttons["reader-book-title"].label
        XCTAssertFalse(pdfTitle.isEmpty, "Keep the actual imported PDF identity for a cold reopen")
        progress(); app.buttons["reader-contents"].tap()
        XCTAssertTrue(app.navigationBars["目录"].waitForExistence(timeout: 5), app.debugDescription)
        // The current contents UI has explicit source-page entries, replacing
        // the old approximate slider and its removed next-page button.
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("72")
        let penultimate = app.buttons["reader-contents-entry-71"]
        XCTAssertTrue(waitForReaderControlAwake(penultimate, timeout: 10), app.debugDescription)
        penultimate.tap()
        XCTAssertTrue(app.navigationBars["目录"].waitForNonExistence(timeout: 5))
        requirePage(72)
        XCTAssertTrue(app.buttons["reader-next-chapter"].exists && app.buttons["reader-next-chapter"].isEnabled,
                      "The PDF still has its real final source page ahead")
        retainOriginalPage(72, name: "PDF-original-page-72-before-final-turn")
        // Prove this native gesture turns 72 -> 73 before using the same
        // gesture at the boundary; a disconnected swipe cannot pass both.
        app.otherElements["leafhour-pdf-reader"].swipeLeft()
        requirePage(73)
        XCTAssertTrue(app.buttons["reader-next-chapter"].exists, app.debugDescription)
        XCTAssertFalse(app.buttons["reader-next-chapter"].isEnabled, "The actual 73-page PDF is at its true last page")
        capture("PDF-page-73-of-73")
        retainOriginalPage(73, name: "PDF-original-page-73-rendered")
        app.otherElements["leafhour-pdf-reader"].swipeLeft()
        requirePage(73)
        XCTAssertTrue(app.buttons["reader-next-chapter"].exists, app.debugDescription)
        XCTAssertFalse(app.buttons["reader-next-chapter"].isEnabled, "A native forward gesture cannot advance beyond page 73")
        retainOriginalPage(73, name: "PDF-original-last-page-after-boundary-gesture")
        app.terminate(); app.launch()
        let resumeLabel = "继续阅读，" + pdfTitle
        let reopened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.otherElements["leafhour-pdf-reader"].exists || self.app.buttons[resumeLabel].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reopened], timeout: 15), .completed, "Cold launch must restore the PDF or offer this exact imported book")
        if !app.otherElements["leafhour-pdf-reader"].exists {
            let resumes = app.buttons.matching(NSPredicate(format: "label == %@", resumeLabel))
            XCTAssertEqual(resumes.count, 1, "Only the imported PDF's exact Continue Reading entry may be reopened")
            resumes.firstMatch.tap()
        }
        XCTAssertTrue(app.otherElements["leafhour-pdf-reader"].waitForExistence(timeout: 15))
        requirePage(73)
        XCTAssertTrue(app.buttons["reader-next-chapter"].exists, app.debugDescription)
        XCTAssertFalse(app.buttons["reader-next-chapter"].isEnabled, "The cold-restored real PDF is at its true last page")
        capture("PDF-page-73-cold-resume")
        retainOriginalPage(73, name: "PDF-original-page-73-cold-resume")
    }
    private func preparedPDFInSystemFiles() -> XCUIElement {
        // Files retains its last directory. The real previous run started in
        // GET317AcceptanceExports; Browse alone did not leave that folder.
        // Re-resolve the native hierarchy after every transition: Files can
        // replace its collection and AX identities while a provider loads.
        let folder = GET328CurrentAcceptance.sourceDirectoryName
        let filename = GET328CurrentAcceptance.pdfFilename
        let stem = (filename as NSString).deletingPathExtension
        let appFolder = GET328CurrentAcceptance.displayName
        let deviceNames = ["我的 iPhone", "我的iPhone", "On My iPhone"]
        func visible(_ element: XCUIElement) -> Bool {
            element.exists && element.isEnabled && element.isHittable && !element.frame.isEmpty && app.frame.intersects(element.frame)
        }
        func named(_ value: String, _ title: String) -> Bool {
            value == title || value.hasPrefix(title + ",") || value.hasPrefix(title + "\n")
        }
        func pickerRoot() -> XCUIElement {
            let picker = app.otherElements["Browse View (Picker)"]
            return picker.exists ? picker : app
        }
        func fileView() -> XCUIElement? {
            let views = app.collectionViews.matching(identifier: "File View").allElementsBoundByIndex.filter {
                $0.exists && !$0.frame.isEmpty && app.frame.intersects($0.frame)
            }
            return views.count == 1 ? views[0] : nil
        }
        func items(_ titles: [String], filesOnly: Bool = true) -> [XCUIElement] {
            let queries: [XCUIElementQuery]
            if filesOnly {
                guard let files = fileView() else { return [] }
                queries = [files.cells]
            } else {
                let root = pickerRoot()
                queries = [root.cells, root.buttons]
            }
            for query in queries {
                let matches = query.allElementsBoundByIndex.filter { element in
                    visible(element) && !element.label.contains("操作菜单") && !element.label.contains("Actions Menu")
                        && titles.contains { named(element.identifier, $0) || named(element.label, $0) }
                }
                if !matches.isEmpty { return matches }
            }
            return []
        }
        func inDirectory(_ titles: [String]) -> Bool {
            let root = pickerRoot()
            if root.navigationBars.allElementsBoundByIndex.contains(where: { bar in
                bar.exists && !bar.frame.isEmpty && app.frame.intersects(bar.frame)
                    && titles.contains { bar.identifier == $0 || bar.label == $0 }
            }) { return true }
            return root.buttons.allElementsBoundByIndex.contains { button in
                visible(button) && (button.label.contains("操作菜单") || button.label.contains("Actions Menu"))
                    && titles.contains { named(button.label, $0) }
            }
        }
        func exactPDFs() -> [XCUIElement] {
            guard let files = fileView() else { return [] }
            return files.cells.allElementsBoundByIndex.filter { cell in
                guard visible(cell) else { return false }
                let values = [cell.identifier, cell.label]
                if values.contains(where: { named($0, filename) }) { return true }
                // Files may hide the extension. Only an exact stem followed by
                // native PDF metadata is acceptable, never a broad prefix.
                return values.contains { value in
                    guard named(value, stem), value != stem else { return false }
                    let metadata = String(value.dropFirst(stem.count))
                    return metadata.range(of: "(?i)(?:^|[\\s,])pdf(?:$|[\\s,]|文稿|文档|文件)", options: .regularExpression) != nil
                }
            }
        }
        func ready() -> Bool {
            let picker = app.otherElements["Browse View (Picker)"]
            let navigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
            return (picker.exists || navigation.exists)
                && (fileView() != nil || !items(deviceNames, filesOnly: false).isEmpty)
        }
        func routeState() -> [String] {
            let bars = pickerRoot().navigationBars.allElementsBoundByIndex.filter { $0.exists && app.frame.intersects($0.frame) }
            let navigation = bars.flatMap { [$0.label] + $0.buttons.allElementsBoundByIndex.map(\.label) + $0.staticTexts.allElementsBoundByIndex.map(\.label) }
            return navigation + (fileView()?.cells.allElementsBoundByIndex.map(\.label) ?? [])
        }
        func directoryIdentity(_ titles: [String]) -> [String] {
            guard inDirectory(titles) else { return [] }
            let root = pickerRoot()
            let bars = root.navigationBars.allElementsBoundByIndex.filter { $0.exists && !$0.frame.isEmpty && app.frame.intersects($0.frame) }
            let parents = bars.flatMap { $0.buttons.matching(identifier: "BackButton").allElementsBoundByIndex }
                .filter { $0.exists && !$0.frame.isEmpty && app.frame.intersects($0.frame) }
                .map { $0.identifier + "\n" + $0.label }
            // Preserve the exact proven directory name and native parent
            // breadcrumb, independent of large/inline title layout changes.
            return [titles.sorted().joined(separator: "\n")] + parents.sorted()
        }
        func visibleListing() -> [String] {
            guard let files = fileView() else { return [] }
            return files.cells.allElementsBoundByIndex.filter {
                $0.exists && !$0.frame.isEmpty && files.frame.intersects($0.frame)
            }.map { $0.identifier + "\n" + $0.label + "\n" + String(describing: $0.frame) }
        }
        func wait(_ message: String, timeout: TimeInterval = 12, until condition: @escaping () -> Bool) -> Bool {
            let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
            let completed = XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
            if !completed { capture("PDF-system-files-readiness-failed"); XCTFail(message + "\n" + app.debugDescription) }
            return completed
        }
        func unavailable(_ message: String) -> XCUIElement {
            capture("PDF-system-files-route-unavailable")
            XCTFail(message + "\n" + app.debugDescription)
            return app.cells.matching(NSPredicate(value: false)).firstMatch
        }
        func reveal(_ item: String, in parentTitles: [String], until found: @escaping () -> Bool) -> Bool {
            guard wait("The exact parent directory must be ready before revealing \(item)", until: {
                inDirectory(parentTitles) && fileView() != nil && !visibleListing().isEmpty
            }) else { return false }
            let parentIdentity = directoryIdentity(parentTitles)
            guard !parentIdentity.isEmpty else {
                _ = unavailable("Cannot establish the exact parent identity before revealing \(item)")
                return false
            }
            if found() { return true }
            // Files can retain a directory's scroll offset. Search toward its
            // beginning and end, never leaving this exact parent directory.
            for towardBeginning in [true, false] {
                for _ in 0..<8 {
                    guard inDirectory(parentTitles), directoryIdentity(parentTitles) == parentIdentity,
                          let files = fileView() else {
                        _ = unavailable("The parent directory changed while revealing \(item)")
                        return false
                    }
                    if found() { return true }
                    let before = visibleListing()
                    if towardBeginning { files.swipeDown() } else { files.swipeUp() }
                    var previous: [String]?
                    var changedParent = false
                    guard wait("The native listing must settle after revealing \(item)", timeout: 4, until: {
                        guard inDirectory(parentTitles), directoryIdentity(parentTitles) == parentIdentity else {
                            changedParent = true
                            return true
                        }
                        guard fileView() != nil else { previous = nil; return false }
                        let current = visibleListing()
                        defer { previous = current }
                        return !current.isEmpty && previous == current
                    }) else { return false }
                    if changedParent {
                        _ = unavailable("A reveal gesture left the exact parent directory for \(item)")
                        return false
                    }
                    if found() { return true }
                    if visibleListing() == before { break } // Native list edge; try the other direction.
                }
            }
            return false
        }
        guard wait("The actual system Files picker must finish presenting", timeout: 20, until: ready) else {
            return app.cells.matching(NSPredicate(value: false)).firstMatch
        }
        var backSteps = 0, usedBrowse = false
        for _ in 0..<12 {
            if inDirectory([folder]) {
                guard reveal(filename, in: [folder], until: { !exactPDFs().isEmpty }) else {
                    return unavailable("The exact PDF was not revealed within the bounded Sources search")
                }
                let matches = exactPDFs()
                guard matches.count == 1, let file = matches.first else {
                    return unavailable("The prepared PDF must identify exactly one native file cell; refusing an ambiguous or EPUB candidate")
                }
                capture("PDF-real-system-source-before-selection")
                return file
            }
            for title in [folder, appFolder] {
                let matches = items([title])
                if matches.count > 1 { return unavailable("The exact task directory \(title) is ambiguous") }
                if let destination = matches.first {
                    destination.tap()
                    guard wait("Files must enter and load the exact task directory \(title)", until: { inDirectory([title]) && fileView() != nil }) else {
                        return app.cells.matching(NSPredicate(value: false)).firstMatch
                    }
                    // Do not inspect a query made before this native transition.
                    break
                }
            }
            if inDirectory([folder]) { continue }
            if inDirectory([appFolder]) {
                guard reveal(folder, in: [appFolder], until: { !items([folder]).isEmpty }) else {
                    return unavailable("The exact Sources folder was not revealed within the bounded task-app search")
                }
                continue
            }
            if inDirectory(deviceNames) {
                guard reveal(appFolder, in: deviceNames, until: { !items([appFolder]).isEmpty }) else {
                    return unavailable("The exact task app was not revealed within the bounded On My iPhone search")
                }
                continue
            }
            let devices = items(deviceNames, filesOnly: false)
            if devices.count > 1 { return unavailable("The native On My iPhone route is ambiguous") }
            if let device = devices.first, !inDirectory(deviceNames) {
                device.tap()
                guard wait("Files must enter the native On My iPhone directory", until: { inDirectory(deviceNames) && fileView() != nil }) else {
                    return app.cells.matching(NSPredicate(value: false)).firstMatch
                }
                continue
            }
            let parent = pickerRoot().navigationBars["FullDocumentManagerViewControllerNavigationBar"].buttons["BackButton"]
            if visible(parent) && backSteps < 6 {
                let before = routeState()
                var previous: [String]?
                parent.tap(); backSteps += 1
                guard wait("The native Back route must finish changing directories", until: {
                    guard ready() else { previous = nil; return false }
                    let current = routeState()
                    guard current != before else { previous = nil; return false }
                    defer { previous = current }
                    // A changed breadcrumb alone may precede replacement of
                    // the provider's cells. Require a settled fresh hierarchy.
                    return previous == current
                }) else {
                    return app.cells.matching(NSPredicate(value: false)).firstMatch
                }
                continue
            }
            let browseTabs = pickerRoot().tabBars.buttons.allElementsBoundByIndex.filter {
                visible($0) && ["浏览", "Browse"].contains($0.label)
            }
            let browse = browseTabs.isEmpty ? items(["浏览", "Browse", "位置", "Locations"], filesOnly: false) : browseTabs
            if !usedBrowse, browse.count == 1, let entry = browse.first {
                entry.tap(); usedBrowse = true
                guard wait("Browse must expose the native device location", until: { !items(deviceNames, filesOnly: false).isEmpty || inDirectory(deviceNames) }) else {
                    return app.cells.matching(NSPredicate(value: false)).firstMatch
                }
                continue
            }
            return unavailable("The actual Files picker has no bounded native route to \(appFolder)/\(folder)/\(filename)")
        }
        return unavailable("Native Files navigation exceeded its bounded route to \(appFolder)/\(folder)/\(filename)")
    }
    /// GET-272 uses a separate task app seeded through the normal OfflineLibrary import service.
    func testQuietChromeEdgesAndTenSecondIdle() {
        let reader = app.textViews["leafhour-epub-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 15), app.debugDescription)
        // Entry tools are intentionally discoverable. Wait for the real idle
        // transition before exercising the asleep page's edge hit region.
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 8))
        let original = reader.value as? String
        reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: min(22, reader.frame.height / 2))).tap()
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["返回书房"], timeout: 3), app.debugDescription)
        capture("GET272-native-top-awake")
        Thread.sleep(forTimeInterval: 10)
        XCTAssertTrue(readerChromeIsAsleep, "Ten-second idle leaves the real grip available and all retained chrome controls noninteractive")
        XCTAssertEqual(reader.value as? String, original)
        capture("GET272-native-idle-ten-seconds")
        reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: reader.frame.height - min(22, reader.frame.height / 2))).tap()
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["目录"], timeout: 3), app.debugDescription)
        capture("GET272-native-bottom-awake")
        reader.swipeUp()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 0.3))
        capture("GET272-native-scroll-asleep")
        let scrolledOriginal = reader.value as? String
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["reader-contents"], timeout: 3), "A scrolled middle tap reveals the compact reading controls")
        XCTAssertEqual(reader.value as? String, scrolledOriginal)
        reader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForReaderChromeAsleep(timeout: 3), "A second middle tap hides the reading controls")
        XCTAssertEqual(reader.value as? String, scrolledOriginal)
        reader.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: reader.frame.width / 2, dy: min(22, reader.frame.height / 2))).tap()
        XCTAssertTrue(waitForReaderControlAwake(app.buttons["返回书房"], timeout: 3), app.debugDescription)
        Thread.sleep(forTimeInterval: 4)
        app.terminate(); app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        XCTAssertTrue(readerControlIsAwake(app.buttons["目录"]))
        capture("GET312-native-cold-resume-tools")
    }

}
