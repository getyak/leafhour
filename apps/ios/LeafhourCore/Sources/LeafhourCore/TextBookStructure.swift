import Foundation
import cmark_gfm

/// Structure for new local imports only. The retained original remains the source of truth.
enum TextBookStructure {
    private struct Line {
        let text: String
        let range: NSRange
    }
    private struct Heading {
        let offset: Int
        let end: Int
        let title: String
    }

    static func chapters(source: String, kind: BookKind, title: String) throws -> [BookChapter] {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let text = normalized as NSString
        var offset = 0
        let lines = normalized.components(separatedBy: "\n").map { value -> Line in
            defer { offset += value.utf16.count + 1 }
            return Line(text: value, range: NSRange(location: offset, length: value.utf16.count))
        }
        let headings: [Heading]
        var markdownBlocks: [Int] = []
        if kind == .markdown {
            let structure = markdownStructure(source: normalized, lines: lines)
            headings = structure.headings; markdownBlocks = structure.blocks
        } else {
            let candidates = try lines.compactMap { line -> Heading? in
                try Task.checkCancellation()
                guard let title = plainHeading(line.text) else { return nil }
                return Heading(offset: line.range.location, end: NSMaxRange(line.range), title: title)
            }
            headings = suppressFrontContents(candidates, text: text)
        }
        var starts: [(offset: Int, title: String, heading: Heading?)] = []
        if let first = headings.first {
            let front = text.substring(to: first.offset)
            if !front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { starts.append((0, title, nil)) }
            for (index, heading) in headings.enumerated() {
                starts.append((index == 0 && starts.isEmpty ? 0 : heading.offset, heading.title, heading))
            }
        } else { starts = [(0, title, nil)] }
        var nextMarkdownBlock = 0
        return try starts.enumerated().map { index, start in
            try Task.checkCancellation()
            let end = index + 1 < starts.count ? starts[index + 1].offset : text.length
            let range = NSRange(location: start.offset, length: end - start.offset)
            let passages: [Passage]
            if kind == .markdown {
                // Whole raw blocks, including their intervening whitespace, make fallback rendering
                // identical when the retained file cannot be decoded by the platform's renderer.
                while nextMarkdownBlock < markdownBlocks.count && markdownBlocks[nextMarkdownBlock] <= start.offset { nextMarkdownBlock += 1 }
                var cuts = [start.offset]
                while nextMarkdownBlock < markdownBlocks.count && markdownBlocks[nextMarkdownBlock] < end {
                    cuts.append(markdownBlocks[nextMarkdownBlock]); nextMarkdownBlock += 1
                }
                cuts.append(end)
                passages = zip(cuts, cuts.dropFirst()).compactMap { lower, upper in
                    guard lower < upper else { return nil }
                    return Passage(id: "text-\(lower)", text: text.substring(with: NSRange(location: lower, length: upper - lower)), heading: start.heading?.offset == lower)
                }
            } else {
                var values: [Passage] = []
                var bodyStart = start.offset
                if let heading = start.heading {
                    values.append(Passage(id: "text-\(heading.offset)", text: heading.title, heading: true))
                    bodyStart = min(end, heading.end + 1)
                }
                let body = text.substring(with: NSRange(location: bodyStart, length: end - bodyStart))
                var paragraphOffset = bodyStart
                for paragraph in body.components(separatedBy: "\n\n") {
                    defer { paragraphOffset += paragraph.utf16.count + 2 }
                    guard !paragraph.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                    let value = start.heading == nil && headings.isEmpty ? paragraph : paragraph.trimmingCharacters(in: .newlines)
                    values.append(Passage(id: "text-\(paragraphOffset)", text: value))
                }
                passages = values
            }
            return BookChapter(id: headings.isEmpty ? "text" : "text-ch-\(start.offset)", title: start.title, sourcePath: "text", passages: passages, sourceUTF16Range: range)
        }
    }

