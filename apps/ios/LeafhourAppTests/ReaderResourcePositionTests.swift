import XCTest
import UIKit
import ZIPFoundation
import LeafhourCore
@testable import Leafhour

/// Real temporary EPUB imports and UIKit windows. No network or real account.
/// These tests compile against the old model: behavior and Codable JSON provide
/// RED without requiring the proposed resourceY property to exist first.
@MainActor
final class ReaderResourcePositionTests: XCTestCase {
    private let insets = UIEdgeInsets(top: 80, left: 24, bottom: 140, right: 24)
    private struct Fixture {
        let library: OfflineLibrary
        let book: LocalBook
        let original: URL
        let directory: URL
        let imageID: String
        let imageURL: URL
        let originalBytes: Data
        let imageBytes: Data
    }
    private struct Host {
        let session: ReaderSession
        let window: UIWindow
        let controller: UIViewController
        let view: ReflowTextView
        let coordinator: TextReadingView.Coordinator
    }
    private struct Sample { let anchor: ReadingAnchor; let ratio: CGFloat }
    private enum FixtureError: Error { case noTwoMiddleScreens, windowNotSettled }

    private func drain() async {
        for _ in 0..<3 {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                DispatchQueue.main.async { continuation.resume() }
            }
        }
    }
    private func fixture() async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ResourcePosition-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.preferredRange = .standard
        let png = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 280), format: format).image { context in
            for (index, color) in [UIColor.red, .green, .blue, .yellow, .cyan, .magenta, .orange].enumerated() {
                color.setFill(); context.fill(CGRect(x: 0, y: CGFloat(index * 40), width: 40, height: 40))
            }
        }
        let imageBytes = try XCTUnwrap(png.pngData()), file = root.appendingPathComponent("striped-source.epub")
        let after = String(repeating: "After the illustration, this original source paragraph remains readable and selectable. ", count: 60)
        let entries: [(String, Data)] = [
            ("mimetype", Data("application/epub+zip".utf8)),
            ("META-INF/container.xml", Data("<container><rootfiles><rootfile full-path=\"OPS/package.opf\"/></rootfiles></container>".utf8)),
            ("OPS/package.opf", Data("<package><metadata><title>Synthetic striped source</title></metadata><manifest><item id=\"body\" href=\"body.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"stripes\" href=\"stripes.png\" media-type=\"image/png\"/></manifest><spine><itemref idref=\"body\"/></spine></package>".utf8)),
            ("OPS/body.xhtml", Data(("<html><body><p id=\"before\">Original source before the illustration.</p><img id=\"illustration\" src=\"stripes.png\" alt=\"Source color bands\"/><p id=\"after\">" + after + "</p></body></html>").utf8)),
            ("OPS/stripes.png", imageBytes)
        ]
        let archive = try Archive(url: file, accessMode: .create)
        for (path, data) in entries {
            try archive.addEntry(with: path, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .none) { position, size in
                data.subdata(in: Int(position)..<min(Int(position) + size, data.count))
            }
        }
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .account(UUID()))
        let book = try await library.importFile(file), original = try await library.originalURL(book.id), directory = try await library.bookDirectory(book.id)
        XCTAssertEqual(book.chapters.count, 1)
        let image = try XCTUnwrap(book.chapters.first?.passages.first { $0.resourcePath != nil })
        let imageURL = directory.appendingPathComponent("assets").appendingPathComponent(try XCTUnwrap(image.resourcePath))
        XCTAssertEqual(try Data(contentsOf: imageURL), imageBytes)
        return Fixture(library: library, book: book, original: original, directory: directory, imageID: image.id,
                       imageURL: imageURL, originalBytes: try Data(contentsOf: original), imageBytes: imageBytes)
    }
    private func open(_ fixture: Fixture, state: ReaderState? = nil) async throws -> Host {
        var initial: ReaderState
        if let state { initial = state } else { initial = try await fixture.library.state(fixture.book.id) }
        initial.preferences.navigationMode = .paged
        let session = ReaderSession(book: try await fixture.library.book(fixture.book.id), state: initial,
                                    original: fixture.original, directory: fixture.directory, library: fixture.library)
        let parent = TextReadingView(session: session, pageInsets: insets, onNote: { _ in }, onSource: { _ in }, onWake: { _ in }, onReadingScroll: {})
        let coordinator = parent.makeCoordinator(), view = ReflowTextView()
        view.isEditable = false; view.isSelectable = true; view.backgroundColor = .white
        view.textContainer.lineFragmentPadding = 0; view.contentInsetAdjustmentBehavior = .never
        view.delegate = coordinator; coordinator.view = view
        view.onSizeChange = { [weak coordinator, weak view] in
            guard let coordinator, let view else { return }; coordinator.updateContent(view)
        }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }, "The host needs a real foreground scene for onscreen pixel evidence")
        let previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        let controller = UIViewController(), window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        controller.traitOverrides.preferredContentSizeCategory = .large
        UIView.performWithoutAnimation {
            window.overrideUserInterfaceStyle = .light; window.rootViewController = controller
            controller.view.frame = window.bounds; view.frame = window.bounds; controller.view.addSubview(view)
            controller.updateTraitsIfNeeded(); view.updateTraitsIfNeeded(); view.layoutIfNeeded()
            window.makeKeyAndVisible(); window.layoutIfNeeded()
        }
        coordinator.updateContent(view); await drain()
        addTeardownBlock { await MainActor.run {
            view.onSizeChange = nil; coordinator.invalidate(); view.delegate = nil
            window.isHidden = true; window.rootViewController = nil
            if let previousKeyWindow, !previousKeyWindow.isHidden { previousKeyWindow.makeKey() }
        } }
        let host = Host(session: session, window: window, controller: controller, view: view, coordinator: coordinator)
        try await settleWindow(host)
        return host
    }
    private func settleWindow(_ host: Host) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        var stableFrames = 0, diagnostic = ""
        repeat {
            host.window.layoutIfNeeded()
            var ancestry: [UIView] = [], current: UIView? = host.view
            while let view = current { ancestry.append(view); current = view.superview }
            let visible = host.window.isKeyWindow && !host.window.isHidden && host.view.window === host.window
            let settled = ancestry.allSatisfy { view in
                guard !view.isHidden, view.alpha >= 0.999, view.layer.opacity >= 0.999,
                      let presentation = view.layer.presentation(), presentation.opacity >= 0.999,
                      (view.layer.animationKeys() ?? []).isEmpty else { return false }
                return true
            }
            stableFrames = visible && settled ? stableFrames + 1 : 0
            if stableFrames >= 2 { return }
            diagnostic = "key=\(host.window.isKeyWindow), scene=\(String(describing: host.window.windowScene?.activationState)), " + ancestry.map {
                "\(type(of: $0)):alpha=\($0.alpha),model=\($0.layer.opacity),presentation=\(String(describing: $0.layer.presentation()?.opacity)),animations=\($0.layer.animationKeys() ?? [])"
            }.joined(separator: "; ")
            // Yield actual display time. Queue drains alone can precede the
            // first appearance frame; readiness never polls reader pixel colors.
            try await Task.sleep(for: .milliseconds(20))
        } while ProcessInfo.processInfo.systemUptime < deadline
        XCTFail("Fixture window did not reach its real visible presentation: " + diagnostic)
        throw FixtureError.windowNotSettled
    }
    private func imageRect(_ host: Host, fixture: Fixture) throws -> CGRect {
        let span = try XCTUnwrap(host.coordinator.spans.first { $0.passage.id == fixture.imageID })
        let attachment = try XCTUnwrap(host.view.attributedText.attribute(.attachment, at: span.range.location, effectiveRange: nil) as? NSTextAttachment)
        XCTAssertNotNil(attachment.image, "Exercise a real rendered source asset")
        host.view.layoutManager.ensureLayout(for: host.view.textContainer)
        let glyphs = host.view.layoutManager.glyphRange(forCharacterRange: NSRange(location: span.range.location, length: 1), actualCharacterRange: nil)
        return host.view.layoutManager.boundingRect(forGlyphRange: glyphs, in: host.view.textContainer)
    }
    private func visibleRatio(_ host: Host, fixture: Fixture) throws -> CGFloat {
        let rect = try imageRect(host, fixture: fixture)
        let readingTop = host.view.visibleReadingRect?.minY ?? (host.view.bounds.minY + insets.top)
        return (readingTop - host.view.textContainerInset.top - rect.minY) / rect.height
    }
    private func twoMiddleScreens(_ host: Host, fixture: Fixture) async throws -> (Sample, Sample) {
        var samples: [Sample] = []
        for _ in 0..<12 {
            let ratio = try visibleRatio(host, fixture: fixture)
            if ratio > 0.2, ratio < 0.8, let anchor = host.session.currentAnchor, anchor.passageID == fixture.imageID {
                samples.append(Sample(anchor: anchor, ratio: ratio))
                if samples.count == 2 { return (samples[0], samples[1]) }
            }
            guard host.coordinator.turnPage(.next) else { break }
            host.view.layer.removeAnimation(forKey: ReaderPageTransition.key)
            await drain()
        }
        XCTFail("The real imported image must expose two different interior screens")
        throw FixtureError.noTwoMiddleScreens
    }
    private func encoded(_ anchor: ReadingAnchor) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(anchor)) as? [String: Any])
    }
    private func screenshot(_ host: Host, name: String) async throws -> UIImage {
        try await settleWindow(host)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true; format.preferredRange = .standard
        let image = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format).image { _ in
            XCTAssertTrue(host.view.drawHierarchy(in: CGRect(origin: .zero, size: host.view.bounds.size), afterScreenUpdates: true))
        }
        let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let background = try pixel(try XCTUnwrap(image.cgImage), x: 4, y: 4)
        XCTAssertTrue(background.allSatisfy { $0 >= 252 }, "The fixture's white background must actually render at full opacity before interpreting source color: \(background)")
        return image
    }
    private func pixel(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
        let crop = try XCTUnwrap(image.cropping(to: CGRect(x: CGFloat(x), y: CGFloat(y), width: 1, height: 1)))
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        var rgba = [UInt8](repeating: 0, count: 4)
        try rgba.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                                 space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            context.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return Array(rgba.prefix(3))
    }
    private func bodyPixel(_ image: UIImage, host: Host) throws -> [UInt8] {
        try pixel(try XCTUnwrap(image.cgImage), x: Int(host.view.bounds.width / 2), y: Int(insets.top + 12))
    }
    private func assertSourceColor(_ actual: [UInt8], fixture: Fixture, file: StaticString = #filePath, line: UInt = #line) throws {
        let original = try XCTUnwrap(UIImage(data: fixture.imageBytes)?.cgImage, file: file, line: line)
        let palette = try (0..<7).map { try pixel(original, x: 20, y: 20 + $0 * 40) }
        XCTAssertTrue(palette.allSatisfy { Int($0.max()!) - Int($0.min()!) > 80 }, "The seven source bands must actually contain colored pixels", file: file, line: line)
        XCTAssertGreaterThan(Int(actual.max()!) - Int(actual.min()!), 80, "A blank white/black reader cannot stand in for an image interior", file: file, line: line)
        XCTAssertTrue(palette.contains { zip($0, actual).allSatisfy { abs(Int($0.0) - Int($0.1)) <= 8 } }, "The visible pixel must belong to the real imported source palette", file: file, line: line)
    }
    private func decoded(_ fields: [String: Any]) throws -> ReadingAnchor {
        let decoder = JSONDecoder()
        decoder.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        return try decoder.decode(ReadingAnchor.self, from: JSONSerialization.data(withJSONObject: fields))
    }
    private func assertSourceUnchanged(_ fixture: Fixture) async throws {
        let disk = try await fixture.library.book(fixture.book.id)
        XCTAssertEqual(disk.chapters, fixture.book.chapters); XCTAssertEqual(disk.sourceVersion, fixture.book.sourceVersion)
        XCTAssertEqual(try Data(contentsOf: fixture.original), fixture.originalBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.imageURL), fixture.imageBytes)
    }

    func testTallImportedImageKeepsItsInternalPositionAfterSaveAndColdOpen() async throws {
        let fixture = try await fixture(), host = try await open(fixture)
        let (first, second) = try await twoMiddleScreens(host, fixture: fixture)
        XCTAssertGreaterThan(second.ratio - first.ratio, 0.1)
        XCTAssertNotEqual(first.anchor, second.anchor, "Different image slices need different durable positions, even with source scalar zero")
        XCTAssertEqual(first.anchor.key, second.anchor.key, "Reading detail must not rename note/draft identities")
        XCTAssertEqual(second.anchor.characterOffset, 0)
        let before = try await screenshot(host, name: "Actual image interior before closing")
        let receipt = await host.session.flush(); XCTAssertTrue(receipt.succeeded); XCTAssertNil(host.session.saveError)
        let state = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(state.anchor, second.anchor)
        let cold = try await open(fixture, state: state)
        XCTAssertEqual(cold.session.currentAnchor, second.anchor)
        XCTAssertEqual(try visibleRatio(cold, fixture: fixture), second.ratio, accuracy: 0.002, "The new window must show the same point inside the original image, not its top")
        let after = try await screenshot(cold, name: "Actual image interior after cold opening")
        let beforePixel = try bodyPixel(before, host: host), afterPixel = try bodyPixel(after, host: cold)
        try assertSourceColor(beforePixel, fixture: fixture); try assertSourceColor(afterPixel, fixture: fixture)
        XCTAssertEqual(afterPixel, beforePixel, "The same original color band must actually render at the reading edge")
        try await assertSourceUnchanged(fixture)
    }

    func testTallImportedImageKeepsItsInternalPositionThroughWidthAndModeReflow() async throws {
        let fixture = try await fixture(), host = try await open(fixture)
        let (_, saved) = try await twoMiddleScreens(host, fixture: fixture)
        for (width, mode) in [(CGFloat(320), ReaderNavigationMode.paged), (420, .paged), (320, .scroll), (390, .paged)] {
            host.session.state.preferences.navigationMode = mode
            host.window.frame.size.width = width; host.controller.view.frame = host.window.bounds; host.view.frame = host.window.bounds
            host.view.layoutIfNeeded(); host.coordinator.updateContent(host.view); await drain()
            XCTAssertEqual(host.session.currentAnchor, saved.anchor)
            XCTAssertEqual(try visibleRatio(host, fixture: fixture), saved.ratio, accuracy: 0.002, "Source-relative image Y must survive real column width and mode changes")
        }
        let receipt = await host.session.flush(); XCTAssertTrue(receipt.succeeded); XCTAssertNil(host.session.saveError)
        let state = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(state.anchor, saved.anchor)
        try await assertSourceUnchanged(fixture)
    }

    func testResourceCoordinateIsOptionalValidatedAndNeverAppliedToOrdinaryText() async throws {
        let fixture = try await fixture(), chapter = fixture.book.chapters[0]
        let legacy = ReadingAnchor(chapterID: chapter.id, passageID: fixture.imageID)
        XCTAssertNil(try encoded(legacy)["resourceY"])
        XCTAssertEqual(try decoded(["chapterID": chapter.id, "passageID": fixture.imageID, "characterOffset": 0]), legacy)
        let valid = try decoded(["chapterID": chapter.id, "passageID": fixture.imageID, "characterOffset": 0, "resourceY": 0.5])
        XCTAssertEqual(try encoded(valid)["resourceY"] as? Double, 0.5)
        var state = ReaderState(); state.anchor = valid
        try await fixture.library.saveState(state, bookID: fixture.book.id)
        let text = try XCTUnwrap(chapter.passages.first { $0.resourcePath == nil && !$0.text.isEmpty })
        for (passageID, ratio) in [(fixture.imageID, -0.1 as Any), (fixture.imageID, 1.1 as Any), (fixture.imageID, "Infinity" as Any), (text.id, 0.5 as Any)] {
            let invalid = try decoded(["chapterID": chapter.id, "passageID": passageID, "characterOffset": 0, "resourceY": ratio])
            var invalidState = ReaderState(); invalidState.anchor = invalid
            do { try await fixture.library.saveState(invalidState, bookID: fixture.book.id); XCTFail("Invalid or non-resource image coordinates cannot overwrite saved progress") }
            catch {}
            let session = ReaderSession(book: fixture.book, state: invalidState, original: fixture.original, directory: fixture.directory, library: fixture.library)
            XCTAssertNil(try encoded(try XCTUnwrap(session.currentAnchor))["resourceY"], "Malformed image coordinates must fall back without inventing a textual location")
        }
        let retained = try await fixture.library.state(fixture.book.id)
        XCTAssertEqual(retained.anchor, valid)
        let host = try await open(fixture, state: ReaderState())
        host.coordinator.capture()
        XCTAssertNotEqual(host.session.currentAnchor?.passageID, fixture.imageID)
        XCTAssertNil(try encoded(try XCTUnwrap(host.session.currentAnchor))["resourceY"])
        try await assertSourceUnchanged(fixture)
    }

    func testPDFKeepsAbsolutePageYAndRejectsAnImageCoordinate() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ResourcePDF-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("absolute-page.pdf")
        try UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595)).writePDF(to: file) { context in
            context.beginPage(); ("Original PDF source" as NSString).draw(at: CGPoint(x: 30, y: 200), withAttributes: [.font: UIFont.systemFont(ofSize: 20)])
        }
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file), chapter = book.chapters[0], passage = try XCTUnwrap(chapter.passages.first)
        let anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id, pageY: 174.25)
        var state = ReaderState(); state.anchor = anchor
        try await library.saveState(state, bookID: book.id)
        let saved = try await library.state(book.id)
        XCTAssertEqual(saved.anchor, anchor); XCTAssertEqual(saved.anchor?.pageY, 174.25)
        XCTAssertNil(try encoded(try XCTUnwrap(saved.anchor))["resourceY"])
        let invalid = try decoded(["chapterID": chapter.id, "passageID": passage.id, "characterOffset": 0, "pageY": 174.25, "resourceY": 0.5])
        var invalidState = state; invalidState.anchor = invalid
        do { try await library.saveState(invalidState, bookID: book.id); XCTFail("Normalized image Y cannot be interpreted as an absolute PDF page coordinate") }
        catch {}
        let unchanged = try await library.state(book.id); XCTAssertEqual(unchanged.anchor, anchor)
    }
}
