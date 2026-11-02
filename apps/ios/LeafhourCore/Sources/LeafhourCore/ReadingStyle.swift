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

/// Installed fonts only. Automatic keeps the Latin face paired with the Chinese style.
public enum ReaderLatinFont: String, Codable, CaseIterable, Sendable {
    case automatic, georgia, palatino, baskerville, charter, system, rounded
    public var title: String {
        switch self {
        case .automatic: "自动搭配"
        case .georgia: "Georgia"
        case .palatino: "Palatino"
        case .baskerville: "Baskerville"
        case .charter: "Charter"
        case .system: "System Sans"
        case .rounded: "System Rounded"
        }
    }
}

public enum ReaderPaper: String, CaseIterable, Sendable {
    case paper, white, sage, mist, sand, rose, dusk, night, system
    public var title: String {
        switch self {
        case .paper: "暖纸"; case .white: "纯白"; case .sage: "青苔"
        case .mist: "雾蓝"; case .sand: "麦色"; case .rose: "浅杏"
        case .dusk: "暮色"; case .night: "夜读"; case .system: "系统"
        }
    }
    public var isDark: Bool { self == .night || self == .dusk }
}
