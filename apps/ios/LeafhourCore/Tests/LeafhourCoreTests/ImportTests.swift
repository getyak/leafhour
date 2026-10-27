import XCTest
import Foundation
import PDFKit
import CoreText
import ZIPFoundation
@testable import LeafhourCore

final class ImportTests: XCTestCase {
    var root: URL!
    override func setUpWithError() throws {
        let base = ProcessInfo.processInfo.environment["LEAFHOUR_TEST_ROOT"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.temporaryDirectory
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        root = base.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    func epub(chapters: Int = 12, extra: [(String, Data)] = [], firstBody: String? = nil) throws -> URL {
        let url = root.appendingPathComponent(UUID().uuidString + ".epub")
        let archive = try Archive(url: url, accessMode: .create)
        var entries: [(String, Data)] = [
            ("mimetype", Data("application/epub+zip".utf8)),
            ("META-INF/container.xml", Data("<container><rootfiles><rootfile full-path=\"OPS/book.opf\"/></rootfiles></container>".utf8))
        ]
        let items = (1...chapters).map { "<item id=\"c\($0)\" href=\"c\($0).xhtml\" media-type=\"application/xhtml+xml\"/>" }.joined()
        let refs = (1...chapters).map { "<itemref idref=\"c\($0)\"/>" }.joined()
        entries.append(("OPS/book.opf", Data("<package><metadata><title>Complete book</title><creator>Test author</creator></metadata><manifest>\(items)<item id=\"img\" href=\"images/dot.png\" media-type=\"image/png\"/></manifest><spine>\(refs)</spine></package>".utf8)))
        for i in 1...chapters {
            let bodyOverride = i == 1 ? firstBody : nil
            entries.append(("OPS/c\(i).xhtml", Data((bodyOverride.map { "<html><body>" + $0 + "</body></html>" } ?? "<html><body><h1>Chapter \(i)</h1><p id=\"p\(i)\">Paragraph \(i): 原文 🐿️ with <em>inline</em> words.</p><p>Last sentence \(i).</p><img src=\"images/dot.png\" alt=\"A dot\"/></body></html>").utf8)))
        }
        entries.append(("OPS/images/dot.png", Data([137,80,78,71])))
        entries += extra
        for (name, data) in entries {
            try archive.addEntry(with: name, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .deflate) { position, size in
                data.subdata(in: Int(position)..<min(Int(position) + size, data.count))
            }
        }
        return url
    }

    func pdf(pages: Int = 5) throws -> URL {
        let url = root.appendingPathComponent(UUID().uuidString + ".pdf")
        var box = CGRect(x: 0, y: 0, width: 400, height: 600)
        let context = try XCTUnwrap(CGContext(url as CFURL, mediaBox: &box, nil))
        for number in 1...pages {
            context.beginPDFPage(nil)
            let text = NSAttributedString(string: "Complete PDF page \(number)", attributes: [.font: CTFontCreateWithName("Helvetica" as CFString, 18, nil)])
            context.textPosition = CGPoint(x: 30, y: 500)
            CTLineDraw(CTLineCreateWithAttributedString(text), context)
            context.endPDFPage()
        }
        context.closePDF()
        return url
    }

    func testImportsEntireEPUBSpineAndKeepsStableAnchorsAndOriginal() async throws {
        let url = try epub()
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(url)
        XCTAssertEqual(book.chapters.count, 12)
        XCTAssertTrue(book.chapters.last!.passages.contains { $0.text == "Last sentence 12." })
        XCTAssertTrue(book.chapters.first!.passages.contains { $0.text.contains("with inline words") })
        XCTAssertTrue(book.chapters.first!.passages.contains { $0.resourcePath == "OPS/images/dot.png" })
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
        let original = try await library.originalURL(book.id)
        XCTAssertEqual(try Data(contentsOf: original), try Data(contentsOf: url))
        let again = try await library.importFile(url)
        XCTAssertEqual(again.id, book.id)
        XCTAssertEqual(again.chapters.map(\.id), book.chapters.map(\.id))
        let books = try await library.books()
        XCTAssertEqual(books.count, 1)
    }

    func testPDFKeepsEveryPageAndExtractsActualText() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(pdf())
        XCTAssertEqual(book.kind, .pdf)
        XCTAssertEqual(book.chapters.count, 5)
        XCTAssertTrue(book.chapters.last!.passages.contains { $0.text.contains("Complete PDF page 5") })
        let url = try await library.originalURL(book.id)
        XCTAssertEqual(PDFDocument(url: url)?.pageCount, 5)
    }

    func testDuplicateImportPreservesPositionNotesAndDraftAfterRelaunch() async throws {
        let location = root.appendingPathComponent("library")
        let library = try OfflineLibrary(root: location, scope: .device)
        let file = try epub()
        let book = try await library.importFile(file)
        let passage = book.chapters[8].passages.first { !$0.text.isEmpty }!
        let anchor = ReadingAnchor(chapterID: book.chapters[8].id, passageID: passage.id, characterOffset: 3)
        var state = ReaderState()
        state.anchor = anchor
        state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: passage.text, body: "未完成 🐿️")
        state.notes = [ReaderNote(anchor: anchor, quote: passage.text, body: "My words")]
        try await library.saveState(state, bookID: book.id)
        _ = try await library.importFile(file)
        let relaunched = try OfflineLibrary(root: location, scope: .device)
        let restored = try await relaunched.state(book.id)
        XCTAssertEqual(restored.anchor, anchor)
        XCTAssertEqual(restored.drafts[anchor.key]?.body, "未完成 🐿️")
        XCTAssertEqual(restored.notes.first?.body, "My words")
    }

