# Native iOS Markdown rendering

GET-312 uses the Swift project's [`swift-cmark` 0.6.0](https://github.com/swiftlang/swift-cmark/tree/0.6.0), pinned to tag object `b022b08312decdc46585e0b3440d97f6f22ef703`. Only the required C sources and GFM extensions are vendored (about 0.93 MB). Builds do not fetch packages from the network. Upstream license notices are preserved in `apps/ios/Vendor/swift-cmark/COPYING` and included in the app's `Resources/MarkdownThirdPartyNotices.txt`.

## Selection

The [Swift Markdown package](https://github.com/swiftlang/swift-markdown) uses cmark-gfm underneath its Swift syntax tree. Using that underlying parser directly gives Leafhour the same CommonMark/GFM parsing model while keeping its existing single `UITextView`, continuous system selection, text search and Unicode-based reading anchors.

[MarkdownUI](https://github.com/gonzalezreal/swift-markdown-ui) is now in maintenance mode. Its [cross-paragraph selection issue](https://github.com/gonzalezreal/swift-markdown-ui/issues/264) matters for an existing selection-based reader. Its successor [Textual](https://github.com/gonzalezreal/textual) is a broader text-rendering engine; adopting it would replace the current TextKit selection and position code. These are useful libraries, but the underlying parser plus native attributed text fits this reader with less migration risk.

## Data and rendering

- Retain the original Markdown file, unchanged `Passage.text`, stable passage IDs, existing `book.json` and integrity manifests. Existing imported Markdown books benefit from rendering without rewriting notes, positions or content versions.
- Local single-chapter Markdown parses the complete retained document, including fenced code containing blank lines. Cloud copies and multi-chapter books parse only the current chapter's unchanged passages, so opening a chapter cannot repeat the entire book. If a local chapter's passages do not match its retained document, parse its unchanged passages together instead.
- Render headings, emphasis, links, lists and task lists, blockquotes, fenced/indented code, thematic breaks, tables and strikethrough as native attributed text. Tables use native tab stops with distinct headers and wrapping on narrow screens; source table separators are removed. Block spacing does not introduce repeated empty lines, and code backgrounds stay within the code content.
- Maintain displayed UTF-16 → source UTF-16 mapping, then convert within the unchanged passage to the existing Unicode scalar anchor. Restore a source anchor through the reverse map after font/width changes.
- Search the rendered document rather than its format markers. Results keep the original passage ID and map the matched position back to the unchanged source anchor. Source format metadata also enables Markdown rendering for downloaded cloud books.
- Accept only HTTP, HTTPS and mailto link actions. HTML tags never execute. Remote images are represented by their alternative text and do not trigger network requests. Importing a standalone Markdown file does not grant access to its adjacent local files.

The parser is a standard CommonMark/GFM parser, not a regular-expression formatter. Malformed/unclosed markup follows upstream parsing behavior and can remain literal where CommonMark treats it as plain text.

## Conversation presentation (GET-385)

Chat uses a separate native attributed layout without changing retained book content, reading anchors or Markdown source. The parser exposes actual table/row/cell UTF-16 ranges; decoded tabs and newlines inside a cell are data, not column delimiters. Responsive records retain rich header links, emphasis and complete values. Short, fitting tables can retain columns. Whole-message copy returns the raw Markdown, including when a long user question is folded.

One selectable UITextView carries each message. TextKit draws code surfaces and quote rules behind that text; code wraps at words with a hanging continuation, while long tokens remain complete. Dynamic type is applied to base fonts once. Marginal notes start at the first sentence and retain user reading intent; the global companion retains explicit latest-following. Native iOS 26 edge fog is disabled on this reading surface with an opaque navigation background; older systems keep their supported path. Runtime iOS 17 and physical-device behavior remain separate acceptance scopes.
