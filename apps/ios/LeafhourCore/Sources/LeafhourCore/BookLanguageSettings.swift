import Foundation
import NaturalLanguage

public enum ReadingLanguage: String, Codable, CaseIterable, Sendable {
    case zh, en, ja, ko, fr, de, es
    public var title: String {
        switch self {
        case .zh: "中文"; case .en: "English"; case .ja: "日本語"; case .ko: "한국어"
        case .fr: "Français"; case .de: "Deutsch"; case .es: "Español"
        }
    }
    public static func detect(in book: LocalBook) -> Self? {
        var sample = ""
        for chapter in book.chapters.prefix(4) {
            for passage in chapter.passages.prefix(12) where !passage.heading {
                sample += String(passage.text.prefix(1000)) + "\n"
                if sample.count >= 4000 { break }
            }
            if sample.count >= 4000 { break }
        }
        guard !sample.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let recognizer = NLLanguageRecognizer(); recognizer.processString(String(sample.prefix(4000)))
        return recognizer.dominantLanguage.flatMap { Self(rawValue: $0.rawValue.split(separator: "-").first.map(String.init) ?? "") }
    }
}

/// Saved with one book's state, never copied into the profile typography file.
public struct BookTranslationSettings: Codable, Equatable, Sendable {
    public var sourceLanguage: ReadingLanguage?
    public var targetLanguage: ReadingLanguage
    public init(sourceLanguage: ReadingLanguage? = nil, targetLanguage: ReadingLanguage = .en) {
        self.sourceLanguage = sourceLanguage; self.targetLanguage = targetLanguage
    }
    public static func suggested(for detected: ReadingLanguage?) -> Self { Self(targetLanguage: .en) }
    /// An absent per-book setting used this rule before defaults were versioned.
    public static func legacySuggested(for detected: ReadingLanguage?) -> Self { Self(targetLanguage: detected == .zh ? .en : .zh) }
    public func resolvedSource(detected: ReadingLanguage?) -> ReadingLanguage? { sourceLanguage ?? detected }
    public func isValid(detected: ReadingLanguage?) -> Bool {
        guard let source = resolvedSource(detected: detected) else { return false }
        return source != targetLanguage
    }
}

/// Accepts a target language, never arbitrary instructions or a guessed fallback.
public enum ReadingTargetIntent {
    public static func parse(_ input: String) throws -> ReadingLanguage {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        guard !value.isEmpty, value.unicodeScalars.count <= 80 else { throw LibraryError.invalid("请写一种目标语言，例如 English 或日语。") }
        for prefix in ["翻译成", "翻譯成", "翻译为", "翻譯為", "译成", "譯成", "翻成", "translate into ", "translate to "] {
            if value.hasPrefix(prefix) { value = String(value.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines); break }
        }
        let names: [String: ReadingLanguage] = [
            "en": .en, "english": .en, "英语": .en, "英語": .en, "英文": .en,
            "zh": .zh, "chinese": .zh, "中文": .zh, "汉语": .zh, "漢語": .zh,
            "ja": .ja, "japanese": .ja, "日本語": .ja, "日文": .ja, "日语": .ja, "日語": .ja,
            "ko": .ko, "korean": .ko, "한국어": .ko, "韩文": .ko, "韩语": .ko, "韓語": .ko,
            "fr": .fr, "french": .fr, "francais": .fr, "法语": .fr, "法語": .fr, "法文": .fr,
            "de": .de, "german": .de, "deutsch": .de, "德语": .de, "德語": .de, "德文": .de,
            "es": .es, "spanish": .es, "espanol": .es, "西班牙语": .es, "西班牙語": .es, "西班牙文": .es
        ]
        guard let language = names[value] else { throw LibraryError.invalid("请写一种支持的目标语言：英文、中文、日语、韩语、法语、德语或西班牙语。") }
        return language
    }
}

public enum ReaderFirstLineIndent: String, Codable, CaseIterable, Sendable {
    case none, twoCharacters
    public var title: String { self == .none ? "不缩进" : "两字" }
}

public enum ReaderParagraphPresentation {
    /// Only TXT's visual paragraph padding is hidden. Source offsets include it.
    public static func leadingIndentUTF16(_ text: String, kind: BookKind, heading: Bool) -> Int {
        guard kind == .txt, !heading else { return 0 }
        return text.unicodeScalars.prefix { $0 == " " || $0 == "\t" || $0 == "　" }.reduce(0) { $0 + ($1.value > 0xffff ? 2 : 1) }
    }
}
