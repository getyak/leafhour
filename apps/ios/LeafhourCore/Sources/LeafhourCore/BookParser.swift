import Foundation
import CoreFoundation
import PDFKit
import ZIPFoundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Parses only user-selected local source files. No scripts, remote resources, OCR or models run here.
enum BookParser {
    static func parse(source: URL, kind: BookKind, filename: String, id: String, destination: URL, limits: ImportLimits, progress: @Sendable (ImportProgress) -> Void = { _ in }) throws -> LocalBook {
        let chapters: [BookChapter]
        var title = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        var author = ""
        var titleCandidates: [String] = []
        var readingStartChapterID: String? = nil
        var coverResourcePath: String?
        var readingStartAnchor: ReadingAnchor? = nil
        progress(ImportProgress(stage: .extracting))
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
            coverResourcePath = try declaredCover(index: index, opf: opf)
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
                if index == paths.count - 1 || index % 25 == 0 { progress(ImportProgress(stage: .extracting, completed: index + 1, total: paths.count)) }
                return BookChapter(id: "ch-" + Disk.hash(Data(path.utf8)), title: parser.passages.first(where: { $0.heading })?.text ?? "第 \(index + 1) 章", sourcePath: path, passages: parser.passages)
            }
            readingStartAnchor = epubReadingStart(chapters: chapters, assets: assets, opf: opf, index: index, elementIDsByPath: elementIDsByPath)
            readingStartChapterID = readingStartAnchor?.chapterID
        case .pdf:
            guard let document = PDFDocument(url: source), !document.isLocked, document.pageCount > 0 else { throw LibraryError.invalid("PDF 无法读取或需要密码。原件已保留。") }
            titleCandidates = pdfTitleCandidates(document)
            title = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String ?? title
            author = document.documentAttributes?[PDFDocumentAttribute.authorAttribute] as? String ?? ""
            chapters = try (0..<document.pageCount).map { index in
                try Task.checkCancellation()
                guard let page = document.page(at: index) else { throw LibraryError.invalid("PDF 包含无法读取的页面。") }
                if index == document.pageCount - 1 || index % 25 == 0 { progress(ImportProgress(stage: .extracting, completed: index + 1, total: document.pageCount)) }
                let key = "page-\(index + 1)"
                return BookChapter(id: key, title: "第 \(index + 1) 页", sourcePath: key, passages: [Passage(id: key, text: page.string ?? "")])
            }
        case .unknown: throw LibraryError.invalid("未知格式，请重新选择原件修复。")
        case .txt, .markdown:
            let data = try Data(contentsOf: source)
            let text = try decodePlainText(data)
            let paragraphs = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            chapters = [BookChapter(id: "text", title: title, sourcePath: "text", passages: try paragraphs.enumerated().map { try Task.checkCancellation(); return Passage(id: "text-\($0.offset)", text: $0.element) })]
        }
        title = recoveredTitle(title, filename: filename, chapters: chapters, kind: kind, candidates: titleCandidates)
        return LocalBook(id: id, title: title, author: author, kind: kind, sourceVersion: "sha256-" + id, originalFilename: filename, importedAt: Date(), chapters: chapters, readingStartChapterID: readingStartChapterID, readingStartAnchor: readingStartAnchor, coverResourcePath: coverResourcePath)
    }

    /// Conservative local recovery: early explicit titles only, never a generated summary.
    private static func recoveredTitle(_ supplied: String, filename: String, chapters: [BookChapter], kind: BookKind, candidates: [String]) -> String {
        func usable(_ value: String) -> Bool {
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.count <= 160 else { return false }
            let generic = "^(untitled|unknown|document|scan|扫描件|未命名|新建文本文档|download|ebook|book|text)([ _-]*[0-9]+)*$"
            if text.range(of: generic, options: [.regularExpression, .caseInsensitive]) != nil { return false }
            if text.range(of: "^[0-9a-f-]{16,}$", options: [.regularExpression, .caseInsensitive]) != nil { return false }
            return true
        }
        let filenameTitle = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        let cleaned = supplied.trimmingCharacters(in: .whitespacesAndNewlines)
        if usable(cleaned) { return cleaned }
        if usable(filenameTitle) { return filenameTitle }
        let early = chapters.prefix(5).flatMap { $0.passages.prefix(12) }
        let headings = early.filter(\.heading).map(\.text)
        let lines = early.flatMap { String($0.text.prefix(2000)).components(separatedBy: .newlines).prefix(12) }
        // PDF requires typographic evidence; ordinary wrapped body lines are
        // never evidence of a title. EPUB uses actual heading elements.
        let explicit = kind == .pdf ? candidates : headings
        let textTitles = [.txt, .markdown].contains(kind) ? lines.filter { line in
            let clean = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if clean.hasPrefix("# ") { return true }
            let words = clean.split(whereSeparator: \.isWhitespace)
            return words.count >= 2 && words.count <= 12 && words.filter { $0.first?.isUppercase == true }.count * 4 >= words.count * 3
        } : []
        for raw in explicit + textTitles {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "^#{1,6} +", with: "", options: .regularExpression)
            guard usable(line), line.count >= 2, line.count <= 80, line.split(whereSeparator: \.isWhitespace).count <= 14,
                  line.range(of: "[。！？.!?;；]", options: .regularExpression) == nil,
                  line.range(of: "^(by |作者|copyright|all rights|目录|contents|table of contents|第.{1,8}[章节页]|chapter |https?://|isbn)", options: [.regularExpression, .caseInsensitive]) == nil else { continue }
            return line
        }
        return filenameTitle
    }

    private static func pdfTitleCandidates(_ document: PDFDocument) -> [String] {
        var lines: [(String, CGFloat)] = []
        var weights: [Int: Int] = [:]
        for index in 0..<min(5, document.pageCount) {
            guard let text = document.page(at: index)?.attributedString else { continue }
            let sample = text.attributedSubstring(from: NSRange(location: 0, length: min(text.length, 6000)))
            let string = sample.string as NSString
            var offset = 0
            while offset < string.length {
                let range = string.lineRange(for: NSRange(location: offset, length: 0))
                var maximum: CGFloat = 0
                sample.enumerateAttribute(.font, in: range) { value, run, _ in
                    #if canImport(UIKit)
                    let size = (value as? UIFont)?.pointSize ?? 0
                    #else
                    let size = (value as? NSFont)?.pointSize ?? 0
                    #endif
                    maximum = max(maximum, size)
                    weights[Int(size.rounded()), default: 0] += run.length
                }
                lines.append((string.substring(with: range), maximum)); offset = NSMaxRange(range)
            }
        }
        let bodySize = weights.max { $0.value < $1.value }?.key ?? 12
        return lines.filter { $0.1 >= max(18, CGFloat(bodySize) * 1.3) }.map(\.0)
    }

    /// A successful UTF-16 conversion alone is not evidence of UTF-16: GBK byte
    /// pairs also convert to unrelated Unicode. Require a BOM or alternating NULs.
    private static func decodePlainText(_ data: Data) throws -> String {
        let encodingError = LibraryError.invalid("无法识别文本编码，或文件编码不完整。支持 UTF-8、UTF-16 和 GB18030（含 GBK）。请另存为 UTF-8 后重试；原件已保留在待继续的导入中。")
        if data.starts(with: Data("%PDF-".utf8)) || data.starts(with: [0x50, 0x4b, 0x03, 0x04]) || data.starts(with: [0x89, 0x50, 0x4e, 0x47]) {
            throw LibraryError.invalid("这个文件不是可阅读的文本，请选择对应格式的原文件。原件已保留。")
        }
        var bytes = data
        let encoding: String.Encoding?
        if data.starts(with: [0xff, 0xfe, 0, 0]) || data.starts(with: [0, 0, 0xfe, 0xff]) { throw encodingError }
        else if data.starts(with: [0xff, 0xfe]) { bytes = data.dropFirst(2); encoding = .utf16LittleEndian }
        else if data.starts(with: [0xfe, 0xff]) { bytes = data.dropFirst(2); encoding = .utf16BigEndian }
        else if data.starts(with: [0xef, 0xbb, 0xbf]) { bytes = data.dropFirst(3); encoding = .utf8 }
        else {
            let sample = Array(data.prefix(4096)), pairs = sample.count / 2
            let even = stride(from: 0, to: pairs * 2, by: 2).filter { sample[$0] == 0 }.count
            let odd = stride(from: 1, to: pairs * 2, by: 2).filter { sample[$0] == 0 }.count
            if data.count % 2 == 0 && pairs > 0 && odd * 5 >= pairs && even == 0 { encoding = .utf16LittleEndian }
            else if data.count % 2 == 0 && pairs > 0 && even * 5 >= pairs && odd == 0 { encoding = .utf16BigEndian }
            else { encoding = nil }
        }
        let text: String
        if let encoding {
            guard let decoded = String(data: bytes, encoding: encoding), decoded.data(using: encoding) == bytes else { throw encodingError }
            text = decoded
        } else if let decoded = String(data: bytes, encoding: .utf8) { text = decoded }
        else {
            let gb = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(UInt32(CFStringEncodings.GB_18030_2000.rawValue)))
            // CP936 aliases such as 0x80 (euro) and A3A0 (space) decode correctly
            // but re-encode to canonical GB bytes. The retained source, not a
            // lossy re-encoding comparison, is the byte-for-byte provenance.
            guard let decoded = String(data: bytes, encoding: gb),
                  decoded.range(of: "\\p{Han}", options: .regularExpression) != nil else { throw encodingError }
            text = decoded
        }
        guard !text.unicodeScalars.contains(where: { ($0.value < 32 && ![9, 10, 12, 13].contains($0.value)) || (127...159).contains($0.value) }) else {
            throw LibraryError.invalid("这个文件不是可阅读的文本，请检查文件内容和格式。原件已保留。")
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw LibraryError.invalid("文件中没有可阅读的文字。请选择有正文的 TXT 或 Markdown；原件已保留。")
        }
        return text
    }

    private static func declaredCover(index: XMLIndex, opf: String) throws -> String? {
        let coverID = index.elements.first { $0.name == "meta" && $0.attributes["name"] == "cover" }?.attributes["content"]
        guard let item = index.elements.first(where: { $0.name == "item" && (($0.attributes["properties"] ?? "").split(separator: " ").contains("cover-image") || (coverID != nil && $0.attributes["id"] == coverID)) }),
              let href = item.attributes["href"] else { return nil }
        return try Disk.resolve(href, relativeTo: opf)
    }
    /// Read declared artwork in older packages without rewriting their index.
    static func legacyCoverResource(for book: LocalBook, directory: URL) -> String? {
        guard book.kind == .epub else { return nil }
        do {
            let assets = try Disk.url(directory, "assets")
            let container = try XMLIndex(data: readingMetadata(try Disk.url(assets, "META-INF/container.xml")))
            guard let rootfile = container.elements.first(where: { $0.name == "rootfile" })?.attributes["full-path"] else { return nil }
            let opf = try Disk.safePath(rootfile)
            let index = try XMLIndex(data: readingMetadata(try Disk.url(assets, opf)))
            return try declaredCover(index: index, opf: opf)
        } catch { return nil }
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
