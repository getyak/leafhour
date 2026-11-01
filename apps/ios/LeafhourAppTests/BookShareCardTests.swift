import XCTest
import UIKit
import CoreImage
@testable import Leafhour
import LeafhourCore

@MainActor final class BookShareCardTests: XCTestCase {
    private func decodedLinks(in image: UIImage) throws -> [String] {
        let exported = try XCTUnwrap(CIImage(data: XCTUnwrap(image.pngData())))
        let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        return detector.features(in: exported).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
    }

    func testEveryCardStylePreservesCompleteMultilingualTextAndReadableInk() throws {
        let text = String(repeating: "阅读的片段与原文都应完整保留。 A quiet page 👩🏽‍💻 café.\n", count: 28)
        let content = NativeShareContent(title: "A real title", author: "Author", text: text, attribution: "作者原文", location: "Chapter", url: nil)
        for style in NativeShareCardStyle.allCases {
            let pages = try NativeShareCardRenderer.pages(content, format: .portrait, style: style)
            XCTAssertGreaterThan(pages.count, 1)
            XCTAssertEqual(pages.map(\.text).joined(), text)
            for page in pages {
                XCTAssertLessThan(page.bodyBounds.maxY, page.footerY)
                XCTAssertLessThanOrEqual(page.citationBounds.maxY, page.image.size.height - 30)
            }
            func luminance(_ color: UIColor) -> Double {
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                color.getRed(&r, green: &g, blue: &b, alpha: &a)
                func linear(_ v: CGFloat) -> Double { v <= 0.04045 ? Double(v / 12.92) : pow(Double((v + 0.055) / 1.055), 2.4) }
                return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
            }
            for ink in [style.foreground, style.secondary, style.accent] {
                let a = luminance(style.background), b = luminance(ink)
                XCTAssertGreaterThanOrEqual((max(a, b) + 0.05) / (min(a, b) + 0.05), 4.5, style.rawValue)
            }
        }
    }

    func testExportedCardsDecodeToTheExactPublicOrGiftURLInEveryFormat() throws {
        for url in [URL(string: "https://leafhour.com/read?book=gutenberg-alice&passage=ch01-p002")!, URL(string: "https://leafhour.com/gift/" + String(repeating: "a", count: 43))!] {
            for format in NativeShareCardFormat.allCases {
                let content = NativeShareContent(title: "A book whose full title stays in the citation", author: String(repeating: "Long Author Name ", count: 8), text: String(repeating: "每一段所选文字都保留。Read the actual words. ", count: 12), attribution: "作者原文", location: "Chapter 1", url: url)
                let pages = try NativeShareCardRenderer.pages(content, format: format)
                XCTAssertEqual(pages.map(\.text).joined(), content.text)
                for (index, page) in pages.enumerated() {
                    XCTAssertEqual(try decodedLinks(in: page.image), [url.absoluteString], format.rawValue)
                    if index == 0 {
                        let attachment = XCTAttachment(image: page.image)
                        attachment.name = "GET352-card-\(format.rawValue)-\(url.path.hasPrefix("/gift/") ? "gift" : "public")"
                        attachment.lifetime = .keepAlways; add(attachment)
                    }
                    let code = try XCTUnwrap(page.qrCodeBounds)
                    XCTAssertFalse(code.intersects(page.citationBounds))
                    XCTAssertGreaterThan(code.minY, page.bodyBounds.maxY)
                    XCTAssertLessThanOrEqual(code.maxY, page.image.size.height - 30)
                    XCTAssertEqual(code.origin.x.rounded(), code.origin.x)
                    XCTAssertEqual(code.width.rounded(), code.width)
                }
            }
        }
    }

    func testPrivateCardsKeepTheWholeQuoteAndHaveNoFabricatedQRCode() throws {
        let content = NativeShareContent(title: "A private book", author: "An author", text: "A private selection 👨‍👩‍👧‍👦", attribution: "作者原文", location: "Chapter 1", url: nil)
        for format in NativeShareCardFormat.allCases {
            let pages = try NativeShareCardRenderer.pages(content, format: format)
            XCTAssertEqual(pages.map(\.text).joined(), content.text)
            for page in pages { XCTAssertNil(page.qrCodeBounds); XCTAssertTrue(try decodedLinks(in: page.image).isEmpty) }
        }
    }

