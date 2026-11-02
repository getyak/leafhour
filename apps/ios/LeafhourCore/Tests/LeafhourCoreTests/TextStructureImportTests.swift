import XCTest
@testable import LeafhourCore

final class TextStructureImportTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    private func load(_ source: String, filename: String = "Synthetic.txt", shelf: String = "library") async throws -> (OfflineLibrary, LocalBook) {
        let file = root.appendingPathComponent(filename)
        try Data(source.utf8).write(to: file)
        let library = try OfflineLibrary(root: root.appendingPathComponent(shelf), scope: .device)
        return (library, try await library.importFile(file))
    }

    // A blank-line-only parser loses the real chapter boundary when title and body share a block.
    func testChineseVolumesAndFullWidthChaptersSplitWithoutBlankLinesAndKeepFrontMatter() async throws {
        let source = "出版说明\r\n这是卷前说明。\r\n第一卷 开始\r\n卷的开场。\r\n第１章　初见\r\n第一章正文 🐿️。\r第二章 重逢\r最后的正文。\r尾声\r尾声正文。"
        let (library, book) = try await load(source)
        XCTAssertEqual(book.chapters.map(\.title), ["Synthetic", "第一卷 开始", "第１章　初见", "第二章 重逢", "尾声"])
        XCTAssertTrue(book.chapters.first?.passages.first?.text.contains("出版说明") == true)
        XCTAssertTrue(book.chapters.last?.passages.contains { $0.text.contains("尾声正文。") } == true)
        XCTAssertEqual(book.chapters.flatMap(\.passages).filter(\.heading).map(\.text), ["第一卷 开始", "第１章　初见", "第二章 重逢", "尾声"])
        let original = try await library.originalURL(book.id)
        XCTAssertEqual(try Data(contentsOf: original), Data(source.utf8))
    }

    // Front TOC entries must remain readable without becoming duplicate body chapters.
    func testFrontContentsDuplicateTitlesArePreservedOutsideBodyChapters() async throws {
        let source = "目录\n第一章 开门\n第二章 远行\n第三章 ..... 15\n\n第一章 开门\n第一章正文。\n\n第二章 远行\n第二章正文和书的结尾。"
        let (_, book) = try await load(source)
        XCTAssertEqual(book.chapters.map(\.title), ["Synthetic", "第一章 开门", "第二章 远行"])
        let text = book.chapters.flatMap(\.passages).map(\.text).joined(separator: "\n")
        XCTAssertEqual(text.components(separatedBy: "第一章 开门").count - 1, 2)
        XCTAssertEqual(text.components(separatedBy: "第二章 远行").count - 1, 2)
        XCTAssertTrue(book.chapters[0].passages.map(\.text).joined().contains("第三章 ..... 15"))
        XCTAssertTrue(text.hasSuffix("第二章正文和书的结尾。"))
    }

    // Only standalone title syntax is evidence; ordinary chapter references are prose.
    func testEnglishNumberingAndExplicitOpeningClosingLabels() async throws {
        let titles = ["Prologue", "BOOK THE FIRST", "Part One", "CHAPTER 1. A Beginning", "Chapter II: Turning", "Chapter Twenty-One — Travel", "Epilogue"]
        let source = titles.map { $0 + "\nBody text for this section.\n" }.joined(separator: "\n")
        let (_, book) = try await load(source)
        XCTAssertEqual(book.chapters.map(\.title), titles)
        XCTAssertEqual(book.chapters.flatMap(\.passages).filter(\.heading).map(\.text), titles)
        let (_, prose) = try await load("Chapter 2 shows how to read.\n\n第一章讲的是一个普通句子。\n\nNothing else.", filename: "prose.txt")
        XCTAssertEqual(prose.chapters.count, 1)
        XCTAssertFalse(prose.chapters[0].passages.contains(where: \.heading))
    }

    func testSingleRealHeadingIsUsedAndUntitledTextKeepsOneChapter() async throws {
        let (_, book) = try await load("Before.\n\nChapter 1\nBody.")
        XCTAssertEqual(book.chapters.map(\.title), ["Synthetic", "Chapter 1"])
        let (_, plain) = try await load("Alpha.\n\nBeta.\n\nTail.", filename: "plain.txt")
        XCTAssertEqual(plain.chapters.map(\.title), ["plain"])
        XCTAssertEqual(plain.chapters[0].passages.map(\.text), ["Alpha.", "Beta.", "Tail."])
    }

    // Parsing raw lines would misclassify code/HTML; joining with synthetic blank lines corrupts code.
    func testMarkdownCommonMarkHeadingsProtectCodeHTMLAndRetainChapterSource() async throws {
        let source = "Opening 🐿️.\n\n# First **chapter**\n\nA paragraph.\n\n```md\n# Fenced fake\n\n\nkept blank lines\n```\n\n    # Indented fake\n\n<div>\n# HTML fake\n</div>\n\n- item\n- next\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSecond chapter\n==============\n\nFinal **words**.\n"
        let (library, book) = try await load(source, filename: "synthetic.markdown")
        XCTAssertEqual(book.kind, .markdown)
        XCTAssertEqual(book.chapters.map(\.title), ["synthetic", "First chapter", "Second chapter"])
        guard book.chapters.count == 3 else { return }
        XCTAssertTrue(MarkdownChapterDocument.canUseRetainedSource(for: book))
        let layout = MarkdownChapterDocument(book: book, chapter: book.chapters[1], retainedSource: source)
        XCTAssertTrue(layout.document.text.contains("# Fenced fake\n\n\nkept blank lines"))
        XCTAssertTrue(layout.document.text.contains("# Indented fake"))
        XCTAssertTrue(layout.document.text.contains("• item\n• next"))
        XCTAssertTrue(layout.document.text.contains("1\t2"))
        XCTAssertFalse(layout.document.text.contains("Final words"))
        let last = MarkdownChapterDocument(book: book, chapter: book.chapters[2], retainedSource: source)
        XCTAssertEqual(last.document.text, "Second chapter\nFinal words.\n")
        let fallback = MarkdownChapterDocument(book: book, chapter: book.chapters[1])
        XCTAssertEqual(fallback.document.text, layout.document.text)
        let original = try await library.originalURL(book.id)
        XCTAssertEqual(try Data(contentsOf: original), Data(source.utf8))
    }

    func testDecoratedSpacedChineseHeadingsAndEnglishSentencesAreDistinguished() async throws {
        let source = "【第 一 章 起点】\n开场。\n第 二 章 终点\n最后。"
        let (_, book) = try await load(source)
        XCTAssertEqual(book.chapters.map(\.title), ["【第 一 章 起点】", "第 二 章 终点"])
        let (_, prose) = try await load("Chapter 1 Is A Sentence.\n\nEnd.", filename: "sentence.txt")
        XCTAssertEqual(prose.chapters.count, 1)
        XCTAssertFalse(prose.chapters[0].passages.contains(where: \.heading))
    }

    func testMarkdownSourceRangesCoverUnicodeCRLFAndThematicFrontMatterExactly() async throws {
        let source = "---\r\n\r\n# 第一个 🐿️\r\n\r\n重复 **中文**。\r\n\r\n<custom>\r\n# HTML fake\r\n</custom>\r\n\r\n> # Quoted fake\r\n\r\n## Second\r\n\r\n重复 **中文**。\r\n"
        let (_, book) = try await load(source, filename: "unicode.md")
        XCTAssertEqual(book.chapters.map(\.title), ["unicode", "第一个 🐿️", "Second"])
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")
        XCTAssertEqual(book.chapters.flatMap(\.passages).map(\.text).joined(), normalized)
        let raw = normalized as NSString
        for chapter in book.chapters {
            let range = try XCTUnwrap(chapter.sourceUTF16Range)
            let chapterSource = raw.substring(with: range)
            XCTAssertEqual(chapterSource, chapter.passages.map(\.text).joined())
            let layout = MarkdownChapterDocument(book: book, chapter: chapter, retainedSource: source)
            XCTAssertEqual(layout.sourceRanges.count, chapter.passages.count)
            for (passage, passageRange) in zip(chapter.passages, layout.sourceRanges) {
                XCTAssertEqual((chapterSource as NSString).substring(with: passageRange), passage.text)
            }
            if chapter.title == "Second" {
                let display = (layout.document.text as NSString).range(of: "中文")
                let sourceOffset = layout.document.sourceUTF16Offset(at: display.location)
                XCTAssertEqual(sourceOffset, (chapterSource as NSString).range(of: "中文").location)
                XCTAssertEqual(layout.document.displayedUTF16Offset(forSourceUTF16Offset: sourceOffset), display.location)
            }
        }
    }

    func testRepairOfHistoricalTextIndexPreservesExistingAnchors() async throws {
        let source = "# First\n\nOne.\n\n# Second\n\nTwo."
        let (library, book) = try await load(source, filename: "repair.md")
        var old = book
        old.chapters = [BookChapter(id: "text", title: "Historical", sourcePath: "text", passages: [Passage(id: "text-0", text: source)])]
        let folder = try await library.bookDirectory(book.id)
        let indexURL = folder.appendingPathComponent("book.json")
        try Disk.write(old, to: indexURL)
        var manifest = try Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json"))
        let index = try XCTUnwrap(manifest.files.firstIndex { $0.path == "book.json" })
        manifest.files[index] = FileDigest(path: "book.json", sha256: try Disk.hashFile(indexURL), bytes: try Disk.size(indexURL))
        try Disk.write(manifest, to: folder.appendingPathComponent("manifest.json"))
        let anchor = ReadingAnchor(chapterID: "text", passageID: "text-0", characterOffset: 3)
        var state = ReaderState()
        state.anchor = anchor
        state.notes = [ReaderNote(anchor: anchor, quote: "First", body: "Preserved")]
        try await library.saveState(state, bookID: book.id)
        let repaired = try await library.repair(book.id)
        XCTAssertEqual(repaired.chapters, old.chapters)
        let restored = try await library.state(book.id)
        XCTAssertEqual(restored.anchor, anchor)
        XCTAssertEqual(restored.notes.first?.anchor, anchor)
    }

    func testRepairWithUnverifiableTextIndexPreservesOriginalAndHistoricalRecords() async throws {
        for ext in ["txt", "md"] {
            for damage in ["index-changed", "index-missing", "manifest-missing"] {
                let source = "Chapter 1\n\nOriginal \(ext) \(damage).\n\nChapter 2\n\nTail."
                let shelf = ext + "-" + damage
                let (library, book) = try await load(source, filename: shelf + "." + ext, shelf: shelf)
                let folder = try await library.bookDirectory(book.id)
                let indexURL = folder.appendingPathComponent("book.json")
                let manifestURL = folder.appendingPathComponent("manifest.json")
                var old = book
                old.chapters = [BookChapter(id: "text", title: "Historical", sourcePath: "text", passages: [Passage(id: "text-0", text: source)])]
                try Disk.write(old, to: indexURL)
                var manifest = try Disk.read(OfflineManifest.self, from: manifestURL)
                let index = try XCTUnwrap(manifest.files.firstIndex { $0.path == "book.json" })
                manifest.files[index] = FileDigest(path: "book.json", sha256: try Disk.hashFile(indexURL), bytes: try Disk.size(indexURL))
                try Disk.write(manifest, to: manifestURL)
                let anchor = ReadingAnchor(chapterID: "text", passageID: "text-0", characterOffset: 3)
                var state = ReaderState()
                state.anchor = anchor
                state.notes = [ReaderNote(anchor: anchor, quote: "Chapter", body: "Keep my historical note")]
                try await library.saveState(state, bookID: book.id)
                if damage == "index-changed" { old.chapters[0].title = "Corrupted"; try Disk.write(old, to: indexURL) }
                else if damage == "index-missing" { try FileManager.default.removeItem(at: indexURL) }
                else { try FileManager.default.removeItem(at: manifestURL) }
                let oldIndex = try? Data(contentsOf: indexURL)
                let oldManifest = try? Data(contentsOf: manifestURL)
                let stateURL = root.appendingPathComponent(shelf + "/device/states/" + book.id + ".json")
                let oldState = try Data(contentsOf: stateURL)
                let originalURL = folder.appendingPathComponent("source." + book.kind.rawValue)
                let original = try Data(contentsOf: originalURL)
                do {
                    _ = try await library.repair(book.id)
                    XCTFail("Unverifiable saved text indexes must not acquire new anchors: \(shelf)")
                } catch { XCTAssertTrue(error.localizedDescription.contains("索引"), error.localizedDescription) }
                XCTAssertEqual(try? Data(contentsOf: indexURL), oldIndex)
                XCTAssertEqual(try? Data(contentsOf: manifestURL), oldManifest)
                XCTAssertEqual(try Data(contentsOf: stateURL), oldState)
                XCTAssertEqual(try Data(contentsOf: originalURL), original)
            }
        }
    }

    func testChineseProseImmediatelyFollowingChapterMarkerDoesNotCreateAHeading() async throws {
        for verb in ["介绍", "讨论", "讲述", "主要", "说明", "提到", "解释", "探讨", "阐述", "描述"] {
            let (_, prose) = try await load("第一章" + verb + "了这些问题\n\n后面的正文。", filename: verb + ".txt")
            XCTAssertFalse(prose.chapters.flatMap(\.passages).contains(where: \.heading), verb)
            let (_, heading) = try await load("第一章 " + verb + "这些问题\n正文。", filename: verb + "-title.txt")
            XCTAssertEqual(heading.chapters.first?.title, "第一章 " + verb + "这些问题")
            XCTAssertTrue(heading.chapters.first?.passages.first?.heading == true)
        }
    }

    func testNewImportIDsAreDeterministicAndDuplicateDoesNotRewriteSavedIndexOrNotes() async throws {
        let source = "# First\n\nOne.\n\n# Second\n\nTwo."
        let (library, book) = try await load(source, filename: "stable.md")
        let (_, independent) = try await load(source, filename: "other.md", shelf: "another")
        XCTAssertEqual(book.chapters.map(\.id), independent.chapters.map(\.id))
        XCTAssertEqual(book.chapters.flatMap(\.passages).map(\.id), independent.chapters.flatMap(\.passages).map(\.id))
        XCTAssertEqual(book.chapters.count, 2)
        // Simulate a historical single-chapter index with existing anchors, then duplicate-import.
        var old = book
        old.chapters = [BookChapter(id: "text", title: "Historical", sourcePath: "text", passages: [Passage(id: "text-0", text: source)])]
        let folder = try await library.bookDirectory(book.id)
        let indexURL = folder.appendingPathComponent("book.json")
        try Disk.write(old, to: indexURL)
        var manifest = try Disk.read(OfflineManifest.self, from: folder.appendingPathComponent("manifest.json"))
        let index = try XCTUnwrap(manifest.files.firstIndex { $0.path == "book.json" })
        manifest.files[index] = FileDigest(path: "book.json", sha256: try Disk.hashFile(indexURL), bytes: try Disk.size(indexURL))
        try Disk.write(manifest, to: folder.appendingPathComponent("manifest.json"))
        var state = ReaderState()
        let anchor = ReadingAnchor(chapterID: "text", passageID: "text-0", characterOffset: 3)
        state.notes = [ReaderNote(anchor: anchor, quote: "First", body: "Keep my note")]
        try await library.saveState(state, bookID: book.id)
        let file = root.appendingPathComponent("stable.md")
        let duplicate = try await library.importFile(file)
        XCTAssertEqual(duplicate.chapters, old.chapters)
        let restored = try await library.state(book.id)
        XCTAssertEqual(restored.notes.first?.body, "Keep my note")
    }
}
