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
    func testLiteralAndEncodedEmojiHaveAccurateScalarSourceMappingsAndRoundTrips() throws {
        let source = "Literal **🐿️**; encoded **&#x1F43F;&#xfe0f;**; multi **&NotEqualTilde;**; link [café](https://example.invalid); after **done**."
        let document = MarkdownDocument(source: source), raw = source as NSString, visible = document.text as NSString
        XCTAssertEqual(document.text, "Literal 🐿️; encoded 🐿️; multi ≂̸; link café; after done.\n")
        let foundLiteral = visible.range(of: "🐿️")
        let literal = try XCTUnwrap(foundLiteral.location == NSNotFound ? nil : foundLiteral)
        let encoded = visible.range(of: "🐿️", options: [], range: NSRange(location: NSMaxRange(literal), length: visible.length - NSMaxRange(literal)))
        let literalSource = raw.range(of: "🐿️"), entitySource = raw.range(of: "&#x1F43F;"), selectorSource = raw.range(of: "&#xfe0f;")
        for (display, scalarSource, selector) in [(literal, literalSource.location, literalSource.location + 2), (encoded, entitySource.location, selectorSource.location)] {
            XCTAssertNotEqual(display.location, NSNotFound)
            XCTAssertEqual(document.sourceUTF16Offset(at: display.location), scalarSource)
            XCTAssertEqual(document.sourceUTF16Offset(at: display.location + 1), scalarSource, "Both UTF-16 surrogate units belong to the squirrel scalar")
            XCTAssertEqual(document.sourceUTF16Offset(at: display.location + 2), selector, "The variation selector has its own source scalar even when it shares one displayed Character")
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: scalarSource), display.location)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: selector), display.location + 2)
        }
        let multi = visible.range(of: "≂̸"), multiSource = raw.range(of: "&NotEqualTilde;")
        XCTAssertEqual(document.sourceUTF16Offset(at: multi.location), multiSource.location)
        XCTAssertEqual(document.sourceUTF16Offset(at: multi.location + 1), multiSource.location, "One entity can produce multiple visible scalars")
        XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: multiSource.location), multi.location)
        for word in ["café", "done"] {
            let display = visible.range(of: word), sourceRange = raw.range(of: word)
            XCTAssertEqual(document.sourceUTF16Offset(at: display.location), sourceRange.location)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: sourceRange.location), display.location)
        }
    }
    func testEncodedPrefixesCanCombineWithLiteralScalarsWithoutLosingTheirSource() throws {
        func firstMatch(of needle: [UInt16], in haystack: [UInt16]) -> Int? {
            guard !needle.isEmpty, needle.count <= haystack.count else { return nil }
            return (0...(haystack.count - needle.count)).first {
                haystack[$0..<($0 + needle.count)].elementsEqual(needle)
            }
        }
        let cases: [(source: String, display: [UInt16], token: [UInt16], tail: [UInt16])] = [
            ("**&#x65;\u{301}** after", [0x65, 0x301], Array("&#x65;".utf16), [0x301]),
            ("**e&#x301;** after", [0x65, 0x301], [0x65], Array("&#x301;".utf16)),
            ("**&NotEqualTilde;\u{FE0F}** after", [0x2242, 0x338, 0xFE0F], Array("&NotEqualTilde;".utf16), [0xFE0F])
        ]
        for item in cases {
            let document = MarkdownDocument(source: item.source)
            let raw = Array(item.source.utf16), display = Array(document.text.utf16)
            let diagnostics = "raw scalars: \(item.source.unicodeScalars.map(\.value)); display scalars: \(document.text.unicodeScalars.map(\.value))"
            let after: [UInt16] = [0x61, 0x66, 0x74, 0x65, 0x72]
            XCTAssertEqual(display, item.display + [0x20] + after + [0xA], diagnostics)
            // Exact UTF-16 subsequences can end before a combining mark or start
            // inside a Character; NSString.range(of:) may reject those boundaries.
            let visible = try XCTUnwrap(firstMatch(of: item.display, in: display), diagnostics)
            let start = try XCTUnwrap(firstMatch(of: item.token, in: raw), diagnostics)
            let suffix = try XCTUnwrap(firstMatch(of: item.tail, in: raw), diagnostics)
            let visibleSuffix = visible + item.display.count - 1
            XCTAssertEqual(document.sourceUTF16Offset(at: visible), start, diagnostics)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: start), visible, diagnostics)
            XCTAssertEqual(document.sourceUTF16Offset(at: visibleSuffix), suffix, diagnostics)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: suffix), visibleSuffix, diagnostics)
            let visibleAfter = try XCTUnwrap(firstMatch(of: after, in: display), diagnostics)
            let rawAfter = try XCTUnwrap(firstMatch(of: after, in: raw), diagnostics)
            XCTAssertEqual(document.sourceUTF16Offset(at: visibleAfter), rawAfter, diagnostics)
            XCTAssertEqual(document.displayedUTF16Offset(forSourceUTF16Offset: rawAfter), visibleAfter, diagnostics)
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