    func testAccountTokensAndAuthenticationRoutesCannotBecomeQRCodePayloads() throws {
        for raw in ["https://leafhour.com/read?book=alice&access_token=synthetic-token", "https://leafhour.com/auth/callback?code=synthetic-code"] {
            let content = NativeShareContent(title: "A book", author: "Author", text: "Keep the full text.", attribution: "作者原文", location: "", url: URL(string: raw))
            let page = try XCTUnwrap(NativeShareCardRenderer.pages(content, format: .portrait).first)
            XCTAssertNil(page.qrCodeBounds)
            XCTAssertTrue(try decodedLinks(in: page.image).isEmpty)
            XCTAssertEqual(page.text, content.text)
        }
    }

    func testLongCardPagesRetainEveryGraphemeAndUseReadableType() throws {
        let text = String(repeating: "读一段话。Read every word. 👨‍👩‍👧‍👦 e\u{301}\n", count: 90)
        let content = NativeShareContent(title: "A book", author: "An author", text: text, attribution: "作者原文", location: "Chapter 1", url: nil)
        let pages = try NativeShareCardRenderer.pages(content, format: .portrait)
        XCTAssertGreaterThan(pages.count, 1)
        XCTAssertEqual(pages.map(\.text).joined(), text)
        for page in pages {
            XCTAssertEqual(page.image.size, CGSize(width: 1080, height: 1350))
            XCTAssertGreaterThanOrEqual(page.quoteFontSize, 40)
            XCTAssertLessThanOrEqual(page.bodyBounds.maxY, page.footerY)
            XCTAssertLessThanOrEqual(page.citationBounds.maxY, page.image.size.height - 30)
        }
    }

    func testLongAttributionAndActualShareURLHaveReservedSpaceBelowTheQuote() throws {
        let content = NativeShareContent(title: "A book whose subtitle belongs in the citation", author: String(repeating: "Long Author Name ", count: 10), text: String(repeating: "A complete thought. ", count: 45), attribution: "作者原文", location: "Chapter 1", url: URL(string: "https://leafhour.com/gift/" + String(repeating: "a", count: 43)))
        let pages = try NativeShareCardRenderer.pages(content, format: .portrait)
        XCTAssertEqual(pages.map(\.text).joined(), content.text)
        for page in pages {
            XCTAssertLessThan(page.bodyBounds.maxY, page.footerY)
            XCTAssertLessThanOrEqual(page.citationBounds.maxY, page.image.size.height - 30)
        }
    }

    func testShareTextContainsTheExactQuoteAndAttributionOnly() {
        let content = NativeShareContent(title: "A book", author: "An author", text: "Selected words 👩🏽‍💻", attribution: "直译 · 草稿", location: "Chapter 1", url: nil)
        XCTAssertTrue(content.plainText.contains("Selected words 👩🏽‍💻"))
        XCTAssertTrue(content.plainText.contains("直译 · 草稿"))
        XCTAssertFalse(content.plainText.contains("https://"))
        XCTAssertEqual(content.text, "Selected words 👩🏽‍💻")
    }

