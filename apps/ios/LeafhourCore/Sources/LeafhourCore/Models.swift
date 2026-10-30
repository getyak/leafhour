import Foundation

public enum BookKind: String, Codable, Sendable { case epub, pdf, txt, markdown, unknown }
public enum LibraryScope: Sendable { case device, account(UUID)
    var folder: String { switch self { case .device: "device"; case .account(let id): "account-" + id.uuidString.lowercased() } }
}
public struct Passage: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var text: String
    public var heading: Bool = false
    public var resourcePath: String? = nil
    public var alternative: String? = nil
}
public struct BookChapter: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var sourcePath: String
    public var passages: [Passage]
}
public struct LocalBook: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var author: String
    public var kind: BookKind
    public var sourceVersion: String
    public var originalFilename: String
    public var importedAt: Date
    public var chapters: [BookChapter]
    public var cloud: CloudBookIdentity? = nil
    /// A first-open hint; every source chapter and saved reading position remains available.
    public var readingStartChapterID: String? = nil
    public var readingStartAnchor: ReadingAnchor? = nil
}
public struct ReadingAnchor: Codable, Equatable, Hashable, Sendable {
    public var chapterID: String
    public var passageID: String
    /// Unicode scalar offset, independent of UTF-16 and layout geometry.
    public var characterOffset: Int
    public var pageY: Double?
    /// Local source-image position, normalized from its top. PDF pageY remains
    /// an absolute PDF coordinate; textual progress remains a Unicode scalar.
    public var resourceY: Double?
    /// Display-layer progress never masquerades as a source character offset.
    public var translationOffset: Int? = nil
    public var translationVariant: ReaderTranslationVariant? = nil
    public var translationVersion: String? = nil
    public init(chapterID: String, passageID: String, characterOffset: Int = 0, pageY: Double? = nil, resourceY: Double? = nil) {
        self.chapterID = chapterID; self.passageID = passageID; self.characterOffset = characterOffset; self.pageY = pageY; self.resourceY = resourceY
    }
    public var key: String {
        let source = chapterID + ":" + passageID + ":" + String(characterOffset)
        guard let translationOffset, let translationVariant else { return source }
        return source + ":" + translationVariant.rawValue + ":" + String(translationOffset)
    }
}
public struct NoteDraft: Codable, Equatable, Sendable {
    public var anchor: ReadingAnchor
    public var quote: String
    public var body: String
    public var quoteOrigin: String? = nil
    public var quoteLanguage: String? = nil
    public init(anchor: ReadingAnchor, quote: String, body: String, quoteOrigin: String? = nil, quoteLanguage: String? = nil) { self.anchor = anchor; self.quote = quote; self.body = body; self.quoteOrigin = quoteOrigin; self.quoteLanguage = quoteLanguage }
}
public struct ReaderNote: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var anchor: ReadingAnchor
    public var quote: String
    public var body: String
    public var modifiedAt: Date
    public var quoteOrigin: String? = nil
    public var quoteLanguage: String? = nil
    public init(id: UUID = UUID(), anchor: ReadingAnchor, quote: String, body: String, modifiedAt: Date = Date(), quoteOrigin: String? = nil, quoteLanguage: String? = nil) {
        self.id = id; self.anchor = anchor; self.quote = quote; self.body = body; self.modifiedAt = modifiedAt; self.quoteOrigin = quoteOrigin; self.quoteLanguage = quoteLanguage
    }
}
public enum ReaderNavigationMode: String, Codable, Sendable { case scroll, paged }
public struct ReaderPreferences: Codable, Equatable, Sendable {
    public var fontSize: Double = 22
    public var lineSpacing: Double = 9
    public var theme: String = "paper"
    public var navigationMode: ReaderNavigationMode = .scroll
    public var textMode: ReaderTextMode = .translation
    public var translationVariant: ReaderTranslationVariant = .interpretive
    public var automaticTranslation = true
    public init() {}
    private enum CodingKeys: String, CodingKey { case fontSize, lineSpacing, theme, navigationMode, textMode, translationVariant, automaticTranslation }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 22
        lineSpacing = try values.decodeIfPresent(Double.self, forKey: .lineSpacing) ?? 9
        theme = try values.decodeIfPresent(String.self, forKey: .theme) ?? "paper"
        // Old state and a future mode remain readable without discarding notes or position.
        let mode = try values.decodeIfPresent(String.self, forKey: .navigationMode)
        navigationMode = mode.flatMap(ReaderNavigationMode.init(rawValue:)) ?? .scroll
        textMode = (try values.decodeIfPresent(String.self, forKey: .textMode)).flatMap(ReaderTextMode.init(rawValue:)) ?? .translation
        translationVariant = (try values.decodeIfPresent(String.self, forKey: .translationVariant)).flatMap(ReaderTranslationVariant.init(rawValue:)) ?? .interpretive
        automaticTranslation = try values.decodeIfPresent(Bool.self, forKey: .automaticTranslation) ?? true
    }
}
public struct ReaderState: Codable, Equatable, Sendable {
    public var anchor: ReadingAnchor?
    public var drafts: [String: NoteDraft] = [:]
    public var notes: [ReaderNote] = []
    public var preferences = ReaderPreferences()
    public init() {}
}
public enum ImportPhase: String, Codable, Sendable { case processing, failed, interrupted, cancelled, complete }
public struct ImportJob: Codable, Identifiable, Sendable {
    public var id: UUID
    public var filename: String
    public var kind: BookKind
    public var phase: ImportPhase
    public var error: String?
    public var bookID: String?
}
public struct ImportLimits: Sendable {
    public var maximumFileBytes: Int64
    public var maximumExpandedBytes: Int64
    public var maximumEntryBytes: Int64
    public var maximumEntries: Int
    public init(maximumFileBytes: Int64 = 150_000_000, maximumExpandedBytes: Int64 = 300_000_000, maximumEntryBytes: Int64 = 32_000_000, maximumEntries: Int = 6000) {
        self.maximumFileBytes = maximumFileBytes; self.maximumExpandedBytes = maximumExpandedBytes; self.maximumEntryBytes = maximumEntryBytes; self.maximumEntries = maximumEntries
    }
}
public enum LibraryError: Error, LocalizedError {
    case invalid(String)
    public var errorDescription: String? { switch self { case .invalid(let message): message } }
}
