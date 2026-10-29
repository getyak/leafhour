import XCTest
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderLayoutTests: XCTestCase {
    private func session(source: String) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let sourceURL = root.appendingPathComponent("reader.txt")
        try Data(source.utf8).write(to: sourceURL)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(sourceURL)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
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
        // The initial dock contains the chapter controls and a second row of tools.
        // Reserving only the ordinary 24 pt page margin leaves this line behind that dock.
        XCTAssertLessThanOrEqual(finalLine.maxY, host.view.safeAreaLayoutGuide.layoutFrame.maxY - 130)
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

    private func actions(in menu: UIMenu) -> [UIAction] {
        menu.children.flatMap { element -> [UIAction] in
            if let action = element as? UIAction { return [action] }
            if let submenu = element as? UIMenu { return self.actions(in: submenu) }
            return []
        }
    }
}
