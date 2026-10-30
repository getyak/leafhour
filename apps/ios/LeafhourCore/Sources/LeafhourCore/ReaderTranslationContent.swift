import Foundation

public enum ReaderTextMode: String, Codable, Sendable { case original, translation, parallel }
public enum ReaderTranslationVariant: String, Codable, Sendable { case literal, interpretive }

public struct ReaderTranslationValue: Equatable, Sendable {
    public let text: String
    public let status: String
    public let sourceVersion: String
    public var displayVersion: String { Disk.hash(Data((sourceVersion + "\u{0}" + text).utf8)) }
    public init(text: String, status: String, sourceVersion: String) { self.text = text; self.status = status; self.sourceVersion = sourceVersion }
}

extension ReaderSession {
    /// Only an exact current-source receipt may change the display overlay.
    /// Source passages and the reading checkpoint remain untouched.
    @discardableResult public func adoptTranslation(_ paragraph: CloudJSON, contentVersion: String) -> Bool {
        guard book.cloud?.contentVersion == contentVersion,
              let id = paragraph["id"].string,
              let passage = book.chapters.lazy.flatMap({ $0.passages }).first(where: { $0.id == id }),
              paragraph["original"].string == passage.text else { return false }
        var values = translations[id] ?? [:]
        let previous = values
        for variant in [ReaderTranslationVariant.literal, .interpretive] {
            let row = paragraph["translations"][variant.rawValue]
            guard let text = row["text"].string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  row["sourceVersion"].string == nil || row["sourceVersion"].string == contentVersion else { continue }
            let status = row["status"].string ?? "draft"
            if values[variant]?.status == "reviewed", status != "reviewed" { continue }
            values[variant] = ReaderTranslationValue(text: text, status: status, sourceVersion: contentVersion)
        }
        guard !values.isEmpty, values != previous else { return false }
        translations[id] = values; translationRevision += 1
        return true
    }

    public func adoptCachedTranslations(_ content: CloudJSON) {
        guard let version = book.cloud?.contentVersion, content["contentVersion"].string == version else { return }
        for section in content["sections"].array {
            for paragraph in section["paragraphs"].array { adoptTranslation(paragraph, contentVersion: version) }
        }
    }
}
