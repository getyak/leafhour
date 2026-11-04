import XCTest
import UIKit
import PDFKit
import LeafhourCore
@testable import Leafhour

/// Real TextKit/PDFKit layout with synthetic files. Physical touch gestures and
/// VoiceOver remain separate device acceptance; these tests do not claim them.
@MainActor final class ReaderBookmarkAppTests: XCTestCase {
    func testPagedTextHasAnIndependentVerticalPanAndPreservesPageAccessibilityActions() async throws {
        let session = try await fixture(), reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onBookmark: { _ in })
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text); coordinator.configureBookmarkGesture(text); coordinator.updateContent(text)
        await settle(); defer { coordinator.invalidate() }
        XCTAssertFalse(text.panGestureRecognizer.isEnabled, "Paged mode continues to suppress the original scroll pan")
        let independent = text.gestureRecognizers?.compactMap { $0 as? UIPanGestureRecognizer }.first { $0 !== text.panGestureRecognizer && $0.delegate is ReaderBookmarkGestureHandler }
        XCTAssertTrue(try XCTUnwrap(independent).isEnabled)
        let names = text.accessibilityCustomActions?.map(\.name) ?? []
        XCTAssertEqual(names.filter { $0 == "添加当前位置书签" }.count, 1)
        XCTAssertTrue(names.contains("下一屏")); XCTAssertTrue(names.contains("上一屏"))
        coordinator.configureNavigation(text)
        XCTAssertEqual(text.accessibilityCustomActions?.filter { $0.name == "添加当前位置书签" }.count, 1)
    }

    func testLongParagraphViewportUsesVisibleScalarRangeAndRevokesOnTeardown() async throws {
        let session = try await fixture()
        var ranges: [ReaderBookmarkVisibleRange] = []
        let reading = TextReadingView(session: session, pageInsets: UIEdgeInsets(top: 40, left: 20, bottom: 40, right: 20), onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onBookmarkViewport: { ranges = $0 })
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text); coordinator.updateContent(text); await settle()
        text.setContentOffset(CGPoint(x: 0, y: 1200), animated: false)
        coordinator.capture(); await settle()
        let anchor = try XCTUnwrap(session.currentAnchor)
        XCTAssertGreaterThan(anchor.characterOffset, 0)
        XCTAssertTrue(ranges.contains { $0.contains(anchor) })
        XCTAssertFalse(ranges.contains { $0.contains(ReadingAnchor(chapterID: anchor.chapterID, passageID: anchor.passageID)) }, "Another page of the same paragraph is not a current-page bookmark")
        coordinator.invalidate(); await settle()
        XCTAssertTrue(ranges.isEmpty)
    }

    func testImageOnlyPDFStillReportsExactBookmarkGeometry() async throws {
        let session = try await fixture(pdf: true)
        var ranges: [ReaderBookmarkVisibleRange] = []
        let reading = PDFReadingView(session: session, pageInsets: .zero, selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {}, onBookmark: { _ in }, onBookmarkViewport: { ranges = $0 })
        let coordinator = reading.makeCoordinator(), pdf = PDFView()
        pdf.autoScales = true; coordinator.view = pdf; host(pdf); coordinator.update(pdf); await settle()
        defer { coordinator.invalidate() }
        let visible = try XCTUnwrap(ranges.first)
        XCTAssertNotNil(visible.start.pageY); XCTAssertNotNil(visible.end.pageY)
        XCTAssertNotEqual(visible.start.pageY, visible.end.pageY)
        XCTAssertEqual(visible.start.passageID, session.chapter.passages.first?.id)
        XCTAssertTrue(pdf.accessibilityCustomActions?.contains { $0.name == "添加当前位置书签" } == true)
    }

    private func fixture(pdf: Bool = false) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("BookmarkApp-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(pdf ? "fixture.pdf" : "fixture.txt")
        if pdf {
            try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 500)).writePDF(to: file) { context in
                context.beginPage(); UIColor.gray.setFill(); context.cgContext.fill(CGRect(x: 20, y: 30, width: 200, height: 350))
            }
        } else { try Data(String(repeating: "Visible original 😀 words preserve their scalar anchor. ", count: 350).utf8).write(to: file) }
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }
    private func host(_ view: UIView) {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 360, height: 430)), controller = UIViewController()
        window.rootViewController = controller; window.makeKeyAndVisible()
        view.frame = controller.view.bounds; controller.view.addSubview(view)
        controller.view.layoutIfNeeded(); view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
    }
    private func settle() async {
        for _ in 0..<6 { await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.main.async { continuation.resume() } } }
    }
}
