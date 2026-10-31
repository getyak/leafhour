import XCTest
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderLayoutTests: XCTestCase {
    private func session(source: String, imageAlternative: String? = nil) async throws -> ReaderSession {
        let fixture = try await importedSession(source: source, imageAlternative: imageAlternative)
        return fixture.session
    }

    private func importedSession(source: String, imageAlternative: String? = nil) async throws -> (session: ReaderSession, library: OfflineLibrary) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let sourceURL = root.appendingPathComponent("reader.txt")
        try Data(source.utf8).write(to: sourceURL)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(sourceURL)
        let directory = try await library.bookDirectory(book.id)
        if let imageAlternative {
            let assets = directory.appendingPathComponent("assets", isDirectory: true)
            try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
            let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
                UIColor.darkGray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
            }
            try XCTUnwrap(image.pngData()).write(to: assets.appendingPathComponent("illustration.png"))
            book.chapters[0].passages[0].text = ""
            book.chapters[0].passages[0].resourcePath = "illustration.png"
            book.chapters[0].passages[0].alternative = imageAlternative
        }
        return (ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: directory, library: library), library)
    }

    private func descendant<T: UIView>(_ type: T.Type, in view: UIView) -> T? {
        if let found = view as? T { return found }
        return view.subviews.lazy.compactMap { self.descendant(type, in: $0) }.first
    }

    private func drainMainQueue() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    private func selectableText(_ session: ReaderSession) async throws -> (UITextView, TextReadingView.Coordinator) {
        let controller = UIViewController(), window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        window.rootViewController = controller; window.makeKeyAndVisible(); controller.view.frame = window.bounds
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        text.frame = controller.view.bounds; text.isEditable = false; text.isSelectable = true
        text.delegate = coordinator; coordinator.view = text; controller.view.addSubview(text)
        coordinator.updateContent(text)
        await drainMainQueue()
        XCTAssertFalse(coordinator.restoring)
        XCTAssertNotNil(text.window)
        text.selectedRange = NSRange(location: 0, length: 5)
        XCTAssertTrue(text.becomeFirstResponder())
        XCTAssertTrue(text.isFirstResponder)
        addTeardownBlock { await MainActor.run {
            coordinator.invalidate(); text.delegate = nil; text.resignFirstResponder()
            window.isHidden = true; window.rootViewController = nil
        } }
        return (text, coordinator)
    }

    func testSelectionDismissalWaitsUntilTheNextMainTurnBeforeClearingAndResigning() async throws {
        let session = try await session(source: "First source paragraph keeps its position.")
        let (text, coordinator) = try await selectableText(session)
        let selection = text.selectedRange, anchor = session.currentAnchor
        coordinator.dismissSelection(in: text, id: UUID())
        XCTAssertEqual(text.selectedRange, selection, "A representable update must not synchronously alter UIKit selection")
        XCTAssertTrue(text.isFirstResponder, "Resigning inside updateUIView can re-enter SwiftUI's active responder graph")
        await drainMainQueue()
        XCTAssertEqual(text.selectedRange, NSRange(location: 0, length: 0))
        XCTAssertFalse(text.isFirstResponder)
        XCTAssertEqual(session.currentAnchor, anchor, "Dismissing selection must not move the source checkpoint")
    }

    func testPendingSelectionDismissalDoesNotClearANewerNativeSelection() async throws {
        let session = try await session(source: "First source paragraph keeps its position.")
        let (text, coordinator) = try await selectableText(session)
        let navigation = session.navigationID, newerSelection = NSRange(location: 6, length: 6)
        coordinator.dismissSelection(in: text, id: UUID())
        text.selectedRange = newerSelection
        await drainMainQueue()
        XCTAssertEqual(session.navigationID, navigation, "Only the native selection changed in this regression")
        XCTAssertEqual(text.selectedRange, newerSelection)
        XCTAssertTrue(text.isFirstResponder, "An old request must not dismiss a newer selection in the same book and navigation")
    }

    func testPendingSelectionDismissalDoesNotResignAfterSourceNavigationEvenWithTheSameRange() async throws {
        let fixture = try await importedSession(source: "First source paragraph keeps its position.\n\nSecond source paragraph remains the chosen destination.")
        let session = fixture.session
        let (text, coordinator) = try await selectableText(session)
        let selection = text.selectedRange, navigation = session.navigationID
        let target = ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[1].id, characterOffset: 2)
        coordinator.dismissSelection(in: text, id: UUID())
        session.go(to: 0, anchor: target)
        XCTAssertNotEqual(session.navigationID, navigation)
        XCTAssertEqual(text.selectedRange, selection, "Keep the range unchanged so it cannot mask a missing navigation guard")
        await drainMainQueue()
        XCTAssertEqual(session.chapterIndex, 0, "A same-chapter source jump isolates navigation identity from the chapter guards")
        XCTAssertEqual(session.currentAnchor, target)
        XCTAssertEqual(text.selectedRange, selection)
        XCTAssertTrue(text.isFirstResponder, "A queued request must not change the new source navigation's responder")
        let receipt = await session.flush()
        XCTAssertTrue(receipt.succeeded)
        XCTAssertNil(session.saveError)
        let saved = try await fixture.library.state(session.book.id)
        XCTAssertEqual(saved.anchor, target, "Verify the valid imported source anchor was actually saved")
    }

    private func host(_ session: ReaderSession, size: CGSize = CGSize(width: 390, height: 844)) async -> UIHostingController<ReaderScreen> {
        let controller = UIHostingController(rootView: ReaderScreen(session: session, systemColorScheme: .light))
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        // SwiftUI completes GeometryReader preferences and representable layout on the next turn.
        try? await Task.sleep(for: .milliseconds(100))
        controller.view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
        return controller
    }

    func testFinalLineCanScrollAboveTheVisibleReadingDock() async throws {
        let paragraphs = (1...60).map { "Paragraph \($0). A book should keep its final line clear of the reading tools." }
        let session = try await session(source: paragraphs.joined(separator: "\n\n"))
        let host = await host(session)
        let text = try XCTUnwrap(descendant(UITextView.self, in: host.view))
        text.layoutManager.ensureLayout(for: text.textContainer)
        text.layoutIfNeeded()
        let lastWord = (text.text as NSString).range(of: "tools.", options: .backwards)
        XCTAssertNotEqual(lastWord.location, NSNotFound)
        let glyphs = text.layoutManager.glyphRange(forCharacterRange: lastWord, actualCharacterRange: nil)
        let line = text.layoutManager.boundingRect(forGlyphRange: glyphs, in: text.textContainer)
        let lastOffset = max(-text.adjustedContentInset.top, text.contentSize.height - text.bounds.height + text.adjustedContentInset.bottom)
        text.setContentOffset(CGPoint(x: 0, y: lastOffset), animated: false)
        let finalLine = text.convert(line.offsetBy(dx: text.textContainerInset.left, dy: text.textContainerInset.top), to: host.view)
        let dock = ReaderBottomBar(mode: .reading, chapterAccessibilityValue: "第 1 章", onContents: {}, onRead: {}, onListen: {}, onAppearance: {}, onTypography: {})
            .frame(width: host.view.bounds.width - 24)
        let dockHeight = try XCTUnwrap(ImageRenderer(content: dock).uiImage).size.height
        // Measure the production controls, whose new compact layout replaces
        // the previous two-row dock. The last source line must clear them.
        XCTAssertGreaterThanOrEqual(dockHeight, 44)
        XCTAssertLessThanOrEqual(finalLine.maxY, host.view.safeAreaLayoutGuide.layoutFrame.maxY - dockHeight - 6)
    }

    func testAdjacentPlainPassagesUseOneTextKitBoundaryAndKeepUnicodeQuoteAndSavedAnchor() async throws {
        let first = "First source.", prefix = "😀 prefix ", selected = "🐿️ e\u{301} source."
        let second = prefix + selected, authoredBreak = "Author line one.\nAuthor line two."
        let following = (1...20).map { "Following paragraph \($0) keeps room below the saved source line." }
        let session = try await session(source: ([first, second, authoredBreak] + following).joined(separator: "\n\n"))
        let passage = session.chapter.passages[1]
        XCTAssertEqual(passage.text, second)
        let savedAnchor = ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id, characterOffset: prefix.unicodeScalars.count)
        session.go(to: 0, anchor: savedAnchor)
        let receipt = await session.flush()
        XCTAssertTrue(session.isCurrent(receipt))
        XCTAssertEqual(session.state.anchor, savedAnchor, "An existing anchor counts source scalars, never rendered separators")

        let controller = UIViewController(), window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        window.rootViewController = controller; window.makeKeyAndVisible(); controller.view.frame = window.bounds
        defer { window.isHidden = true; window.rootViewController = nil }
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        func makeText() -> (UITextView, TextReadingView.Coordinator) {
            let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
            text.frame = controller.view.bounds; text.isEditable = false; text.isSelectable = true
            text.textContainer.lineFragmentPadding = 0; text.contentInsetAdjustmentBehavior = .never
            text.delegate = coordinator; coordinator.view = text; controller.view.addSubview(text)
            coordinator.updateContent(text)
            return (text, coordinator)
        }
        func drain() async {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                DispatchQueue.main.async { continuation.resume() }
            }
        }
        let (text, coordinator) = makeText()
        defer { coordinator.invalidate(); text.delegate = nil }
        await drain()
        text.layoutManager.ensureLayout(for: text.textContainer); text.layoutIfNeeded()
        let firstSpan = try XCTUnwrap(coordinator.spans.first), secondSpan = try XCTUnwrap(coordinator.spans.dropFirst().first)
        let lastFirstCharacter = firstSpan.range.location + first.utf16.count - 1
        let boundary = NSRange(location: lastFirstCharacter, length: secondSpan.range.location - lastFirstCharacter + 1)
        let glyphs = text.layoutManager.glyphRange(forCharacterRange: boundary, actualCharacterRange: nil)
        var boundaryLines: [CGRect] = []
        text.layoutManager.enumerateLineFragments(forGlyphRange: glyphs) { rect, _, _, _, _ in boundaryLines.append(rect) }
        XCTAssertEqual(boundaryLines.count, 2, "Adjacent source paragraphs must have no synthetic empty TextKit line between their actual text lines")
        let authoredSpan = coordinator.spans[2]
        XCTAssertEqual((text.text as NSString).substring(with: NSRange(location: authoredSpan.range.location, length: authoredBreak.utf16.count)), authoredBreak, "Keep author-provided line breaks intact")

        let quoteRange = NSRange(location: secondSpan.range.location + prefix.utf16.count, length: selected.utf16.count)
        text.selectedRange = quoteRange
        XCTAssertTrue(text.becomeFirstResponder())
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: text, range: quoteRange))
        let sourceQuote = try XCTUnwrap(quote.sourceText)
        XCTAssertEqual(quote.text.unicodeScalars.map(\.value), selected.unicodeScalars.map(\.value))
        XCTAssertEqual(sourceQuote.unicodeScalars.map(\.value), selected.unicodeScalars.map(\.value))
        XCTAssertEqual(quote.anchor, savedAnchor, "An earlier surrogate pair must not turn the source scalar offset into a UTF-16 offset")
        XCTAssertTrue(text.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
        text.copy(nil)
        XCTAssertEqual(text.selectedRange, quoteRange)
        text.selectedRange = NSRange(location: 0, length: 0); text.resignFirstResponder()
        coordinator.invalidate(); text.delegate = nil; text.removeFromSuperview()

        session.go(to: 0, anchor: savedAnchor)
        _ = await session.flush()
        let (restored, restoredCoordinator) = makeText()
        defer { restoredCoordinator.invalidate(); restored.delegate = nil }
        await drain()
        restored.layoutManager.ensureLayout(for: restored.textContainer); restored.layoutIfNeeded()
        XCTAssertFalse(restoredCoordinator.restoring)
        XCTAssertEqual(session.currentAnchor, savedAnchor)
        XCTAssertGreaterThan(restored.contentOffset.y, 0, "Restoring must actually move the second passage to the readable top")
        let restoredSpan = try XCTUnwrap(restoredCoordinator.spans.first { $0.passage.id == savedAnchor.passageID })
        let restoredRange = NSRange(location: restoredSpan.range.location + prefix.utf16.count, length: selected.utf16.count)
        let restoredGlyphs = restored.layoutManager.glyphRange(forCharacterRange: NSRange(location: restoredRange.location, length: 1), actualCharacterRange: nil)
        let sourceRect = restored.layoutManager.boundingRect(forGlyphRange: restoredGlyphs, in: restored.textContainer)
            .offsetBy(dx: restored.textContainerInset.left - restored.contentOffset.x, dy: restored.textContainerInset.top - restored.contentOffset.y)
        let viewport = CGRect(x: 0, y: reading.pageInsets.top, width: restored.bounds.width, height: restored.bounds.height - reading.pageInsets.top - reading.pageInsets.bottom)
        XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(sourceRect), "The saved source glyphs must physically return inside the readable viewport")
        XCTAssertTrue(restoredCoordinator.checkpointVisible())
        XCTAssertEqual(session.currentAnchor?.passageID, passage.id)
        XCTAssertLessThanOrEqual(try XCTUnwrap(session.currentAnchor?.characterOffset), savedAnchor.characterOffset)
        XCTAssertEqual(restoredCoordinator.selectedQuote(in: restored, range: restoredRange)?.sourceText, selected)
        _ = await session.flush()
    }

    func testCrossParagraphSelectionDisablesEveryAnchoredActionButKeepsCopy() async throws {
        let session = try await session(source: "First paragraph.\n\nSecond paragraph.")
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onExplain: { _ in }, onWake: { _ in }, onReadingScroll: {}, onTranslate: { _ in })
        let coordinator = reading.makeCoordinator()
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = text
        coordinator.updateContent(text)
        let first = (text.text as NSString).range(of: "First paragraph.")
        let second = (text.text as NSString).range(of: "Second paragraph.")
        let crossing = NSRange(location: first.location, length: NSMaxRange(second) - first.location)
        let copy = UIAction(title: "Copy", identifier: UIAction.Identifier("copy-fixture")) { _ in }
        let menu = try XCTUnwrap(coordinator.textView(text, editMenuForTextIn: crossing, suggestedActions: [copy]))
        let actions = self.actions(in: menu)
        for title in ["解释这句", "记笔记", "核对原文", "查看译文"] {
            let action = try XCTUnwrap(actions.first { $0.title == title }, title)
            XCTAssertTrue(action.attributes.contains(.disabled), "\(title) must not accept a quote crossing stable passage anchors")
        }
        XCTAssertTrue(actions.contains { $0 === copy })
        XCTAssertFalse(copy.attributes.contains(.disabled), "Copy remains a normal system selection action")
        XCTAssertTrue(actions.first === copy, "Cross-paragraph copying must stay ahead of unavailable anchored actions")
    }

    func testSystemEditingStaysAheadOfOptionalReadingActionsWithoutReplacingCopy() async throws {
        let session = try await session(source: "First paragraph.")
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onExplain: { _ in }, onWake: { _ in }, onReadingScroll: {}, onTranslate: { _ in })
        let coordinator = reading.makeCoordinator()
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = text; coordinator.updateContent(text)
        let copy = UIAction(title: "Copy") { _ in }
        let editing = UIMenu(title: "", identifier: .standardEdit, options: .displayInline, children: [copy])
        let lookup = UIAction(title: "Look Up") { _ in }
        let menu = try XCTUnwrap(coordinator.textView(text, editMenuForTextIn: NSRange(location: 0, length: 5), suggestedActions: [lookup, editing]))
        XCTAssertTrue(menu.children.first === editing)
        XCTAssertTrue(actions(in: menu).first === copy)
        XCTAssertTrue(actions(in: menu).contains { $0.title == "记笔记" })
        XCTAssertTrue(actions(in: menu).last === lookup)
    }

    func testSingleParagraphSelectionKeepsAllAnchoredActionsAvailable() async throws {
        let session = try await session(source: "First paragraph.\n\nSecond paragraph.")
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onExplain: { _ in }, onWake: { _ in }, onReadingScroll: {}, onTranslate: { _ in })
        let coordinator = reading.makeCoordinator()
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = text
        coordinator.updateContent(text)
        let range = (text.text as NSString).range(of: "Second paragraph.")
        let menu = try XCTUnwrap(coordinator.textView(text, editMenuForTextIn: range, suggestedActions: []))
        let actions = self.actions(in: menu)
        XCTAssertEqual(actions.count, 4)
        XCTAssertTrue(actions.allSatisfy { !$0.attributes.contains(.disabled) })
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: text, range: range))
        XCTAssertEqual(quote.text, "Second paragraph.")
        XCTAssertEqual(quote.anchor.passageID, session.chapter.passages.last?.id)
    }

    func testTextColumnStaysReadableAndCenteredOnWideScreens() async throws {
        let session = try await session(source: "A quiet page should remain a readable column when the window gets wider.")
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        for (width, expectedColumn) in [(390.0, 342.0), (768.0, 680.0), (1024.0, 680.0), (1366.0, 680.0)] {
            let coordinator = reading.makeCoordinator()
            let text = UITextView(frame: CGRect(x: 0, y: 0, width: width, height: 768))
            coordinator.view = text
            coordinator.updateContent(text)
            let column = text.bounds.width - text.textContainerInset.left - text.textContainerInset.right
            XCTAssertEqual(column, expectedColumn, accuracy: 1, "Readable column at \(width) pt")
            XCTAssertEqual(text.textContainerInset.left, text.textContainerInset.right, accuracy: 1)
        }
    }

    func testWideningTextKeepsSelectionAndVisiblePassageCheckpoint() async throws {
        let paragraphs = (1...60).map { "Paragraph \($0). This passage has enough words to reflow between phone and tablet widths." }
        let session = try await session(source: paragraphs.joined(separator: "\n\n"))
        let passage = session.chapter.passages[29]
        let anchor = ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id, characterOffset: 3)
        session.go(to: 0, anchor: anchor)
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator()
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = text
        coordinator.updateContent(text)
        try await Task.sleep(for: .milliseconds(100))
        let range = (text.text as NSString).range(of: passage.text)
        text.selectedRange = range
        let selected = try XCTUnwrap(coordinator.selectedQuote(in: text, range: range))

        text.frame.size.width = 1024
        coordinator.updateContent(text)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(text.selectedRange, range)
        XCTAssertEqual(coordinator.selectedQuote(in: text, range: text.selectedRange)?.sourceText, selected.sourceText)
        XCTAssertEqual(session.currentAnchor, anchor)
        XCTAssertTrue(coordinator.checkpointVisible(), "The centered column must still accept its scroll checkpoint after reflow")
        XCTAssertEqual(session.currentAnchor?.passageID, passage.id)
    }

    func testIllustrationDescriptionIsReadableWithoutBecomingAnAuthorQuote() async throws {
        let description = "一只松鼠坐在树枝上。"
        let source = "The next paragraph remains the author's text."
        let session = try await session(source: "Image placeholder.\n\n" + source, imageAlternative: description)
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator()
        let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        coordinator.view = text
        coordinator.updateContent(text)
        XCTAssertNotNil(text.attributedText.attribute(.attachment, at: 0, effectiveRange: nil), "The real illustration remains displayed")
        let descriptionRange = (text.text as NSString).range(of: description)
        XCTAssertNotEqual(descriptionRange.location, NSNotFound, "System reading and selection can reach the source-provided image description")
        XCTAssertNil(coordinator.selectedQuote(in: text, range: descriptionRange), "Illustration metadata must not acquire a fabricated author-text anchor")
        XCTAssertEqual(session.chapter.passages[0].text, "")
        let authorRange = (text.text as NSString).range(of: source)
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: text, range: authorRange))
        XCTAssertEqual(quote.text, source)
        XCTAssertEqual(quote.anchor.passageID, session.chapter.passages[1].id)
    }

    func testIllustrationDescriptionDoesNotRepeatTheFollowingCaptionOrInventMissingText() async throws {
        for alternative in ["", "Source caption."] {
            let session = try await session(source: "Image placeholder.\n\nSource caption.", imageAlternative: alternative)
            let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
            let coordinator = reading.makeCoordinator()
            let text = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
            coordinator.view = text
            coordinator.updateContent(text)
            let prose = text.text.replacingOccurrences(of: "\u{fffc}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertEqual(prose, "Source caption.")
        }
    }

    private func sourceInkPixels(_ image: UIImage, in rect: CGRect) throws -> Int {
        let cgImage = try XCTUnwrap(image.cgImage), bytes = try XCTUnwrap(cgImage.dataProvider?.data)
        let data = try XCTUnwrap(CFDataGetBytePtr(bytes))
        let clipped = rect.integral.intersection(CGRect(x: 0, y: 0, width: CGFloat(cgImage.width), height: CGFloat(cgImage.height)))
        guard !clipped.isNull, !clipped.isEmpty else { return 0 }
        var count = 0
        for y in Int(clipped.minY)..<Int(clipped.maxY) {
            for x in Int(clipped.minX)..<Int(clipped.maxX) {
                let offset = y * cgImage.bytesPerRow + x * (cgImage.bitsPerPixel / 8)
                if min(data[offset], data[offset + 1], data[offset + 2]) < 180 { count += 1 }
            }
        }
        return count
    }

    private func settleBudgetHost(_ host: UIHostingController<ReaderScreen>) async {
        host.view.setNeedsLayout(); host.view.layoutIfNeeded()
        try? await Task.sleep(for: .milliseconds(120))
        host.view.layoutIfNeeded()
        await drainMainQueue()
    }

    private func budgetHost(_ session: ReaderSession, size: CGSize, category: UIContentSizeCategory) async -> (UIWindow, UIHostingController<ReaderScreen>) {
        let host = UIHostingController(rootView: ReaderScreen(session: session, systemColorScheme: .light))
        // Override the actual UIKit trait environment, not only SwiftUI's
        // dynamicTypeSize. UIFontMetrics and real TextKit must see AX5 too.
        host.traitOverrides.preferredContentSizeCategory = category
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.overrideUserInterfaceStyle = .light
        window.rootViewController = host; window.makeKeyAndVisible()
        host.view.frame = window.bounds
        await settleBudgetHost(host)
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
        return (window, host)
    }

    @discardableResult
    private func assertRealPagedBody(_ host: UIHostingController<ReaderScreen>, window: UIWindow, stage: String,
                                     awake: Bool = true, file: StaticString = #filePath, line: UInt = #line) throws -> ReflowTextView {
        let text = try XCTUnwrap(descendant(ReflowTextView.self, in: host.view), stage, file: file, line: line)
        XCTAssertEqual(text.traitCollection.preferredContentSizeCategory, host.traitCollection.preferredContentSizeCategory, stage, file: file, line: line)
        text.layoutManager.ensureLayout(for: text.textContainer); text.layoutIfNeeded()
        let body = try XCTUnwrap(text.visibleReadingRect, "Measure the actual paged ink viewport: " + stage, file: file, line: line)
        XCTAssertGreaterThan(body.height, 0, "All source ink was clipped away: " + stage, file: file, line: line)
        var fullSourceLines: [CGRect] = []
        text.layoutManager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: text.layoutManager.numberOfGlyphs)) { _, used, _, glyphs, _ in
            guard glyphs.length > 0, used.height > 0, used.width > 0 else { return }
            let actualLine = used.offsetBy(dx: text.textContainerInset.left, dy: text.textContainerInset.top)
            if body.insetBy(dx: -0.5, dy: -0.5).contains(actualLine) { fullSourceLines.append(actualLine) }
        }
        XCTAssertFalse(fullSourceLines.isEmpty, "The actual OS-scaled TextKit source must fit at least one whole line: " + stage, file: file, line: line)
        guard text.attributedText.length > 0 else { XCTFail("No real source text: " + stage, file: file, line: line); return text }
        let firstFont = try XCTUnwrap(text.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont, file: file, line: line)
        let expectedFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: host.rootView.session.state.preferences.fontSize), compatibleWith: text.traitCollection)
        XCTAssertEqual(firstFont.pointSize, expectedFont.pointSize, accuracy: 0.5, "Keep the real system text size instead of shrinking to pass: " + stage, file: file, line: line)
        // Tools are transient overlays in compact horizontal reading. Sample
        // the middle source line rather than ink behind an awake toolbar.
        if let sourceLine = fullSourceLines.isEmpty ? nil : fullSourceLines[fullSourceLines.count / 2] {
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true; format.preferredRange = .standard
            let image = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: CGRect(origin: .zero, size: host.view.bounds.size), afterScreenUpdates: true), stage, file: file, line: line)
            }
            let actualLine = text.convert(sourceLine, to: host.view)
            XCTAssertGreaterThan(try sourceInkPixels(image, in: actualLine), 5, "The geometrically complete source line must actually draw readable ink: " + stage, file: file, line: line)
            let screenshot = XCTAttachment(image: image); screenshot.name = "Real reader viewport · " + stage
            screenshot.lifetime = .keepAlways; add(screenshot)
        }
        // SwiftUI's in-process public AX containers do not vend a complete
        // automation tree. Real 44pt buttons, all actions and overlay separation
        // remain Native UI40/UI57 responsibilities; do not turn an empty walk
        // into either a product failure or a vacuous control-accessibility pass.
        let attachment = XCTAttachment(string: "Stage: " + stage + "\nOS category: " + text.traitCollection.preferredContentSizeCategory.rawValue
            + "\nText bounds: " + String(describing: text.bounds) + "\nActual body: " + String(describing: body)
            + "\nContainer insets: " + String(describing: text.textContainerInset) + "\nActual font pt: " + String(describing: firstFont.pointSize)
            + "\nWhole source lines: " + String(fullSourceLines.count) + "\nChrome expected: " + (awake ? "awake" : "asleep")
            + "\nActual host window: " + String(describing: window.bounds)
            + "\n44pt/control reachability gate: pending real Native UI40/UI57, not claimed by this layout test")
        attachment.name = "Actual paged source budget · " + stage; attachment.lifetime = .keepAlways
        add(attachment)
        return text
    }

    func testAX5RealPagedReaderKeepsAWholeSourceLineWithAwakeChromeInPortraitAndShortLandscape() async throws {
        // Cover both the default and the largest legitimate in-app settings.
        // The view-trait font oracle below follows each actual base size.
        for settings in [(font: 22.0, spacing: 9.0), (font: 36.0, spacing: 18.0)] {
            for size in [CGSize(width: 402, height: 780), CGSize(width: 874, height: 340)] {
                let source = (1...45).map { "Original paragraph \($0). The actual system font and measured reader controls must leave at least one complete source line visible." }.joined(separator: "\n\n")
                let session = try await session(source: source)
                session.state.preferences.fontSize = settings.font
                session.state.preferences.lineSpacing = settings.spacing
                session.state.preferences.navigationMode = .paged
                let (window, host) = await budgetHost(session, size: size, category: .accessibilityExtraExtraExtraLarge)
                XCTAssertEqual(host.view.bounds.size, size, "The probe must exercise the requested real hosting geometry")
                XCTAssertEqual(host.traitCollection.preferredContentSizeCategory, .accessibilityExtraExtraExtraLarge)
                _ = try assertRealPagedBody(host, window: window, stage: "AX5 \(size), base \(settings.font), spacing \(settings.spacing)")
                let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded); XCTAssertTrue(session.isCurrent(receipt))
                window.isHidden = true; window.rootViewController = nil
            }
        }
    }

    func testRealReaderBudgetUpdatesAcrossResizeAndOSTypeButChromeWakeKeepsItsSource() async throws {
        let source = (1...60).map { "Original paragraph \($0). Source identity survives real window and system typography changes while reading tools stay separate from the book." }.joined(separator: "\n\n")
        let session = try await session(source: source)
        session.state.preferences.navigationMode = .paged
        let target = ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[14].id)
        session.go(to: 0, anchor: target)
        let (window, host) = await budgetHost(session, size: CGSize(width: 402, height: 780), category: .accessibilityExtraExtraExtraLarge)
        let profiles: [(CGSize, UIContentSizeCategory)] = [
            (CGSize(width: 402, height: 780), .accessibilityExtraExtraExtraLarge),
            (CGSize(width: 874, height: 340), .accessibilityExtraExtraExtraLarge),
            (CGSize(width: 874, height: 340), .large),
            (CGSize(width: 402, height: 780), .accessibilityExtraExtraExtraLarge)
        ]
        for (size, category) in profiles {
            window.frame = CGRect(origin: .zero, size: size); host.view.frame = window.bounds
            host.traitOverrides.preferredContentSizeCategory = category
            await settleBudgetHost(host)
            let text = try assertRealPagedBody(host, window: window, stage: "resized \(size), \(category.rawValue)")
            XCTAssertEqual(session.currentAnchor?.passageID, target.passageID, "A responsive chrome budget cannot move to another source paragraph")
            XCTAssertEqual(text.textContainerInset.top, 16, accuracy: 0.5, "Paged reading does not reserve the sleeping header")
            XCTAssertEqual(text.textContainerInset.bottom, 28, accuracy: 0.5, "Paged reading does not reserve the sleeping dock")
            let offset = text.contentOffset, insets = text.textContainerInset, anchor = session.currentAnchor
            let coordinator = try XCTUnwrap(text.delegate as? TextReadingView.Coordinator)
            // Exercise the same production callback used by a real page tap;
            // this regression targets layout, not gesture recognition itself.
            coordinator.parent.onWake(.tools)
            await settleBudgetHost(host)
            _ = try assertRealPagedBody(host, window: window, stage: "asleep \(size)", awake: false)
            XCTAssertEqual(text.contentOffset.y, offset.y, accuracy: 0.5)
            XCTAssertEqual(text.textContainerInset, insets)
            XCTAssertEqual(session.currentAnchor, anchor)
            coordinator.parent.onWake(.tools)
            await settleBudgetHost(host)
            _ = try assertRealPagedBody(host, window: window, stage: "awake again \(size)")
            XCTAssertEqual(text.contentOffset.y, offset.y, accuracy: 0.5)
            XCTAssertEqual(text.textContainerInset, insets)
            XCTAssertEqual(session.currentAnchor, anchor)
        }
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded); XCTAssertTrue(session.isCurrent(receipt))
    }

    func testStandardPagedMarginsUseMeasuredChromeWithoutBlanketPortraitReserves() async throws {
        let source = (1...40).map { "Original paragraph \($0) keeps enough source to measure real paged reading space." }.joined(separator: "\n\n")
        let session = try await session(source: source)
        session.state.preferences.navigationMode = .paged
        let (window, host) = await budgetHost(session, size: CGSize(width: 402, height: 780), category: .large)
        let text = try assertRealPagedBody(host, window: window, stage: "GET341 standard measured margins")
        XCTAssertLessThanOrEqual(text.textContainerInset.top, 52.5, "A standard 44pt header needs only an 8pt source gap inside the existing safe area")
        XCTAssertLessThan(text.textContainerInset.bottom, 110, "Use the actual compact dock and caption rather than a 100pt floor plus 24pt padding")
        let offset = text.contentOffset, insets = text.textContainerInset, anchor = session.currentAnchor
        let coordinator = try XCTUnwrap(text.delegate as? TextReadingView.Coordinator)
        coordinator.parent.onWake(.tools)
        await settleBudgetHost(host)
        XCTAssertEqual(text.textContainerInset, insets)
        XCTAssertEqual(text.contentOffset, offset)
        XCTAssertEqual(session.currentAnchor, anchor)
    }

    private func actions(in menu: UIMenu) -> [UIAction] {
        menu.children.flatMap { element -> [UIAction] in
            if let action = element as? UIAction { return [action] }
            if let submenu = element as? UIMenu { return self.actions(in: submenu) }
            return []
        }
    }
}
