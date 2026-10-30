import XCTest
import UIKit
import PDFKit
import LeafhourCore
@testable import Leafhour

@MainActor private final class LocatedLongPress: UILongPressGestureRecognizer {
    var point: CGPoint
    init(point: CGPoint) { self.point = point; super.init(target: nil, action: nil) }
    override func location(in view: UIView?) -> CGPoint { point }
}

@MainActor private final class PublicSelectionHandle: UIView, UITextSelectionHandleView {
    var direction: NSDirectionalRectEdge = .leading
    var isVertical: Bool { false }
    var customShape: UIBezierPath?
    func preferredFrame(for rect: CGRect) -> CGRect { rect }
}

@MainActor private final class PDFPageEventLog { var indices: [Int] = []; var selectionChanges = 0; var selectionStrings: [String] = [] }

/// GET-328: real TextKit/PDFKit fixtures, with no account or provider calls.
/// These cases were written before the implementation; execution belongs to
/// the shared native runner and has not been performed by the authoring agent.
@MainActor
final class ReaderPaginationTests: XCTestCase {
    private let longParagraph = String(repeating: "A source sentence with café, 中文 and 🐿️ keeps its exact anchor. ", count: 70)

    private func session(pdf: Bool = false, chapters: Int = 1, source: String? = nil) async throws -> ReaderSession {
        let fixture = try await importedSession(pdf: pdf, chapters: chapters, source: source)
        return fixture.session
    }
    private func importedSession(pdf: Bool = false, chapters: Int = 1, source: String? = nil) async throws -> (session: ReaderSession, library: OfflineLibrary) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(pdf ? "paging.pdf" : "paging.txt")
        if pdf {
            try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595)).writePDF(to: file) { context in
                for number in 1...3 {
                    context.beginPage()
                    ("SYNTHETIC PDF PAGE \(number)" as NSString).draw(at: CGPoint(x: 24, y: 80), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
                    if let source {
                        ((source + " PAGE \(number)") as NSString).draw(at: CGPoint(x: 24, y: 220), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
                    }
                }
            }
        } else { try Data((source ?? (longParagraph + "\n\nSecond distinct source paragraph.")).utf8).write(to: file) }
        let account = !pdf && chapters > 1 ? UUID() : nil
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: account.map { .account($0) } ?? .device)
        var book = try await library.importFile(file)
        if let account {
            let original = book.chapters[0]
            let cloudChapters = (0..<chapters).map { index in
                var chapter = original
                chapter.id = "synthetic-chapter-\(index)"; chapter.title = "Chapter \(index + 1)"
                chapter.passages = original.passages.enumerated().map { offset, original in
                    var passage = original; passage.id = "c\(index)-p\(offset)"; return passage
                }
                return chapter
            }
            let identity = CloudBookIdentity(ownerID: account.uuidString.lowercased(), bookID: "synthetic-paging-book", contentVersion: "paging-fixture-v1", sourceFormat: "text")
            let sections: [CloudJSON] = cloudChapters.map { chapter in
                .object(["chapterId": .string(chapter.id), "paragraphs": .array(chapter.passages.map { passage in
                    .object(["id": .string(passage.id), "original": .string(passage.text), "translations": .object([:]),
                             "source": .object(["type": .string(passage.heading ? "heading" : "paragraph")])])
                })])
            }
            let content = try CloudJSON.encode(["bookId": .string(identity.bookID), "contentVersion": .string(identity.contentVersion),
                                               "title": .string("Synthetic paging source"), "author": .string("Fixture"),
                                               "source": .object(["format": .string("text")]),
                                               "chapters": .array(cloudChapters.map { .object(["id": .string($0.id), "title": .string($0.title)]) }),
                                               "sections": .array(sections)])
            // Import through the public persistence path: book.json, manifest,
            // stable IDs and reading state must agree after a fresh session.
            book = try await library.importCloud(CloudReadingCopy(identity: identity, title: "Synthetic paging source", author: "Fixture", chapters: cloudChapters, content: content))
        }
        let original = try await library.originalURL(book.id)
        if pdf, let source {
            let document = try XCTUnwrap(PDFDocument(url: original), "Read the freshly imported fixture's real original before creating the reader")
            XCTAssertEqual(document.pageCount, 3)
            for index in 0..<document.pageCount {
                let page = try XCTUnwrap(document.page(at: index)), expected = source + " PAGE \(index + 1)"
                let actual = page.string
                let containsExactMarker = (actual ?? "").contains(expected)
                XCTAssertTrue(containsExactMarker, "Fixture preflight expected exact marker \(String(reflecting: expected)); actual fresh PDFKit page text \(String(reflecting: actual)); page index \(index)")
                guard containsExactMarker else { throw NSError(domain: "ReaderPaginationPDFSourceFixture", code: 1) }
            }
        }
        return (ReaderSession(book: book, state: try await library.state(book.id), original: original, directory: try await library.bookDirectory(book.id), library: library), library)
    }
    private func host(_ view: UIView, size: CGSize = CGSize(width: 390, height: 700), scene: UIWindowScene? = nil) {
        let controller = UIViewController()
        let previousKeyWindow = scene?.windows.first { $0.isKeyWindow }
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: CGRect(origin: .zero, size: size))
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = controller; window.makeKeyAndVisible()
        controller.view.frame = window.bounds; view.frame = window.bounds
        controller.view.addSubview(view); view.layoutIfNeeded()
        addTeardownBlock { await MainActor.run {
            window.isHidden = true; window.rootViewController = nil
            if let previousKeyWindow, !previousKeyWindow.isHidden { previousKeyWindow.makeKey() }
        } }
    }
    private func drain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in DispatchQueue.main.async { continuation.resume() } }
    }
    private func text(_ session: ReaderSession, pageInsets: UIEdgeInsets = UIEdgeInsets(top: 64, left: 24, bottom: 24, right: 24), onPageChange: ((ReaderPagePosition) -> Void)? = nil) async -> (ReflowTextView, TextReadingView.Coordinator) {
        let parent = TextReadingView(session: session, pageInsets: pageInsets, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onPageChange: onPageChange)
        let coordinator = parent.makeCoordinator(), view = ReflowTextView()
        view.isEditable = false; view.isSelectable = true; view.textContainer.lineFragmentPadding = 0
        view.contentInsetAdjustmentBehavior = .never; view.delegate = coordinator
        coordinator.view = view; host(view); coordinator.updateContent(view); await drain()
        addTeardownBlock { await MainActor.run { coordinator.invalidate(); view.delegate = nil } }
        return (view, coordinator)
    }

    private func image(of view: UIView) -> UIImage {
        view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true; format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: view.bounds.size, format: format).image { _ in
            XCTAssertTrue(view.drawHierarchy(in: CGRect(origin: .zero, size: view.bounds.size), afterScreenUpdates: true))
        }
    }
    private func inkPixels(in rect: CGRect, image: UIImage) throws -> Int {
        let cgImage = try XCTUnwrap(image.cgImage), bytes = try XCTUnwrap(cgImage.dataProvider?.data)
        let data = try XCTUnwrap(CFDataGetBytePtr(bytes))
        let area = rect.integral.intersection(CGRect(x: 0, y: 0, width: CGFloat(cgImage.width), height: CGFloat(cgImage.height)))
        var count = 0
        for y in Int(area.minY)..<Int(area.maxY) {
            for x in Int(area.minX)..<Int(area.maxX) {
                let offset = y * cgImage.bytesPerRow + x * (cgImage.bitsPerPixel / 8)
                if min(data[offset], data[offset + 1], data[offset + 2]) < 180 { count += 1 }
            }
        }
        return count
    }

    func testBodyFontFollowsTheReadingViewsOwnDynamicTypeTrait() async throws {
        let session = try await session(), (view, coordinator) = await text(session)
        let host = try XCTUnwrap(view.window?.rootViewController)
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge, .large] {
            host.traitOverrides.preferredContentSizeCategory = category
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            // Propagate through the real controller/window environment before
            // asking the renderer to rebuild for its view's new OS category.
            for _ in 0..<10 {
                host.updateTraitsIfNeeded(); host.view.updateTraitsIfNeeded(); view.updateTraitsIfNeeded()
                if view.traitCollection.preferredContentSizeCategory == category { break }
                await drain()
            }
            host.view.layoutIfNeeded(); await drain()
            coordinator.updateContent(view); await drain()
            XCTAssertEqual(view.traitCollection.preferredContentSizeCategory, category)
            let font = try XCTUnwrap(view.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
            let expected = UIFontMetrics(forTextStyle: .body).scaledValue(for: session.state.preferences.fontSize, compatibleWith: UITraitCollection(preferredContentSizeCategory: category))
            XCTAssertEqual(font.pointSize, expected, accuracy: 0.1, "The reading view's actual OS trait, including AX5, must determine its rendered source font")
        }
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testChangedViewportAndInsetsKeepCanonicalSourceWhileUnchangedLayoutKeepsItsOffset() async throws {
        let source = (1...40).map { "Paragraph \($0). This original passage keeps its source position through changes to the real viewport and reader margins." }.joined(separator: "\n\n")
        let session = try await session(source: source)
        session.state.preferences.navigationMode = .paged
        let target = ReadingAnchor(chapterID: session.chapter.id, passageID: session.chapter.passages[14].id, characterOffset: 5)
        session.go(to: 0, anchor: target)
        let (view, coordinator) = await text(session)
        coordinator.parent.pageInsets = UIEdgeInsets(top: 112, left: 24, bottom: 120, right: 24)
        view.frame.size.height = 443; view.layoutIfNeeded()
        coordinator.scrollViewDidScroll(view)
        XCTAssertEqual(session.currentAnchor, target, "An intermediate UIKit resize/clamp before updateContent cannot become a user reading checkpoint")
        XCTAssertFalse(coordinator.checkpointVisible())
        coordinator.updateContent(view); await drain()
        XCTAssertEqual(session.currentAnchor, target)
        let span = try XCTUnwrap(coordinator.spans.first { $0.passage.id == target.passageID })
        let index = span.range.location + span.sourceOffsets.utf16Offset(forScalarOffset: target.characterOffset)
        let glyphs = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let sourceRect = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: view.textContainer)
            .offsetBy(dx: view.textContainerInset.left, dy: view.textContainerInset.top)
        XCTAssertGreaterThan(sourceRect.intersection(try XCTUnwrap(view.visibleReadingRect)).height, 0)
        let stable = view.contentOffset
        for _ in 0..<3 {
            coordinator.updateContent(view); await drain()
            XCTAssertEqual(view.contentOffset, stable); XCTAssertEqual(session.currentAnchor, target)
        }
        view.setContentOffset(CGPoint(x: 0, y: stable.y + 100), animated: false)
        XCTAssertTrue(coordinator.checkpointVisible(), "A real content scroll in the same geometry must still capture immediately")
        XCTAssertNotEqual(session.currentAnchor, target)
        coordinator.capture(); let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testPagedTextHidesAdjacentPageInkWithoutReflowingOrMovingTheSourceAnchor() async throws {
        let session = try await session(), insets = UIEdgeInsets(top: 80, left: 24, bottom: 180, right: 24)
        let (view, coordinator) = await text(session, pageInsets: insets)
        view.overrideUserInterfaceStyle = .light; view.backgroundColor = .white
        let initialLayout = ReaderTextPagination(textView: view, readingTop: 80, bottomInset: 180)
        let offset = try XCTUnwrap(initialLayout.origins.dropFirst().first)
        view.setContentOffset(CGPoint(x: 0, y: offset), animated: false); await drain()
        XCTAssertTrue(coordinator.checkpointVisible())
        let bounds = view.bounds, contentSize = view.contentSize, anchor = session.currentAnchor
        let top = CGRect(x: 24, y: 0, width: 342, height: 79)
        let bottom = CGRect(x: 24, y: 521, width: 342, height: 179)
        let continuous = image(of: view)
        XCTAssertGreaterThan(try inkPixels(in: top, image: continuous), 30, "The fixture must expose the preceding screen's text")
        XCTAssertGreaterThan(try inkPixels(in: bottom, image: continuous), 30, "The fixture must expose the following screen's text")

        session.state.preferences.navigationMode = .paged; coordinator.updateContent(view); await drain()
        for y in [offset, offset + 91] {
            // Restored source lines need not coincide with a precomputed page origin.
            view.setContentOffset(CGPoint(x: 0, y: y), animated: false); await drain()
            let screenshot = image(of: view)
            XCTAssertEqual(try inkPixels(in: top, image: screenshot), 0)
            XCTAssertEqual(try inkPixels(in: bottom, image: screenshot), 0)
            XCTAssertGreaterThan(try inkPixels(in: CGRect(x: 24, y: 100, width: 342, height: 380), image: screenshot), 500, "Clipping must keep the actual current body, including between page origins")
        }
        view.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
        XCTAssertEqual(view.bounds, bounds); XCTAssertEqual(view.contentSize, contentSize)
        XCTAssertEqual(view.textContainerInset, insets)
        XCTAssertEqual(ReaderTextPagination(textView: view, readingTop: 80, bottomInset: 180).origins, initialLayout.origins)
        XCTAssertTrue(coordinator.checkpointVisible()); XCTAssertEqual(session.currentAnchor, anchor)

        session.state.preferences.navigationMode = .scroll; coordinator.updateContent(view); await drain()
        let restored = image(of: view)
        XCTAssertGreaterThan(try inkPixels(in: top, image: restored), 30, "Switching back to scrolling must redraw the complete viewport")
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testPagedMarginsRejectNewNativeSelectionButKeepReaderTapAndPagePan() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        let (view, _) = await text(session, pageInsets: UIEdgeInsets(top: 80, left: 24, bottom: 180, right: 24))
        let tap = ReaderEdgeTapHandler(view: view, blocked: { false }, onWake: { _ in })
        let page = ReaderPageTurnGestureHandler(view: view, blocked: { false }, onTurn: { _ in })
        view.readerTapRecognizer = tap.recognizer; view.readerPageRecognizer = page.recognizer
        let hidden = CGPoint(x: 100, y: view.bounds.minY + 20)
        let body = CGPoint(x: 100, y: view.bounds.minY + 140)
        let native = LocatedLongPress(point: hidden); view.addGestureRecognizer(native)
        XCTAssertTrue(view.hitTest(hidden, with: nil) === view, "Hidden text must not receive a text-input canvas touch")
        XCTAssertFalse(view.gestureRecognizerShouldBegin(native), "A long press cannot select source that is not drawn")
        native.point = body; XCTAssertTrue(view.gestureRecognizerShouldBegin(native))
        XCTAssertNotNil(tap.destination(at: hidden), "The paper margin must still wake the reader")
        XCTAssertTrue(view.gestureRecognizerShouldBegin(tap.recognizer))
        XCTAssertTrue(view.gestureRecognizerShouldBegin(page.recognizer))
        page.invalidate(); let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testPagedMarginPreservesPublicNativeSelectionHandleHit() async throws {
        let session = try await session(); session.state.preferences.navigationMode = .paged
        let (view, _) = await text(session, pageInsets: UIEdgeInsets(top: 80, left: 24, bottom: 180, right: 24))
        let handle = PublicSelectionHandle(frame: CGRect(x: 40, y: view.bounds.minY + 60, width: 20, height: 30))
        view.addSubview(handle)
        let point = CGPoint(x: 50, y: view.bounds.minY + 70)
        XCTAssertTrue(view.hitTest(point, with: nil) === handle, "The selection handle can extend into the paper margin")
        let drag = LocatedLongPress(point: point); view.addGestureRecognizer(drag)
        XCTAssertTrue(view.gestureRecognizerShouldBegin(drag))
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testEveryOrdinaryLineAppearsWholeAndTheLastScreenHasNoClippedTopLine() async throws {
        let session = try await session(), insets = UIEdgeInsets(top: 80, left: 24, bottom: 180, right: 24)
        let (view, coordinator) = await text(session, pageInsets: insets)
        var lines: [CGRect] = []
        view.layoutManager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: view.layoutManager.numberOfGlyphs)) { _, used, _, glyphs, _ in
            if glyphs.length > 0, used.height > 0 { lines.append(used) }
        }
        XCTAssertGreaterThan(lines.count, 20)
        // Deliberately put the continuous scroll maximum in the middle of a real
        // ordinary line. This is a deterministic RED oracle for forced-max paging,
        // independent of the pager's own choices or the current Dynamic Type size.
        let cutLine = lines[lines.count - 12]
        view.frame.size.height = view.contentSize.height + view.adjustedContentInset.bottom + 80 - view.textContainerInset.top - cutLine.midY
        view.layoutIfNeeded()
        session.state.preferences.navigationMode = .paged; coordinator.updateContent(view); await drain()
        let pages = ReaderTextPagination(textView: view, readingTop: 80, bottomInset: 180)
        XCTAssertGreaterThan(pages.origins.count, 3)
        var bodies: [CGRect] = []
        for origin in pages.origins {
            view.setContentOffset(CGPoint(x: 0, y: origin), animated: false); view.layoutIfNeeded()
            let body = try XCTUnwrap(view.visibleReadingRect).offsetBy(dx: -view.textContainerInset.left, dy: -view.textContainerInset.top)
            bodies.append(body)
            for line in lines where min(line.maxY, body.maxY) - max(line.minY, body.minY) > 0.5 {
                XCTAssertGreaterThanOrEqual(line.minY + 0.5, body.minY, "A screen must not begin halfway through an ordinary source line")
                XCTAssertLessThanOrEqual(line.maxY - 0.5, body.maxY, "A screen must not end halfway through an ordinary source line")
            }
        }
        for line in lines {
            XCTAssertTrue(bodies.contains { $0.minY <= line.minY + 0.5 && $0.maxY >= line.maxY - 0.5 }, "Every ordinary source line must appear completely on at least one screen; clipping both ends cannot hide a missing line")
        }
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testPagedEndAllowanceDoesNotAccumulateAndScrollRestoresItsInsetAndSource() async throws {
        let session = try await session(), insets = UIEdgeInsets(top: 80, left: 24, bottom: 180, right: 24)
        let (view, coordinator) = await text(session, pageInsets: insets)
        view.frame.size.height = 697; view.contentInset.bottom = 11; view.layoutIfNeeded(); await drain()
        let baseline = view.contentInset
        session.state.preferences.navigationMode = .paged; coordinator.updateContent(view); await drain()
        for height in [CGFloat(695), 699, 697] {
            // Force distinct geometry keys so each pass really recalculates the
            // allowance, rather than merely hitting the pagination cache.
            view.frame.size.height = height; view.layoutIfNeeded(); coordinator.configureNavigation(view); await drain()
            view.layoutManager.ensureLayout(for: view.textContainer); view.layoutIfNeeded()
            let last = try XCTUnwrap(ReaderTextPagination(textView: view, readingTop: 80, bottomInset: 180).origins.last)
            // Measure the final rebuilt document, using the independently saved
            // raw inset. UIKit's extra line fragment can settle after replacement
            // of attributedText; its earlier contentSize is not a stable oracle.
            let automaticBottom = view.adjustedContentInset.bottom - view.contentInset.bottom
            let naturalMaximum = max(-view.adjustedContentInset.top, view.contentSize.height - view.bounds.height + baseline.bottom + automaticBottom)
            let expected = baseline.bottom + max(0, last - naturalMaximum)
            XCTAssertGreaterThan(expected, baseline.bottom + 1, "Exercise a real extra bottom allowance")
            XCTAssertEqual(view.contentInset.bottom, expected, accuracy: 0.5, "Paging owns only the exact extra space needed to display its final complete screen")
        }
        let last = try XCTUnwrap(ReaderTextPagination(textView: view, readingTop: 80, bottomInset: 180).origins.last)
        view.setContentOffset(CGPoint(x: 0, y: last), animated: false); coordinator.capture()
        let saved = try XCTUnwrap(session.currentAnchor)
        view.frame.size.width = 360; view.layoutIfNeeded(); coordinator.updateContent(view); await drain()
        XCTAssertEqual(session.currentAnchor, saved, "Reflow must retain the exact canonical source, not a proportional screen offset")
        session.state.preferences.navigationMode = .scroll; coordinator.updateContent(view); await drain()
        XCTAssertEqual(view.contentInset, baseline); XCTAssertTrue(view.panGestureRecognizer.isEnabled)
        XCTAssertEqual(session.currentAnchor, saved)
        let span = try XCTUnwrap(coordinator.spans.first { $0.passage.id == saved.passageID })
        let index = span.range.location + span.sourceOffsets.utf16Offset(forScalarOffset: saved.characterOffset)
        let glyphs = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let sourceRect = view.layoutManager.boundingRect(forGlyphRange: glyphs, in: view.textContainer).offsetBy(dx: view.textContainerInset.left, dy: view.textContainerInset.top)
        XCTAssertGreaterThan(sourceRect.intersection(view.bounds).height, 0, "The source kept in state must also remain physically visible after removing the paged allowance")
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
    }

    func testOneLongParagraphSpansRealGlyphPagesWithoutSkippingVisibleLines() async throws {
        let session = try await session(), (view, _) = await text(session)
        let layout = ReaderTextPagination(textView: view, readingTop: 64, bottomInset: 180)
        XCTAssertGreaterThan(layout.origins.count, 3, "A paragraph is not a page")
        for (start, end) in zip(layout.origins, layout.origins.dropFirst()) {
            XCTAssertGreaterThan(end, start)
            XCTAssertLessThanOrEqual(end - start, view.bounds.height - 64 - 180 + 1, "Successive screens must not skip any vertical text interval")
        }
        let lastBodyEnd = layout.origins.last! + 64 - view.textContainerInset.top + view.bounds.height - 64 - 180
        XCTAssertGreaterThanOrEqual(lastBodyEnd + 0.5, view.layoutManager.usedRect(for: view.textContainer).maxY)
        _ = await session.flush()
    }

    func testOversizedAttachmentMakesForwardProgressInsteadOfDroppingTheIllustration() {
        let view = ReflowTextView()
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
        let lastBodyEnd = layout.origins.last! + 64 - view.textContainerInset.top + view.bounds.height - 64 - 180
        XCTAssertGreaterThanOrEqual(lastBodyEnd + 0.5, view.layoutManager.usedRect(for: view.textContainer).maxY)
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
        let fixture = try await importedSession(chapters: 2), session = fixture.session
        session.state.preferences.navigationMode = .paged
        let (view, coordinator) = await text(session)
        let lastOrigin = try XCTUnwrap(ReaderTextPagination(textView: view, readingTop: 64, bottomInset: 24).origins.last)
        view.setContentOffset(CGPoint(x: 0, y: lastOrigin), animated: false)
        coordinator.capture()
        XCTAssertTrue(coordinator.turnPage(.next)); await drain()
        XCTAssertEqual(session.chapterIndex, 1); XCTAssertEqual(view.contentOffset.y, 0, accuracy: 1)
        XCTAssertTrue(coordinator.turnPage(.previous)); await drain()
        XCTAssertEqual(session.chapterIndex, 0)
        XCTAssertEqual(view.contentOffset.y, lastOrigin, accuracy: 1)
        session.go(to: 1); coordinator.updateContent(view); await drain()
        view.setContentOffset(CGPoint(x: 0, y: try XCTUnwrap(ReaderTextPagination(textView: view, readingTop: 64, bottomInset: 24).origins.last)), animated: false)
        coordinator.capture()
        XCTAssertFalse(coordinator.turnPage(.next), "The book end must not loop to chapter one")
        let saved = try XCTUnwrap(session.currentAnchor), receipt = await session.flush()
        XCTAssertTrue(receipt.succeeded); XCTAssertNil(session.saveError)
        let state = try await fixture.library.state(session.book.id)
        XCTAssertEqual(state.anchor, saved)
        let reopened = ReaderSession(book: try await fixture.library.book(session.book.id), state: state,
                                     original: try await fixture.library.originalURL(session.book.id), directory: try await fixture.library.bookDirectory(session.book.id), library: fixture.library)
        let (reopenedView, reopenedCoordinator) = await text(reopened)
        XCTAssertEqual(reopened.chapterIndex, 1); XCTAssertEqual(reopened.currentAnchor, saved)
        let span = try XCTUnwrap(reopenedCoordinator.spans.first { $0.passage.id == saved.passageID })
        let index = span.range.location + span.sourceOffsets.utf16Offset(forScalarOffset: saved.characterOffset)
        let glyphs = reopenedView.layoutManager.glyphRange(forCharacterRange: NSRange(location: index, length: 1), actualCharacterRange: nil)
        let sourceRect = reopenedView.layoutManager.boundingRect(forGlyphRange: glyphs, in: reopenedView.textContainer)
            .offsetBy(dx: reopenedView.textContainerInset.left, dy: reopenedView.textContainerInset.top)
        let body = try XCTUnwrap(reopenedView.visibleReadingRect)
        XCTAssertGreaterThan(sourceRect.intersection(body).height, 0, "A fresh persisted session must physically show the same source on the last chapter's final screen")
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

    private func replacingPDFDismissal(_ parent: PDFReadingView, with id: UUID) -> PDFReadingView {
        PDFReadingView(session: parent.session, pageInsets: parent.pageInsets, selectionDismissalID: id,
                       onSelection: parent.onSelection, onWake: parent.onWake, onReadingScroll: parent.onReadingScroll,
                       onPageChange: parent.onPageChange)
    }
    private func pdfHost(_ session: ReaderSession, onPageChange: ((ReaderPagePosition) -> Void)? = nil) throws -> (PDFView, PDFReadingView.Coordinator) {
        let parent = PDFReadingView(session: session, pageInsets: UIEdgeInsets(top: 64, left: 0, bottom: 124, right: 0), selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {}, onPageChange: onPageChange)
        let coordinator = parent.makeCoordinator(), view = PDFView()
        view.autoScales = true; view.backgroundColor = .white; view.overrideUserInterfaceStyle = .light
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive })
        host(view, scene: scene); coordinator.view = view; coordinator.observe(view)
        addTeardownBlock { await MainActor.run { coordinator.invalidate() } }
        return (view, coordinator)
    }
    private func settlePDF(_ view: PDFView, coordinator: PDFReadingView.Coordinator, source: URL, page index: Int, mode: ReaderNavigationMode) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + 3
        var stableFrames = 0
        repeat {
            view.layoutDocumentView(); view.layoutIfNeeded()
            let pageIndex = view.currentPage.flatMap { view.document?.index(for: $0) }
            let ready = view.document?.documentURL == source && pageIndex == index && !coordinator.restoring && view.scaleFactor > 0
                && view.isUsingPageViewController == (mode == .paged)
                && view.window?.isKeyWindow == true && (view.window?.layer.presentation()?.opacity ?? 0) >= 0.999
            stableFrames = ready ? stableFrames + 1 : 0
            if stableFrames >= 2 { await drain(); return }
            try await Task.sleep(for: .milliseconds(20))
        } while ProcessInfo.processInfo.systemUptime < deadline
        XCTFail("The real PDF view did not settle at its requested source/page/mode; restoring=\(coordinator.restoring), page=\(String(describing: view.currentPage.flatMap { view.document?.index(for: $0) }))")
        throw NSError(domain: "ReaderPaginationPDFFixture", code: 1)
    }
    func testPDFScheduledConfigurationWaitsAndCoalescesToTheLatestReaderAndAnchor() async throws {
        let first = try await importedSession(pdf: true, source: "Old PDF witness"), latest = try await importedSession(pdf: true, source: "Latest PDF witness")
        var reported: [(String, ReaderPagePosition)] = []
        let (oldView, coordinator) = try pdfHost(first.session, onPageChange: { reported.append(("old", $0)) })
        coordinator.scheduleUpdate(oldView)
        XCTAssertNil(oldView.document, "updateUIView must return before document/page-controller configuration")
        let (view, unused) = try pdfHost(latest.session); unused.invalidate()
        latest.session.state.preferences.navigationMode = .scroll
        latest.session.go(to: 1, anchor: ReadingAnchor(chapterID: "page-2", passageID: "page-2", pageY: 450))
        coordinator.parent = PDFReadingView(session: latest.session, pageInsets: UIEdgeInsets(top: 64, left: 0, bottom: 124, right: 0), selectionDismissalID: UUID(), onSelection: { _ in }, onWake: { _ in }, onReadingScroll: {}, onPageChange: { reported.append(("latest", $0)) })
        coordinator.observe(view); coordinator.scheduleUpdate(view)
        latest.session.state.preferences.navigationMode = .paged
        latest.session.go(to: 2, anchor: ReadingAnchor(chapterID: "page-3", passageID: "page-3", pageY: 420))
        coordinator.scheduleUpdate(view)
        let target = ReadingAnchor(chapterID: "page-3", passageID: "page-3", pageY: 400)
        latest.session.moved(target) // Same nav: read the latest canonical point when work executes.
        XCTAssertNil(view.document, "Coalescing cannot synchronously configure the newer native view either")
        try await settlePDF(view, coordinator: coordinator, source: latest.session.original, page: 2, mode: .paged)
        XCTAssertNil(oldView.document, "An abandoned view/book request must never acquire the newer reader's source")
        XCTAssertEqual(latest.session.currentAnchor, target)
        XCTAssertEqual(view.displayMode, .singlePage); XCTAssertEqual(view.displayDirection, .horizontal)
        let expectedNativeText = "Latest PDF witness PAGE 3", actualNativeText = view.currentPage?.string
        XCTAssertTrue((actualNativeText ?? "").contains(expectedNativeText), "Expected exact marker \(String(reflecting: expectedNativeText)); actual PDFKit page text \(String(reflecting: actualNativeText)); native page index \(String(describing: view.currentPage.flatMap { view.document?.index(for: $0) }))")
        XCTAssertFalse(reported.isEmpty)
        XCTAssertTrue(reported.allSatisfy { $0.0 == "latest" && $0.1.index == 2 && $0.1.count == 3 }, "Stale callbacks cannot report the old owner/page")
        let receipt = await latest.session.flush(); XCTAssertTrue(receipt.succeeded)
        _ = await first.session.flush()
    }

    func testPDFQueuedNavigationRejectsOldNativePageChangesAndInvalidationCancels() async throws {
        let fixture = try await importedSession(pdf: true, source: "Queued PDF witness"), session = fixture.session
        session.state.preferences.navigationMode = .paged
        let (view, coordinator) = try pdfHost(session)
        coordinator.scheduleUpdate(view)
        try await settlePDF(view, coordinator: coordinator, source: session.original, page: 0, mode: .paged)
        let events = PDFPageEventLog()
        let observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak view] _ in
            MainActor.assumeIsolated {
                if let view, let page = view.currentPage, let index = view.document?.index(for: page) { events.indices.append(index) }
            }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        let target = ReadingAnchor(chapterID: "page-3", passageID: "page-3", pageY: 400)
        session.go(to: 2, anchor: target); let navigation = session.navigationID
        coordinator.scheduleUpdate(view)
        view.go(to: try XCTUnwrap(view.document?.page(at: 1))) // Real old-view notification, never a fabricated NotificationCenter post.
        XCTAssertTrue(events.indices.contains(1), "The old native page notification must actually arrive before the queued update; otherwise this fixture has not proved the pending-window guard")
        XCTAssertEqual(session.navigationID, navigation)
        XCTAssertEqual(session.currentAnchor, target, "Old native geometry between scheduling and execution cannot overwrite a newly chosen source anchor")
        try await settlePDF(view, coordinator: coordinator, source: session.original, page: 2, mode: .paged)
        XCTAssertEqual(session.navigationID, navigation); XCTAssertEqual(session.currentAnchor, target)
        let abandoned = PDFView(); host(abandoned)
        coordinator.scheduleUpdate(abandoned); coordinator.invalidate()
        for _ in 0..<4 { await drain() }
        XCTAssertNil(abandoned.document, "Dismantling cancels queued native document/page-controller work")
        XCTAssertEqual(session.currentAnchor, target)
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
        let saved = try await fixture.library.state(session.book.id); XCTAssertEqual(saved.anchor, target)
    }

    func testPDFCoalescedOldDismissalKeepsANewerRealNativeSelectionAndFreshDismissalClearsIt() async throws {
        let fixture = try await importedSession(pdf: true, source: "Revision PDF witness"), session = fixture.session
        session.state.preferences.navigationMode = .scroll
        let (view, coordinator) = try pdfHost(session)
        coordinator.scheduleUpdate(view)
        try await settlePDF(view, coordinator: coordinator, source: session.original, page: 0, mode: .scroll)
        let page = try XCTUnwrap(view.currentPage), original = try XCTUnwrap(page.string) as NSString
        func selection(_ words: String) throws -> PDFSelection {
            let range = original.range(of: words)
            let result = try XCTUnwrap(range.location == NSNotFound ? nil : page.selection(for: range),
                "Expected exact native selection marker \(String(reflecting: words)); actual PDFKit page text \(String(reflecting: original as String)); source range \(range.location),\(range.length); native page index \(String(describing: view.document?.index(for: page)))")
            XCTAssertEqual(result.string, words)
            return result
        }
        let first = try selection("SYNTHETIC PDF PAGE 1"), newest = try selection("Revision PDF witness PAGE 1")
        XCTAssertNotEqual(first.string, newest.string)
        let events = PDFPageEventLog()
        let observer = NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak view] _ in
            MainActor.assumeIsolated {
                events.selectionChanges += 1
                events.selectionStrings.append(view?.currentSelection?.string ?? "<none>")
            }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        view.setCurrentSelection(first, animate: false)
        XCTAssertEqual(view.currentSelection?.string, first.string)
        XCTAssertGreaterThan(events.selectionChanges, 0, "Selection A must deliver an actual native notification before queueing the dismissal")
        XCTAssertEqual(events.selectionStrings.last, first.string)
        let afterFirstSelection = events.selectionChanges
        coordinator.parent = replacingPDFDismissal(coordinator.parent, with: UUID())
        let dismissal = coordinator.parent.selectionDismissalID
        coordinator.scheduleUpdate(view)
        XCTAssertEqual(view.currentSelection?.string, first.string, "Scheduling cannot synchronously clear a real native selection")
        view.setCurrentSelection(newest, animate: false)
        XCTAssertEqual(view.currentSelection?.string, newest.string)
        XCTAssertGreaterThan(events.selectionChanges, afterFirstSelection, "Selection B must notify while actually current and before queued work; later notifications cannot prove this race")
        XCTAssertEqual(events.selectionStrings.last, newest.string)
        coordinator.scheduleUpdate(view) // Same dismissal ID must retain its first-enqueue revision.
        XCTAssertEqual(coordinator.parent.selectionDismissalID, dismissal)
        try await settlePDF(view, coordinator: coordinator, source: session.original, page: 0, mode: .scroll)
        XCTAssertGreaterThanOrEqual(events.selectionChanges, 2, "Both selections must deliver real PDFKit notifications; no synthetic post is used")
        XCTAssertEqual(view.currentSelection?.string, newest.string, "A stale dismissal coalesced after a newer real selection must not clear that selection")
        let beforeFreshDismissal = events.selectionChanges
        coordinator.parent = replacingPDFDismissal(coordinator.parent, with: UUID())
        XCTAssertNotEqual(coordinator.parent.selectionDismissalID, dismissal)
        coordinator.scheduleUpdate(view)
        try await settlePDF(view, coordinator: coordinator, source: session.original, page: 0, mode: .scroll)
        XCTAssertNil(view.currentSelection, "A genuinely fresh dismissal with no intervening selection still has to clear the native selection")
        XCTAssertGreaterThan(events.selectionChanges, beforeFreshDismissal)
        let receipt = await session.flush(); XCTAssertTrue(receipt.succeeded)
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