    private static let chinese = try! NSRegularExpression(pattern: "^第\\s*[0-9０-９零〇一二三四五六七八九十百千万兩两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+\\s*[章节節回卷部篇集](.*)$")
    private static let english: NSRegularExpression = {
        let words = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth"
        return try! NSRegularExpression(pattern: "^(?:chapter|part|book)\\s+(?:the\\s+)?(?:[0-9０-９]+|[ivxlcdm]+|(?:" + words + ")(?:[ -](?:" + words + "))*)(?=$|[\\s.:：—–-])(.*)$", options: .caseInsensitive)
    }()
    private static let opening = try! NSRegularExpression(pattern: "^(?:prologue|epilogue|preface|introduction|foreword|afterword|序章|楔子|序言|前言|引言|尾声|尾聲|终章|終章|后记|後記)(?=$|[\\s:：—–-])(.*)$", options: .caseInsensitive)
    private static let pageLeader = try! NSRegularExpression(pattern: "(?:[.．·…_]{2,}|[—–-]{3,}|\\s{2,})\\s*[0-9０-９ivxlcdm]+\\s*$", options: .caseInsensitive)
    private static func plainHeading(_ raw: String) -> String? {
        let title = raw.trimmingCharacters(in: .whitespaces)
        var candidate = title
        for (open, close) in [("【", "】"), ("[", "]"), ("（", "）"), ("(", ")")] {
            if candidate.hasPrefix(open), candidate.hasSuffix(close) {
                candidate = String(candidate.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
                break
            }
        }
        let ns = candidate as NSString
        let full = NSRange(location: 0, length: ns.length)
        guard !title.isEmpty, title.count <= 100, pageLeader.firstMatch(in: candidate, range: full) == nil else { return nil }
        for pattern in [chinese, english, opening] {
            guard let match = pattern.firstMatch(in: candidate, range: full) else { continue }
            let suffix = ns.substring(with: match.range(at: 1))
            let separatedChinese = pattern === chinese && suffix.first?.isWhitespace == true
            if !separatedChinese && title.range(of: "[。！？!?；;]", options: .regularExpression) != nil { return nil }
            // An unseparated verb after the chapter marker is normally a prose reference.
            if pattern === chinese, ["介绍", "讨论", "讲述", "主要", "说明", "提到", "解释", "探讨", "阐述", "描述"].contains(where: { suffix.hasPrefix($0) }) { return nil }
            let clean = suffix.trimmingCharacters(in: .whitespaces)
            // English prose references ("Chapter 2 shows …") are not standalone titles.
            if pattern === english, let first = clean.first, first.isLetter && !first.isUppercase { return nil }
            let content = clean.replacingOccurrences(of: "^[.．:：—–-]+\\s*", with: "", options: .regularExpression)
            guard content.range(of: separatedChinese ? "[。；;]" : "[.。！？!?；;]", options: .regularExpression) == nil else { return nil }
            return title
        }
        return nil
    }

    private static func suppressFrontContents(_ headings: [Heading], text: NSString) -> [Heading] {
        guard let first = headings.first else { return headings }
        var later: [String: Int] = [:]
        for heading in headings { later[heading.title, default: 0] += 1 }
        var suppressed = Set<Int>()
        var previousEnd = first.offset
        for heading in headings {
            let between = text.substring(with: NSRange(location: previousEnd, length: heading.offset - previousEnd))
            let lines = between.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            // A front TOC is a compact run of repeated titles; page-leader rows may sit between them.
            let contentsOnly = lines.allSatisfy { line in
                ["目录", "目錄", "contents", "table of contents"].contains(line.lowercased()) || pageLeader.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)) != nil
            }
            guard contentsOnly, later[heading.title, default: 0] > 1 else { break }
            suppressed.insert(heading.offset)
            later[heading.title, default: 0] -= 1
            previousEnd = heading.end
        }
        // A lone repeated title is ambiguous unless the source explicitly labels its contents.
        let prefix = text.substring(to: first.offset).lowercased()
        let explicit = prefix.contains("目录") || prefix.contains("目錄") || prefix.contains("contents")
        if suppressed.count < 2 && !explicit { return headings }
        return headings.filter { !suppressed.contains($0.offset) }
    }

    private static func markdownStructure(source: String, lines: [Line]) -> (headings: [Heading], blocks: [Int]) {
        guard let root = source.withCString({ cmark_parse_document($0, source.utf8.count, CMARK_OPT_DEFAULT | CMARK_OPT_VALIDATE_UTF8) }) else { return ([], []) }
        defer { cmark_node_free(root) }
        var headings: [Heading] = [], blocks: [Int] = []
        var child = cmark_node_first_child(root)
        while let node = child {
            defer { child = cmark_node_next(node) }
            let line = Int(cmark_node_get_start_line(node)) - 1
            guard lines.indices.contains(line) else { continue }
            let start = lines[line].range.location
            blocks.append(start)
            guard cmark_node_get_type(node) == CMARK_NODE_HEADING else { continue }
            let endLine = min(lines.count - 1, Int(cmark_node_get_end_line(node)) - 1)
            guard endLine >= line else { continue }
            let end = NSMaxRange(lines[endLine].range)
            let raw = (source as NSString).substring(with: NSRange(location: start, length: end - start))
            let title = MarkdownDocument(source: raw).text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { continue }
            headings.append(Heading(offset: start, end: end, title: title))
        }
        return (headings, Array(Set(blocks)).sorted())
    }
}
