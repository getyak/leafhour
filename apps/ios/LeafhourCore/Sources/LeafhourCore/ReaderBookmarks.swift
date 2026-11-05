import Foundation
import CryptoKit

public struct BookmarkColor: Codable, Equatable, Hashable, Sendable {
    public let hex: String
    public let name: String
    public init?(hex: String, name: String = "自定义") {
        guard hex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil else { return nil }
        self.hex = hex.uppercased()
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.name = trimmed.isEmpty ? "自定义" : String(trimmed.prefix(40))
    }
    public static let presets: [BookmarkColor] = [
        BookmarkColor(hex: "#35745A", name: "墨绿")!, BookmarkColor(hex: "#A66A13", name: "琥珀")!,
        BookmarkColor(hex: "#B34E44", name: "朱红")!, BookmarkColor(hex: "#3F6C9E", name: "蓝色")!,
        BookmarkColor(hex: "#835BA2", name: "紫色")!
    ]
    public static var defaultColor: BookmarkColor { presets[0] }
    private enum CodingKeys: String, CodingKey { case hex, name }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self = BookmarkColor(hex: (try? values.decode(String.self, forKey: .hex)) ?? "", name: (try? values.decode(String.self, forKey: .name)) ?? "自定义") ?? .defaultColor
    }
}

