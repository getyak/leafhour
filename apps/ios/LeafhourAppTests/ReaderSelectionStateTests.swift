import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderSelectionStateTests: XCTestCase {
    private func drain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.main.async { continuation.resume() } }
    }
    func testNativeSelectionAndClearingPublishAccurateTransientContext() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("selection.txt")
        try Data("First quiet paragraph.\n\nSecond quiet paragraph.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        var quote: SelectedQuote?, active = false
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onSelectionChange: { quote = $0; active = $1 })
        let coordinator = reading.makeCoordinator()
        let view = UITextView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), textContainer: nil)
        view.delegate = coordinator; coordinator.view = view; coordinator.updateContent(view)
        await drain()
        view.selectedRange = (view.text as NSString).range(of: "quiet")
        coordinator.textViewDidChangeSelection(view)
        await drain()
        XCTAssertTrue(active)
        XCTAssertEqual(quote?.text, "quiet")
        XCTAssertEqual(quote?.anchor.passageID, book.chapters[0].passages[0].id)
        view.selectedRange = NSRange(location: 0, length: view.text.utf16.count)
        coordinator.textViewDidChangeSelection(view)
        await drain()
        XCTAssertTrue(active, "Cross-paragraph selection still needs its native Copy menu")
        XCTAssertNil(quote, "An invalid anchored selection must not become an author quote")
        view.selectedRange = NSRange(location: 0, length: 0)
        coordinator.textViewDidChangeSelection(view)
        await drain()
        XCTAssertFalse(active)
        XCTAssertNil(quote)
        XCTAssertTrue(session.state.notes.isEmpty)
        XCTAssertTrue(session.state.drafts.isEmpty)
        coordinator.invalidate(); view.delegate = nil
    }
    func testParagraphSelectionKeepsViewportAndExactUnicodeSource() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = "First line 🌿 contains e\u{301} and a second sentence."
        let file = root.appendingPathComponent("paragraph.txt")
        try Data((source + "\n\nAnother paragraph remains separate.").utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator(), view = ReflowTextView()
        view.frame = CGRect(x: 0, y: 0, width: 390, height: 700); coordinator.view = view; view.delegate = coordinator
        coordinator.updateContent(view); await drain()
        let offset = view.contentOffset, anchor = session.currentAnchor
        let word = (view.text as NSString).range(of: "contains")
        XCTAssertTrue(coordinator.selectParagraph(containing: word))
        XCTAssertEqual((view.text as NSString).substring(with: view.selectedRange), source)
        XCTAssertEqual(coordinator.selectedQuote(in: view, range: view.selectedRange)?.sourceText, source)
        XCTAssertEqual(view.contentOffset, offset)
        XCTAssertEqual(session.currentAnchor, anchor)
        coordinator.invalidate(); view.delegate = nil
    }

    func testSpeechPaintAndFollowingPreserveTheAttributedSourceAndNativeSelection() throws {
        for paged in [false, true] {
            let view = ReflowTextView()
            view.frame = CGRect(x: 0, y: 0, width: 390, height: 600)
            view.textContainerInset = UIEdgeInsets(top: 16, left: 22, bottom: 44, right: 22)
            view.textContainer.lineFragmentPadding = 0
            let source = "Sentence starts. " + (1...250).map { "witness\($0)" }.joined(separator: " ") + "."
            let original = NSAttributedString(string: source, attributes: [.font: UIFont.systemFont(ofSize: 22)])
            view.attributedText = original; view.layoutManager.ensureLayout(for: view.textContainer); view.layoutIfNeeded()
            let word = (source as NSString).range(of: "witness180")
            let sentence = NSRange(location: 0, length: source.utf16.count)
            let follower = ReaderSpeechTextFollower()
            let pages = paged ? ReaderTextPagination(textView: view, readingTop: 16, bottomInset: 44) : nil
            let viewport = CGRect(x: 0, y: 16, width: 390, height: 540)
            follower.apply(to: view, target: ReaderSpeechTextTarget(sentence: sentence, word: word), following: true, viewport: viewport, pages: pages)
            XCTAssertTrue(view.attributedText.isEqual(to: original))
            XCTAssertEqual((view.layoutManager as? ReaderSpeechPaintingLayout)?.speechHighlightRange, sentence)
            XCTAssertGreaterThan(view.contentOffset.y, 0, "Follow the currently spoken word inside a sentence taller than a screen")
            view.selectedRange = NSRange(location: 0, length: 8)
            let offset = view.contentOffset
            follower.apply(to: view, target: ReaderSpeechTextTarget(sentence: sentence, word: word), following: true, viewport: viewport, pages: pages)
            XCTAssertEqual(view.selectedRange, NSRange(location: 0, length: 8))
            XCTAssertEqual(view.contentOffset, offset, "Speech must not pull a live native selection away")
            follower.apply(to: view, target: nil, following: false, viewport: viewport, pages: pages)
            XCTAssertNil((view.layoutManager as? ReaderSpeechPaintingLayout)?.speechHighlightRange)
        }
    }

    func testPDFExtractedParagraphKeepsWrappedLinesWithinItsBlankLineBoundary() throws {
        let text = "First line.\nContinued line.\n\nSecond block."
        let range = try XCTUnwrap(ReaderParagraphSelectionObserver.pdfParagraph(in: text, containing: (text as NSString).range(of: "Continued")))
        XCTAssertEqual((text as NSString).substring(with: range), "First line.\nContinued line.")
    }

}
