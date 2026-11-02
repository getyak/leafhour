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
    public init(sourceLanguage: ReadingLanguage? = nil, targetLanguage: ReadingLanguage = .zh) {
        self.sourceLanguage = sourceLanguage; self.targetLanguage = targetLanguage
    }
    public static func suggested(for detected: ReadingLanguage?) -> Self { Self(targetLanguage: detected == .zh ? .en : .zh) }
    public func resolvedSource(detected: ReadingLanguage?) -> ReadingLanguage? { sourceLanguage ?? detected }
    public func isValid(detected: ReadingLanguage?) -> Bool {
        guard let source = resolvedSource(detected: detected) else { return false }
        return source != targetLanguage
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
