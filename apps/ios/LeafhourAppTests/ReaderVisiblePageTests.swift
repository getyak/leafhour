import XCTest
import UIKit
import PDFKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderVisiblePageTests: XCTestCase {
    private func session(filename: String = "page.txt", write: ((URL) throws -> Void)? = nil) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let original = root.appendingPathComponent(filename)
        if let write { try write(original) }
        else { try Data((1...8).map { "Paragraph \($0). " + String(repeating: "Complete synthetic source words. ", count: 10) }.joined(separator: "\n\n").utf8).write(to: original) }
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(original)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }
    private func host(_ view: UIView, size: CGSize = CGSize(width: 360, height: 430)) {
        let window = UIWindow(frame: CGRect(origin: .zero, size: size)), controller = UIViewController()
        window.rootViewController = controller; window.makeKeyAndVisible()
        view.frame = controller.view.bounds; controller.view.addSubview(view)
        controller.view.layoutIfNeeded(); view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
    }
    private func settle() async {
        for _ in 0..<5 { await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.main.async { continuation.resume() } } }
    }

    func testSnapshotRejectsNavigationSettingsAnotherSessionAndInvalidatedLayout() async throws {
        let session = try await session(), layout = ReaderVisiblePageLayout()
        let ids = Array(session.chapter.passages.prefix(2).map(\.id))
        let snapshot = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids, layout: layout))
        XCTAssertTrue(snapshot.isCurrent(session)); XCTAssertEqual(snapshot.passageIDs, ids)
        XCTAssertNil(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids + ids, layout: layout))
        XCTAssertNil(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ["unknown"], layout: layout))
        session.navigationID = UUID(); XCTAssertFalse(snapshot.isCurrent(session))
        let current = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids, layout: layout))
        session.state.preferences.fontSize += 2; XCTAssertFalse(current.isCurrent(session))
        let languagePage = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids, layout: layout))
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .ja))
        XCTAssertFalse(languagePage.isCurrent(session))
        let last = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids, layout: layout))
        layout.invalidate(); XCTAssertFalse(last.isCurrent(session))
        let refreshed = try XCTUnwrap(ReaderVisiblePage(session: session, chapterID: session.chapter.id, passageIDs: ids, layout: layout))
        let other = ReaderSession(book: session.book, state: session.state, original: session.original, directory: session.directory, library: try OfflineLibrary(root: session.directory.appendingPathComponent("isolated"), scope: .device))
        XCTAssertFalse(refreshed.isCurrent(other))
    }

    func testTextPageIncludesPartialBoundaryParagraphAndExcludesOffscreenSource() async throws {
        let session = try await session()
        let insets = UIEdgeInsets(top: 40, left: 20, bottom: 50, right: 20)
        var events: [ReaderVisiblePage?] = []
        let reading = TextReadingView(session: session, pageInsets: insets, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onVisiblePage: { events.append($0) })
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text); coordinator.updateContent(text); await settle()
        defer { coordinator.invalidate() }
        let first = try XCTUnwrap(coordinator.spans.first)
        text.layoutManager.ensureLayout(for: text.textContainer)
        let glyphs = text.layoutManager.glyphRange(forCharacterRange: first.range, actualCharacterRange: nil)
        let sourceRect = text.layoutManager.boundingRect(forGlyphRange: glyphs, in: text.textContainer)
        text.setContentOffset(CGPoint(x: 0, y: sourceRect.maxY + text.textContainerInset.top - insets.top - 12), animated: false)
        coordinator.capture(); await settle()
        let page = try XCTUnwrap(coordinator.visiblePage())
        XCTAssertEqual(page.passageIDs, Array(session.chapter.passages.prefix(2).map(\.id)))
        XCTAssertTrue(page.isCurrent(session))
        XCTAssertFalse(page.passageIDs.contains(session.chapter.passages[2].id))
        text.frame.size.width = 500; coordinator.updateContent(text)
        XCTAssertFalse(page.isCurrent(session), "A resized viewport invalidates previously captured page scope immediately")
        await settle(); coordinator.invalidate()
        await settle()
        XCTAssertNil(events.last ?? nil, "Teardown clears the consumer's page scope")
    }

    func testParallelTextCollapsesSourceAndTranslationIntoOneSourceID() async throws {
        let session = try await session()
        session.state.preferences.viewMode = .parallel
        let passage = session.chapter.passages[0]
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: "Short literal.", interpretive: "Short interpretation.")])
        let reading = TextReadingView(session: session, pageInsets: UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20), onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text, size: CGSize(width: 360, height: 700)); coordinator.updateContent(text); await settle()
        defer { coordinator.invalidate() }
        let page = try XCTUnwrap(coordinator.visiblePage())
        XCTAssertEqual(page.passageIDs.first, passage.id)
        XCTAssertEqual(page.passageIDs.filter { $0 == passage.id }.count, 1)
        XCTAssertEqual(Set(page.passageIDs).count, page.passageIDs.count)
    }

    func testPDFSnapshotUsesOnlyCurrentOriginalPageAndImageOnlyIsUnavailable() async throws {
        let session = try await session(filename: "pages.pdf") { url in
            try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 500)).writePDF(to: url) { context in
                context.beginPage(); ("Synthetic source on original page." as NSString).draw(at: CGPoint(x: 30, y: 30), withAttributes: [.font: UIFont.systemFont(ofSize: 16)])
                context.beginPage(); UIColor.gray.setFill(); context.cgContext.fill(CGRect(x: 20, y: 20, width: 100, height: 100))
            }
        }
        let reading = PDFReadingView(session: session, pageInsets: .zero, selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator(), pdf = PDFView()
        pdf.autoScales = true; coordinator.view = pdf; host(pdf); coordinator.update(pdf); await settle()
        defer { coordinator.invalidate() }
        let page = try XCTUnwrap(coordinator.visiblePage())
        XCTAssertEqual(page.passageIDs, [session.book.chapters[0].passages[0].id])
        session.go(to: 1); coordinator.update(pdf); await settle()
        XCTAssertFalse(page.isCurrent(session))
        XCTAssertNil(coordinator.visiblePage(), "An image-only page cannot borrow text from an adjacent original page")
    }
}
