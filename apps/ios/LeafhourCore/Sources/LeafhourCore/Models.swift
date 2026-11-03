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
    /// Range in decoded source with CR/LF normalized to LF; absent in historical indexes.
    public var sourceUTF16Range: NSRange? = nil
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
    public var coverResourcePath: String? = nil
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
    public init(chapterID: String, passageID: String, characterOffset: Int = 0, pageY: Double? = nil, resourceY: Double? = nil) {
        self.chapterID = chapterID; self.passageID = passageID; self.characterOffset = characterOffset; self.pageY = pageY; self.resourceY = resourceY
    }
    public var key: String { chapterID + ":" + passageID + ":" + String(characterOffset) }
}
public struct NoteDraft: Codable, Equatable, Sendable {
    public var id: String { SelectedQuote(anchor: anchor, text: quote, origin: quoteOrigin, variant: quoteVariant, translationOffset: quoteOffset).id }
    public var anchor: ReadingAnchor
    public var quote: String
    public var body: String
    public var quoteOrigin: String? = nil
    public var quoteVariant: String? = nil
    public var quoteOffset: Int? = nil
    public init(anchor: ReadingAnchor, quote: String, body: String, quoteOrigin: String? = nil, quoteVariant: String? = nil, quoteOffset: Int? = nil) {
        self.anchor = anchor; self.quote = quote; self.body = body
        self.quoteOrigin = quoteOrigin; self.quoteVariant = quoteVariant; self.quoteOffset = quoteOffset
    }
}
public struct ReaderNote: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var anchor: ReadingAnchor
    public var quote: String
    public var body: String
    public var modifiedAt: Date
    public var quoteOrigin: String? = nil
    public var quoteVariant: String? = nil
    public init(id: UUID = UUID(), anchor: ReadingAnchor, quote: String, body: String, modifiedAt: Date = Date(), quoteOrigin: String? = nil, quoteVariant: String? = nil) {
        self.id = id; self.anchor = anchor; self.quote = quote; self.body = body; self.modifiedAt = modifiedAt
        self.quoteOrigin = quoteOrigin; self.quoteVariant = quoteVariant
    }
}
public enum ReaderPageAnimation: String, Codable, CaseIterable, Sendable { case slide, curl, none }
public enum ReaderPageInput: String, Codable, CaseIterable, Sendable { case tapAndSwipe, swipeOnly, tapOnly
    public var allowsTap: Bool { self != .swipeOnly }
    public var allowsSwipe: Bool { self != .tapOnly }
}
public enum ReaderNavigationMode: String, Codable, Sendable { case scroll, paged }
public enum ReaderFontStyle: String, Codable, CaseIterable, Sendable { case serif, sans, rounded, kai }
public struct ReaderPreferences: Codable, Equatable, Sendable {
    public var latinFont: ReaderLatinFont = .automatic
    public var fontStyle: ReaderFontStyle = .serif
    public var fontSize: Double = 22
    public var lineSpacing: Double = 9
    public var firstLineIndent: ReaderFirstLineIndent = .none
    public var theme: String = "paper"
    public var navigationMode: ReaderNavigationMode = .paged
    public var pageAnimation: ReaderPageAnimation = .slide
    public var pageInput: ReaderPageInput = .tapAndSwipe
    public var pageTapDelay: Double = 0
    public var alwaysShowReadingProgress = false
    public var viewMode: ReaderViewMode = .source
    public var translationVariant: ReaderTranslationVariant = .literal
    public var speechSpeed: Double = 1
    public var autoPageInterval: Double = 30
    public var automaticReadingTime = true
    public init() {}
    private enum CodingKeys: String, CodingKey { case latinFont, fontStyle, fontSize, lineSpacing, firstLineIndent, theme, navigationMode, pageAnimation, pageInput, pageTapDelay, alwaysShowReadingProgress, viewMode, translationVariant, speechSpeed, autoPageInterval, automaticReadingTime }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        latinFont = (try values.decodeIfPresent(String.self, forKey: .latinFont)).flatMap(ReaderLatinFont.init(rawValue:)) ?? .automatic
        fontStyle = (try values.decodeIfPresent(String.self, forKey: .fontStyle)).flatMap(ReaderFontStyle.init(rawValue:)) ?? .serif
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 22
        lineSpacing = try values.decodeIfPresent(Double.self, forKey: .lineSpacing) ?? 9
        firstLineIndent = (try values.decodeIfPresent(String.self, forKey: .firstLineIndent)).flatMap(ReaderFirstLineIndent.init(rawValue:)) ?? .none
        theme = try values.decodeIfPresent(String.self, forKey: .theme) ?? "paper"
        // Old state and a future mode remain readable without discarding notes or position.
        let mode = try values.decodeIfPresent(String.self, forKey: .navigationMode)
        navigationMode = mode.flatMap(ReaderNavigationMode.init(rawValue:)) ?? .paged
        pageAnimation = (try values.decodeIfPresent(String.self, forKey: .pageAnimation)).flatMap(ReaderPageAnimation.init(rawValue:)) ?? .slide
        pageInput = (try values.decodeIfPresent(String.self, forKey: .pageInput)).flatMap(ReaderPageInput.init(rawValue:)) ?? .tapAndSwipe
        pageTapDelay = Self.normalizedPageTapDelay(try values.decodeIfPresent(Double.self, forKey: .pageTapDelay) ?? 0)
        alwaysShowReadingProgress = try values.decodeIfPresent(Bool.self, forKey: .alwaysShowReadingProgress) ?? false
        viewMode = (try values.decodeIfPresent(String.self, forKey: .viewMode)).flatMap(ReaderViewMode.init(rawValue:)) ?? .source
        translationVariant = (try values.decodeIfPresent(String.self, forKey: .translationVariant)).flatMap(ReaderTranslationVariant.init(rawValue:)) ?? .literal
        speechSpeed = Self.normalizedSpeechSpeed(try values.decodeIfPresent(Double.self, forKey: .speechSpeed) ?? 1)
        automaticReadingTime = try values.decodeIfPresent(Bool.self, forKey: .automaticReadingTime) ?? true
        autoPageInterval = Self.normalizedAutoPageInterval(try values.decodeIfPresent(Double.self, forKey: .autoPageInterval) ?? 30)
    }
    public static func normalizedSpeechSpeed(_ value: Double) -> Double {
        value.isFinite ? min(5, max(0.5, value)) : 1
    }
    public static func normalizedPageTapDelay(_ value: Double) -> Double {
        value.isFinite ? min(0.5, max(0, value)) : 0
    }
    public static func normalizedAutoPageInterval(_ value: Double) -> Double {
        ReaderAutoPageState.normalizedInterval(value)
    }
}
public struct ReaderState: Codable, Equatable, Sendable {
    public var anchor: ReadingAnchor?
    /// Actual foreground reading interaction, distinct from local/cloud save time.
    public var lastActivityAt: Date?
    public var listeningPosition: ReaderListeningPosition?
    public var drafts: [String: NoteDraft] = [:]
    public var notes: [ReaderNote] = []
    public var preferences = ReaderPreferences()
    public var translationSettings: BookTranslationSettings? = nil
    public init() {}
}
/// Layer offsets are UTF-16 positions in a verified text snapshot, never source
/// scalar anchors. Optional state preserves older on-device libraries/backups.
public struct ReaderListeningPosition: Codable, Equatable, Sendable {
    public var sourceVersion: String
    public var chapterID: String
    public var passageID: String
    public var layer: String
    public var utf16Offset: Int
    public var textFingerprint: String
    public var viewport: ReadingAnchor?
    public init(sourceVersion: String, chapterID: String, passageID: String, layer: String, utf16Offset: Int, textFingerprint: String, viewport: ReadingAnchor?) {
        self.sourceVersion = sourceVersion; self.chapterID = chapterID; self.passageID = passageID
        self.layer = layer; self.utf16Offset = utf16Offset; self.textFingerprint = textFingerprint; self.viewport = viewport
    }
}
public struct ImportProgress: Sendable {
    public enum Stage: Int, Sendable { case retaining, extracting, verifying }
    public var stage: Stage
    public var completed: Int
    public var total: Int
    public init(stage: Stage, completed: Int = 0, total: Int = 0) {
        self.stage = stage; self.completed = completed; self.total = total
    }
}

public enum DuplicateImportPolicy: String, Codable, Sendable { case keep, replace, new }
public enum ImportPhase: String, Codable, Sendable { case processing, failed, interrupted, cancelled, complete }
public struct ImportJob: Codable, Identifiable, Sendable {
    public var id: UUID
    public var filename: String
    public var kind: BookKind
    public var phase: ImportPhase
    public var error: String?
    public var bookID: String?
    public var duplicatePolicy: DuplicateImportPolicy? = nil
    public var operationID: UUID? = nil
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
