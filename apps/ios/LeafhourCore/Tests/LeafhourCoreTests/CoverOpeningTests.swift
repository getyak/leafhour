import XCTest
import Foundation
import ZIPFoundation
@testable import LeafhourCore

final class CoverOpeningTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        let base = ProcessInfo.processInfo.environment["LEAFHOUR_TEST_ROOT"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.temporaryDirectory
        root = base.appendingPathComponent("CoverOpening-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    @MainActor func testLegacyEPUBCoverIsReadFromExistingOPFWithoutRewritingTheIndex() async throws {
        let fixture = try await fixture(declareCoverImage: true)
        var legacy=fixture.book;legacy.coverResourcePath=nil
        let index=fixture.directory.appendingPathComponent("book.json")
        try Disk.write(legacy,to:index)
        let manifestFile=fixture.directory.appendingPathComponent("manifest.json")
        var manifest=try Disk.read(OfflineManifest.self,from:manifestFile)
        let slot=try XCTUnwrap(manifest.files.firstIndex { $0.path == "book.json" })
        manifest.files[slot]=FileDigest(path:"book.json",sha256:try Disk.hashFile(index),bytes:try Disk.size(index))
        try Disk.write(manifest,to:manifestFile)
        let before=try Data(contentsOf:index)
        let url=try await fixture.library.localCoverURL(legacy.id)
        XCTAssertEqual(url?.lastPathComponent,"cover.png")
        XCTAssertEqual(try Data(contentsOf:index),before)
        let verified=try await fixture.library.verify(legacy.id);XCTAssertTrue(verified)
    }
    @MainActor func testNewReadingStartsAtFirstLinearChapterAndRetainsCover() async throws {
        let fixture = try await fixture(coverLinear: false)
        let reader = fixture.session()
        XCTAssertEqual(reader.chapter.sourcePath, "OPS/preface.xhtml")
        XCTAssertEqual(fixture.book.chapters.map(\.sourcePath), ["OPS/art.xhtml", "OPS/title.xhtml", "OPS/preface.xhtml", "OPS/body.xhtml", "OPS/nav.xhtml"])
        XCTAssertEqual(fixture.book.chapters[0].passages[0].resourcePath, "OPS/cover.png")
    }

    @MainActor func testExplicitCoverAndTitlePageDoNotReplaceUnmarkedPreface() async throws {
        let fixture = try await fixture(coverLinear: true)
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/preface.xhtml")
    }

    @MainActor func testBodymatterLandmarkSelectsBodyWithoutRemovingFrontMatter() async throws {
        let fixture = try await fixture(landmark: "body.xhtml#opening")
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/body.xhtml")
        XCTAssertTrue(fixture.book.chapters.contains { $0.sourcePath == "OPS/preface.xhtml" })
    }

    @MainActor func testBodymatterFragmentStartsAtRealPassageAfterCoverInSameXHTML() async throws {
        let fixture = try await fixture(coverLinear: true, markCover: false, landmark: "art.xhtml#body-start", combinedOpening: true)
        let reader = fixture.session()
        let passage = try XCTUnwrap(reader.chapter.passages.first { $0.text == "Chapter one inside the cover document" })
        XCTAssertEqual(reader.chapter.sourcePath, "OPS/art.xhtml")
        XCTAssertEqual(reader.currentAnchor?.passageID, passage.id)
        XCTAssertEqual(reader.chapter.passages.first?.resourcePath, "OPS/cover.png")
    }

    @MainActor func testLegacyCacheResolvesEncodedFragmentWithoutRewritingIndex() async throws {
        let fixture = try await fixture(coverLinear: true, markCover: false, landmark: "art.xhtml#body%2Dstart", combinedOpening: true)
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
        index.removeValue(forKey: "readingStartChapterID")
        index.removeValue(forKey: "readingStartAnchor")
        let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
        let before = try Data(contentsOf: fixture.directory.appendingPathComponent("book.json"))
        let reader = fixture.session(book: legacy)
        let passage = try XCTUnwrap(reader.chapter.passages.first { $0.text == "Chapter one inside the cover document" })
        XCTAssertEqual(reader.currentAnchor?.passageID, passage.id)
        XCTAssertEqual(try Data(contentsOf: fixture.directory.appendingPathComponent("book.json")), before)
    }

    @MainActor func testMissingBodymatterFragmentDoesNotInventAnOpeningAnchor() async throws {
        let fixture = try await fixture(landmark: "body.xhtml#missing-target")
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/preface.xhtml")
    }

    @MainActor func testBodyFragmentInSameDocumentOverridesCoverLandmarkForNewAndLegacyBooks() async throws {
        let fixture = try await fixture(coverLinear: true, markCover: false, landmark: "art.xhtml#body-start", combinedOpening: true, coverLandmark: "art.xhtml#cover")
        try assertCombinedBodyStartForNewAndLegacy(fixture)
    }

    @MainActor func testGuideBodyFragmentInSameDocumentOverridesCoverReferenceForNewAndLegacyBooks() async throws {
        let guide = "<reference type=\"cover\" href=\"art.xhtml#cover\"/><reference type=\"text\" href=\"art.xhtml#body-start\"/>"
        let fixture = try await fixture(coverLinear: true, markCover: false, guide: guide, combinedOpening: true)
        try assertCombinedBodyStartForNewAndLegacy(fixture)
    }

    @MainActor func testBodyFragmentCannotOverrideWholeDocumentCoverOrTheSameCoverFragment() async throws {
        let wholeCover = try await fixture(coverLinear: true, landmark: "art.xhtml#body-start", combinedOpening: true, coverLandmark: "art.xhtml#cover")
        XCTAssertEqual(wholeCover.session().chapter.sourcePath, "OPS/preface.xhtml")
        // A contradictory cover/body fragment is not a trusted body target.
        // It must not exclude the mixed chapter either. Put original source
        // before the cover so rejecting that hint has a distinct observable
        // result from following its cover target.
        let firstText = "Original source before the explicitly marked cover fragment."
        let sameFragment = try await fixture(coverLinear: true, markCover: false,
            landmark: "art.xhtml#cover", combinedOpening: true,
            coverMarkup: "<p id=\"first-source\">\(firstText)</p><img id=\"cover\" src=\"cover.png\" alt=\"Source artwork\"/>",
            coverLandmark: "art.xhtml#cover")
        let chapter = try XCTUnwrap(sameFragment.book.chapters.first)
        let first = try XCTUnwrap(chapter.passages.first)
        let cover = try XCTUnwrap(chapter.passages.first(where: { $0.resourcePath == "OPS/cover.png" }))
        XCTAssertEqual(first.text, firstText)
        XCTAssertEqual(first.id, "p-35b737df5c84f1b19fa03d8fe9e91e55a6935b5c55ac0e53fdde635b8fec57ba")
        XCTAssertEqual(cover.id, "p-b3e65e3199ce2f27022a9f991715e0718eecedf6299b1672bed2b2ad502a11d9")
        XCTAssertTrue(chapter.passages.contains(where: { $0.text == "Actual main prose after source artwork." }))
        let fallback = ReadingAnchor(chapterID: chapter.id, passageID: first.id)
        let wrongBodyTarget = ReadingAnchor(chapterID: chapter.id, passageID: cover.id)
        XCTAssertNotEqual(fallback, wrongBodyTarget)
        var legacy = sameFragment.book
        legacy.readingStartChapterID = nil; legacy.readingStartAnchor = nil
        let indexBefore = try Data(contentsOf: sameFragment.directory.appendingPathComponent("book.json"))
        let manifestBefore = try Data(contentsOf: sameFragment.directory.appendingPathComponent("manifest.json"))
        for book in [sameFragment.book, legacy] {
            let reader = sameFragment.session(book: book)
            XCTAssertEqual(reader.chapter.sourcePath, "OPS/art.xhtml", "Do not discard mixed Chapter I because one fragment is contradictory")
            XCTAssertEqual(reader.currentAnchor, fallback, "Reject the erroneous bodymatter target instead of following it to the cover")
            XCTAssertEqual(reader.declaredReadingStart(), fallback)
            XCTAssertNotEqual(reader.currentAnchor, wrongBodyTarget)
            var saved = ReaderState()
            saved.anchor = wrongBodyTarget
            saved.drafts[wrongBodyTarget.key] = NoteDraft(anchor: wrongBodyTarget, quote: "Source artwork", body: "Keep my saved-cover draft")
            let resumed = sameFragment.session(book: book, state: saved)
            XCTAssertEqual(resumed.currentAnchor, wrongBodyTarget, "A valid user-saved cover position remains authoritative")
            XCTAssertEqual(resumed.state, saved)
        }
        XCTAssertEqual(try Data(contentsOf: sameFragment.directory.appendingPathComponent("book.json")), indexBefore)
        XCTAssertEqual(try Data(contentsOf: sameFragment.directory.appendingPathComponent("manifest.json")), manifestBefore)
    }

    @MainActor func testLinearNavigationDocumentCanDeclareBodyOutsideNavigationElements() async throws {
        let fixture = try await fixture(landmark: "nav.xhtml#body-start", navInSpine: true, navSupplement: "<section id=\"body-start\"><h1>Actual body outside navigation</h1><p>Original main prose.</p></section>")
        try assertCombinedBodyStartForNewAndLegacy(fixture, path: "OPS/nav.xhtml", text: "Actual body outside navigation", hasCover: false)
    }

    @MainActor func testFragmentOnlyLandmarkResolvesWithinItsCurrentDocument() async throws {
        let fixture = try await fixture(landmark: "#body-start", navInSpine: true, navSupplement: "<section id=\"body-start\"><h1>Actual body outside navigation</h1><p>Original main prose.</p></section>")
        try assertCombinedBodyStartForNewAndLegacy(fixture, path: "OPS/nav.xhtml", text: "Actual body outside navigation", hasCover: false)
    }

    @MainActor func testNavigationFragmentOrDescendantCannotMasqueradeAsBodymatter() async throws {
        for role in ["toc", "landmarks", "page-list"] {
            let fixture = try await fixture(landmark: "#navigation-child", navInSpine: true, navSupplement: "<nav epub:type=\"\(role)\" id=\"navigation-target\"><h1 id=\"navigation-child\">Navigation only</h1><ol><li>Index entry</li></ol></nav>")
            var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
            index.removeValue(forKey: "readingStartChapterID")
            index.removeValue(forKey: "readingStartAnchor")
            let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
            for book in [fixture.book, legacy] { XCTAssertEqual(fixture.session(book: book).chapter.sourcePath, "OPS/preface.xhtml", role) }
        }
    }

    @MainActor private func assertCombinedBodyStartForNewAndLegacy(_ fixture: CoverFixture, path: String = "OPS/art.xhtml", text: String = "Chapter one inside the cover document", hasCover: Bool = true) throws {
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
        index.removeValue(forKey: "readingStartChapterID")
        index.removeValue(forKey: "readingStartAnchor")
        let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
        for book in [fixture.book, legacy] {
            let reader = fixture.session(book: book)
            XCTAssertEqual(reader.chapter.sourcePath, path)
            let passage = try XCTUnwrap(reader.chapter.passages.first { $0.text == text })
            XCTAssertEqual(reader.currentAnchor?.passageID, passage.id)
            if hasCover { XCTAssertEqual(reader.chapter.passages.first?.resourcePath, "OPS/cover.png") }
        }
    }

    @MainActor func testSVGRasterCoverImportsAsLocalImageAndKeepsAlternative() async throws {
        for attribute in ["href", "xlink:href"] {
            let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><title>Source cover artwork</title><image \(attribute)=\"cover.png\"/></svg>"
            let fixture = try await fixture(coverMarkup: svg)
            let image = try XCTUnwrap(fixture.book.chapters[0].passages.first { $0.resourcePath == "OPS/cover.png" })
            XCTAssertEqual(image.alternative, "Source cover artwork")
            XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/preface.xhtml")
        }
    }

    @MainActor func testPureVectorCoverKeepsExplicitPlaceholderAndOriginalSource() async throws {
        let fixture = try await fixture(coverMarkup: "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0 L10 10\"/></svg>")
        let placeholder = try XCTUnwrap(fixture.book.chapters[0].passages.first)
        XCTAssertEqual(placeholder.text, "")
        XCTAssertEqual(placeholder.resourcePath, "OPS/art.xhtml")
        XCTAssertTrue(placeholder.alternative?.contains("SVG") == true)
        let source = try String(contentsOf: fixture.directory.appendingPathComponent("assets/OPS/art.xhtml"), encoding: .utf8)
        XCTAssertTrue(source.contains("M0 0 L10 10"))
    }

    @MainActor func testAddingSVGImageDoesNotRenumberExistingSourceParagraph() async throws {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>Source cover artwork</title><image href=\"cover.png\"/></svg><p>Existing source paragraph.</p>"
        let fixture = try await fixture(coverMarkup: svg)
        let source = try XCTUnwrap(fixture.book.chapters[0].passages.first { $0.text == "Existing source paragraph." })
        // The pre-SVG implementation assigned this source paragraph block-1.
        XCTAssertEqual(source.id, "p-056f3be19fb1b499d38c77ef8bd7e08a84c4b6d97bc1807863dcf14e6b13dfd4")
    }

    @MainActor func testSVGImageCannotLoadRemoteOrEscapingResource() async throws {
        for href in ["https://example.invalid/cover.png", "../../outside.png"] {
            do {
                _ = try await fixture(coverMarkup: "<svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"\(href)\"/></svg>")
                XCTFail("Unsafe SVG image reference must fail import")
            } catch { /* No request is made; source remains in the failed import job. */ }
        }
    }

    @MainActor func testEPUB2GuideTextSelectsBody() async throws {
        let fixture = try await fixture(guide: "<reference type=\"text\" href=\"body.xhtml#opening\"/>")
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/body.xhtml")
    }

    @MainActor func testGuideCoverReferenceSkipsOnlyItsExplicitTarget() async throws {
        let fixture = try await fixture(coverLinear: true, markCover: false, guide: "<reference type=\"cover\" href=\"art.xhtml\"/>")
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/preface.xhtml")
    }

    @MainActor func testFragmentOnlyCoverReferenceKeepsMixedFirstLinearChapterWithoutGuessingBody() async throws {
        // A cover fragment does not declare its entire XHTML to be front matter.
        // There is intentionally no bodymatter/text start hint, so preserve the
        // first linear chapter and its source order rather than guessing a heading.
        for landmarks in [false, true] {
            let file = root.appendingPathComponent(UUID().uuidString + ".epub")
            let archive = try Archive(url: file, accessMode: .create)
            let navItem = landmarks ? "<item id=\"nav\" href=\"nav.xhtml\" properties=\"nav\" media-type=\"application/xhtml+xml\"/>" : ""
            let guide = landmarks ? "" : "<guide><reference type=\"cover\" href=\"opening.xhtml#cover\"/></guide>"
            var entries = [
                ("mimetype", "application/epub+zip"),
                ("META-INF/container.xml", "<container><rootfiles><rootfile full-path=\"OPS/book.opf\"/></rootfiles></container>"),
                ("OPS/book.opf", "<package><metadata><title>Mixed source opening</title></metadata><manifest><item id=\"opening\" href=\"opening.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"second\" href=\"second.xhtml\" media-type=\"application/xhtml+xml\"/>\(navItem)</manifest><spine><itemref idref=\"opening\"/><itemref idref=\"second\"/></spine>\(guide)</package>"),
                ("OPS/opening.xhtml", "<html xmlns:epub=\"http://www.idpf.org/2007/ops\"><body><section id=\"cover\" epub:type=\"cover\"><img id=\"cover-art\" src=\"cover.png\" alt=\"Retained source cover\"/></section><section id=\"chapter-one\"><h1>CHAPTER I.</h1><p id=\"first-prose\">The first chapter's original prose must remain before chapter two.</p></section></body></html>"),
                ("OPS/second.xhtml", "<html><body><h1>CHAPTER II.</h1><p>The second chapter follows the complete first chapter.</p></body></html>"),
                ("OPS/cover.png", "Synthetic retained source resource; this Core test does not assert image rendering")
            ]
            if landmarks {
                entries.append(("OPS/nav.xhtml", "<html xmlns:epub=\"http://www.idpf.org/2007/ops\"><body><nav epub:type=\"landmarks\"><ol><li><a epub:type=\"cover\" href=\"opening.xhtml#cover\">Cover</a></li></ol></nav></body></html>"))
            }
            for (path, text) in entries {
                let data = Data(text.utf8)
                try archive.addEntry(with: path, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .deflate) { position, size in
                    data.subdata(in: Int(position)..<min(Int(position) + size, data.count))
                }
            }
            let library = try OfflineLibrary(root: root.appendingPathComponent(UUID().uuidString), scope: .device)
            let book = try await library.importFile(file)
            let directory = try await library.bookDirectory(book.id), original = try await library.originalURL(book.id)
            XCTAssertEqual(Array(book.chapters.prefix(2).map(\.sourcePath)), ["OPS/opening.xhtml", "OPS/second.xhtml"])
            let opening = try XCTUnwrap(book.chapters.first)
            let cover = try XCTUnwrap(opening.passages.first)
            let prose = try XCTUnwrap(opening.passages.first(where: { $0.text == "The first chapter's original prose must remain before chapter two." }))
            XCTAssertEqual(opening.id, "ch-2eb320527c69b30f42a87b5966778a6c1acee2da2849fd57480ce1992f3a8e9f")
            XCTAssertEqual(cover.id, "p-305b8b92c2610f15567589524adcdb4340e239be72c1fbdae7c461ee1d06cfbf")
            XCTAssertEqual(cover.resourcePath, "OPS/cover.png")
            XCTAssertEqual(prose.id, "p-10e7e9a07b304e2c06c31a5ff33dbc72a3654e20868646f9ec0081e53b18c40f")
            let conservative = ReadingAnchor(chapterID: opening.id, passageID: cover.id)
            var legacy = book
            legacy.readingStartChapterID = nil; legacy.readingStartAnchor = nil
            let indexBefore = try Data(contentsOf: directory.appendingPathComponent("book.json"))
            let manifestBefore = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
            for candidate in [book, legacy] {
                let reader = ReaderSession(book: candidate, state: ReaderState(), original: original, directory: directory, library: library)
                XCTAssertEqual(reader.chapterIndex, 0, "A fragment cover cannot skip all first-chapter prose; landmarks=\(landmarks)")
                XCTAssertEqual(reader.chapter.sourcePath, "OPS/opening.xhtml")
                XCTAssertEqual(reader.currentAnchor, conservative, "Without a trusted body target, keep original order including the cover")
                XCTAssertEqual(reader.declaredReadingStart(), conservative)
                var saved = ReaderState()
                saved.anchor = conservative
                saved.drafts[conservative.key] = NoteDraft(anchor: conservative, quote: "Retained source cover", body: "Keep this existing cover draft")
                let resumed = ReaderSession(book: candidate, state: saved, original: original, directory: directory, library: library)
                XCTAssertEqual(resumed.chapterIndex, 0)
                XCTAssertEqual(resumed.currentAnchor, conservative)
                XCTAssertEqual(resumed.state, saved, "Valid saved cover anchors and user drafts always win")
            }
            XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("book.json")), indexBefore)
            XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("manifest.json")), manifestBefore)
        }
    }

    @MainActor func testUnmarkedOpeningIllustrationIsNotAssumedToBeCover() async throws {
        let fixture = try await fixture(coverLinear: true, markCover: false)
        XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/art.xhtml")
    }

    @MainActor func testLandmarkCannotSelectNonlinearOrOutsideSpineContent() async throws {
        for href in ["art.xhtml", "nav.xhtml", "https://example.invalid/body.xhtml", "../../outside.xhtml"] {
            let fixture = try await fixture(landmark: href)
            XCTAssertEqual(fixture.session().chapter.sourcePath, "OPS/preface.xhtml", href)
        }
    }

    @MainActor func testSavedCoverAndBodyPositionsOverrideNewReadingStart() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        for chapterIndex in [0, 2, 3] {
            let chapter = fixture.book.chapters[chapterIndex], passage = chapter.passages[0]
            var state = ReaderState()
            let anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id, characterOffset: min(3, passage.text.unicodeScalars.count))
            state.anchor = anchor
            state.notes = [ReaderNote(anchor: anchor, quote: passage.text, body: "Keep this note")]
            state.drafts[anchor.key] = NoteDraft(anchor: anchor, quote: passage.text, body: "Keep this draft")
            let reader = fixture.session(state: state)
            XCTAssertEqual(reader.chapter.id, chapter.id)
            XCTAssertEqual(reader.currentAnchor, anchor)
            XCTAssertEqual(reader.state.notes, state.notes)
            XCTAssertEqual(reader.state.drafts, state.drafts)
        }
    }

    @MainActor func testDeclaredReadingStartFindsBodyWithoutMovingSavedCoverPosition() async throws {
        let fixture = try await fixture(landmark: "body.xhtml#opening")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
        index.removeValue(forKey: "readingStartChapterID")
        index.removeValue(forKey: "readingStartAnchor")
        let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
        let cover = fixture.book.chapters[0]
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: cover.id, passageID: cover.passages[0].id)
        for book in [fixture.book, legacy] {
            let reader = fixture.session(book: book, state: state)
            let declared = try XCTUnwrap(reader.declaredReadingStart())
            XCTAssertEqual(declared.chapterID, fixture.book.chapters[3].id)
            XCTAssertEqual(declared.passageID, fixture.book.chapters[3].passages[0].id)
            XCTAssertEqual(reader.currentAnchor, state.anchor)
            XCTAssertEqual(reader.chapter.id, cover.id)
            XCTAssertEqual(reader.state, state)
        }
        let diskState = try await fixture.library.state(fixture.book.id)
        XCTAssertNil(diskState.anchor)
    }

    @MainActor func testOldOutOfRangeOffsetIsClampedWithoutMovingChapters() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        let chapter = fixture.book.chapters[2], passage = chapter.passages[0]
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: chapter.id, passageID: passage.id, characterOffset: 10_000)
        let reader = fixture.session(state: state)
        XCTAssertEqual(reader.chapter.sourcePath, "OPS/preface.xhtml")
        XCTAssertEqual(reader.currentAnchor?.characterOffset, passage.text.unicodeScalars.count)
    }

    @MainActor func testMissingPassageKeepsSavedChapterAndMissingChapterUsesReadingStart() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        var state = ReaderState()
        state.anchor = ReadingAnchor(chapterID: fixture.book.chapters[2].id, passageID: "old-missing-passage")
        XCTAssertEqual(fixture.session(state: state).chapter.sourcePath, "OPS/preface.xhtml")
        state.anchor = ReadingAnchor(chapterID: "missing-chapter", passageID: "missing-passage")
        XCTAssertEqual(fixture.session(state: state).chapter.sourcePath, "OPS/body.xhtml")
    }

    @MainActor func testLegacyBookIndexDerivesStartFromLocalAssetsWithoutWritingPackage() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
        index.removeValue(forKey: "readingStartChapterID")
        index.removeValue(forKey: "readingStartAnchor")
        let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
        let before = try Data(contentsOf: fixture.directory.appendingPathComponent("book.json"))
        let reader = fixture.session(book: legacy)
        XCTAssertEqual(reader.chapter.sourcePath, "OPS/body.xhtml")
        XCTAssertEqual(try Data(contentsOf: fixture.directory.appendingPathComponent("book.json")), before)
        let diskState = try await fixture.library.state(fixture.book.id)
        XCTAssertNil(diskState.anchor)
    }

    @MainActor func testLegacyFallbackDoesNotFollowInvalidContainerPath() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        var index = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.book)) as? [String: Any])
        index.removeValue(forKey: "readingStartChapterID")
        index.removeValue(forKey: "readingStartAnchor")
        let legacy = try JSONDecoder().decode(LocalBook.self, from: JSONSerialization.data(withJSONObject: index))
        let container = fixture.directory.appendingPathComponent("assets/META-INF/container.xml")
        try Data("<container><rootfiles><rootfile full-path=\"../../outside.opf\"/></rootfiles></container>".utf8).write(to: container)
        XCTAssertEqual(fixture.session(book: legacy).chapter.sourcePath, "OPS/art.xhtml")
    }

    @MainActor func testTextAndPDFKeepTheirOriginalFirstChapter() async throws {
        let fixture = try await fixture(landmark: "body.xhtml")
        for kind in [BookKind.txt, .pdf] {
            var book = fixture.book
            book.kind = kind
            XCTAssertEqual(fixture.session(book: book).chapter.sourcePath, "OPS/art.xhtml")
        }
    }

    @MainActor private func fixture(coverLinear: Bool = false, markCover: Bool = true, landmark: String? = nil, guide: String = "", combinedOpening: Bool = false, coverMarkup: String? = nil, coverLandmark: String? = nil, navInSpine: Bool = false, navSupplement: String = "", declareCoverImage: Bool = false) async throws -> CoverFixture {
        let file = root.appendingPathComponent(UUID().uuidString + ".epub")
        let archive = try Archive(url: file, accessMode: .create)
        let coverLink = coverLandmark.map { "<li><a epub:type=\"cover\" href=\"\($0)\">Source cover</a></li>" } ?? ""
        let navigation = landmark.map { "<nav epub:type=\"landmarks\"><ol>\(coverLink)<li><a epub:type=\"bodymatter\" href=\"\($0)\">Begin reading</a></li></ol></nav>" } ?? "<nav><p>Contents</p></nav>"
        let entries = [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", "<container><rootfiles><rootfile full-path=\"OPS/book.opf\"/></rootfiles></container>"),
            ("OPS/book.opf", "<package><metadata><title>Synthetic opening</title></metadata><manifest>\(declareCoverImage ? "<item id=\"image\" href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\"/>" : "")<item id=\"art\" href=\"art.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"title\" href=\"title.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"preface\" href=\"preface.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"body\" href=\"body.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"nav\" href=\"nav.xhtml\" properties=\"nav\" media-type=\"application/xhtml+xml\"/></manifest><spine><itemref idref=\"art\" linear=\"\(coverLinear ? "yes" : "no")\"/><itemref idref=\"title\"/><itemref idref=\"preface\"/><itemref idref=\"body\"/>\(navInSpine ? "<itemref idref=\"nav\"/>" : "")</spine><guide>\(guide)</guide></package>"),
            ("OPS/art.xhtml", "<html xmlns:epub=\"http://www.idpf.org/2007/ops\"><body\(markCover ? " epub:type=\"cover\"" : "")>\(coverMarkup ?? "<img id=\"cover\" src=\"cover.png\" alt=\"Source artwork\"/>")\(combinedOpening ? "<section id=\"body-start\"><h1>Chapter one inside the cover document</h1><p>Actual main prose after source artwork.</p></section>" : "")</body></html>"),
            ("OPS/title.xhtml", "<html xmlns:epub=\"http://www.idpf.org/2007/ops\"><body><section epub:type=\"titlepage\"><h1>Synthetic opening</h1><p>Author metadata</p></section></body></html>"),
            ("OPS/preface.xhtml", "<html><body><h1>Preface</h1><p>A real preface is retained.</p></body></html>"),
            ("OPS/body.xhtml", "<html><body><h1 id=\"opening\">Chapter one</h1><p>The main reading begins here.</p></body></html>"),
            ("OPS/nav.xhtml", "<html xmlns:epub=\"http://www.idpf.org/2007/ops\"><body>\(navigation)\(navSupplement)</body></html>"),
            ("OPS/cover.png", "Synthetic retained image resource")
        ]
        for (path, text) in entries {
            let data = Data(text.utf8)
            try archive.addEntry(with: path, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .deflate) { position, size in
                data.subdata(in: Int(position)..<min(Int(position) + size, data.count))
            }
        }
        let library = try OfflineLibrary(root: root.appendingPathComponent(UUID().uuidString), scope: .device)
        let book = try await library.importFile(file)
        return CoverFixture(library: library, book: book, original: try await library.originalURL(book.id), directory: try await library.bookDirectory(book.id))
    }
}

private struct CoverFixture {
    let library: OfflineLibrary
    let book: LocalBook
    let original: URL
    let directory: URL
    @MainActor func session(book: LocalBook? = nil, state: ReaderState = ReaderState()) -> ReaderSession {
        ReaderSession(book: book ?? self.book, state: state, original: original, directory: directory, library: library)
    }
}
