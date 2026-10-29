import XCTest
import UIKit
import PDFKit
import LeafhourCore
@testable import Leafhour

/// Native layout contracts, using synthetic files imported through the real library.
/// These tests do not exercise a real account, model, or physical device.
@MainActor
final class ReaderViewportTests: XCTestCase {
    private func session(filename: String, write: (URL) throws -> Void) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent(filename)
        try write(source)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library", isDirectory: true), scope: .device)
        let book = try await library.importFile(source)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }

    private func host(_ view: UIView, size: CGSize = CGSize(width: 390, height: 700)) -> UIView {
        let controller = UIViewController()
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        view.frame = controller.view.bounds
        controller.view.addSubview(view)
        controller.view.layoutIfNeeded()
        view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
        return controller.view
    }

    /// Restore enqueues one main-queue layout operation. Await that queue boundary,
    /// rather than guessing a device-dependent sleep duration.
    private func drainMainQueue() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    private func descendant<T: UIView>(_ type: T.Type, in view: UIView) -> T? {
        if let found = view as? T { return found }
        return view.subviews.lazy.compactMap { self.descendant(type, in: $0) }.first
    }

    func testDefaultTextInsetsRestoreTheAnchorBelowTopChromeAndKeepItsCheckpoint() async throws {
        try await assertTextAnchorRemainsReadable(topInset: 64)
    }

    func testTallTextInsetsRestoreTheAnchorBelowTopChromeAndKeepItsCheckpoint() async throws {
        try await assertTextAnchorRemainsReadable(topInset: 120)
    }

    private func assertTextAnchorRemainsReadable(topInset: CGFloat, file: StaticString = #filePath, line: UInt = #line) async throws {
        let marker = "VIEWPORT_MIDDLE_ANCHOR_30"
        let paragraphs = (1...60).map { index in
            "VIEWPORT_MIDDLE_ANCHOR_\(index). " + String(repeating: "This invented paragraph checks whether its saved source stays visible below reading controls. ", count: 5)
        }
        let session = try await session(filename: "synthetic-viewport.txt") { url in
            try Data(paragraphs.joined(separator: "\n\n").utf8).write(to: url)
        }
        let passage = try XCTUnwrap(session.chapter.passages.first { $0.text.hasPrefix(marker) }, file: file, line: line)
        let anchor = ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id, characterOffset: 0)
        session.go(to: 0, anchor: anchor)
        let saved = await session.flush()
        XCTAssertTrue(session.isCurrent(saved), "The fixture must begin with a durable middle-passage anchor", file: file, line: line)

        let insets = UIEdgeInsets(top: topInset, left: 24, bottom: 180, right: 24)
        let reading = TextReadingView(session: session, pageInsets: insets, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator()
        let text = UITextView(usingTextLayoutManager: false)
        text.isEditable = false
        text.isSelectable = true
        text.textContainerInset = insets
        text.textContainer.lineFragmentPadding = 0
        text.contentInsetAdjustmentBehavior = .never
        text.delegate = coordinator
        coordinator.view = text
        let viewport = host(text)
        defer { coordinator.invalidate(); text.delegate = nil }

        coordinator.updateContent(text)
        await drainMainQueue()
        text.layoutManager.ensureLayout(for: text.textContainer)
        text.layoutIfNeeded()
        XCTAssertFalse(coordinator.restoring, "Wait for the actual restoration operation, not a guessed delay", file: file, line: line)
        let sourceRange = (text.text as NSString).range(of: marker)
        XCTAssertNotEqual(sourceRange.location, NSNotFound, file: file, line: line)
        guard sourceRange.location != NSNotFound else { return }
        let glyphs = text.layoutManager.glyphRange(forCharacterRange: NSRange(location: sourceRange.location, length: 1), actualCharacterRange: nil)
        let glyphRect = text.layoutManager.boundingRect(forGlyphRange: glyphs, in: text.textContainer)
        let viewportRect = text.convert(glyphRect.offsetBy(dx: text.textContainerInset.left, dy: text.textContainerInset.top), to: viewport)
        // ReaderScreen reserves 16 pt after the measured top chrome. At the
        // default 64 pt inset this conservatively reserves 48 pt of controls;
        // a 120 pt inset represents 104 pt of controls, not a fixed 44 pt bar.
        let readableTop = topInset - 16
        XCTAssertGreaterThanOrEqual(viewportRect.minY, readableTop - 1, "Restoring a source anchor must not put it behind the top chrome (inset \(topInset))", file: file, line: line)
        XCTAssertLessThan(viewportRect.maxY, viewport.bounds.maxY - insets.bottom, "The anchor must also lie inside the readable viewport", file: file, line: line)
        XCTAssertTrue(coordinator.checkpointVisible(), file: file, line: line)
        XCTAssertEqual(session.currentAnchor?.passageID, passage.id, "A checkpoint after restore must retain the visible source passage", file: file, line: line)
        _ = await session.flush()
    }

}
