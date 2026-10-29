import XCTest
@testable import LeafhourCore

final class MarkdownDocumentTests: XCTestCase {
    func testCommonMarkRendersBlocksAndInlineStylesWithoutSourceDelimiters() {
        let source = "# A quiet page\n\nA **bold** and *gentle* thought with `code` and [a link](https://example.org).\n\n> A quoted thought.\n\n- First\n- Second\n\n```swift\nlet value = 1\n\nprint(value)\n```\n\n---"
        let document = MarkdownDocument(source: source)
        XCTAssertTrue(document.text.contains("A quiet page"))
        XCTAssertTrue(document.text.contains("A bold and gentle thought with code and a link."))
        XCTAssertTrue(document.text.contains("• First\n• Second"))
        XCTAssertTrue(document.text.contains("let value = 1\n\nprint(value)"))
        XCTAssertFalse(document.text.contains("**"))
        XCTAssertFalse(document.text.contains("```"))
        XCTAssertFalse(document.text.contains("https://"))
        XCTAssertTrue(document.runs.contains { $0.style.heading == 1 })
        XCTAssertTrue(document.runs.contains { $0.style.bold })
        XCTAssertTrue(document.runs.contains { $0.style.italic })
        XCTAssertTrue(document.runs.contains { $0.style.quoteDepth == 1 })
        XCTAssertTrue(document.runs.contains { $0.style.codeBlock })
        XCTAssertTrue(document.runs.contains { $0.style.link == "https://example.org" })
    }
    func testGFMListsTablesAndStrikethrough() {
        let document = MarkdownDocument(source: "- [x] Read\n- [ ] Reflect\n\n| Name | Thought |\n| --- | --- |\n| Leaf | ~~gone~~ |")
        XCTAssertTrue(document.text.contains("☑ Read"))
        XCTAssertTrue(document.text.contains("☐ Reflect"))
        XCTAssertTrue(document.text.contains("Name\tThought"))
        XCTAssertTrue(document.text.contains("Leaf\tgone"))
        XCTAssertFalse(document.text.contains("---"))
        XCTAssertFalse(document.text.contains("~~"))
        XCTAssertTrue(document.runs.contains { $0.style.table })
        XCTAssertTrue(document.runs.contains { $0.style.tableHeader && $0.style.bold && $0.style.tableColumns == 2 })
        XCTAssertFalse(document.text.contains("│"))
        XCTAssertTrue(document.runs.contains { $0.style.strikethrough })
    }
    func testSourceMappingRetainsUnicodeAndMarkdownAnchors() {
        let source = "# 标题\n\n🐿️ A **bold** 中文 and [link](https://example.org)."
        let document = MarkdownDocument(source: source)
        for word in ["标题", "🐿️", "bold", "中文", "link"] {
            let raw = (source as NSString).range(of: word)
            let visible = (document.text as NSString).range(of: word)
            XCTAssertNotEqual(visible.location, NSNotFound)
            XCTAssertEqual(document.sourceUTF16Offset(at: visible.location), raw.location, word)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: raw.location), visible.location, word)
        }
    }
    func testEscapesEntitiesAndSafeLinksKeepTextAndSourceLocation() {
        let source = "An &amp; apple \\*literal\\* and &#x4e2d;文 **after**. [unsafe](javascript:alert(1))"
        let document = MarkdownDocument(source: source)
        XCTAssertTrue(document.text.contains("An & apple *literal* and 中文 after."))
        XCTAssertFalse(document.runs.contains { $0.style.link?.hasPrefix("javascript:") == true })
        for word in ["apple", "literal", "文", "after"] {
            XCTAssertEqual(document.sourceUTF16Offset(at: (document.text as NSString).range(of: word).location), (source as NSString).range(of: word).location)
        }
    }
    func testHTMLAndImagesNeverBecomeExecutableOrRemoteLoads() {
        let document = MarkdownDocument(source: "Before <b>bold</b>.\n\n![A squirrel](https://example.org/squirrel.jpg)\n\n<div>A thought</div>")
        XCTAssertTrue(document.text.contains("Before bold."))
        XCTAssertTrue(document.text.contains("[插图：A squirrel]"))
        XCTAssertTrue(document.text.contains("A thought"))
        XCTAssertFalse(document.text.contains("<div>"))
        XCTAssertFalse(document.runs.contains { $0.style.link == "https://example.org/squirrel.jpg" })
    }
    func testMultiScalarEntitiesDoNotMoveFollowingTextAnchors() {
        let source = "An &NotEqualTilde; comparison and **after**."
        let document = MarkdownDocument(source: source)
        XCTAssertTrue(document.text.contains("≂̸"))
        for word in ["comparison", "after"] {
            XCTAssertEqual(document.sourceUTF16Offset(at: (document.text as NSString).range(of: word).location), (source as NSString).range(of: word).location)
        }
    }
    func testCodePreservesLiteralEntitiesAndMarkdown() {
        let source = "```html\n&amp; **kept**\n```"
        let document = MarkdownDocument(source: source)
        XCTAssertTrue(document.text.contains("&amp; **kept**"))
        XCTAssertEqual(document.sourceUTF16Offset(at: (document.text as NSString).range(of: "kept").location), (source as NSString).range(of: "kept").location)
    }
    func testBlockSeparatorsDoNotAddBlankRowsOrCodeBackgroundWhitespace() throws {
        let document = MarkdownDocument(source: "# Heading\n\nBody.\n\n```swift\nlet page = 1\n```\n\nAfter.")
        XCTAssertEqual(document.text, "Heading\nBody.\nlet page = 1\nAfter.\n")
        let code = try XCTUnwrap(document.runs.first { $0.style.codeBlock })
        XCTAssertEqual((document.text as NSString).substring(with: code.range), "let page = 1")
        XCTAssertFalse(document.runs.contains { $0.style.codeBlock && (document.text as NSString).substring(with: $0.range).contains("\n\n") })
    }
    func testCloudMarkdownUsesOnlyCurrentChapterAndKeepsOriginalAnchor() {
        let first = BookChapter(id: "one", title: "One", sourcePath: "one", passages: [Passage(id: "stable-one", text: "# First\n🐿️ **alpha**")])
        let second = BookChapter(id: "two", title: "Two", sourcePath: "two", passages: [Passage(id: "stable-two", text: "# Second\n中文 **beta**")])
        let book = LocalBook(id: "cloud-copy", title: "Book", author: "", kind: .txt, sourceVersion: "version", originalFilename: "source.txt", importedAt: Date(), chapters: [first, second], cloud: CloudBookIdentity(ownerID: "account", bookID: "book", contentVersion: "version", sourceFormat: "md"))
        XCTAssertTrue(book.rendersMarkdown)
        XCTAssertFalse(MarkdownChapterDocument.canUseRetainedSource(for: book))
        let fullSource = first.passages[0].text + "\n\n" + second.passages[0].text
        for (chapter, own, other) in [(first, "alpha", "beta"), (second, "beta", "alpha")] {
            let layout = MarkdownChapterDocument(book: book, chapter: chapter, retainedSource: fullSource)
            XCTAssertTrue(layout.document.text.contains(own))
            XCTAssertFalse(layout.document.text.contains(other))
            let visibleOffset = (layout.document.text as NSString).range(of: own).location
            let rawOffset = layout.document.sourceUTF16Offset(at: visibleOffset) - layout.sourceRanges[0].location
            let scalarOffset = (chapter.passages[0].text as NSString).substring(to: rawOffset).unicodeScalars.count
            let oldAnchor = ReadingAnchor(chapterID: chapter.id, passageID: chapter.passages[0].id, characterOffset: chapter.passages[0].text[..<chapter.passages[0].text.range(of: own)!.lowerBound].unicodeScalars.count)
            XCTAssertEqual(scalarOffset, oldAnchor.characterOffset)
            XCTAssertEqual(layout.document.displayedUTF16Offset(forSourceUTF16Offset: rawOffset + layout.sourceRanges[0].location), visibleOffset)
        }
    }
    func testLocalSingleChapterMarkdownKeepsRetainedCodeBlankLines() {
        let passage = Passage(id: "text-0", text: "```swift\nlet value = 1")
        let ending = Passage(id: "text-1", text: "print(value)\n```")
        let chapter = BookChapter(id: "text", title: "Book", sourcePath: "text", passages: [passage, ending])
        let book = LocalBook(id: "local", title: "Book", author: "", kind: .markdown, sourceVersion: "version", originalFilename: "book.md", importedAt: Date(), chapters: [chapter])
        let source = passage.text + "\n\n\n\n" + ending.text
        XCTAssertTrue(MarkdownChapterDocument.canUseRetainedSource(for: book))
        let layout = MarkdownChapterDocument(book: book, chapter: chapter, retainedSource: source)
        XCTAssertTrue(layout.document.text.contains("let value = 1\n\n\n\nprint(value)"))
        XCTAssertEqual(layout.sourceRanges[1].location, passage.text.utf16.count + 4)
    }
    func testEmptyAndMalformedMarkdownRemainReadable() {
        let empty = MarkdownDocument(source: "")
        XCTAssertEqual(empty.text, "")
        XCTAssertEqual(empty.sourceUTF16Offset(at: 100), 0)
        XCTAssertEqual(empty.displayedUTF16Offset(forSourceUTF16Offset: 100), 0)
        let malformed = MarkdownDocument(source: "Unclosed **format\n\n````\nkept code")
        XCTAssertTrue(malformed.text.contains("Unclosed **format"))
        XCTAssertTrue(malformed.text.contains("kept code"))
    }
}
