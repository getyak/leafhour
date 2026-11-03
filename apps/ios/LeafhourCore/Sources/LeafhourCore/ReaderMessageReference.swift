import Foundation

/// A conversation quotation is distinct from a book-source quotation. The
/// server resolves its ID in the authenticated conversation before accepting it.
public struct ReaderMessageReference: Codable, Equatable, Sendable {
    public let turnId: String
    public let role: String
    public let text: String
    public init(turnId: String, role: String, text: String) {
        self.turnId = turnId; self.role = role; self.text = text
    }
    public var authorLabel: String { role == "assistant" ? "松鼠" : "你" }
    public var messageKey: String { turnId + ":" + role }
}
