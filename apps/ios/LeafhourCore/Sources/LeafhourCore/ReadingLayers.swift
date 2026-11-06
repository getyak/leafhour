import Foundation
import cmark_gfm

public enum ReaderViewMode: String, Codable, CaseIterable, Sendable {
    case source, translation, parallel
    var webMode: String { switch self { case .source: "en"; case .translation: "zh"; case .parallel: "parallel" } }
}
public enum ReaderParallelOrder: String, Codable, CaseIterable, Sendable { case sourceFirst, translationFirst }
public enum ReaderTranslationVariant: String, Codable, CaseIterable, Sendable { case literal, interpretive }

public struct ReadingTranslation: Codable, Equatable, Sendable {
    public var original: String
    public var literal: String?
    public var interpretive: String?
    public var literalStatus: String?
    public var interpretiveStatus: String?
    public var targetLanguage: ReadingLanguage? = nil
    public init(original: String, literal: String? = nil, interpretive: String? = nil, literalStatus: String? = nil, interpretiveStatus: String? = nil, targetLanguage: ReadingLanguage? = nil) {
        self.original = original; self.literal = literal; self.interpretive = interpretive
        self.literalStatus = literalStatus; self.interpretiveStatus = interpretiveStatus
        self.targetLanguage = targetLanguage
    }
    public init?(_ row: CloudJSON, targetLanguage: ReadingLanguage = .zh) {
        guard let original = row["original"].string else { return nil }
        func matching(_ variant: String) -> CloudJSON {
            let value = row["translations"][variant]
            return (value["targetLanguage"].string ?? "zh") == targetLanguage.rawValue ? value : .null
        }
        let literal = matching("literal"), interpretive = matching("interpretive")
        self.init(original: original, literal: literal["text"].string, interpretive: interpretive["text"].string,
                  literalStatus: literal["status"].string, interpretiveStatus: interpretive["status"].string, targetLanguage: targetLanguage)
    }
    public func text(_ variant: ReaderTranslationVariant) -> String? {
        let value = variant == .literal ? literal : interpretive
        return value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? value : nil
    }
    public func status(_ variant: ReaderTranslationVariant) -> String? { variant == .literal ? literalStatus : interpretiveStatus }
}

public struct ReadingLayerSegment: Equatable, Sendable {
    public var text: String
    public var isTranslation: Bool
    public var status: String?
    public var translationMissing: Bool
}
public enum ReadingLayers {
    public static func segments(passage: Passage, preferences: ReaderPreferences, translation: ReadingTranslation?, showingSource: Bool = false) -> [ReadingLayerSegment] {
        let source = ReadingLayerSegment(text: passage.text, isTranslation: false, status: nil, translationMissing: false)
        guard preferences.viewMode != .source, !passage.heading, passage.resourcePath == nil else { return [source] }
        guard let translation, translation.original == passage.text, let text = translation.text(preferences.translationVariant) else {
            if preferences.viewMode == .parallel { return [ReadingLayerSegment(text: passage.text, isTranslation: false, status: nil, translationMissing: true)] }
            let missing = ReadingLayerSegment(text: "", isTranslation: false, status: nil, translationMissing: true)
            return showingSource ? [missing, source] : [missing]
        }
        let translated = ReadingLayerSegment(text: text, isTranslation: true, status: translation.status(preferences.translationVariant), translationMissing: false)
        guard preferences.viewMode == .parallel else { return showingSource ? [translated, source] : [translated] }
        return preferences.parallelOrder == .translationFirst ? [translated, source] : [source, translated]
    }
}

public enum ReadingTranslationScope: String, Codable, Sendable { case passage, page, following, chapter, currentAndNext }

