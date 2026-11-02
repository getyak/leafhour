import Foundation

extension OfflineLibrary {
    private func languageCacheURL(_ bookID: String, _ language: ReadingLanguage) -> URL {
        root.appendingPathComponent("states/" + bookID + "-translations-" + language.rawValue + ".json")
    }
    func cachedLanguageTranslations(bookID: String, language: ReadingLanguage) throws -> [String: ReadingTranslation] {
        let book = try book(bookID)
        guard let identity = book.cloud else { return [:] }
        let content = try CloudJSON.decode(Data(contentsOf: bookDirectory(bookID).appendingPathComponent("cloud-content.json")))
        guard content["contentVersion"].string == identity.contentVersion else { throw LibraryError.invalid("离线译文版本无法核对。") }
        var rows: [String: CloudJSON] = [:]
        for row in content["sections"].array.flatMap({ $0["paragraphs"].array }) {
            guard let id = row["id"].string else { continue }
            var projected = row.object
            projected["translations"] = row["translationsByLanguage"][language.rawValue]
            rows[id] = .object(projected)
        }
        let file = languageCacheURL(bookID, language)
        func translations() -> [String: ReadingTranslation] { rows.compactMapValues { ReadingTranslation($0, targetLanguage: language) } }
        guard Disk.fm.fileExists(atPath: file.path) else { return translations() }
        let saved = try CloudJSON.decode(Data(contentsOf: file))
        guard saved["contentVersion"].string == identity.contentVersion else { return translations() }
        let sources = Dictionary(uniqueKeysWithValues: book.chapters.flatMap(\.passages).map { ($0.id, $0.text) })
        for (id, row) in saved["passages"].object where row["original"].string == sources[id] {
            var pair = rows[id]?["translations"].object ?? [:]
            for (variant, incoming) in row["translations"].object {
                let prior = pair[variant] ?? .null
                if prior["status"].string == "reviewed", incoming["status"].string != "reviewed" { continue }
                if let oldDate = prior["createdAt"].string, let newDate = incoming["createdAt"].string, oldDate > newDate { continue }
                pair[variant] = incoming
            }
            var merged = row.object; merged["translations"] = .object(pair); rows[id] = .object(merged)
        }
        return translations()
    }
    func cacheLanguageTranslations(_ passages: [CloudJSON], bookID: String, language: ReadingLanguage) throws {
        guard !passages.isEmpty else { return }
        let book = try book(bookID)
        guard let identity = book.cloud else { throw LibraryError.invalid("请先同步这本书。") }
        let sources = Dictionary(uniqueKeysWithValues: book.chapters.flatMap(\.passages).map { ($0.id, $0.text) })
        let file = languageCacheURL(bookID, language)
        let prior = Disk.fm.fileExists(atPath: file.path) ? try CloudJSON.decode(Data(contentsOf: file)) : .null
        var rows = prior["contentVersion"].string == identity.contentVersion ? prior["passages"].object : [:]
        var seen = Set<String>()
        for row in passages {
            guard let id = row["id"].string, seen.insert(id).inserted, sources[id] == row["original"].string,
                  !row["translations"].object.isEmpty,
                  row["translations"].object.values.allSatisfy({ $0["targetLanguage"].string == language.rawValue }) else {
                throw LibraryError.invalid("译文与当前原文或译入语言不一致，尚未缓存。")
            }
            var merged = rows[id]?["translations"].object ?? [:]
            for (variant, incoming) in row["translations"].object where ["literal", "interpretive"].contains(variant) {
                let old = merged[variant] ?? .null
                guard incoming["text"].string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else { continue }
                if old["status"].string == "reviewed", incoming["status"].string != "reviewed" { continue }
                if let oldDate = old["createdAt"].string, let newDate = incoming["createdAt"].string, oldDate > newDate { continue }
                merged[variant] = incoming
            }
            var object = row.object; object["translations"] = .object(merged); rows[id] = .object(object)
        }
        try JSONEncoder().encode(CloudJSON.object(["contentVersion": .string(identity.contentVersion), "passages": .object(rows)])).write(to: file, options: .atomic)
    }
}
