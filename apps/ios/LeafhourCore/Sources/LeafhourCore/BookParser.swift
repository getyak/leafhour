import Foundation
import PDFKit
import ZIPFoundation

/// Parses only user-selected local source files. No scripts, remote resources, OCR or models run here.
enum BookParser {
    static func parse(source: URL, kind: BookKind, filename: String, id: String, destination: URL, limits: ImportLimits) throws -> LocalBook {
        let chapters: [BookChapter]
        var title = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        var author = ""
        var readingStartChapterID: String? = nil
        var readingStartAnchor: ReadingAnchor? = nil
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
            var elementIDsByPath: [String: [String: String]] = [:]
            chapters = try paths.enumerated().map { index, path in
                try Task.checkCancellation()
                let parser = XHTMLReader(sourcePath: path)
                try parser.parse(Data(contentsOf: Disk.url(assets, path)))
                guard !parser.passages.isEmpty else { throw LibraryError.invalid("第 \(index + 1) 章没有可读取的正文，未将不完整内容标为可离线。") }
                elementIDsByPath[path] = parser.elementPassageIDs
                for passage in parser.passages { if let image = passage.resourcePath { _ = try Data(contentsOf: Disk.url(assets, image)) } }
                return BookChapter(id: "ch-" + Disk.hash(Data(path.utf8)), title: parser.passages.first(where: { $0.heading })?.text ?? "第 \(index + 1) 章", sourcePath: path, passages: parser.passages)
            }
            readingStartAnchor = epubReadingStart(chapters: chapters, assets: assets, opf: opf, index: index, elementIDsByPath: elementIDsByPath)
            readingStartChapterID = readingStartAnchor?.chapterID
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
        return LocalBook(id: id, title: title, author: author, kind: kind, sourceVersion: "sha256-" + id, originalFilename: filename, importedAt: Date(), chapters: chapters, readingStartChapterID: readingStartChapterID, readingStartAnchor: readingStartAnchor)
    }

    /// Older cached indexes have no hint. Read their already-verified local metadata
    /// without replacing book.json, its integrity manifest, or any personal state.
    static func legacyReadingStart(for book: LocalBook, directory: URL) -> ReadingAnchor? {
        guard book.kind == .epub else { return nil }
        do {
            let assets = try Disk.url(directory, "assets")
            let container = try XMLIndex(data: readingMetadata(try Disk.url(assets, "META-INF/container.xml")))
            guard let rootfile = container.elements.first(where: { $0.name == "rootfile" })?.attributes["full-path"] else { return nil }
            let opf = try Disk.safePath(rootfile)
            let index = try XMLIndex(data: readingMetadata(try Disk.url(assets, opf)))
            return epubReadingStart(chapters: book.chapters, assets: assets, opf: opf, index: index)
        } catch { return nil }
    }

    private static func readingMetadata(_ url: URL) throws -> Data {
        // Opening an old cache must not parse arbitrarily large chapters on the main actor.
        guard try Disk.size(url) <= 1_048_576 else { throw LibraryError.invalid("起读元数据超过安全读取上限。") }
        return try Data(contentsOf: url)
    }