    func testCorruptAssetAndMissingChapterCannotClaimOfflineReady() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub())
        let folder = try await library.bookDirectory(book.id)
        try Data("corrupt".utf8).write(to: folder.appendingPathComponent("assets/OPS/images/dot.png"))
        do { _ = try await library.verify(book.id); XCTFail("Corruption must fail verification") } catch {}
        try FileManager.default.removeItem(at: folder.appendingPathComponent("book.json"))
        do { _ = try await library.book(book.id); XCTFail("Incomplete book must not open") } catch {}
    }

    func testProfilesCannotReadEachOthersBooksOrState() async throws {
        let a = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .account(UUID()))
        let b = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .account(UUID()))
        let book = try await a.importFile(epub())
        let otherBooks = try await b.books()
        XCTAssertTrue(otherBooks.isEmpty)
        do { _ = try await b.originalURL(book.id); XCTFail("Cross-account original must fail") } catch {}
        do { _ = try await b.state(book.id); XCTFail("Cross-account state must fail") } catch {}
        do { _ = try await b.bookDirectory("../" + book.id); XCTFail("Invalid path must fail") } catch {}
    }

    func testTraversalAndOversizedArchiveFailWithoutPublishingPartialBook() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        do { _ = try await library.importFile(epub(extra: [("../escape", Data("bad".utf8))])); XCTFail("Traversal must be rejected") } catch {}
        let books = try await library.books()
        XCTAssertTrue(books.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("escape").path))
        let limited = try OfflineLibrary(root: root.appendingPathComponent("limited"), scope: .device, limits: ImportLimits(maximumFileBytes: 8))
        do { _ = try await limited.importFile(epub()); XCTFail("File limit must be enforced") } catch {}
    }

    func testFailedImportRetainsOriginalAndCanRetryWithoutDuplicateBooks() async throws {
        let file = root.appendingPathComponent("broken.epub")
        try Data("not a zip".utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        do { _ = try await library.importFile(file); XCTFail("Invalid EPUB must fail") } catch {}
        let jobs = try await library.jobs()
        let failed = try XCTUnwrap(jobs.first)
        XCTAssertEqual(failed.phase, .failed)
        let retained = try await library.jobOriginalURL(failed.id)
        XCTAssertEqual(try Data(contentsOf: retained), Data("not a zip".utf8))
        do { _ = try await library.retry(failed.id); XCTFail("Retrying same invalid source must fail") } catch {}
        let books = try await library.books()
        XCTAssertTrue(books.isEmpty)
    }

    func testStateRejectsForeignAnchorAndDoesNotOverwriteValidData() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub())
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: "foreign", passageID: "foreign", characterOffset: 1)
        do { try await library.saveState(state, bookID: book.id); XCTFail("Unknown anchor must fail") } catch {}
        let restored = try await library.state(book.id)
        XCTAssertNil(restored.anchor)
    }
    func testRepairUsesRetainedOriginalAndPreservesPersonalState() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub())
        let chapter = book.chapters[0]
        let anchor = ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages[0].id)
        var state = ReaderState()
        state.notes = [ReaderNote(anchor: anchor, quote: chapter.passages[0].text, body: "Keep me")]
        try await library.saveState(state, bookID: book.id)
        let folder = try await library.bookDirectory(book.id)
        try Data("damaged".utf8).write(to: folder.appendingPathComponent("assets/OPS/images/dot.png"))
        let repaired = try await library.repair(book.id)
        XCTAssertEqual(repaired.id, book.id)
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
        let restored = try await library.state(book.id)
        XCTAssertEqual(restored.notes.first?.body, "Keep me")
    }

    func testMissingIndexStillListsRecoverableBookAndRepairRetainsRecords() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub())
        let folder = try await library.bookDirectory(book.id)
        try FileManager.default.removeItem(at: folder.appendingPathComponent("book.json"))
        let listed = try await library.books()
        XCTAssertEqual(listed.map(\.id), [book.id])
        let repaired = try await library.repair(book.id)
        XCTAssertEqual(repaired.chapters.count, 12)
    }

    func testRepairInterruptedBetweenRenamesRecoversRetainedOriginalOnRestart() async throws {
        let location = root.appendingPathComponent("library")
        let library = try OfflineLibrary(root: location, scope: .device)
        let book = try await library.importFile(epub())
        let profile = location.appendingPathComponent("device")
        let folder = try await library.bookDirectory(book.id)
        let backup = "staging/backup-test"
        try FileManager.default.moveItem(at: folder, to: profile.appendingPathComponent(backup))
        let journal = ["bookID": book.id, "stage": "staging/repair-test", "backup": backup]
        try JSONSerialization.data(withJSONObject: journal).write(to: profile.appendingPathComponent("repair-transaction.json"))
        let restarted = try OfflineLibrary(root: location, scope: .device)
        let recovered = try await restarted.book(book.id)
        XCTAssertEqual(recovered.id, book.id)
        let original = try await restarted.originalURL(book.id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
    }

    func testExpansionLimitRejectsArchiveAndKeepsRetryableSource() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device, limits: ImportLimits(maximumExpandedBytes: 512))
        do { _ = try await library.importFile(epub()); XCTFail("Expanded-byte bound must fail") } catch {}
        let books = try await library.books()
        XCTAssertTrue(books.isEmpty)
        let jobs = try await library.jobs()
        XCTAssertEqual(jobs.first?.phase, .failed)
    }

    func testPlainTextLastBookAndUnicodeScalarPositionSurviveRestart() async throws {
        let location = root.appendingPathComponent("library"), file = root.appendingPathComponent("unicode.txt")
        try "First 🐿️ paragraph.\n\nLast 段落.".write(to: file, atomically: true, encoding: .utf8)
        let library = try OfflineLibrary(root: location, scope: .device)
        let book = try await library.importFile(file)
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: book.chapters[0].id, passageID: book.chapters[0].passages[0].id, characterOffset: 8)
        try await library.saveState(state, bookID: book.id)
        try await library.setLastOpenedBook(book.id)
        let restarted = try OfflineLibrary(root: location, scope: .device)
        let last = try await restarted.lastOpenedBook()
        let restored = try await restarted.state(book.id)
        XCTAssertEqual(last, book.id)
        XCTAssertEqual(restored.anchor?.characterOffset, 8)
    }

    func testInterruptedJobRecoversWithOriginalAndExplicitRetry() async throws {
        let location = root.appendingPathComponent("library"), invalid = root.appendingPathComponent("invalid.pdf")
        try Data("invalid PDF".utf8).write(to: invalid)
        let library = try OfflineLibrary(root: location, scope: .device)
        do { _ = try await library.importFile(invalid); XCTFail("Invalid PDF") } catch {}
        let jobs = try await library.jobs()
        let job = try XCTUnwrap(jobs.first)
        let original = try await library.jobOriginalURL(job.id)
        let file = original.deletingLastPathComponent().appendingPathComponent("job.json")
        var record = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        record["phase"] = "processing"
        try JSONSerialization.data(withJSONObject: record).write(to: file)
        let restarted = try OfflineLibrary(root: location, scope: .device)
        let restoredJobs = try await restarted.jobs()
        XCTAssertEqual(restoredJobs.first?.phase, .interrupted)
        let retained = try await restarted.jobOriginalURL(job.id)
        XCTAssertEqual(try Data(contentsOf: retained), Data("invalid PDF".utf8))
    }

    func testGeneratedAndAuthorSuppliedParagraphIDsCannotCollide() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub(chapters: 1, firstBody: "<p>a</p><p id=\"block-0\">b</p><p id=\"block-0-1\">c</p>"))
        let ids = book.chapters[0].passages.map(\.id)
        XCTAssertEqual(Set(ids).count, 3)
    }

    func testPDFSecondIdenticalQuoteUsesItsActualSelectionRange() throws {
        let url = root.appendingPathComponent("repeated.pdf")
        var box = CGRect(x: 0, y: 0, width: 400, height: 600)
        let context = try XCTUnwrap(CGContext(url as CFURL, mediaBox: &box, nil))
        context.beginPDFPage(nil)
        let text = NSAttributedString(string: "Same words", attributes: [.font: CTFontCreateWithName("Helvetica" as CFString, 18, nil)])
        for y in [500, 400] { context.textPosition = CGPoint(x: 30, y: y); CTLineDraw(CTLineCreateWithAttributedString(text), context) }
        context.endPDFPage(); context.closePDF()
        let page = try XCTUnwrap(PDFDocument(url: url)?.page(at: 0))
        let content = try XCTUnwrap(page.string)
        let second = (content as NSString).range(of: "Same words", options: .backwards)
        XCTAssertGreaterThan(second.location, 0)
        let selection = try XCTUnwrap(page.selection(for: second))
        let anchor = try XCTUnwrap(PDFTextAnchor.make(selection: selection, page: page, chapterID: "page-1", passageID: "page-1"))
        XCTAssertEqual(anchor.characterOffset, (content as NSString).substring(to: second.location).unicodeScalars.count)
    }

    func testReselectingMatchingOriginalRepairsCorruptSourceAndManifest() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let source = try epub(), book = try await library.importFile(source)
        let folder = try await library.bookDirectory(book.id)
        try Data("corrupt".utf8).write(to: folder.appendingPathComponent("source.epub"))
        try Data("corrupt".utf8).write(to: folder.appendingPathComponent("manifest.json"))
        let repaired = try await library.repair(book.id, usingOriginal: source)
        XCTAssertEqual(repaired.id, book.id)
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
    }

    func testUTF16EntityDeclarationsCannotBypassSafeXML() throws {
        let text = "<?xml version=\"1.0\" encoding=\"UTF-16\"?><!DOCTYPE container [<!ENTITY item \"expanded\">]><container>&item;</container>"
        let le = Data([0xff, 0xfe]) + text.data(using: .utf16LittleEndian)!
        let be = Data([0xfe, 0xff]) + text.data(using: .utf16BigEndian)!
        XCTAssertThrowsError(try XMLIndex(data: le))
        XCTAssertThrowsError(try XMLIndex(data: be))
    }

    func testMarkdownCanRepairFromSelectedOriginalAfterIndexLoss() async throws {
        let file = root.appendingPathComponent("notes.md")
        try "# Original\n\nKeep all content.".write(to: file, atomically: true, encoding: .utf8)
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(file)
        let folder = try await library.bookDirectory(book.id)
        try FileManager.default.removeItem(at: folder.appendingPathComponent("book.json"))
        let repaired = try await library.repair(book.id, usingOriginal: file)
        XCTAssertEqual(repaired.kind, .markdown)
    }

    func testFailedRepairCleansUncommittedDerivedStage() async throws {
        let location = root.appendingPathComponent("library")
        let library = try OfflineLibrary(root: location, scope: .device)
        let book = try await library.importFile(epub())
        let limited = try OfflineLibrary(root: location, scope: .device, limits: ImportLimits(maximumExpandedBytes: 512))
        do { _ = try await limited.repair(book.id); XCTFail("Repair must respect expansion limit") } catch {}
        let staged = try FileManager.default.contentsOfDirectory(atPath: location.appendingPathComponent("device/staging").path)
        XCTAssertTrue(staged.isEmpty)
        let verified = try await library.verify(book.id)
        XCTAssertTrue(verified)
    }

    func testXHTMLCollapsesSourceWhitespaceButPreservesBreaksAndPreformattedText() async throws {
        let library = try OfflineLibrary(root: root.appendingPathComponent("library"), scope: .device)
        let book = try await library.importFile(epub(chapters: 1, firstBody: "<p>Long\n   lines <em>with</em>\n whitespace.</p><p>Line<br/>break</p><pre>a\n b</pre>"))
        XCTAssertEqual(book.chapters[0].passages.map(\.text), ["Long lines with whitespace.", "Line\nbreak", "a\n b"])
    }

}
