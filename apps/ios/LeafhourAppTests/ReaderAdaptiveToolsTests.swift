import XCTest
import SwiftUI
import UIKit
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderAdaptiveToolsTests: XCTestCase {
    private func fixture() async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("quiet.txt")
        let source = (1...30).map { "Original paragraph \($0). The reading position belongs to this book while its tools change size." }.joined(separator: "\n\n")
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }

    private func descendant<T: UIView>(_ type: T.Type, in view: UIView, matching: @escaping (T) -> Bool = { _ in true }) -> T? {
        if let found = view as? T, matching(found) { return found }
        return view.subviews.lazy.compactMap { self.descendant(type, in: $0, matching: matching) }.first
    }

    private func settle(_ view: UIView) async {
        view.setNeedsLayout(); view.layoutIfNeeded()
        try? await Task.sleep(for: .milliseconds(180))
        view.layoutIfNeeded()
    }

    func testWideToolsRequireUsableReadingAndEditingSpace() {
        XCTAssertFalse(ReaderAdaptiveLayout(size: CGSize(width: 390, height: 780), minimumReadingWidth: 360, accessibilityText: false, toolIsOpen: true).isBeside)
        let wide = ReaderAdaptiveLayout(size: CGSize(width: 1024, height: 780), minimumReadingWidth: 360, accessibilityText: false, toolIsOpen: true)
        XCTAssertTrue(wide.isBeside)
        XCTAssertGreaterThanOrEqual(wide.readingWidth, 360)
        XCTAssertGreaterThanOrEqual(wide.toolWidth, 340)
        XCTAssertEqual(wide.readingWidth + wide.toolWidth + 1, 1024, accuracy: 0.5)
        XCTAssertFalse(ReaderAdaptiveLayout(size: CGSize(width: 1024, height: 780), minimumReadingWidth: 360, accessibilityText: true, toolIsOpen: true).isBeside, "Large text must get a usable independent tool page")
        XCTAssertFalse(ReaderAdaptiveLayout(size: CGSize(width: 1024, height: 300), minimumReadingWidth: 360, accessibilityText: false, toolIsOpen: true).isBeside, "A short keyboard-constrained window must not force side-by-side editing")
        XCTAssertEqual(ReaderAdaptiveLayout(size: CGSize(width: 1024, height: 780), minimumReadingWidth: 360, accessibilityText: false, toolIsOpen: false).readingWidth, 1024)
    }

    func testDefaultReaderHasOneIndependent44PointToolsEntryAndNoDockReserve() async throws {
        let session = try await fixture()
        let host = UIHostingController(rootView: ReaderScreen(session: session, systemColorScheme: .light))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 780))
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
        await settle(host.view)
        let entry = try XCTUnwrap(descendant(UIButton.self, in: host.view) { $0.accessibilityIdentifier == "reader-tools" })
        XCTAssertEqual(entry.accessibilityLabel, "阅读工具")
        XCTAssertGreaterThanOrEqual(entry.bounds.width, 44)
        XCTAssertGreaterThanOrEqual(entry.bounds.height, 44)
        let text = try XCTUnwrap(descendant(ReflowTextView.self, in: host.view))
        XCTAssertLessThanOrEqual(text.textContainerInset.bottom, 72, "A sleeping five-button dock must not reserve the page")
        let anchor = session.currentAnchor, insets = text.textContainerInset
        entry.sendActions(for: .touchUpInside)
        await settle(host.view)
        XCTAssertEqual(session.currentAnchor, anchor)
        XCTAssertEqual(text.textContainerInset, insets, "Opening tools must not reflow the same-width text container")
        let sourcePoint = text.convert(CGPoint(x: text.bounds.midX, y: text.bounds.midY), to: host.view)
        let hit = host.view.hitTest(sourcePoint, with: nil)
        XCTAssertFalse(hit === text || hit?.isDescendant(of: text) == true, "A compact tool page must shield the source beneath it")
    }

    func testNoteEditorStaysMountedAndRetainsDraftAndSourceAcrossCompactWideTransitions() async throws {
        let session = try await fixture()
        let passage = session.chapter.passages[8]
        let anchor = ReadingAnchor(chapterID: session.chapter.id, passageID: passage.id, characterOffset: 4)
        session.go(to: 0, anchor: anchor)
        let quote = SelectedQuote(anchor: anchor, text: passage.text)
        session.draft(quote, text: "An unsaved thought")
        let tools = ReaderCloudTools(); tools.question = "Keep this question"
        let speech = ReaderSpeech()
        let screen = ReaderAdaptiveSurface(toolIsOpen: true, minimumReadingWidth: 360, accessibilityText: false) {
            TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        } tool: {
            ReaderPanelView(panel: .note(quote), session: session, systemColorScheme: .light, speech: speech, tools: tools, cloud: nil, onJump: { _, _ in }, onCompanion: {})
        }
        let host = UIHostingController(rootView: screen)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 780))
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
        await settle(host.view)
        let editor = try XCTUnwrap(descendant(UITextView.self, in: host.view) { $0.isEditable })
        XCTAssertEqual(editor.text, "An unsaved thought")
        let submissionID = try XCTUnwrap(session.noteEditorID)
        editor.text = "A thought that survives resizing"
        editor.delegate?.textViewDidChange?(editor)
        await settle(host.view)
        for width in [1024.0, 390.0, 1180.0, 390.0] {
            window.frame.size.width = width; host.view.frame = window.bounds
            await settle(host.view)
            let current = try XCTUnwrap(descendant(UITextView.self, in: host.view) { $0.isEditable })
            XCTAssertTrue(current === editor, "Resize must move the existing editor rather than create a new submission")
            XCTAssertEqual(session.noteEditorID, submissionID)
            XCTAssertEqual(current.text, "A thought that survives resizing")
            XCTAssertEqual(session.state.drafts[quote.anchor.key]?.body, "A thought that survives resizing")
            XCTAssertEqual(session.currentAnchor?.passageID, passage.id)
            XCTAssertEqual(tools.question, "Keep this question")
        }
        _ = await session.flush()
    }
}
