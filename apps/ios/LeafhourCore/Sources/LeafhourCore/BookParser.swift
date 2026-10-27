import Foundation
import PDFKit
import ZIPFoundation

/// Parses only user-selected local source files. No scripts, remote resources, OCR or models run here.
enum BookParser {
    static func parse(source: URL, kind: BookKind, filename: String, id: String, destination: URL, limits: ImportLimits) throws -> LocalBook {
        let chapters: [BookChapter]
        var title = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        var author = ""
        switch kind {
        case .epub:
            let assets = destination.appendingPathComponent("assets", isDirectory: true)
            try Disk.directory(assets)
            try unpack(source, into: assets, limits: limits)
            guard !Disk.fm.fileExists(atPath: assets.appendingPathComponent("META-INF/encryption.xml").path) else { throw LibraryError.invalid("此 EPUB 含加密资源，当前无法安全导入。原件已保留。") }
            let container = try XMLIndex(data: Data(contentsOf: Disk.url(assets, "META-INF/container.xml")))
            guard let rootfile = container.elements.first(where: { $0.name == "rootfile" })?.attributes["full-path"] else { throw LibraryError.invalid("EPUB 缺少内容目录。") }
            let opf = try Disk.safePath(rootfile)
            let index = try XMLIndex(data: Data(contentsOf: Disk.url(assets, opf)))
            title = index.elements.first(where: { $0.name == "title" && !$0.text.isEmpty })?.text ?? title
            author = index.elements.first(where: { $0.name == "creator" })?.text ?? ""
            let items = index.elements.filter { $0.name == "item" }
            var byID: [String: XMLElementValue] = [:]
            for item in items {
                guard let key = item.attributes["id"], byID[key] == nil else { throw LibraryError.invalid("EPUB 内容目录有重复或缺失标识。") }
                byID[key] = item
            }
            let refs = index.elements.filter { $0.name == "itemref" }
            guard !refs.isEmpty else { throw LibraryError.invalid("EPUB 没有可阅读的章节顺序。") }
            var paths: [String] = []
            for ref in refs {
                guard let key = ref.attributes["idref"], let item = byID[key], let href = item.attributes["href"], item.attributes["media-type"] == "application/xhtml+xml" || item.attributes["media-type"] == "text/html" else { throw LibraryError.invalid("EPUB 的章节不完整或使用不支持的格式。") }
                let path = try Disk.resolve(href, relativeTo: opf)
                guard !paths.contains(path) else { throw LibraryError.invalid("EPUB 包含重复的章节引用。") }
                paths.append(path)
            }
            // Keep supplementary XHTML (for example endnotes) accessible, too.
            for item in items where item.attributes["media-type"] == "application/xhtml+xml" || item.attributes["media-type"] == "text/html" {
                if let href = item.attributes["href"] { let path = try Disk.resolve(href, relativeTo: opf); if !paths.contains(path) { paths.append(path) } }
            }
            chapters = try paths.enumerated().map { index, path in
                try Task.checkCancellation()
                let parser = XHTMLReader(sourcePath: path)
                try parser.parse(Data(contentsOf: Disk.url(assets, path)))
                guard !parser.passages.isEmpty else { throw LibraryError.invalid("第 \(index + 1) 章没有可读取的正文，未将不完整内容标为可离线。") }
                for passage in parser.passages { if let image = passage.resourcePath { _ = try Data(contentsOf: Disk.url(assets, image)) } }
                return BookChapter(id: "ch-" + Disk.hash(Data(path.utf8)), title: parser.passages.first(where: { $0.heading })?.text ?? "第 \(index + 1) 章", sourcePath: path, passages: parser.passages)
            }
        case .pdf:
            guard let document = PDFDocument(url: source), !document.isLocked, document.pageCount > 0 else { throw LibraryError.invalid("PDF 无法读取或需要密码。原件已保留。") }
            title = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String ?? title
            author = document.documentAttributes?[PDFDocumentAttribute.authorAttribute] as? String ?? ""
            chapters = try (0..<document.pageCount).map { index in
                try Task.checkCancellation()
                guard let page = document.page(at: index) else { throw LibraryError.invalid("PDF 包含无法读取的页面。") }
                let key = "page-\(index + 1)"
                return BookChapter(id: key, title: "第 \(index + 1) 页", sourcePath: key, passages: [Passage(id: key, text: page.string ?? "")])
            }
        case .unknown: throw LibraryError.invalid("未知格式，请重新选择原件修复。")
        case .txt, .markdown:
            let data = try Data(contentsOf: source)
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw LibraryError.invalid("文本为空或编码不受支持。请使用 UTF-8 或 UTF-16。") }
            let paragraphs = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            chapters = [BookChapter(id: "text", title: title, sourcePath: "text", passages: paragraphs.enumerated().map { Passage(id: "text-\($0.offset)", text: $0.element) })]
        }
        return LocalBook(id: id, title: title, author: author, kind: kind, sourceVersion: "sha256-" + id, originalFilename: filename, importedAt: Date(), chapters: chapters)
    }

    static func unpack(_ source: URL, into folder: URL, limits: ImportLimits) throws {
        let archive = try Archive(url: source, accessMode: .read)
        var entryCount = 0
        var names = Set<String>(), total: Int64 = 0
        for entry in archive {
            try Task.checkCancellation()
            entryCount += 1
            guard entryCount <= limits.maximumEntries else { throw LibraryError.invalid("EPUB 文件项超过本机上限。") }
            let raw = entry.type == .directory ? String(entry.path.dropLast()) : entry.path
            // Directory paths are validated too; never create archive-supplied symlinks.
            let path = try Disk.safePath(raw)
            let normalized = path.precomposedStringWithCanonicalMapping.lowercased()
            guard names.insert(normalized).inserted, entry.type != .symlink else { throw LibraryError.invalid("EPUB 含重复路径或符号链接。") }
            guard entry.uncompressedSize <= UInt64(limits.maximumEntryBytes) else { throw LibraryError.invalid("EPUB 单个资源过大。") }
            guard entry.uncompressedSize <= UInt64(limits.maximumExpandedBytes - total) else { throw LibraryError.invalid("EPUB 解压后的内容过大。") }
            total += Int64(entry.uncompressedSize)
            if entry.type == .directory { continue }
            var data = Data()
            let crc = try archive.extract(entry, bufferSize: 65_536) { chunk in
                try Task.checkCancellation()
                guard data.count <= Int(limits.maximumEntryBytes) - chunk.count, data.count + chunk.count <= Int(entry.uncompressedSize) else { throw LibraryError.invalid("EPUB 实际资源大小与目录不符。") }
                data.append(chunk)
            }
            guard crc == entry.checksum, data.count == Int(entry.uncompressedSize) else { throw LibraryError.invalid("EPUB 文件校验失败。原件已保留。") }
            let target = try Disk.url(folder, path)
            try Disk.directory(target.deletingLastPathComponent())
            try data.write(to: target, options: .atomic)
        }
        guard let type = try? String(contentsOf: Disk.url(folder, "mimetype"), encoding: .utf8), type.trimmingCharacters(in: .whitespacesAndNewlines) == "application/epub+zip" else { throw LibraryError.invalid("文件不是有效 EPUB。") }
    }
}

