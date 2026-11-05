import XCTest
import UIKit
import PDFKit
import SwiftUI
import LeafhourCore
@testable import Leafhour

/// Real TextKit/PDFKit layout with synthetic files. Physical touch gestures and
/// VoiceOver remain separate device acceptance; these tests do not claim them.
@MainActor final class ReaderBookmarkAppTests: XCTestCase {
    func testBookmarkPanelAtNarrowNormalAndAccessibilitySizes() async throws {
        let session = try await fixture()
        let source = ReadingAnchor(chapterID: session.chapter.id, passageID: try XCTUnwrap(session.chapter.passages.first).id)
        let saved = await session.addBookmark(at: source)
        XCTAssertTrue(saved.succeeded)
        let bookmark = try XCTUnwrap(session.bookmarks.first), anchor = session.currentAnchor
        for size in [DynamicTypeSize.large, .accessibility5] {
            let controller = UIHostingController(rootView: NavigationStack {
                ReaderBookmarkPanel(session: session, initialBookmarkID: bookmark.id)
            }.environment(\.dynamicTypeSize, size))
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 568))
            window.rootViewController = controller; window.makeKeyAndVisible(); controller.view.frame = window.bounds
            try await Task.sleep(for: .milliseconds(200)); controller.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image); attachment.name = "GET408-Narrow-" + String(describing: size)
            attachment.lifetime = .keepAlways; add(attachment)
            XCTAssertEqual(session.bookmarks, [bookmark]); XCTAssertEqual(session.currentAnchor, anchor)
            window.isHidden = true; window.rootViewController = nil
        }
    }

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

    func testLongTranslationPagesSaveDistinctDisplayOffsetsAndRestoreAfterTemplateSwitch() async throws {
        let session = try await fixture(source: "A short real author paragraph."), passage = session.chapter.passages[0]
        let translation = String(repeating: "译文😀有自己可核对的位置。Translated display words preserve their own snapshot. ", count: 150)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh))
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, literal: translation, targetLanguage: .zh)])
        var preferences = session.state.preferences; preferences.viewMode = .translation; preferences.pageAnimation = .none
        session.changePreferences(preferences)
        var ranges: [ReaderBookmarkVisibleRange] = []
        let reading = TextReadingView(session: session, pageInsets: UIEdgeInsets(top: 40, left: 20, bottom: 40, right: 20), onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onBookmarkViewport: { ranges = $0 }, onBookmarkCapture: { _ in })
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text); coordinator.updateContent(text); await settle()
        defer { coordinator.invalidate() }
        text.setContentOffset(CGPoint(x: 0, y: 1200), animated: false); coordinator.capture(); await settle()
        let first = try XCTUnwrap(coordinator.bookmarkCapture())
        XCTAssertGreaterThan(try XCTUnwrap(first.presentation).utf16Offset, 0)
        let firstSaved = await session.addBookmark(capture: first); XCTAssertTrue(firstSaved.succeeded)
        text.setContentOffset(CGPoint(x: 0, y: 2500), animated: false); coordinator.capture(); await settle()
        let second = try XCTUnwrap(coordinator.bookmarkCapture())
        let secondSaved = await session.addBookmark(capture: second); XCTAssertTrue(secondSaved.succeeded)
        XCTAssertEqual(session.bookmarks.count, 2)
        XCTAssertEqual(first.anchor, second.anchor, "Both source identities stay at the real source paragraph; display offsets are independent")
        XCTAssertNotEqual(first.presentation?.utf16Offset, second.presentation?.utf16Offset)
        XCTAssertEqual(session.bookmarks(in: ranges).map(\.presentation), [second.presentation])
        let id = try XCTUnwrap(session.bookmark(capture: first)?.id)
        preferences.viewMode = .source; session.changePreferences(preferences); coordinator.updateContent(text); await settle()
        XCTAssertTrue(session.goToBookmark(id: id)); coordinator.updateContent(text); await settle()
        XCTAssertEqual(session.state.preferences.viewMode, .translation)
        XCTAssertEqual(coordinator.bookmarkCapture()?.presentation?.utf16Offset, first.presentation?.utf16Offset)
        XCTAssertGreaterThan(text.contentOffset.y, 800, "Restoring a translated page must not land at the canonical source paragraph start")
    }

    func testParallelBookmarkRestoresItsTranslatedLayerAndChangedTranslationDoesNotJump() async throws {
        let session = try await fixture(source: "A short author paragraph."), passage = session.chapter.passages[0]
        let translated = String(repeating: "Verified parallel translation content. ", count: 200)
        session.changeTranslationSettings(BookTranslationSettings(sourceLanguage: .en, targetLanguage: .zh))
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, interpretive: translated, targetLanguage: .zh)])
        var prefs = session.state.preferences; prefs.viewMode = .parallel; prefs.translationVariant = .interpretive; session.changePreferences(prefs)
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {}, onBookmarkCapture: { _ in })
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        coordinator.view = text; host(text); coordinator.updateContent(text); await settle()
        defer { coordinator.invalidate() }
        text.setContentOffset(CGPoint(x: 0, y: 1600), animated: false); coordinator.capture(); await settle()
        let captured = try XCTUnwrap(coordinator.bookmarkCapture())
        XCTAssertNotNil(captured.presentation)
        _ = await session.addBookmark(capture: captured)
        let id = try XCTUnwrap(session.bookmarks.first?.id)
        prefs.viewMode = .source; session.changePreferences(prefs); coordinator.updateContent(text); await settle()
        XCTAssertTrue(session.goToBookmark(id: id)); coordinator.updateContent(text); await settle()
        XCTAssertEqual(session.state.preferences.viewMode, .parallel)
        XCTAssertEqual(coordinator.bookmarkCapture()?.presentation?.utf16Offset, captured.presentation?.utf16Offset)
        session.updateTranslations([passage.id: ReadingTranslation(original: passage.text, interpretive: "A changed snapshot. " + translated, targetLanguage: .zh)])
        let before = text.contentOffset
        XCTAssertFalse(session.goToBookmark(id: id))
        XCTAssertEqual(text.contentOffset, before)
        XCTAssertTrue(session.message?.contains("待核对") == true)
    }

    func testMissingMarkdownTranslationAddsNonSourceCaptionAndKeepsFormattedQuoteMapping() async throws {
        let session = try await fixture(filename: "fixture.md", source: "# Synthetic heading\n\nA **bold** source 😀 remains selectable.\n\nAnother source paragraph.")
        var preferences = session.state.preferences
        preferences.viewMode = .parallel; preferences.parallelSourceOpacity = 0.75; preferences.parallelSourceScale = 0.8; preferences.parallelSpacing = 28
        session.changePreferences(preferences)
        let reading = TextReadingView(session: session, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = reading.makeCoordinator(), text = UITextView(usingTextLayoutManager: false)
        text.isSelectable = true; text.isEditable = false
        coordinator.view = text; host(text); coordinator.updateContent(text); await settle()
        defer { coordinator.invalidate() }
        XCTAssertTrue(text.text.hasPrefix("译文尚未准备 · 原文"))
        XCTAssertGreaterThan(coordinator.markdownDisplayPrefix, 0)
        XCTAssertNil(coordinator.selectedQuote(in: text, range: NSRange(location: 0, length: 2)), "Status caption must not become an author-source quote")
        let displayed = (text.text as NSString).range(of: "bold")
        XCTAssertNotEqual(displayed.location, NSNotFound)
        let quote = try XCTUnwrap(coordinator.selectedQuote(in: text, range: displayed))
        XCTAssertEqual(quote.text, "bold")
        let passage = try XCTUnwrap(session.chapter.passages.first { $0.id == quote.anchor.passageID })
        let sourceRange = (passage.text as NSString).range(of: "bold")
        XCTAssertEqual(quote.anchor.characterOffset, (passage.text as NSString).substring(to: sourceRange.location).unicodeScalars.count)
        let ink = try XCTUnwrap(text.attributedText.attribute(.foregroundColor, at: displayed.location, effectiveRange: nil) as? UIColor)
        XCTAssertEqual(ink.cgColor.alpha, 0.75, accuracy: 0.01)
        let style = try XCTUnwrap(text.attributedText.attribute(.paragraphStyle, at: displayed.location, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(style.paragraphSpacing, 28, accuracy: 0.01)
    }

    private func fixture(pdf: Bool = false, filename: String = "fixture.txt", source: String? = nil) async throws -> ReaderSession {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("BookmarkApp-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent(pdf ? "fixture.pdf" : filename)
        if pdf {
            try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 500)).writePDF(to: file) { context in
                context.beginPage(); UIColor.gray.setFill(); context.cgContext.fill(CGRect(x: 20, y: 30, width: 200, height: 350))
            }
        } else { try Data((source ?? String(repeating: "Visible original 😀 words preserve their scalar anchor. ", count: 350)).utf8).write(to: file) }
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
