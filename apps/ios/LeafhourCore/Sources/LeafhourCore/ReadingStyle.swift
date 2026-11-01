import Foundation

public enum ReaderStylePreset: String, CaseIterable, Sendable {
    case classic, spacious, compact
    public var title: String {
        switch self { case .classic: "经典"; case .spacious: "舒展"; case .compact: "紧凑" }
    }
    public func applying(to preferences: ReaderPreferences) -> ReaderPreferences {
        var value = preferences
        switch self {
        case .classic: value.fontStyle = .serif; value.fontSize = 22; value.lineSpacing = 9
        case .spacious: value.fontStyle = .serif; value.fontSize = 26; value.lineSpacing = 13
        case .compact: value.fontStyle = .sans; value.fontSize = 20; value.lineSpacing = 6
        }
        return value
    }
    public static func matching(_ value: ReaderPreferences) -> Self? {
        allCases.first { preset in
            let candidate = preset.applying(to: value)
            return candidate.fontStyle == value.fontStyle && candidate.fontSize == value.fontSize && candidate.lineSpacing == value.lineSpacing
        }
    }
}

extension OfflineLibrary {
    public func readingPreferences() throws -> ReaderPreferences { try readerPreferences(legacy: nil) }
}