    func testIncomingIntentsAreQueuedWithoutImportingAndInvalidHostsCannotReplaceThem() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = LibraryModel(root: root, cloud: CloudLibraryClient(), monitorNetwork: false)
        let first = URL(string: "leafhour://gift/" + String(repeating: "a", count: 43))!
        let second = URL(string: "leafhour://gift/" + String(repeating: "b", count: 43))!
        model.busy = true
        model.receiveIncomingURL(first); model.receiveIncomingURL(first); model.receiveIncomingURL(second)
        let request = try XCTUnwrap(model.incomingBookRequest)
        XCTAssertEqual(request.link, .gift(String(repeating: "a", count: 43)))
        XCTAssertEqual(model.queuedBookRequests.count, 1)
        XCTAssertTrue(model.books.isEmpty)
        model.receiveIncomingURL(URL(string: "https://evil.invalid/gift/" + String(repeating: "c", count: 43))!)
        XCTAssertEqual(model.incomingBookRequest?.id, request.id)
        XCTAssertEqual(model.queuedBookRequests.count, 1)
        model.dismissIncomingBookPresentation(presentationAvailable: false)
        XCTAssertEqual(model.incomingBookRequest?.id, request.id, "Another sheet or reader presentation must not consume the pending import")
        model.finishIncomingBook(request); model.nextIncomingBook()
        XCTAssertEqual(model.incomingBookRequest?.link, .gift(String(repeating: "b", count: 43)))
    }

    func testASelectedDraftCannotInheritTheReviewStatusOfANewerTranslation() {
        let quote = SelectedQuote(anchor: ReadingAnchor(chapterID: "chapter", passageID: "passage"), text: "旧稿 👨‍👩‍👧‍👦", sourceText: "Source paragraph", origin: "translation", variant: "literal", translationOffset: 2)
        let draft = ReadingTranslation(original: "Source paragraph", literal: "前文旧稿 👨‍👩‍👧‍👦后文", literalStatus: "draft")
        XCTAssertEqual(NativeShareContent.attribution(quote: quote, cached: draft), "直译 · 草稿")
        let newer = ReadingTranslation(original: "Source paragraph", literal: "前文新修订文字后文", literalStatus: "reviewed")
        XCTAssertEqual(NativeShareContent.attribution(quote: quote, cached: newer), "直译 · 未核对")
        let reviewed = ReadingTranslation(original: "Source paragraph", literal: "前文旧稿 👨‍👩‍👧‍👦后文", literalStatus: "reviewed")
        XCTAssertEqual(NativeShareContent.attribution(quote: quote, cached: reviewed), "直译")
        let changedSource = ReadingTranslation(original: "A different source", literal: "前文旧稿 👨‍👩‍👧‍👦后文", literalStatus: "reviewed")
        XCTAssertEqual(NativeShareContent.attribution(quote: quote, cached: changedSource), "直译 · 未核对")
    }

    func testAFilePreparationFailureCanRetryWithoutExportingReadyPayloadsAgain() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let preparation = ShelfShareFilePreparation(), scope = UUID()
        var failSecond = true, exports: [String] = []
        func export(_ id: String, _ index: Int) async throws -> URL {
            exports.append(id)
            if id == "second", failSecond { throw LibraryError.invalid("The second file is not ready") }
            let file = root.appendingPathComponent(id + ".txt")
            try Data((id + ":" + UUID().uuidString).utf8).write(to: file)
            return file
        }
        await preparation.prepare(ids: ["first", "second"], scope: scope, currentScope: { scope }, export: export)
        XCTAssertFalse(preparation.preparing)
        XCTAssertNotNil(preparation.error)
        XCTAssertEqual(preparation.preparedCount, 1)
        XCTAssertTrue(preparation.files.isEmpty, "A partial batch cannot pretend all selected files are ready")
        let first = try Data(contentsOf: root.appendingPathComponent("first.txt"))
        failSecond = false
        await preparation.prepare(ids: ["first", "second"], scope: scope, currentScope: { scope }, export: export)
        XCTAssertNil(preparation.error)
        XCTAssertEqual(preparation.files.count, 2)
        XCTAssertEqual(exports, ["first", "second", "second"])
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("first.txt")), first)
    }

    func testAFilePreparedAfterAnAccountChangeCannotBecomeASharePayload() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
        defer { try? FileManager.default.removeItem(at: file) }
        try Data("Source file".utf8).write(to: file)
        let preparation = ShelfShareFilePreparation(), original = UUID()
        var current = original
        await preparation.prepare(ids: ["book"], scope: original, currentScope: { current }) { _, _ in
            current = UUID()
            return file
        }
        XCTAssertTrue(preparation.files.isEmpty)
        XCTAssertEqual(preparation.preparedCount, 0)
        XCTAssertNotNil(preparation.error)
    }
}
