import XCTest
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor final class ReaderDisplayTranslationTests: XCTestCase {
    private func fixture() async throws -> (ReaderSession, UITextView, TextReadingView.Coordinator) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("reader.txt"); try Data("Original 😀 author paragraph.".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        book.cloud = CloudBookIdentity(ownerID: "owner", bookID: "book", contentVersion: "v1", sourceFormat: "txt")
        let state = try await library.state(book.id)
        let session = ReaderSession(book: book, state: state, original: file, directory: root, library: library)
        let component = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = component.makeCoordinator(), view = ReflowTextView()
        view.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        view.textContainer.lineFragmentPadding = 0
        coordinator.view = view
        addTeardownBlock { await MainActor.run { coordinator.invalidate() } }
        return (session, view, coordinator)
    }
    private func publish(_ session: ReaderSession, text: String) {
        let passage = session.chapter.passages[0]
        _ = session.adoptTranslation(.object(["id":.string(passage.id),"original":.string(passage.text),"translations":.object([
            "literal":.object(["text":.string("直译：" + text),"status":.string("draft"),"sourceVersion":.string("v1")]),
            "interpretive":.object(["text":.string(text),"status":.string("draft"),"sourceVersion":.string("v1")])])]), contentVersion:"v1")
    }
    private func drain() async { await withCheckedContinuation { c in DispatchQueue.main.async { c.resume() } } }

    func testTranslationRenderingKeepsASeparateSourceQuoteAndLayer() async throws {
        let (session, view, coordinator) = try await fixture()
        publish(session, text: "译文保持自己的位置。")
        coordinator.updateContent(view); await drain()
        XCTAssertTrue(view.text.contains("译文保持自己的位置。"))
        XCTAssertFalse(view.text.contains("Original 😀 author paragraph."))
        let range = (view.text as NSString).range(of: "译文保持")
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: view, range: range))
        XCTAssertEqual(quote.text, "译文保持")
        XCTAssertEqual(quote.sourceText, "Original 😀 author paragraph.")
        XCTAssertEqual(quote.origin, "translation")
        XCTAssertEqual(quote.language, "zh")
        XCTAssertEqual(quote.anchor.characterOffset, 0)
        XCTAssertEqual(quote.anchor.translationOffset, 0)
    }

    func testAutomaticReceiptDoesNotReplaceAnActiveSourceSelection() async throws {
        let (session, view, coordinator) = try await fixture()
        coordinator.updateContent(view); await drain()
        view.selectedRange = NSRange(location: 0, length: 8)
        let source = view.text, selection = view.selectedRange
        publish(session, text: "自动到达的译文。")
        coordinator.updateContent(view); await drain()
        XCTAssertEqual(view.text, source)
        XCTAssertEqual(view.selectedRange, selection)
        view.selectedRange = NSRange(location: 0, length: 0)
        coordinator.updateContent(view); await drain()
        XCTAssertTrue(view.text.contains("自动到达的译文。"))
    }

    func testTranslationReflowRetainsItsCanonicalLayerAnchor() async throws {
        let (session, view, coordinator) = try await fixture()
        publish(session, text: String(repeating: "宽度变化仍应继续同一段。", count: 80))
        var anchor = ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[0].id)
        anchor.translationOffset = 180; anchor.translationVariant = .interpretive
        anchor.translationVersion = session.translations[anchor.passageID]?[.interpretive]?.displayVersion
        session.go(to: 0, anchor: anchor)
        coordinator.updateContent(view); await drain()
        view.frame.size.width = 760
        coordinator.updateContent(view); await drain()
        XCTAssertEqual(session.currentAnchor, anchor)
        XCTAssertGreaterThan(view.contentOffset.y, 0)
    }
}
