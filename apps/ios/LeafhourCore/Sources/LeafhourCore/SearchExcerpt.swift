import Foundation

/// A source-owned preview and destination derived from the same user-level search range.
public struct SearchExcerpt: Equatable, Sendable {
    public let before: String
    public let match: String
    public let after: String
    /// Unicode scalar offset, matching ReadingAnchor rather than UTF-16 or grapheme counts.
    public let characterOffset: Int

    public static func find(in text: String, query: String) -> SearchExcerpt? {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, let range = text.localizedStandardRange(of: query) else { return nil }
        // Foundation may end a diacritic-insensitive match before a combining mark.
        // Expand only the preview styling to whole characters; keep the exact search destination.
        let displayRange = (text as NSString).rangeOfComposedCharacterSequences(for: NSRange(range, in: text))
        guard let displayRange = Range(displayRange, in: text) else { return nil }
        let prefix = text[..<displayRange.lowerBound]
        let leadingContext = prefix.suffix(33)
        let suffix = text[displayRange.upperBound...].prefix(65)
        let matched = text[displayRange].prefix(97)
        let before = (leadingContext.count > 32 ? "…" : "") + String(leadingContext.suffix(32))
        let match = String(matched.prefix(96))
        let after = matched.count > 96 ? "…" : String(suffix.prefix(64)) + (suffix.count > 64 ? "…" : "")
        // Search summaries stay compact even when source files contain hard line breaks.
        // This presentation-only substitution does not change the source or destination.
        func singleLine(_ value: String) -> String { String(value.map { $0.isWhitespace ? " " : $0 }) }
        return SearchExcerpt(before: singleLine(before), match: singleLine(match), after: singleLine(after), characterOffset: text[..<range.lowerBound].unicodeScalars.count)
    }
}
