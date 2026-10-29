import XCTest
import UIKit
import PDFKit
import LeafhourCore
@testable import Leafhour

/// GET-328: real TextKit/PDFKit fixtures, with no account or provider calls.
/// These cases were written before the implementation; execution belongs to
/// the shared native runner and has not been performed by the authoring agent.
@MainActor
final class ReaderPaginationTests: XCTestCase {
    private let longParagraph = String(repeating: "A source sentence with café, 中文 and 🐿️ keeps its exact anchor. ", count: 70)

    private func session(pdf: Bool = false, chapters: Int = 1, source: String? = nil) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(pdf ? "paging.pdf" : "paging.txt")
        if pdf {
            try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595)).writePDF(to: file) { context in
                for number in 1...3 {
                    context.beginPage()
                    ("SYNTHETIC PDF PAGE \(number)" as NSString).draw(at: CGPoint(x: 24, y: 80), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
                }
            }
        } else { try Data((source ?? (longParagraph + "\n\nSecond distinct source paragraph.")).utf8).write(to: file) }
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        var book = try await library.importFile(file)
        if !pdf, chapters > 1 {
            let original = book.chapters[0]
            book.chapters = (0..<chapters).map { index in
                var chapter = original
                chapter.id = "synthetic-chapter-\(index)"; chapter.title = "Chapter \(index + 1)"
                chapter.passages = original.passages.enumerated().map { offset, original in
                    var passage = original; passage.id = "c\(index)-p\(offset)"; return passage
                }
                return chapter
            }
        }
        return ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
    }
    private func host(_ view: UIView, size: CGSize = CGSize(width: 390, height: 700)) {
        let controller = UIViewController(), window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = controller; window.makeKeyAndVisible()
        controller.view.frame = window.bounds; view.frame = window.bounds
        controller.view.addSubview(view); view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run { window.isHidden = true; window.rootViewController = nil } }
    }
    private func drain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.main.async { continuation.resume() } }
    }
    private func text(_ session: ReaderSession, onPageChange: ((ReaderPagePosition) -> Void)? = nil) async -> (UITextView, TextReadingView.Coordinator) {
        let parent = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onPageChange: onPageChange)
        let coordinator = parent.makeCoordinator(), view = UITextView(usingTextLayoutManager: false)
        view.isEditable = false; view.isSelectable = true; view.textContainer.lineFragmentPadding = 0
        view.contentInsetAdjustmentBehavior = .never; view.delegate = coordinator
        coordinator.view = view; host(view); coordinator.updateContent(view); await drain()
        addTeardownBlock { await MainActor.run { coordinator.invalidate(); view.delegate = nil } }
        return (view, coordinator)
    }

    func testOneLongParagraphSpansRealGlyphPagesWithoutSkippingVisibleLines() async throws {
        let session = try await session(), (view, _) = await text(session)
        let layout = ReaderTextPagination(textView: view, readingTop: 64, bottomInset: 180)
        XCTAssertGreaterThan(layout.origins.count, 3, "A paragraph is not a page")
        for (start, end) in zip(layout.origins, layout.origins.dropFirst()) {
            XCTAssertGreaterThan(end, start)
            XCTAssertLessThanOrEqual(end - start, view.bounds.height - 64 - 180 + 1, "Successive screens must not skip any vertical text interval")
        }
        XCTAssertEqual(layout.origins.last!, max(0, view.contentSize.height - view.bounds.height), accuracy: 1)
        _ = await session.flush()
    }

    func testOversizedAttachmentMakesForwardProgressInsteadOfDroppingTheIllustration() {
        let view = UITextView(usingTextLayoutManager: false)
        view.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        view.textContainerInset = UIEdgeInsets(top: 64, left: 24, bottom: 180, right: 24)
        let attachment = NSTextAttachment(); attachment.bounds = CGRect(x: 0, y: 0, width: 342, height: 1600)
        let text = NSMutableAttributedString(attachment: attachment)
        text.append(NSAttributedString(string: "\nThe original sentence after the illustration.", attributes: [.font: UIFont.systemFont(ofSize: 22)]))
        view.attributedText = text; view.layoutManager.ensureLayout(for: view.textContainer); view.layoutIfNeeded()
        let layout = ReaderTextPagination(textView: view, readingTop: 64, bottomInset: 180)
        XCTAssertGreaterThan(layout.origins.count, 3)
        for (start, end) in zip(layout.origins, layout.origins.dropFirst()) {
            XCTAssertGreaterThan(end, start); XCTAssertLessThanOrEqual(end - start, 457)
        }
        XCTAssertEqual(layout.origins.last!, max(0, view.contentSize.height - view.bounds.height), accuracy: 1)
    }

    func testCommittedPageTurnPersistsTheVisibleScalarAnchorAndPreviousRestoresTheScreen() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session), original = view.contentOffset.y
        XCTAssertTrue(coordinator.turnPage(.next)); await drain()
        XCTAssertGreaterThan(view.contentOffset.y, original)
        let moved = try XCTUnwrap(session.currentAnchor)
        XCTAssertEqual(moved.passageID, session.chapter.passages[0].id)
        XCTAssertGreaterThan(moved.characterOffset, 0)
        XCTAssertTrue(coordinator.turnPage(.previous)); await drain()
        XCTAssertEqual(view.contentOffset.y, original, accuracy: 1)
        XCTAssertFalse(coordinator.turnPage(.previous), "The first screen must not wrap to the end of the book")
        _ = await session.flush()
    }

    func testCrossParagraphNativeSelectionBlocksPagingEvenWithoutADomainQuote() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        view.selectedRange = NSRange(location: 0, length: view.attributedText.length - 1)
        XCTAssertNil(coordinator.selectedQuote(in: view, range: view.selectedRange))
        let range = view.selectedRange, offset = view.contentOffset
        XCTAssertFalse(coordinator.turnPage(.next))
        XCTAssertEqual(view.selectedRange, range); XCTAssertEqual(view.contentOffset, offset)
        _ = await session.flush()
    }

    func testLastScreenCrossesChaptersAndPreviousEntersThePreviousChapterLastScreen() async throws {
        let session = try await session(chapters: 2); session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        view.setContentOffset(CGPoint(x: 0, y: max(0, view.contentSize.height - view.bounds.height)), animated: false)
        coordinator.capture()
        XCTAssertTrue(coordinator.turnPage(.next)); await drain()
        XCTAssertEqual(session.chapterIndex, 1); XCTAssertEqual(view.contentOffset.y, 0, accuracy: 1)
        XCTAssertTrue(coordinator.turnPage(.previous)); await drain()
        XCTAssertEqual(session.chapterIndex, 0)
        XCTAssertEqual(view.contentOffset.y, max(0, view.contentSize.height - view.bounds.height), accuracy: 1)
        session.go(to: 1); coordinator.updateContent(view); await drain()
        view.setContentOffset(CGPoint(x: 0, y: max(0, view.contentSize.height - view.bounds.height)), animated: false)
        coordinator.capture()
        XCTAssertFalse(coordinator.turnPage(.next), "The book end must not loop to chapter one")
        _ = await session.flush()
    }

    func testScrollModeKeepsItsNativePanAndDoesNotTurnOnHorizontalPageRequests() async throws {
        let session = try await session(), (view, coordinator) = await text(session)
        let offset = view.contentOffset
        XCTAssertTrue(view.panGestureRecognizer.isEnabled)
        XCTAssertFalse(coordinator.turnPage(.next)); XCTAssertEqual(view.contentOffset, offset)
        _ = await session.flush()
    }

    func testCancelledAndVerticalGesturesNeverCommitAPage() {
        let view = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        var directions: [ReaderPageDirection] = []
        let handler = ReaderPageTurnGestureHandler(view: view, blocked: { false }, onTurn: { directions.append($0) })
        handler.complete(state: .cancelled, translation: CGPoint(x: -200, y: 0))
        handler.complete(state: .ended, translation: CGPoint(x: 10, y: 200))
        XCTAssertTrue(directions.isEmpty)
        handler.complete(state: .ended, translation: CGPoint(x: -200, y: 0))
        XCTAssertEqual(directions, [.next])
        handler.invalidate()
    }

    func testPagePositionNotificationsAreAsyncAndOnlyEmittedWhenPositionChanges() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        var positions: [ReaderPagePosition] = []
        let (view, coordinator) = await text(session, onPageChange: { positions.append($0) })
        await drain(); let initialCount = positions.count
        XCTAssertEqual(initialCount, 1)
        coordinator.updateContent(view)
        XCTAssertEqual(positions.count, initialCount)
        await drain(); XCTAssertEqual(positions.count, initialCount)
        XCTAssertTrue(coordinator.turnPage(.next))
        XCTAssertEqual(positions.count, initialCount, "A UIKit callback must not synchronously mutate SwiftUI state")
        await drain(); XCTAssertEqual(positions.last?.index, 1)
        _ = await session.flush()
    }

    func testPDFNativePageControllerChangesPersistWithoutVerticalTrackingAndModesCanSwitch() async throws {
        let session = try await session(pdf: true); session.state.preferences.navigationMode = .paged
        let parent = PDFReadingView(session: session, selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = parent.makeCoordinator(), view = PDFView()
        coordinator.view = view; host(view); coordinator.observe(view); coordinator.update(view); await drain(); await drain()
        XCTAssertTrue(view.isUsingPageViewController); XCTAssertEqual(view.displayDirection, .horizontal)
        view.goToNextPage(nil); await drain(); await drain()
        XCTAssertEqual(session.chapterIndex, 1)
        XCTAssertEqual(session.currentAnchor?.chapterID, session.book.chapters[1].id, "PDF's native horizontal controller must save its actual changed page even when vertical-scroll isTracking is false")
        session.state.preferences.navigationMode = .scroll
        coordinator.update(view); await drain(); await drain()
        XCTAssertFalse(view.isUsingPageViewController); XCTAssertEqual(view.displayDirection, .vertical)
        XCTAssertEqual(view.document?.index(for: try XCTUnwrap(view.currentPage)), 1)
        coordinator.invalidate(); _ = await session.flush()
    }

    func testSavedPagedScalarAnchorRemainsVisibleAcrossFontWidthAndModeReflow() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        XCTAssertTrue(coordinator.turnPage(.next)); await drain(); coordinator.capture()
        let receipt = await session.flush()
        XCTAssertTrue(session.isCurrent(receipt))
        let saved = try XCTUnwrap(session.state.anchor)
        XCTAssertGreaterThan(saved.characterOffset, 0)
        // These change real TextKit layout, then traverse both navigation modes.
        for (size, width, mode) in [(30.0, 390.0, ReaderNavigationMode.paged), (30.0, 680.0, .paged), (30.0, 680.0, .scroll), (22.0, 390.0, .paged)] {
            var preferences = session.state.preferences
            preferences.fontSize = size; preferences.navigationMode = mode
            session.changePreferences(preferences)
            view.frame.size.width = CGFloat(width)
            coordinator.updateContent(view); await drain(); view.layoutIfNeeded()
            XCTAssertTrue(coordinator.checkpointVisible())
            let actual = try XCTUnwrap(session.currentAnchor)
            XCTAssertEqual(actual.chapterID, saved.chapterID)
            XCTAssertEqual(actual.passageID, saved.passageID)
            XCTAssertLessThanOrEqual(actual.characterOffset, saved.characterOffset, "Reflow may expose the start of the containing line, but must not jump ahead of the saved source")
            let passage = try XCTUnwrap(session.chapter.passages.first { $0.id == saved.passageID })
            let originalUTF16 = passage.text.unicodeScalars.prefix(saved.characterOffset).reduce(0) { $0 + $1.utf16.count }
            let glyph = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: originalUTF16, length: 1), actualCharacterRange: nil)
            let rendered = view.layoutManager.boundingRect(forGlyphRange: glyph, in: view.textContainer)
                .offsetBy(dx: view.textContainerInset.left - view.contentOffset.x, dy: view.textContainerInset.top - view.contentOffset.y)
            let visible = CGRect(x: 0, y: 64, width: view.bounds.width, height: view.bounds.height - 64 - 24)
            XCTAssertGreaterThan(rendered.intersection(visible).height, 0, "The saved scalar's actual glyph must remain visible after \(size) pt / \(width) pt / \(mode)")
            XCTAssertEqual(view.panGestureRecognizer.isEnabled, mode == .scroll)
        }
        _ = await session.flush()
    }

    func testReusedCoordinatorRebuildsPageGeometryForADifferentSessionWithTheSameChapterID() async throws {
        let short = try await session(source: "One short original sentence."), long = try await session()
        short.state.preferences.navigationMode = .paged; long.state.preferences.navigationMode = .paged
        XCTAssertEqual(short.chapter.id, long.chapter.id)
        let (view, coordinator) = await text(short)
        XCTAssertFalse(coordinator.turnPage(.next))
        coordinator.parent = TextReadingView(session: long, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        coordinator.updateContent(view); await drain()
        XCTAssertTrue(coordinator.turnPage(.next), "A previous book's single-screen cache must not make the new long book impossible to page")
        XCTAssertGreaterThan(view.contentOffset.y, 0)
        XCTAssertGreaterThan(try XCTUnwrap(long.currentAnchor).characterOffset, 0)
        _ = await short.flush(); _ = await long.flush()
    }

    func testMarkdownQuoteEndExcludesHiddenDelimitersButIncludesCompleteEntitiesAndEmoji() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = "Before **café** / **🐿️** / **&amp;** / **&#x1F43F;&#xfe0f;** / [orchard](https://example.invalid/hidden) / **&NotEqualTilde;** after."
        let file = root.appendingPathComponent("boundaries.md")
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        for (visible, raw, ordinal) in [("café", "café", 0), ("🐿️", "🐿️", 0), ("&", "&amp;", 0), ("🐿️", "&#x1F43F;&#xfe0f;", 1), ("orchard", "orchard", 0), ("≂̸", "&NotEqualTilde;", 0)] {
            let displayed = view.text as NSString
            var search = NSRange(location: 0, length: displayed.length), selected = NSRange(location: NSNotFound, length: 0)
            for _ in 0...ordinal {
                selected = displayed.range(of: visible, options: [], range: search)
                guard selected.location != NSNotFound else { XCTFail("The renderer must retain \(visible)"); return }
                search = NSRange(location: NSMaxRange(selected), length: displayed.length - NSMaxRange(selected))
            }
            view.selectedRange = selected
            let quote = try XCTUnwrap(coordinator.selectedQuote(in: view, range: view.selectedRange))
            XCTAssertEqual(quote.text, visible)
            XCTAssertEqual(quote.sourceText, raw, "An end-exclusive displayed selection must exclude hidden Markdown trailing syntax")
            let rawStart = (source as NSString).range(of: raw).location
            XCTAssertEqual(quote.anchor.characterOffset, (source as NSString).substring(to: rawStart).unicodeScalars.count)
        }
        _ = await session.flush()
    }

    func testPagedMarkdownVisibleCopyKeepsSourceMappingAndTextAfterTallIllustration() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = String(repeating: "🐿️ 中文 **café** and [orchard](https://example.invalid/source) remain original. ", count: 100)
        let file = root.appendingPathComponent("source.md")
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let session = ReaderSession(book: book, state: try await library.state(book.id), original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id), library: library)
        session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        XCTAssertTrue(coordinator.turnPage(.next)); await drain()
        let visible = CGRect(x: 0, y: view.contentOffset.y + 64 - view.textContainerInset.top,
                             width: view.textContainer.size.width, height: view.bounds.height - 64 - 24)
        let glyphs = view.layoutManager.glyphRange(forBoundingRect: visible, in: view.textContainer)
        let characters = view.layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        let displayed = view.text as NSString
        var search = characters, choice: NSRange?
        while search.length > 0 {
            let found = displayed.range(of: "café", options: [], range: search)
            if found.location == NSNotFound { break }
            let range = view.layoutManager.glyphRange(forCharacterRange: found, actualCharacterRange: nil)
            if visible.insetBy(dx: -1, dy: -1).contains(view.layoutManager.boundingRect(forGlyphRange: range, in: view.textContainer)) { choice = found; break }
            search = NSRange(location: NSMaxRange(found), length: NSMaxRange(characters) - NSMaxRange(found))
        }
        let selection = try XCTUnwrap(choice, "Select a completely visible rendered word on the second screen")
        view.selectedRange = selection; view.becomeFirstResponder()
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: view, range: view.selectedRange))
        XCTAssertEqual(quote.text, "café"); XCTAssertEqual(quote.sourceText, "café")
        // Find the same occurrence in unchanged raw Markdown independently of
        // the renderer's source mapper; markup and astral scalars shift offsets.
        let ordinal = displayed.substring(to: selection.location).components(separatedBy: "café").count - 1
        let raw = source as NSString
        var rawSearch = NSRange(location: 0, length: raw.length), rawWord = NSRange(location: NSNotFound, length: 0)
        for _ in 0...ordinal {
            rawWord = raw.range(of: "café", options: [], range: rawSearch)
            guard rawWord.location != NSNotFound else { XCTFail("The visible word must map to the same original occurrence"); return }
            rawSearch = NSRange(location: NSMaxRange(rawWord), length: raw.length - NSMaxRange(rawWord))
        }
        XCTAssertEqual(quote.anchor.passageID, book.chapters[0].passages[0].id)
        XCTAssertEqual(quote.anchor.characterOffset, raw.substring(to: rawWord.location).unicodeScalars.count)
        XCTAssertTrue(view.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
        view.copy(nil) // Actual native Copy; no test code reads/writes UIPasteboard.
        XCTAssertEqual(view.selectedRange, selection)
        view.selectedRange = NSRange(location: 0, length: 0); view.resignFirstResponder()
        _ = await session.flush()

        let marker = "AFTER_TALL_ATTACHMENT 完整作者原文仍可读。"
        let illustrated = root.appendingPathComponent("illustrated.txt")
        try Data(("Illustration placeholder.\n\n" + marker).utf8).write(to: illustrated)
        var illustratedBook = try await library.importFile(illustrated)
        let directory = try await library.bookDirectory(illustratedBook.id), assets = directory.appendingPathComponent("assets")
        try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 100)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 20, height: 100))
        }
        try XCTUnwrap(image.pngData()).write(to: assets.appendingPathComponent("tall.png"))
        illustratedBook.chapters[0].passages[0].text = ""
        illustratedBook.chapters[0].passages[0].resourcePath = "tall.png"
        let illustratedSession = ReaderSession(book: illustratedBook, state: try await library.state(illustratedBook.id), original: try await library.originalURL(illustratedBook.id), directory: directory, library: library)
        illustratedSession.state.preferences.navigationMode = .paged
        let (illustratedView, illustratedCoordinator) = await text(illustratedSession)
        XCTAssertNotNil(illustratedView.attributedText.attribute(.attachment, at: 0, effectiveRange: nil), "Exercise the actual source asset rendering path")
        let markerCharacters = (illustratedView.text as NSString).range(of: marker)
        guard markerCharacters.location != NSNotFound else { XCTFail("The real rendered chapter lost its text after the attachment"); return }
        let markerGlyphs = illustratedView.layoutManager.glyphRange(forCharacterRange: markerCharacters, actualCharacterRange: nil)
        let bodyViewport = CGRect(x: 0, y: 64, width: illustratedView.bounds.width, height: illustratedView.bounds.height - 64 - 24)
        func renderedMarker() -> CGRect {
            illustratedView.layoutManager.boundingRect(forGlyphRange: markerGlyphs, in: illustratedView.textContainer)
                .offsetBy(dx: illustratedView.textContainerInset.left - illustratedView.contentOffset.x, dy: illustratedView.textContainerInset.top - illustratedView.contentOffset.y)
        }
        var turns = 0
        while !bodyViewport.insetBy(dx: -1, dy: -1).contains(renderedMarker()) && turns < 20 {
            guard illustratedCoordinator.turnPage(.next) else { XCTFail("Paging stopped before the following original became visible"); break }
            await drain(); turns += 1
        }
        XCTAssertGreaterThan(turns, 1, "The illustration must really be taller than one screen")
        XCTAssertTrue(bodyViewport.insetBy(dx: -1, dy: -1).contains(renderedMarker()), "Following text must physically fit in a reached screen, not merely exist in the chapter value")
        illustratedView.selectedRange = markerCharacters
        let afterImage = try XCTUnwrap(illustratedCoordinator.selectedQuote(in: illustratedView, range: markerCharacters))
        XCTAssertEqual(afterImage.text, marker); XCTAssertEqual(afterImage.sourceText, marker)
        XCTAssertEqual(afterImage.anchor.passageID, illustratedBook.chapters[0].passages[1].id)
        _ = await illustratedSession.flush()
    }

    func testPagedPDFOuterPaddingCapturesItsActualLocalTopWithoutAddingChromeTwice() async throws {
        let session = try await session(pdf: true); session.state.preferences.navigationMode = .paged
        let insets = UIEdgeInsets(top: 64, left: 0, bottom: 124, right: 0)
        let parent = PDFReadingView(session: session, pageInsets: insets, selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = parent.makeCoordinator(), view = PDFView()
        view.autoScales = true
        coordinator.view = view; host(view)
        // ReaderScreen pads the paged PDF outside PDFView. Its local top is
        // already below chrome; the passed chrome inset must not be added again.
        view.frame = CGRect(x: 0, y: 64, width: 390, height: 512)
        coordinator.observe(view); coordinator.update(view); await drain(); await drain()
        view.layoutDocumentView(); await drain()
        let page = try XCTUnwrap(view.currentPage)
        let localTop = CGPoint(x: view.bounds.midX, y: view.bounds.minY + 1)
        let sourceTop = view.convert(localTop, to: page), bounds = page.bounds(for: view.displayBox)
        let expectedY = min(bounds.maxY, max(bounds.minY, sourceTop.y))
        coordinator.userScrolled = true; coordinator.capture()
        let saved = try XCTUnwrap(session.currentAnchor)
        XCTAssertEqual(try XCTUnwrap(saved.pageY), Double(expectedY), accuracy: max(1, Double(1 / view.scaleFactor)), "Capture the visible padded PDF's local top, not a point 64 pt farther into its source")
        session.state.preferences.navigationMode = .scroll
        view.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        coordinator.update(view); await drain(); await drain()
        XCTAssertEqual(session.currentAnchor?.chapterID, saved.chapterID)
        XCTAssertEqual(try XCTUnwrap(session.currentAnchor?.pageY), try XCTUnwrap(saved.pageY), accuracy: max(3, Double(2 / view.scaleFactor)), "Switching mode must restore the saved source top, not resample the already-resized old PDF view")
        let readablePoint = CGPoint(x: view.bounds.midX, y: 65)
        let visiblePage = try XCTUnwrap(view.page(for: readablePoint, nearest: true))
        XCTAssertEqual(view.document?.index(for: visiblePage), 0)
        XCTAssertEqual(Double(view.convert(readablePoint, to: visiblePage).y), try XCTUnwrap(saved.pageY), accuracy: max(3, Double(2 / view.scaleFactor)), "The saved coordinate must also be physically visible, not merely left unchanged in state")
        coordinator.invalidate(); _ = await session.flush()
    }
}