struct XMLElementValue { var name: String; var attributes: [String: String]; var text: String }
final class XMLIndex: NSObject, XMLParserDelegate {
    var elements: [XMLElementValue] = []
    private var stack: [XMLElementValue] = []
    init(data: Data) throws {
        super.init()
        let parser = try safeXML(data, delegate: self)
        guard parser.parse() else { throw LibraryError.invalid("书籍内容目录格式错误。") }
    }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) { stack.append(XMLElementValue(name: localName(name), attributes: attributes, text: "")) }
    func parser(_ parser: XMLParser, foundCharacters string: String) { if !stack.isEmpty { stack[stack.count - 1].text += string } }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard var node = stack.popLast() else { return }; node.text = node.text.trimmingCharacters(in: .whitespacesAndNewlines); elements.append(node)
        if !stack.isEmpty { stack[stack.count - 1].text += node.text }
    }
}
private func localName(_ value: String) -> String { String(value.split(separator: ":").last ?? Substring(value)) }
private func safeXML(_ data: Data, delegate: XMLParserDelegate) throws -> XMLParser {
    // Prevent internally declared entity expansion; external entities are never resolved.
    let text: String?
    if data.starts(with: [0xff, 0xfe]) || data.starts(with: [0xfe, 0xff]) { text = String(data: data, encoding: .utf16) }
    else if data.starts(with: [0x00, 0x3c, 0x00, 0x3f]) { text = String(data: data, encoding: .utf16BigEndian) }
    else if data.starts(with: [0x3c, 0x00, 0x3f, 0x00]) { text = String(data: data, encoding: .utf16LittleEndian) }
    else { text = String(data: data, encoding: .utf8) }
    guard let text, !text.contains("\0"), !text.localizedCaseInsensitiveContains("<!ENTITY") else { throw LibraryError.invalid("书籍 XML 编码或实体声明不受支持。") }
    let parser = XMLParser(data: data); parser.delegate = delegate; parser.shouldResolveExternalEntities = false; parser.externalEntityResolvingPolicy = .never
    return parser
}
final class XHTMLReader: NSObject, XMLParserDelegate {
    let sourcePath: String
    var passages: [Passage] = []
    private var buffer = "", anchor = "", heading = false, bodyDepth = 0, ignoredDepth = 0
    private var preformatted = false
    private var usedIDs = Set<String>()
    private let blocks: Set<String> = ["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "figcaption", "dt", "dd"]
    init(sourcePath: String) { self.sourcePath = sourcePath }
    func parse(_ data: Data) throws {
        let parser = try safeXML(data, delegate: self)
        guard parser.parse() else { throw LibraryError.invalid("章节 XHTML 无法完整解析，原件已保留。") }
        flush()
    }
    private func flush() {
        let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        defer { buffer = ""; anchor = ""; heading = false }
        guard !value.isEmpty else { return }
        let preferred = anchor.isEmpty ? "block-\(passages.count)" : anchor
        let stable = uniqueID(preferred)
        passages.append(Passage(id: "p-" + Disk.hash(Data((sourcePath + "#" + stable).utf8)), text: value, heading: heading))
    }
    private func uniqueID(_ preferred: String) -> String {
        var value = preferred, suffix = 1
        while usedIDs.contains(value) { value = preferred + "-\(suffix)"; suffix += 1 }
        usedIDs.insert(value)
        return value
    }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        let name = localName(name)
        if name == "body" { bodyDepth = 1; return }
        guard bodyDepth > 0 else { return }; bodyDepth += 1
        if ignoredDepth > 0 { ignoredDepth += 1; return }
        if ["script", "style"].contains(name) { ignoredDepth = 1; return }
        if blocks.contains(name) { flush(); anchor = attributes["id"] ?? ""; heading = name.hasPrefix("h") && name.count == 2 }
        if name == "pre" { preformatted = true }
        if name == "br" { buffer += "\n" }
        if name == "td" || name == "th" { if !buffer.isEmpty { buffer += "\t" } }
        if name == "img", let href = attributes["src"] {
            flush()
            do {
                let path = try Disk.resolve(href, relativeTo: sourcePath)
                let stable = uniqueID(attributes["id"] ?? "image-\(passages.count)")
                passages.append(Passage(id: "p-" + Disk.hash(Data((sourcePath + "#" + stable).utf8)), text: "", resourcePath: path, alternative: attributes["alt"]))
            } catch { parser.abortParsing() }
        }
        // Preserve foreign SVG/math textual content; unsupported vector images still retain their source.
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard bodyDepth > 0, ignoredDepth == 0 else { return }
        if preformatted { buffer += string; return }
        for scalar in string.unicodeScalars {
            if scalar == " " || scalar == "\t" || scalar == "\r" || scalar == "\n" {
                if buffer.last?.isWhitespace != true { buffer.append(" ") }
            } else { buffer.unicodeScalars.append(scalar) }
        }
    }
    func parser(_ parser: XMLParser, foundCDATA data: Data) { self.parser(parser, foundCharacters: String(decoding: data, as: UTF8.self)) }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard bodyDepth > 0 else { return }
        let name = localName(name)
        if ignoredDepth > 0 { ignoredDepth -= 1 }
        else if blocks.contains(name) || name == "body" { flush() }
        if name == "pre" { preformatted = false }
        bodyDepth -= 1
    }
}