/// A translated display offset belongs to one verified translation snapshot.
/// It never claims a scalar-to-scalar alignment with the author source.
public struct ReaderBookmarkPresentation: Codable, Equatable, Sendable {
    public let layer: ReaderTranslationVariant
    public let targetLanguage: ReadingLanguage
    public let textFingerprint: String
    public var utf16Offset: Int
    public let viewMode: ReaderViewMode
    public init?(layer: ReaderTranslationVariant, targetLanguage: ReadingLanguage, text: String, utf16Offset: Int, viewMode: ReaderViewMode = .translation) {
        guard !text.isEmpty, (0...text.utf16.count).contains(utf16Offset), viewMode != .source else { return nil }
        self.layer = layer; self.targetLanguage = targetLanguage; self.textFingerprint = Self.fingerprint(text)
        self.utf16Offset = utf16Offset; self.viewMode = viewMode
    }
    public static func fingerprint(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    public var isStructurallyValid: Bool {
        utf16Offset >= 0 && utf16Offset <= 100_000_000 && viewMode != .source
            && textFingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }
    public func matches(text: String, targetLanguage: ReadingLanguage) -> Bool {
        isStructurallyValid && self.targetLanguage == targetLanguage && utf16Offset <= text.utf16.count
            && textFingerprint == Self.fingerprint(text)
    }
    public var snapshotKey: String { layer.rawValue + ":" + targetLanguage.rawValue + ":" + textFingerprint }
    public var positionKey: String { snapshotKey + ":" + String(utf16Offset) }
}

public struct ReaderBookmarkCapture: Equatable, Sendable {
    public let anchor: ReadingAnchor
    public let presentation: ReaderBookmarkPresentation?
    public init(anchor: ReadingAnchor, presentation: ReaderBookmarkPresentation? = nil) { self.anchor = anchor; self.presentation = presentation }
}

/// A session-local restore request. It is revoked by any later navigation ID.
public struct ReaderBookmarkNavigation: Equatable, Sendable {
    public let navigationID: UUID
    public let anchor: ReadingAnchor
    public let presentation: ReaderBookmarkPresentation
    public let previousChapterIndex: Int
    public let previousAnchor: ReadingAnchor?
    public let previousPreferences: ReaderPreferences
    public init(navigationID: UUID, anchor: ReadingAnchor, presentation: ReaderBookmarkPresentation, previousChapterIndex: Int, previousAnchor: ReadingAnchor?, previousPreferences: ReaderPreferences) {
        self.navigationID = navigationID; self.anchor = anchor; self.presentation = presentation
        self.previousChapterIndex = previousChapterIndex; self.previousAnchor = previousAnchor; self.previousPreferences = previousPreferences
    }
}

/// A user-owned position, separate from notes, translations and reading progress.
public struct ReaderBookmark: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let sourceVersion: String
    public let contentVersion: String?
    public var anchor: ReadingAnchor
    public let presentation: ReaderBookmarkPresentation?
    public var name: String?
    public var color: BookmarkColor
    public let createdAt: Date
    public var modifiedAt: Date
    public init(id: UUID = UUID(), sourceVersion: String, contentVersion: String?, anchor: ReadingAnchor, presentation: ReaderBookmarkPresentation? = nil, name: String? = nil, color: BookmarkColor = .defaultColor, createdAt: Date = Date(), modifiedAt: Date? = nil) {
        self.id = id; self.sourceVersion = sourceVersion; self.contentVersion = contentVersion
        self.anchor = Self.normalized(anchor); self.presentation = presentation; self.name = Self.normalizedName(name); self.color = color
        self.createdAt = createdAt; self.modifiedAt = modifiedAt ?? createdAt
    }
    public static func normalizedName(_ value: String?) -> String? {
        let value = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : String(value.prefix(80))
    }
    public static func normalized(_ anchor: ReadingAnchor) -> ReadingAnchor {
        var value = anchor
        if let y = value.pageY, y.isFinite { value.pageY = y.rounded() }
        if let y = value.resourceY, y.isFinite { value.resourceY = (y * 1000).rounded() / 1000 }
        return value
    }
    public static func positionKey(_ anchor: ReadingAnchor) -> String {
        let anchor = normalized(anchor)
        // Length-delimited Codable data avoids delimiter collisions in source IDs.
        let parts = [anchor.chapterID, anchor.passageID, String(anchor.characterOffset), anchor.pageY.map { String($0) } ?? "", anchor.resourceY.map { String($0) } ?? ""]
        return (try? JSONEncoder().encode(parts)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
    public var positionKey: String { Self.positionKey(anchor) + "\n" + (presentation?.positionKey ?? "source") }
    public var capture: ReaderBookmarkCapture { ReaderBookmarkCapture(anchor: anchor, presentation: presentation) }
    public func matchesVersion(of book: LocalBook) -> Bool {
        sourceVersion == book.sourceVersion && contentVersion == book.cloud?.contentVersion
    }
    public func isValid(in book: LocalBook) -> Bool {
        guard matchesVersion(of: book),
              let chapter = book.chapters.first(where: { $0.id == anchor.chapterID }),
              let passage = chapter.passages.first(where: { $0.id == anchor.passageID }),
              anchor.characterOffset >= 0, anchor.characterOffset <= passage.text.unicodeScalars.count,
              anchor.pageY?.isFinite != false, anchor.resourceY?.isFinite != false else { return false }
        if let presentation, !presentation.isStructurallyValid || book.kind == .pdf || anchor.pageY != nil || anchor.resourceY != nil { return false }
        if anchor.pageY != nil, book.kind != .pdf { return false }
        if let y = anchor.resourceY {
            guard (0...1).contains(y), passage.resourcePath != nil, book.kind != .pdf, anchor.pageY == nil, anchor.characterOffset == 0 else { return false }
        }
        return true
    }
}

public enum BookmarkSaveResult: Equatable, Sendable {
    case saved(UUID), existing(UUID), failed(String), unavailable(String)
    public var succeeded: Bool { switch self { case .saved, .existing: true; case .failed, .unavailable: false } }
    public var message: String {
        switch self {
        case .saved: "书签已保存"
        case .existing: "此位置已有书签"
        case .failed(let reason), .unavailable(let reason): reason
        }
    }
}

/// Exact source interval in a real viewport, including long paragraphs and image/PDF geometry.
public struct ReaderBookmarkVisibleRange: Equatable, Sendable {
    public let start: ReadingAnchor
    public let end: ReadingAnchor
    public let presentation: ReaderBookmarkPresentation?
    public let displayEndOffset: Int?
    public init(start: ReadingAnchor, end: ReadingAnchor, presentation: ReaderBookmarkPresentation? = nil, displayEndOffset: Int? = nil) {
        self.start = start; self.end = end; self.presentation = presentation; self.displayEndOffset = displayEndOffset
    }
    public var capture: ReaderBookmarkCapture { ReaderBookmarkCapture(anchor: start, presentation: presentation) }
    public func contains(_ bookmark: ReaderBookmark) -> Bool {
        guard bookmark.anchor.chapterID == start.chapterID, bookmark.anchor.passageID == start.passageID else { return false }
        if let presentation, let saved = bookmark.presentation, let end = displayEndOffset {
            return presentation.snapshotKey == saved.snapshotKey && saved.utf16Offset >= presentation.utf16Offset && saved.utf16Offset <= end
        }
        guard presentation == nil, bookmark.presentation == nil else { return false }
        return contains(bookmark.anchor)
    }
    public func contains(_ anchor: ReadingAnchor) -> Bool {
        guard presentation == nil else { return false }
        guard anchor.chapterID == start.chapterID, anchor.passageID == start.passageID,
              end.chapterID == start.chapterID, end.passageID == start.passageID else { return false }
        if let y = anchor.pageY, let first = start.pageY, let last = end.pageY { return y >= min(first, last) - 1 && y <= max(first, last) + 1 }
        if let y = anchor.resourceY, let first = start.resourceY, let last = end.resourceY { return y >= min(first, last) - 0.001 && y <= max(first, last) + 0.001 }
        guard anchor.pageY == nil, anchor.resourceY == nil else { return false }
        return anchor.characterOffset >= min(start.characterOffset, end.characterOffset) && anchor.characterOffset <= max(start.characterOffset, end.characterOffset)
    }
}

public enum ReaderBookmarkPullFeedback: Equatable, Sendable { case idle, pulling, armed }

/// Presentation only. Moving the paper never changes its layout or saved anchor.
public struct ReaderBookmarkPullVisual: Equatable, Sendable {
    public let feedback: ReaderBookmarkPullFeedback
    public let progress: Double
    public let displacement: Double
    public static let idle = Self(feedback: .idle, progress: 0, displacement: 0)
    public init(feedback: ReaderBookmarkPullFeedback, progress: Double, displacement: Double) {
        self.feedback = feedback; self.progress = progress; self.displacement = displacement
    }
}

/// One touch sequence, with hysteresis and no commit before release.
public struct ReaderBookmarkPullState: Sendable {
    private var eligible = false
    private var peak = 0.0
    public private(set) var feedback: ReaderBookmarkPullFeedback = .idle
    public private(set) var visual: ReaderBookmarkPullVisual = .idle
    public init() {}
    public mutating func begin(eligible: Bool) { cancel(); self.eligible = eligible }
    @discardableResult public mutating func change(down: Double, across: Double) -> ReaderBookmarkPullFeedback {
        guard eligible else { return .idle }
        guard down.isFinite, across.isFinite else { cancel(); return .idle }
        // A deliberate reversal or horizontal departure cancels this touch;
        // it cannot accidentally rearm while the finger is still returning.
        guard down >= 0, peak - down <= 18, down < 12 || down > abs(across) * 1.6 else { cancel(); return .idle }
        peak = max(peak, down)
        if down >= 72 { feedback = .armed }
        else if down < 56 || feedback != .armed { feedback = .pulling }
        let distance = max(0, down)
        let displacement = 112 * (1 - 1 / (1 + distance * 0.55 / 112))
        visual = ReaderBookmarkPullVisual(feedback: feedback, progress: min(1, distance / 72), displacement: displacement)
        return feedback
    }
    public mutating func end() -> Bool { let committed = eligible && feedback == .armed; cancel(); return committed }
    public mutating func cancel() { eligible = false; peak = 0; feedback = .idle; visual = .idle }
}
