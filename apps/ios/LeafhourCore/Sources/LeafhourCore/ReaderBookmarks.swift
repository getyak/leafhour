import Foundation

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

/// A user-owned position, separate from notes, translations and reading progress.
public struct ReaderBookmark: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let sourceVersion: String
    public let contentVersion: String?
    public var anchor: ReadingAnchor
    public var name: String?
    public var color: BookmarkColor
    public let createdAt: Date
    public var modifiedAt: Date
    public init(id: UUID = UUID(), sourceVersion: String, contentVersion: String?, anchor: ReadingAnchor, name: String? = nil, color: BookmarkColor = .defaultColor, createdAt: Date = Date(), modifiedAt: Date? = nil) {
        self.id = id; self.sourceVersion = sourceVersion; self.contentVersion = contentVersion
        self.anchor = Self.normalized(anchor); self.name = Self.normalizedName(name); self.color = color
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
    public func matchesVersion(of book: LocalBook) -> Bool {
        sourceVersion == book.sourceVersion && contentVersion == book.cloud?.contentVersion
    }
    public func isValid(in book: LocalBook) -> Bool {
        guard matchesVersion(of: book),
              let chapter = book.chapters.first(where: { $0.id == anchor.chapterID }),
              let passage = chapter.passages.first(where: { $0.id == anchor.passageID }),
              anchor.characterOffset >= 0, anchor.characterOffset <= passage.text.unicodeScalars.count,
              anchor.pageY?.isFinite != false, anchor.resourceY?.isFinite != false else { return false }
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
    public init(start: ReadingAnchor, end: ReadingAnchor) { self.start = start; self.end = end }
    public func contains(_ anchor: ReadingAnchor) -> Bool {
        guard anchor.chapterID == start.chapterID, anchor.passageID == start.passageID,
              end.chapterID == start.chapterID, end.passageID == start.passageID else { return false }
        if let y = anchor.pageY, let first = start.pageY, let last = end.pageY { return y >= min(first, last) - 1 && y <= max(first, last) + 1 }
        if let y = anchor.resourceY, let first = start.resourceY, let last = end.resourceY { return y >= min(first, last) - 0.001 && y <= max(first, last) + 0.001 }
        guard anchor.pageY == nil, anchor.resourceY == nil else { return false }
        return anchor.characterOffset >= min(start.characterOffset, end.characterOffset) && anchor.characterOffset <= max(start.characterOffset, end.characterOffset)
    }
}

public enum ReaderBookmarkPullFeedback: Equatable, Sendable { case idle, pulling, armed }

/// One touch sequence, with hysteresis and no commit before release.
public struct ReaderBookmarkPullState: Sendable {
    private var eligible = false
    public private(set) var feedback: ReaderBookmarkPullFeedback = .idle
    public init() {}
    public mutating func begin(eligible: Bool) { self.eligible = eligible; feedback = .idle }
    @discardableResult public mutating func change(down: Double, across: Double) -> ReaderBookmarkPullFeedback {
        guard eligible, down.isFinite, across.isFinite else { return .idle }
        guard down > 0, down > abs(across) * 1.6 else { feedback = .pulling; return feedback }
        if down >= 72 { feedback = .armed }
        else if down < 56 || feedback != .armed { feedback = .pulling }
        return feedback
    }
    public mutating func end() -> Bool { let committed = eligible && feedback == .armed; cancel(); return committed }
    public mutating func cancel() { eligible = false; feedback = .idle }
}
