import Foundation

public enum ReaderViewMode: String, Codable, CaseIterable, Sendable {
    case source, translation, parallel
    var webMode: String { switch self { case .source: "en"; case .translation: "zh"; case .parallel: "parallel" } }
}
public enum ReaderTranslationVariant: String, Codable, CaseIterable, Sendable { case literal, interpretive }

public struct ReadingTranslation: Codable, Equatable, Sendable {
    public var original: String
    public var literal: String?
    public var interpretive: String?
    public var literalStatus: String?
    public var interpretiveStatus: String?
    public init(original: String, literal: String? = nil, interpretive: String? = nil, literalStatus: String? = nil, interpretiveStatus: String? = nil) {
        self.original = original; self.literal = literal; self.interpretive = interpretive
        self.literalStatus = literalStatus; self.interpretiveStatus = interpretiveStatus
    }
    public init?(_ row: CloudJSON) {
        guard let original = row["original"].string else { return nil }
        self.init(original: original, literal: row["translations"]["literal"]["text"].string, interpretive: row["translations"]["interpretive"]["text"].string,
                  literalStatus: row["translations"]["literal"]["status"].string, interpretiveStatus: row["translations"]["interpretive"]["status"].string)
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
    public static func segments(passage: Passage, preferences: ReaderPreferences, translation: ReadingTranslation?) -> [ReadingLayerSegment] {
        let source = ReadingLayerSegment(text: passage.text, isTranslation: false, status: nil, translationMissing: false)
        guard preferences.viewMode != .source, !passage.heading, passage.resourcePath == nil else { return [source] }
        guard let translation, translation.original == passage.text, let text = translation.text(preferences.translationVariant) else {
            return [ReadingLayerSegment(text: passage.text, isTranslation: false, status: nil, translationMissing: true)]
        }
        let translated = ReadingLayerSegment(text: text, isTranslation: true, status: translation.status(preferences.translationVariant), translationMissing: false)
        return preferences.viewMode == .parallel ? [source, translated] : [translated]
    }
}

public struct ReadingTranslationPlan: Codable, Equatable, Sendable {
    public let ownerID: String
    public let bookID: String
    public let contentVersion: String
    public let chapterIDs: [String]
    public let passageIDs: [String]
    public var maximumPoints: Int { passageIDs.count }
    public static func make(book: LocalBook, chapterIndex: Int, translations: [String: ReadingTranslation]) throws -> Self {
        guard let identity = book.cloud, book.chapters.indices.contains(chapterIndex) else { throw LibraryError.invalid("请先登录并同步这本书。") }
        let chapters = Array(book.chapters.dropFirst(chapterIndex).prefix(2))
        var pending: [String] = []
        for passage in chapters.flatMap(\.passages) where !passage.heading && passage.resourcePath == nil && !passage.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let existing = translations[passage.id].flatMap { $0.original == passage.text ? $0 : nil }
            let literal = existing?.text(.literal) != nil, interpretive = existing?.text(.interpretive) != nil
            if literal != interpretive { throw LibraryError.invalid("有段落已有部分译文，请先核对；预译不会覆盖它。") }
            if !literal && pending.count < 100 { pending.append(passage.id) }
        }
        return Self(ownerID: identity.ownerID, bookID: identity.bookID, contentVersion: identity.contentVersion, chapterIDs: chapters.map(\.id), passageIDs: pending)
    }
}
