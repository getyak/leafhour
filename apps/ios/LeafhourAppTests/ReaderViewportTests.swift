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

    func testPDFCaptureUsesThePageAtTheReadableTopAcrossPageSeamsInBothDirections() async throws {
        let session = try await session(filename: "synthetic-viewport.pdf") { url in
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595))
            try renderer.writePDF(to: url) { context in
                for page in 1...3 {
                    context.beginPage()
                    for y in stride(from: 20, through: 570, by: 50) {
                        let label = "SYNTHETIC PAGE \(page) / MARKER \(y)"
                        (label as NSString).draw(at: CGPoint(x: 24, y: CGFloat(y)), withAttributes: [.font: UIFont.systemFont(ofSize: 13), .foregroundColor: UIColor.black])
                    }
                }
            }
        }
        XCTAssertEqual(session.book.chapters.count, 3, "Use the actual imported PDF page index")
        let insets = UIEdgeInsets(top: 120, left: 0, bottom: 180, right: 0)
        let reading = PDFReadingView(session: session, pageInsets: insets, selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator()
        let pdf = PDFView()
        pdf.displayMode = .singlePageContinuous
        pdf.displayDirection = .vertical
        pdf.autoScales = true
        pdf.document = try XCTUnwrap(PDFDocument(url: session.original))
        coordinator.view = pdf
        coordinator.navigationID = session.navigationID
        coordinator.observe(pdf)
        _ = host(pdf)
        pdf.layoutDocumentView()
        await drainMainQueue()
        pdf.layoutIfNeeded()
        coordinator.observeScroll(in: pdf)
        let scroll = try XCTUnwrap(descendant(UIScrollView.self, in: pdf), "PDFKit must expose its real laid-out scrolling view")
        let document = try XCTUnwrap(pdf.document)
        XCTAssertGreaterThan(pdf.scaleFactor, 0)
        XCTAssertGreaterThan(scroll.contentSize.height, scroll.bounds.height)

        // The next page begins before, inside, and after the obscured top band.
        // Reversing the same positions checks capture without relying on which
        // page PDFKit previously considered current during forward scrolling.
        let seamPositions: [(page: Int, top: CGFloat)] = [1, 2].flatMap { page in
            [insets.top + 60, insets.top / 2, CGFloat(0)].map { (page: page, top: $0) }
        }
        var sampledPages: Set<Int> = []
        for sample in seamPositions + Array(seamPositions.reversed()) {
            let nextPage = try XCTUnwrap(document.page(at: sample.page))
            let nextPageRect = pdf.convert(nextPage.bounds(for: pdf.displayBox), from: nextPage)
            let desiredOffset = scroll.contentOffset.y + nextPageRect.minY - sample.top
            let minimum = -scroll.adjustedContentInset.top
            let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(maximum, max(minimum, desiredOffset))), animated: false)
            pdf.layoutIfNeeded()
            await drainMainQueue()

            let readablePoint = CGPoint(x: pdf.bounds.midX, y: insets.top + 1)
            let expectedPage = try XCTUnwrap(pdf.page(for: readablePoint, nearest: true))
            let expectedIndex = document.index(for: expectedPage)
            let expectedPoint = pdf.convert(readablePoint, to: expectedPage)
            sampledPages.insert(expectedIndex)
            coordinator.restoring = false
            coordinator.userScrolled = true
            coordinator.capture()

            let saved = try XCTUnwrap(session.currentAnchor)
            let sampleDescription = "page \(sample.page + 1) top at \(sample.top) pt; actual unobscured page is \(expectedIndex + 1)"
            XCTAssertEqual(saved.chapterID, session.book.chapters[expectedIndex].id, "Capture must bind to the page under the unobscured reading point: " + sampleDescription)
            XCTAssertEqual(session.chapterIndex, expectedIndex, sampleDescription)
            let savedY = try XCTUnwrap(saved.pageY)
            // capture currently samples top rather than top+1; one screen point
            // is allowed so this assertion detects page/coordinate confusion.
            XCTAssertEqual(savedY, Double(expectedPoint.y), accuracy: max(2, Double(1 / pdf.scaleFactor) + 0.1), sampleDescription)
        }
        XCTAssertEqual(sampledPages, Set([0, 1, 2]), "The seam setup must really sample all three pages, not repeat a single-page fixture")
        coordinator.cancelPendingScroll()
        _ = await session.flush()
    }
    func testPDFSpeechCursorUsesTheVisibleRightColumnAndPaintDoesNotSelectText() async throws {
        let session = try await session(filename: "speech-columns.pdf") { url in
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 900))
            try renderer.writePDF(to: url) { context in
                context.beginPage()
                (String(repeating: "LEFT_UNSEEN one.\n", count: 20) as NSString).draw(in: CGRect(x: 20, y: 40, width: 150, height: 800), withAttributes: [.font: UIFont.systemFont(ofSize: 14)])
                (String(repeating: "RIGHT_VISIBLE two.\n", count: 20) as NSString).draw(in: CGRect(x: 250, y: 40, width: 150, height: 800), withAttributes: [.font: UIFont.systemFont(ofSize: 14)])
            }
        }
        var location: ReaderSpeechLocation?
        var reading = PDFReadingView(session: session, pageInsets: UIEdgeInsets(top: 16, left: 0, bottom: 44, right: 0), selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {}, onReadingPosition: { location = $0 })
        let coordinator = reading.makeCoordinator(), pdf = PDFView()
        pdf.autoScales = false; coordinator.view = pdf
        _ = host(pdf, size: CGSize(width: 300, height: 500))
        coordinator.update(pdf)
        for _ in 0..<4 { await drainMainQueue() }
        pdf.scaleFactor = 2; pdf.layoutDocumentView(); pdf.layoutIfNeeded(); coordinator.observeScroll(in: pdf)
        let scroll = try XCTUnwrap(descendant(UIScrollView.self, in: pdf))
        let maximum = max(0, scroll.contentSize.width - scroll.bounds.width)
        XCTAssertGreaterThan(maximum, 0)
        scroll.setContentOffset(CGPoint(x: maximum, y: -scroll.adjustedContentInset.top), animated: false)
        pdf.layoutIfNeeded(); coordinator.restoring = false; coordinator.reportReadingPosition()
        let page = try XCTUnwrap(pdf.document?.page(at: 0)), source = try XCTUnwrap(page.string)
        let reported = try XCTUnwrap(location)
        let character = page.characterBounds(at: reported.utf16Offset)
        XCTAssertGreaterThan(character.minX, 200, "A zoomed right column cannot begin with invisible left-column text")
        let right = (source as NSString).rangeOfComposedCharacterSequence(at: reported.utf16Offset)
        reading.speechHighlight = ReaderSpeechHighlight(location: ReaderSpeechLocation(chapterID: session.chapter.id, passageID: session.chapter.passages[0].id, layer: "original", snapshot: source, utf16Offset: right.location), sentenceRange: right, wordRange: right)
        coordinator.parent = reading; coordinator.updateSpeech()
        XCTAssertEqual(pdf.highlightedSelections?.count, 1)
        XCTAssertNil(pdf.currentSelection, "Speech paint must never replace the native editable selection")
        coordinator.invalidate()
    }

}
