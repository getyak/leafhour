import XCTest
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderLayoutTests: XCTestCase {
    private func session(source: String, imageAlternative: String? = nil) async throws -> ReaderSession {
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
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: directory, library: library)
    }

    private func descendant<T: UIView>(_ type: T.Type, in view: UIView) -> T? {
        if let found = view as? T { return found }
        return view.subviews.lazy.compactMap { self.descendant(type, in: $0) }.first
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

    private func actions(in menu: UIMenu) -> [UIAction] {
        menu.children.flatMap { element -> [UIAction] in
            if let action = element as? UIAction { return [action] }
            if let submenu = element as? UIMenu { return self.actions(in: submenu) }
            return []
        }
    }
}
