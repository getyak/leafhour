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
}
