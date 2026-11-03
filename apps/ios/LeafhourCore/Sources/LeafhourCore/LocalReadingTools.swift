import Foundation

/// Read-only, per-generation access to one captured local book. No filesystem,
/// note store, account switching, model calls or reading-progress writes exist here.
public actor LocalReadingTools {
    private static let targetBytes = 7_168
    private static let maximumBytes = 24_576
    private let book: LocalBook
    private let chapterID: String
    private let passageID: String
    private struct PassageKey: Hashable { let chapter: Int; let passage: Int }
    private struct ReadRange { var start: Int; var end: Int }
    private var visible: [PassageKey: [ReadRange]] = [:]
    private var texts: [PassageKey: TextSnapshot] = [:]

    public init(book: LocalBook, chapterID: String, passageID: String) {
        self.book = book
        self.chapterID = chapterID
        self.passageID = passageID
    }

    public func execute(name: String, args: CloudJSON = .object([:])) async -> CloudJSON {
        guard let fields = Self.fields[name] else { return Self.failure("UNKNOWN_TOOL", "本地阅读工具不支持这项操作。") }
        guard case .object(let values) = args, Set(values.keys).isSubset(of: fields), valid(values, name: name) else {
            return Self.failure("INVALID_ARGUMENTS", "工具参数无效。")
        }
        if Task.isCancelled { return Self.failure("CANCELLED", "读取已取消。") }
        if let id = values["bookId"]?.string, id != book.id { return Self.failure("SCOPE_DENIED", "当前只允许查阅本地这本书。") }
        if let ids = values["bookIds"]?.array, ids.contains(where: { $0.string != book.id }) {
            return Self.failure("SCOPE_DENIED", "当前只允许查阅本地这本书。")
        }
        if let version = values["sourceVersion"]?.string, version != book.sourceVersion {
            return Self.failure("SOURCE_CHANGED", "原文版本不一致，请重新打开当前书籍。")
        }
        // Real identifiers are never shortened into invented anchors.
        guard Self.validString(book.id, maximum: 128), Self.validString(book.sourceVersion, maximum: 256) else {
            return Self.failure("UNAVAILABLE", "本地书籍标识无法核对。")
        }
        var returnedRanges: [(PassageKey, Int, Int)] = []
        let result: CloudJSON
        switch name {
        case "reader_get_context":
            guard let chapter = book.chapters.firstIndex(where: { $0.id == chapterID }),
                  let passage = book.chapters[chapter].passages.firstIndex(where: { $0.id == passageID }) else {
                return Self.failure("NOT_FOUND", "当前位置已无法在当前书中找到。")
            }
            var context = page(chapter: chapter, offset: passage, start: 0, limit: 1, returnedRanges: &returnedRanges).object
            if context["error"] == nil { context["passageId"] = .string(passageID) }
            result = .object(context)
        case "reader_list_books":
            let query = values["query"]?.string
            let matches = query.map { (book.title + " " + book.author).range(of: $0, options: [.caseInsensitive, .literal]) != nil } ?? true
            let offset = Self.integer(values["offset"]) ?? 0
            let entry: CloudJSON = .object([
                "bookId": .string(book.id), "title": .string(Self.label(book.title)), "author": .string(Self.label(book.author)),
                "contentVersion": .string(book.sourceVersion), "sourceVersion": .string(book.sourceVersion),
                "visibility": .string("local"), "owned": .bool(true), "url": .string(readURL())
            ])
            result = .object(["books": .array(matches && offset == 0 ? [entry] : []), "nextOffset": .null])
        case "reader_get_outline":
            result = outline(offset: Self.integer(values["offset"]) ?? 0, limit: Self.integer(values["limit"]) ?? 100)
        case "reader_read_chapter":
            guard let chapter = book.chapters.firstIndex(where: { $0.id == values["chapterId"]?.string }) else {
                return Self.failure("NOT_FOUND", "章节不属于当前书籍。")
            }
            // Layer selection applies to both ordinary pages and passage cursors.
            // LocalBook has no stored translated layers; never return source text
            // for an explicitly requested translation.
            guard (values["layer"]?.string ?? "original") == "original" else {
                return Self.failure("UNAVAILABLE", "本地副本没有这个译文层。")
            }
            var offset = Self.integer(values["offset"]) ?? 0
            let start = Self.integer(values["charOffset"]) ?? 0
            if let id = values["passageId"]?.string {
                guard let found = book.chapters[chapter].passages.firstIndex(where: { $0.id == id }) else {
                    return Self.failure("NOT_FOUND", "段落不属于当前章节。")
                }
                offset = found
            }
            result = page(chapter: chapter, offset: offset, start: start, limit: Self.integer(values["limit"]) ?? 20, returnedRanges: &returnedRanges)
        case "reader_search":
            result = search(query: values["query"]!.string!, offset: Self.integer(values["offset"]) ?? 0, limit: Self.integer(values["limit"]) ?? 20,
                            includesBook: values["bookIds"] == nil || !values["bookIds"]!.array.isEmpty, returnedRanges: &returnedRanges)
        case "reader_cite":
            result = cite(passageID: values["passageId"]!.string!, quote: values["quote"]!.string!, layer: values["layer"]?.string ?? "original")
        default:
            return Self.failure("UNKNOWN_TOOL", "本地阅读工具不支持这项操作。")
        }
        guard !Task.isCancelled else { return Self.failure("CANCELLED", "读取已取消。") }
        guard Self.bytes(result) <= Self.maximumBytes else { return Self.failure("UNAVAILABLE", "这项资料无法在单页安全返回。") }
        if result["error"] == .null {
            for (key, start, end) in returnedRanges { remember(key, start: start, end: end) }
        }
        return result
    }

    private static let fields: [String: Set<String>] = [
        "reader_get_context": ["sourceVersion"],
        "reader_list_books": ["query", "offset", "limit", "sourceVersion"],
        "reader_get_outline": ["bookId", "offset", "limit", "sourceVersion"],
        "reader_read_chapter": ["bookId", "chapterId", "offset", "limit", "passageId", "layer", "charOffset", "sourceVersion"],
        "reader_search": ["query", "bookIds", "offset", "limit", "sourceVersion"],
        "reader_cite": ["bookId", "passageId", "quote", "layer", "sourceVersion"]
    ]
    private func valid(_ args: [String: CloudJSON], name: String) -> Bool {
        for (key, value) in args {
            switch key {
            case "offset", "charOffset", "limit":
                let maximum = key == "limit" ? (name == "reader_get_outline" ? 100 : 20) : 9_007_199_254_740_991
                guard let number = Self.integer(value), number >= (key == "limit" ? 1 : 0), number <= maximum else { return false }
            case "bookIds":
                guard case .array(let ids) = value, ids.count <= 20, ids.allSatisfy({ $0.string.map { Self.validString($0, maximum: 128) } == true }) else { return false }
            case "layer":
                guard let layer = value.string, ["original", "literal", "interpretive"].contains(layer) else { return false }
            default:
                let maximum = key == "quote" ? 12_000 : key == "query" ? 2_000 : key == "sourceVersion" ? 256 : 128
                guard let text = value.string, Self.validString(text, maximum: maximum) else { return false }
                if ["query", "quote"].contains(key), text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
            }
        }
        if ["reader_get_outline", "reader_read_chapter", "reader_cite"].contains(name), args["bookId"] == nil { return false }
        if name == "reader_read_chapter" {
            guard args["chapterId"] != nil else { return false }
            if args["passageId"] != nil {
                guard args["charOffset"] != nil, args["offset"] == nil else { return false }
            } else if args["charOffset"] != nil { return false }
        }
        if name == "reader_search", args["query"] == nil { return false }
        if name == "reader_cite", args["passageId"] == nil || args["quote"] == nil { return false }
        return true
    }

    private func page(chapter chapterIndex: Int, offset: Int, start: Int, limit: Int, returnedRanges: inout [(PassageKey, Int, Int)]) -> CloudJSON {
        let chapter = book.chapters[chapterIndex]
        guard Self.validString(chapter.id, maximum: 128), offset <= chapter.passages.count else { return Self.failure("INVALID_ARGUMENTS", "章节游标无效。") }
        var response = sourceMetadata()
        response.merge([
            "title": .string(Self.label(book.title)), "chapterId": .string(chapter.id), "chapterTitle": .string(Self.label(chapter.title)),
            "passages": .array([]), "nextOffset": .null, "nextCursor": .null, "truncated": .bool(false)
        ]) { _, new in new }
        var pieces: [CloudJSON] = []
        for index in offset..<chapter.passages.count {
            if Task.isCancelled { return Self.failure("CANCELLED", "读取已取消。") }
            if pieces.count >= limit { break }
            let passage = chapter.passages[index], key = PassageKey(chapter: chapterIndex, passage: index)
            guard Self.validString(passage.id, maximum: 128) else { return Self.failure("UNAVAILABLE", "段落标识无法核对。") }
            var piece: [String: CloudJSON] = [
                "passageId": .string(passage.id), "original": .null, "literal": .null, "interpretive": .null,
                "translationStatus": .object(["literal": .string("missing"), "interpretive": .string("missing")]), "visibleRanges": .object([:])
            ]
            let begin = index == offset ? start : 0
            if passage.resourcePath != nil || !passage.text.unicodeScalars.contains(where: { !CharacterSet.whitespacesAndNewlines.contains($0) }) {
                guard begin == 0 else { return Self.failure("INVALID_ARGUMENTS", "当前段落没有可续读的文字。") }
                piece["textStatus"] = .string("unavailable")
            } else {
                let text = snapshot(key)
                guard let beginIndex = text.index(at: begin) else { return Self.failure("INVALID_ARGUMENTS", "段落游标必须位于完整文字边界。") }
                let budget = max(0, Self.targetBytes - Self.bytes(.object(response)) - Self.bytes(.object(piece)) - 700)
                let chunk = text.chunk(from: beginIndex, scalarOffset: begin, budget: budget)
                if chunk.end == begin && begin < text.totalScalars {
                    if !pieces.isEmpty { break }
                    return Self.failure("UNAVAILABLE", "单个完整文字单元超过安全分页大小。")
                }
                piece["original"] = .string(chunk.text)
                piece["textStatus"] = .string("available")
                piece["visibleRanges"] = .object(["original": .object([
                    "charOffset": .number(Double(begin)), "charEnd": .number(Double(chunk.end)), "totalChars": .number(Double(text.totalScalars))
                ])])
                returnedRanges.append((key, begin, chunk.end))
                if chunk.end < text.totalScalars {
                    response["nextCursor"] = .object([
                        "bookId": .string(book.id), "chapterId": .string(chapter.id), "passageId": .string(passage.id),
                        "layer": .string("original"), "charOffset": .number(Double(chunk.end)), "sourceVersion": .string(book.sourceVersion)
                    ])
                    response["truncated"] = .bool(true)
                }
            }
            pieces.append(.object(piece))
            response["passages"] = .array(pieces)
            if response["nextCursor"] != .null { break }
            response["nextOffset"] = index + 1 < chapter.passages.count ? .number(Double(index + 1)) : .null
            if Self.bytes(.object(response)) >= Self.targetBytes - 1_000 { break }
        }
        if response["nextCursor"] != .null { response["nextOffset"] = .null }
        return .object(response)
    }

    private func outline(offset: Int, limit: Int) -> CloudJSON {
        var response = sourceMetadata()
        var rows: [CloudJSON] = []
        for chapter in book.chapters.dropFirst(offset).prefix(limit) {
            guard Self.validString(chapter.id, maximum: 128), chapter.passages.first.map({ Self.validString($0.id, maximum: 128) }) != false else {
                return Self.failure("UNAVAILABLE", "目录标识无法核对。")
            }
            let row: CloudJSON = .object(["id": .string(chapter.id), "title": .string(Self.label(chapter.title)), "startPassageId": chapter.passages.first.map { .string($0.id) } ?? .null])
            let candidate = CloudJSON.object(response.merging(["chapters": .array(rows + [row]), "nextOffset": .number(Double(offset + rows.count + 1))]) { _, new in new })
            if Self.bytes(candidate) > Self.targetBytes, !rows.isEmpty { break }
            rows.append(row)
        }
        response["chapters"] = .array(rows)
        response["nextOffset"] = offset + rows.count < book.chapters.count ? .number(Double(offset + rows.count)) : .null
        return .object(response)
    }

    private func search(query: String, offset: Int, limit: Int, includesBook: Bool, returnedRanges: inout [(PassageKey, Int, Int)]) -> CloudJSON {
        guard includesBook else { return .object(["results": .array([]), "nextOffset": .null]) }
        var results: [CloudJSON] = [], matched = 0
        for (chapterIndex, chapter) in book.chapters.enumerated() {
            for (passageIndex, passage) in chapter.passages.enumerated() {
                if Task.isCancelled { return Self.failure("CANCELLED", "读取已取消。") }
                guard passage.resourcePath == nil, let match = passage.text.range(of: query, options: [.caseInsensitive, .literal]) else { continue }
                defer { matched += 1 }
                if matched < offset { continue }
                if results.count >= limit { return .object(["results": .array(results), "nextOffset": .number(Double(offset + results.count))]) }
                guard Self.validString(chapter.id, maximum: 128), Self.validString(passage.id, maximum: 128) else { return Self.failure("UNAVAILABLE", "搜索结果标识无法核对。") }
                let source = passage.text
                // Search ranges and excerpts keep the source's original normalization.
                var matchStart = match.lowerBound, matchEnd = match.upperBound
                while String.Index(matchStart, within: source) == nil { source.unicodeScalars.formIndex(before: &matchStart) }
                while String.Index(matchEnd, within: source) == nil { source.unicodeScalars.formIndex(after: &matchEnd) }
                let excerptStart = source.index(matchStart, offsetBy: -60, limitedBy: source.startIndex) ?? source.startIndex
                let requestedEnd = source.index(matchEnd, offsetBy: 100, limitedBy: source.endIndex) ?? source.endIndex
                let key = PassageKey(chapter: chapterIndex, passage: passageIndex), text = snapshot(key)
                let begin = source.unicodeScalars.distance(from: source.unicodeScalars.startIndex, to: excerptStart)
                let chunk = text.chunk(from: excerptStart, scalarOffset: begin, budget: 3_000, until: requestedEnd)
                // A huge query/grapheme should not create an excerpt that omits its match.
                guard chunk.endIndex >= matchEnd else { return Self.failure("UNAVAILABLE", "搜索匹配超过安全片段大小，请缩短关键词。") }
                var row = sourceMetadata()
                row.merge([
                    "chapterId": .string(chapter.id), "passageId": .string(passage.id), "layer": .string("original"),
                    "excerpt": .string(chunk.text), "charOffset": .number(Double(begin)), "charEnd": .number(Double(chunk.end)),
                    "url": .string(readURL(passageID: passage.id))
                ]) { _, new in new }
                let candidate = CloudJSON.object(["results": .array(results + [.object(row)]), "nextOffset": .number(Double(offset + results.count + 1))])
                if Self.bytes(candidate) > Self.targetBytes, !results.isEmpty {
                    return .object(["results": .array(results), "nextOffset": .number(Double(offset + results.count))])
                }
                results.append(.object(row))
                returnedRanges.append((key, begin, chunk.end))
            }
        }
        return .object(["results": .array(results), "nextOffset": .null])
    }

    private func cite(passageID: String, quote: String, layer: String) -> CloudJSON {
        guard layer == "original" else { return Self.failure("UNREAD_SOURCE", "引用必须精确对应本轮已读文字。") }
        var found: (Int, Int)?
        for (chapter, value) in book.chapters.enumerated() {
            for (passage, source) in value.passages.enumerated() where source.id == passageID {
                // The tool's passage-only input cannot disambiguate duplicate anchors.
                guard found == nil else { return Self.failure("INVALID_ARGUMENTS", "段落标识不唯一，无法核对引用。") }
                found = (chapter, passage)
            }
        }
        guard let (chapterIndex, passageIndex) = found else { return Self.failure("UNREAD_SOURCE", "引用必须精确对应本轮已读文字。") }
        let key = PassageKey(chapter: chapterIndex, passage: passageIndex)
        guard let ranges = visible[key], !ranges.isEmpty else { return Self.failure("UNREAD_SOURCE", "引用必须精确对应本轮已读文字。") }
        let text = snapshot(key)
        let verified = ranges.contains { range in
            guard let start = text.index(at: range.start), let end = text.index(at: range.end) else { return false }
            // Swift String equality/contains accepts canonical equivalence. A source
            // quote must instead match the exact stored Unicode sequence.
            return text.source.range(of: quote, options: .literal, range: start..<end) != nil
        }
        guard verified else { return Self.failure("UNREAD_SOURCE", "引用必须精确对应本轮已读文字。") }
        var ref = sourceMetadata()
        ref.merge([
            "chapterId": .string(book.chapters[chapterIndex].id), "chapterTitle": .string(Self.label(book.chapters[chapterIndex].title)),
            "passageId": .string(passageID), "quote": .string(quote), "layer": .string("original"), "url": .string(readURL(passageID: passageID))
        ]) { _, new in new }
        return .object(ref)
    }

    private func remember(_ key: PassageKey, start: Int, end: Int) {
        guard start < end else { return }
        var ranges = (visible[key] ?? []) + [ReadRange(start: start, end: end)]
        ranges.sort { $0.start < $1.start }
        var merged: [ReadRange] = []
        for range in ranges {
            if let last = merged.last, range.start <= last.end { merged[merged.count - 1].end = max(last.end, range.end) }
            else { merged.append(range) }
        }
        visible[key] = merged
    }
    private func snapshot(_ key: PassageKey) -> TextSnapshot {
        if let cached = texts[key] { return cached }
        let value = TextSnapshot(book.chapters[key.chapter].passages[key.passage].text)
        texts[key] = value
        return value
    }
    private func sourceMetadata() -> [String: CloudJSON] {
        ["bookId": .string(book.id), "contentVersion": .string(book.sourceVersion), "sourceVersion": .string(book.sourceVersion)]
    }
    private func readURL(passageID: String? = nil) -> String {
        "leafhour://local/read?book=" + CloudJSON.component(book.id) + "&sourceVersion=" + CloudJSON.component(book.sourceVersion) + (passageID.map { "&passage=" + CloudJSON.component($0) } ?? "")
    }
    private static func validString(_ text: String, maximum: Int) -> Bool { !text.isEmpty && text.utf16.count <= maximum }
    private static func integer(_ value: CloudJSON?) -> Int? {
        guard let number = value?.number, number.isFinite, number.rounded() == number, number >= 0, number <= Double(Int.max / 2) else { return nil }
        return Int(number)
    }
    private static func bytes(_ value: CloudJSON) -> Int { (try? JSONEncoder().encode(value).count) ?? Int.max }
    private static func failure(_ code: String, _ message: String) -> CloudJSON { .object(["error": .object(["code": .string(code), "message": .string(message)])]) }
    private static func label(_ source: String) -> String {
        var result = "", size = 0
        for character in source.prefix(500) {
            let cost = escapedBytes(character)
            if size + cost > 1_024 { break }
            result.append(character); size += cost
        }
        return result
    }
    private static func escapedBytes(_ character: Character) -> Int {
        character.unicodeScalars.reduce(0) { size, scalar in
            switch scalar.value {
            case 0x22, 0x5c, 0x2f, 8, 9, 10, 12, 13: size + 2
            case 0..<0x20: size + 6
            default: size + scalar.utf8.count
            }
        }
    }

    /// Keep continuation indexes without rebuilding a whole paragraph's Character
    /// array on every page. All exposed offsets still count Unicode scalars.
    private final class TextSnapshot {
        let source: String
        let totalScalars: Int
        private var positions: [Int: String.Index]
        init(_ source: String) {
            self.source = source; totalScalars = source.unicodeScalars.count
            positions = [0: source.startIndex]
            positions[totalScalars] = source.endIndex
        }
        func index(at offset: Int) -> String.Index? {
            guard offset >= 0, offset <= totalScalars else { return nil }
            if let saved = positions[offset] { return saved }
            let scalars = source.unicodeScalars
            let index = scalars.index(scalars.startIndex, offsetBy: offset)
            guard String.Index(index, within: source) != nil else { return nil }
            positions[offset] = index
            return index
        }
        func chunk(from start: String.Index, scalarOffset: Int, budget: Int, until requestedEnd: String.Index? = nil) -> (text: String, end: Int, endIndex: String.Index) {
            let stop = requestedEnd ?? source.endIndex
            var index = start, scalar = scalarOffset, size = 0
            while index < stop {
                let character = source[index], cost = LocalReadingTools.escapedBytes(character)
                if size + cost > budget { break }
                size += cost; scalar += character.unicodeScalars.count
                source.formIndex(after: &index)
            }
            positions[scalarOffset] = start; positions[scalar] = index
            return (String(source[start..<index]), scalar, index)
        }
    }
}