    private static func epubReadingStart(chapters: [BookChapter], assets: URL, opf: String, index: XMLIndex, elementIDsByPath: [String: [String: String]] = [:]) -> ReadingAnchor? {
        let items = index.elements.filter { $0.name == "item" }
        var byID: [String: XMLElementValue] = [:]
        for item in items { if let id = item.attributes["id"] { byID[id] = item } }
        let chapterPaths = Set(chapters.map(\.sourcePath))
        let primary = index.elements.filter { $0.name == "itemref" && $0.attributes["linear"] != "no" }.compactMap { ref -> String? in
            guard let id = ref.attributes["idref"], let item = byID[id], let href = item.attributes["href"],
                  let path = try? Disk.resolve(href, relativeTo: opf), chapterPaths.contains(path) else { return nil }
            return path
        }
        guard !primary.isEmpty else { return nil }
        let primaryPaths = Set(primary)
        var excluded = Set<String>()
        let nonBodyRoles: Set<String> = ["cover", "titlepage", "toc", "landmarks", "page-list", "navigation"]
        var openerFragments: [String: Set<String>] = [:]
        var preferred: [(path: String, fragment: String?)] = []
        var metadataBytes: Int64 = 0
        var metadataCache: [String: EPUBStartMetadata] = [:]
        func boundedData(at path: String) -> Data? {
            guard let url = try? Disk.url(assets, path), let size = try? Disk.size(url),
                  size >= 0, size <= 1_048_576, metadataBytes + size <= 4_194_304 else { return nil }
            metadataBytes += size
            return try? readingMetadata(url)
        }
        func metadata(at path: String) -> EPUBStartMetadata? {
            if let cached = metadataCache[path] { return cached }
            guard let data = boundedData(at: path) else { return nil }
            guard let result = try? EPUBStartMetadata(data: data) else { return nil }
            metadataCache[path] = result
            return result
        }
        func openingPath(_ href: String, relativeTo source: String) -> String? {
            // Disk.resolve keeps its existing resource semantics elsewhere. A
            // fragment-only reading target belongs to this very XHTML file.
            let path = href.hasPrefix("#") ? (try? Disk.safePath(source)) : (try? Disk.resolve(href, relativeTo: source))
            guard let path, (try? Disk.url(assets, path)) != nil else { return nil }
            return path
        }
        func excludeOpener(_ href: String, relativeTo source: String) {
            guard let path = openingPath(href, relativeTo: source) else { return }
            let parts = href.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 1 || parts[1].isEmpty {
                excluded.insert(path)
            } else if let fragment = String(parts[1]).removingPercentEncoding, !fragment.isEmpty {
                // A cover fragment marks only that region. Without an explicit
                // body target, retain the first linear chapter in source order.
                openerFragments[path, default: []].insert(fragment)
            }
        }
        func prefer(_ href: String, relativeTo source: String) {
            guard let path = openingPath(href, relativeTo: source), primaryPaths.contains(path) else { return }
            let parts = href.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
            let fragment = parts.count == 2 ? String(parts[1]).removingPercentEncoding : nil
            if parts.count == 2, fragment == nil { return }
            preferred.append((path, fragment?.isEmpty == false ? fragment : nil))
        }
        func openingAnchor(path: String, fragment: String? = nil) -> ReadingAnchor? {
            guard let chapter = chapters.first(where: { $0.sourcePath == path }) else { return nil }
            let passageID: String?
            if let fragment {
                var ids = elementIDsByPath[path]
                if ids == nil, let data = boundedData(at: path) {
                    let reader = XHTMLReader(sourcePath: path)
                    do { try reader.parse(data); ids = reader.elementPassageIDs } catch { return nil }
                }
                passageID = ids?[fragment]
            } else { passageID = chapter.passages.first?.id }
            guard let passageID, chapter.passages.contains(where: { $0.id == passageID }) else { return nil }
            return ReadingAnchor(chapterID: chapter.id, passageID: passageID)
        }
        // EPUB 3 landmarks are explicit author intent. Merely looking like a
        // cover (a filename, a short title, or an opening image) is insufficient.
        for item in items where item.attributes["properties"]?.split(whereSeparator: { $0.isWhitespace }).contains("nav") == true {
            guard let href = item.attributes["href"], let path = try? Disk.resolve(href, relativeTo: opf) else { continue }
            excluded.insert(path)
            guard let navigation = metadata(at: path) else { continue }
            for href in navigation.bodymatter { prefer(href, relativeTo: path) }
            for href in navigation.openers { excludeOpener(href, relativeTo: path) }
        }
        // EPUB 2 uses guide references for the same explicit start/cover intent.
        for reference in index.elements where reference.name == "reference" {
            guard let href = reference.attributes["href"] else { continue }
            if reference.attributes["type"] == "text" { prefer(href, relativeTo: opf) }
            if ["cover", "title-page"].contains(reference.attributes["type"] ?? "") { excludeOpener(href, relativeTo: opf) }
        }
        for target in preferred {
            let document = metadata(at: target.path)
            guard document?.documentRoles.isDisjoint(with: nonBodyRoles) != false else { continue }
            if let fragment = target.fragment {
                guard openerFragments[target.path]?.contains(fragment) != true,
                      document?.fragmentRoles[fragment]?.isDisjoint(with: nonBodyRoles) != false else { continue }
            }
            // A cover section can share an XHTML file with bodymatter. Only
            // a verified body fragment may override that file-level exclusion;
            // whole-document cover roles and fragments inside navigation still win.
            if excluded.contains(target.path), target.fragment == nil || document == nil { continue }
            if let anchor = openingAnchor(path: target.path, fragment: target.fragment) { return anchor }
        }
        let selected = primary.first { path in
            guard !excluded.contains(path) else { return false }
            return metadata(at: path)?.documentRoles.isDisjoint(with: nonBodyRoles) != false
        }
        return selected.flatMap { openingAnchor(path: $0) }
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

/// Reads only explicit whole-document roles and links inside the landmarks nav.
/// Its output never changes the source chapter list or passage identity.
private final class EPUBStartMetadata: NSObject, XMLParserDelegate {
    var bodymatter: [String] = []
    var openers: [String] = []
    var documentRoles = Set<String>()
    var fragmentRoles: [String: Set<String>] = [:]
    private var stack: [(name: String, landmarks: Bool, readingRoles: Set<String>)] = []
    private var bodyLevel: Int?
    private var bodyChildCount = 0
    private var soleChildRoles = Set<String>()
    private var bodyHasText = false
    init(data: Data) throws {
        super.init()
        let parser = try safeXML(data, delegate: self)
        guard parser.parse() else { throw LibraryError.invalid("起读元数据无法解析。") }
    }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        let name = localName(name)
        let roles = Set((attributes["epub:type"] ?? "").split(whereSeparator: { $0.isWhitespace }).map(String.init))
        let landmarks = stack.last?.landmarks == true || (name == "nav" && roles.contains("landmarks"))
        var readingRoles = (stack.last?.readingRoles ?? []).union(roles.intersection(["cover", "titlepage", "toc", "landmarks", "page-list"]))
        if name == "nav" { readingRoles.insert("navigation") }
        stack.append((name, landmarks, readingRoles))
        if let id = attributes["id"], fragmentRoles[id] == nil { fragmentRoles[id] = readingRoles }
        if name == "body" { bodyLevel = stack.count; documentRoles.formUnion(roles) }
        else if let bodyLevel, stack.count == bodyLevel + 1 {
            bodyChildCount += 1
            soleChildRoles = name == "section" ? roles : []
        }
        if name == "a", landmarks, let href = attributes["href"] {
            if roles.contains("bodymatter") { bodymatter.append(href) }
            if !roles.isDisjoint(with: ["cover", "titlepage"]) { openers.append(href) }
        }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if let bodyLevel, stack.count == bodyLevel, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { bodyHasText = true }
    }
    func parser(_ parser: XMLParser, foundCDATA data: Data) { self.parser(parser, foundCharacters: String(decoding: data, as: UTF8.self)) }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        if localName(name) == "body", bodyChildCount == 1, !bodyHasText { documentRoles.formUnion(soleChildRoles) }
        _ = stack.popLast()
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
    var elementPassageIDs: [String: String] = [:]
    private var buffer = "", anchor = "", heading = false, bodyDepth = 0, ignoredDepth = 0
    private var preformatted = false
    private var usedIDs = Set<String>()
    private var pendingElementIDs: [String] = []
    // Added SVG resources must not renumber existing block-N/image-N anchors.
    private var legacyPassageCount = 0
    private var svgDepth = 0, svgNumber = 0, svgLabelDepth: Int?
    private var svgAlternative = "", svgLabel = "", svgHasLeadingText = false
    private var svgResources: [(path: String, alternative: String?, elementID: String?)] = []
    private var deferredSVG: [Passage] = []
    private let blocks: Set<String> = ["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "figcaption", "dt", "dd"]
    init(sourcePath: String) { self.sourcePath = sourcePath }
    func parse(_ data: Data) throws {
        let parser = try safeXML(data, delegate: self)
        guard parser.parse() else { throw LibraryError.invalid("章节 XHTML 无法完整解析，原件已保留。") }
        flush()
    }
    private func flush() {
        let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        defer {
            buffer = ""; anchor = ""; heading = false
            for passage in deferredSVG { append(passage, legacy: false) }
            deferredSVG = []
        }
        guard !value.isEmpty else { return }
        let preferred = anchor.isEmpty ? "block-\(legacyPassageCount)" : anchor
        let stable = uniqueID(preferred)
        append(Passage(id: "p-" + Disk.hash(Data((sourcePath + "#" + stable).utf8)), text: value, heading: heading), legacy: true)
    }
    private func append(_ passage: Passage, legacy: Bool) {
        passages.append(passage)
        for id in pendingElementIDs where elementPassageIDs[id] == nil { elementPassageIDs[id] = passage.id }
        pendingElementIDs = []
        if legacy { legacyPassageCount += 1 }
    }
    private func finishSVG() {
        let alternative = svgLabel.isEmpty ? svgAlternative.trimmingCharacters(in: .whitespacesAndNewlines) : svgLabel
        let resources: [(path: String, alternative: String?, elementID: String?)] = svgResources.isEmpty ? [(sourcePath, "SVG 插图暂不支持显示，原始图形随原件保留", nil)] : svgResources
        for (index, resource) in resources.enumerated() {
            let id = "p-svg-" + Disk.hash(Data((sourcePath + "#svg-\(svgNumber)-\(index)").utf8))
            let label = alternative.isEmpty ? resource.alternative : (svgResources.isEmpty ? "SVG 插图暂不支持显示 · " + alternative + "；原始图形随原件保留" : alternative)
            let passage = Passage(id: id, text: "", resourcePath: resource.path, alternative: label)
            if let elementID = resource.elementID, elementPassageIDs[elementID] == nil { elementPassageIDs[elementID] = id }
            if svgHasLeadingText { deferredSVG.append(passage) } else { append(passage, legacy: false) }
        }
        svgDepth = 0; svgLabelDepth = nil; svgResources = []
    }
    private func uniqueID(_ preferred: String) -> String {
        var value = preferred, suffix = 1
        while usedIDs.contains(value) { value = preferred + "-\(suffix)"; suffix += 1 }
        usedIDs.insert(value)
        return value
    }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        let name = localName(name)
        if name == "body" { bodyDepth = 1; if let id = attributes["id"] { pendingElementIDs.append(id) }; return }
        guard bodyDepth > 0 else { return }; bodyDepth += 1
        if ignoredDepth > 0 { ignoredDepth += 1; return }
        if ["script", "style"].contains(name) { ignoredDepth = 1; return }
        if blocks.contains(name) { flush(); anchor = attributes["id"] ?? ""; heading = name.hasPrefix("h") && name.count == 2 }
        if name == "pre" { preformatted = true }
        if name == "br" { buffer += "\n" }
        if name == "td" || name == "th" { if !buffer.isEmpty { buffer += "\t" } }
        if name == "img", let href = attributes["src"] {
            flush()
            if let id = attributes["id"] { pendingElementIDs.append(id) }
            do {
                let path = try Disk.resolve(href, relativeTo: sourcePath)
                let stable = uniqueID(attributes["id"] ?? "image-\(legacyPassageCount)")
                append(Passage(id: "p-" + Disk.hash(Data((sourcePath + "#" + stable).utf8)), text: "", resourcePath: path, alternative: attributes["alt"]), legacy: true)
            } catch { parser.abortParsing() }
        } else if name == "image", svgDepth > 0 {
            if let href = attributes["href"] ?? attributes["xlink:href"] {
                do { svgResources.append((try Disk.resolve(href, relativeTo: sourcePath), attributes["alt"] ?? attributes["aria-label"], attributes["id"])) }
                catch { parser.abortParsing() }
            }
        } else if let id = attributes["id"] { pendingElementIDs.append(id) }
        if name == "svg", svgDepth == 0 {
            svgDepth = bodyDepth; svgNumber += 1; svgAlternative = ""
            svgLabel = attributes["aria-label"] ?? attributes["alt"] ?? ""
            svgHasLeadingText = !buffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            svgResources = []
        }
        if svgDepth > 0, name == "title" || name == "desc" { svgLabelDepth = bodyDepth }
        // Keep existing SVG/math source text and its stable IDs; image metadata
        // remains distinct from generated prose, and no SVG scripts execute.
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard bodyDepth > 0, ignoredDepth == 0 else { return }
        if svgLabelDepth != nil { svgAlternative += string }
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
        if svgLabelDepth == bodyDepth { svgLabelDepth = nil; svgAlternative += " " }
        if name == "svg", svgDepth == bodyDepth { finishSVG() }
        if name == "pre" { preformatted = false }
        bodyDepth -= 1
    }
}