public struct ReadingTranslationPlan: Codable, Equatable, Sendable {
    public let ownerID: String
    public let bookID: String
    public let contentVersion: String
    public let chapterIDs: [String]
    public let passageIDs: [String]
    // Optional for recovery of envelopes written before explicit scopes existed.
    public let scope: ReadingTranslationScope?
    /// The complete original viewport scope, including paragraphs whose twins
    /// were already available. Page recovery must not infer this from a chapter.
    public let visiblePassageIDs: [String]?
    public var sourceLanguage: ReadingLanguage? = nil
    public var targetLanguage: ReadingLanguage? = nil
    public var maximumPoints: Int { passageIDs.count }
    /// A rendered image alternative or heading does not become an author
    /// paragraph merely because the Markdown importer preserves its source ID.
    public static func isPageText(_ passage: Passage, in book: LocalBook) -> Bool {
        guard !passage.heading, passage.resourcePath == nil,
              !passage.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard book.rendersMarkdown else { return true }
        guard let root = passage.text.withCString({ cmark_parse_document($0, passage.text.utf8.count, CMARK_OPT_DEFAULT | CMARK_OPT_VALIDATE_UTF8) }) else { return false }
        defer { cmark_node_free(root) }
        func containsText(_ node: UnsafeMutablePointer<cmark_node>) -> Bool {
            let kind = cmark_node_get_type(node)
            if kind == CMARK_NODE_IMAGE || kind == CMARK_NODE_HEADING || kind == CMARK_NODE_THEMATIC_BREAK { return false }
            if kind == CMARK_NODE_TEXT || kind == CMARK_NODE_CODE || kind == CMARK_NODE_CODE_BLOCK {
                return cmark_node_get_literal(node).map { !String(cString: $0).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? false
            }
            if kind == CMARK_NODE_HTML_INLINE || kind == CMARK_NODE_HTML_BLOCK, let value = cmark_node_get_literal(node) {
                return !MarkdownDocument(source: String(cString: value)).text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            var child = cmark_node_first_child(node)
            while let current = child {
                if containsText(current) { return true }
                child = cmark_node_next(current)
            }
            return false
        }
        return containsText(root)
    }
    /// Pure visible-source window; completed translations never expand its end.
    public static func followingWindow(book: LocalBook, chapterIndex: Int, visiblePassageIDs: [String]) throws -> [Passage] {
        guard book.chapters.indices.contains(chapterIndex), !visiblePassageIDs.isEmpty,
              visiblePassageIDs.count <= 12, Set(visiblePassageIDs).count == visiblePassageIDs.count else {
            throw LibraryError.invalid("当前页范围尚未确定或超过 12 段，请调整字号后重新开启随读翻译。")
        }
        let source = book.chapters[chapterIndex].passages
        guard let first = source.firstIndex(where: { $0.id == visiblePassageIDs[0] }) else {
            throw LibraryError.invalid("当前页原文段落无法核对，请等书页稳定后重试。")
        }
        var window: [Passage] = []
        for passage in source.dropFirst(first) {
            if isPageText(passage, in: book) { window.append(passage) }
            if window.count == min(12, visiblePassageIDs.count + 2) { break }
        }
        guard Array(window.prefix(visiblePassageIDs.count)).map(\.id) == visiblePassageIDs else {
            throw LibraryError.invalid("当前页原文段落无法核对，请等书页稳定后重试。")
        }
        return window
    }
    /// Matches the provider's one-passage plus neighboring-source contract.
    public static func validateFollowingContext(book: LocalBook, passageID: String) throws {
        guard let chapterIndex = book.chapters.firstIndex(where: { $0.passages.contains { $0.id == passageID } }),
              let index = book.chapters[chapterIndex].passages.firstIndex(where: { $0.id == passageID }) else {
            throw LibraryError.invalid("当前原文段落无法核对，本次未提交。")
        }
        let source = book.chapters[chapterIndex].passages, passage = source[index]
        guard passage.text.unicodeScalars.count <= 4000 else {
            throw LibraryError.invalid("这一段超过 4,000 字的翻译范围，原文仍可阅读；本次未提交。")
        }
        var neighbors: [Passage] = []
        if index > 0 { neighbors.append(source[index - 1]) }
        else if let previous = book.chapters[..<chapterIndex].reversed().first(where: { !$0.passages.isEmpty })?.passages.last { neighbors.append(previous) }
        neighbors.append(passage)
        if index + 1 < source.count { neighbors.append(source[index + 1]) }
        else if let next = book.chapters.dropFirst(chapterIndex + 1).first(where: { !$0.passages.isEmpty })?.passages.first { neighbors.append(next) }
        guard neighbors.reduce(0, { $0 + $1.text.utf8.count }) <= 24 * 1024 else {
            throw LibraryError.invalid("当前段与邻近上下文超过 24 KiB，本次未提交；原文仍可阅读。")
        }
        let context = neighbors.map { ["id": $0.id, "original": $0.text] }
        guard try JSONSerialization.data(withJSONObject: context, options: [.withoutEscapingSlashes]).count <= 24 * 1024 else {
            throw LibraryError.invalid("当前段与邻近上下文超过 24 KiB，本次未提交；原文仍可阅读。")
        }
    }
    public static func make(book: LocalBook, chapterIndex: Int, translations: [String: ReadingTranslation], scope: ReadingTranslationScope = .currentAndNext, passageID: String? = nil, languages: BookTranslationSettings? = nil, visiblePassageIDs: [String]? = nil) throws -> Self {
        guard let identity = book.cloud, book.chapters.indices.contains(chapterIndex) else { throw LibraryError.invalid("请先登录并同步这本书。") }
        let chapters = Array(book.chapters.dropFirst(chapterIndex).prefix(scope == .currentAndNext ? 2 : 1))
        var passages = chapters.flatMap(\.passages)
        var pageIDs: [String]?
        if scope == .following {
            guard let visiblePassageIDs else { throw LibraryError.invalid("当前页范围尚未确定，请等书页稳定后重试。") }
            pageIDs = visiblePassageIDs
            passages = try followingWindow(book: book, chapterIndex: chapterIndex, visiblePassageIDs: visiblePassageIDs)
        } else if scope == .page {
            guard let visiblePassageIDs, !visiblePassageIDs.isEmpty,
                  Set(visiblePassageIDs).count == visiblePassageIDs.count,
                  visiblePassageIDs.count <= 100 else { throw LibraryError.invalid("当前页范围尚未确定，请等书页排版完成后重试。") }
            let selected = Set(visiblePassageIDs)
            passages = chapters[0].passages.filter { selected.contains($0.id) }
            guard passages.count == selected.count,
                  passages.allSatisfy({ isPageText($0, in: book) }) else {
                throw LibraryError.invalid("当前页原文段落无法核对，请重新打开这一页。")
            }
            pageIDs = passages.map(\.id)
        } else if let passageID {
            guard let index = chapters[0].passages.firstIndex(where: { $0.id == passageID }) else { throw LibraryError.invalid("当前段落不属于本章，尚未准备译文。") }
            passages = Array(passages.dropFirst(index)) + Array(passages.prefix(index))
        }
        let eligible = passages.filter { !$0.heading && $0.resourcePath == nil && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var pending: [String] = []
        for passage in eligible.prefix(scope == .passage ? 1 : eligible.count) {
            if (scope == .page || scope == .following), let existing = translations[passage.id], existing.original != passage.text {
                throw LibraryError.invalid("有段落的译文对应另一份原文，请先核对；本页翻译不会覆盖它。")
            }
            let existing = translations[passage.id].flatMap { $0.original == passage.text ? $0 : nil }
            let literal = existing?.text(.literal) != nil, interpretive = existing?.text(.interpretive) != nil
            if literal != interpretive { throw LibraryError.invalid("有段落已有部分译文，请先核对；预译不会覆盖它。") }
            if !literal && pending.count < 100 {
                if scope == .following { try validateFollowingContext(book: book, passageID: passage.id) }
                pending.append(passage.id)
            }
        }
        return Self(ownerID: identity.ownerID, bookID: identity.bookID, contentVersion: identity.contentVersion, chapterIDs: chapters.map(\.id), passageIDs: pending, scope: scope, visiblePassageIDs: pageIDs, sourceLanguage: languages?.resolvedSource(detected: ReadingLanguage.detect(in: book)), targetLanguage: languages?.targetLanguage)
    }
}
