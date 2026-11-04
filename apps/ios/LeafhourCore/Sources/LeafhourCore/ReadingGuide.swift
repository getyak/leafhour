import Foundation

public struct ReadingGuideContext: Codable, Equatable, Sendable {
    public struct Chapter: Codable, Equatable, Sendable { public let id: String; public let title: String }
    public struct Sample: Codable, Equatable, Sendable { public let id: String; public let chapterId: String; public var original: String }
    public let title: String
    public let author: String
    public var chapters: [Chapter]
    public var passages: [Sample]
    private static func label(_ source: String, maximumScalars: Int) -> String {
        var result = "", count = 0
        for character in source {
            let cost = character.unicodeScalars.count
            guard count + cost <= maximumScalars else { break }
            result.append(character); count += cost
        }
        return result
    }

    public static func make(book: LocalBook) throws -> ReadingGuideContext {
        var remaining = 6000, passages: [Sample] = []
        outer: for chapter in book.chapters {
            for passage in chapter.passages where !passage.heading && passage.resourcePath == nil {
                guard passages.count < 6, remaining > 0 else { break outer }
                // Prefix by Character to avoid breaking a combining sequence, counting scalars
                // for the wire contract. Never build an index of a very long paragraph.
                var original = "", used = 0
                for character in passage.text {
                    let count = character.unicodeScalars.count
                    guard used + count <= remaining else { break }
                    original.append(character); used += count
                }
                guard !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                passages.append(Sample(id: passage.id, chapterId: chapter.id, original: original)); remaining -= used
            }
        }
        guard !passages.isEmpty else { throw LibraryError.invalid("这份文件还没有可读取的文字。可以先阅读页面，识别文字后再准备前导。") }
        var value = ReadingGuideContext(title: label(book.title.isEmpty ? "未命名书籍" : book.title, maximumScalars: 500), author: label(book.author, maximumScalars: 500),
                                        chapters: book.chapters.prefix(24).map { Chapter(id: $0.id, title: label($0.title, maximumScalars: 200)) }, passages: passages)
        while try JSONEncoder().encode(value).count > 18000, !value.chapters.isEmpty { value.chapters.removeLast() }
        while try JSONEncoder().encode(value).count > 18000, !value.passages.isEmpty {
            let index = value.passages.count - 1
            value.passages[index].original = String(value.passages[index].original.dropLast(min(128, value.passages[index].original.count)))
            if value.passages[index].original.isEmpty { value.passages.removeLast() }
        }
        guard !value.passages.isEmpty else { throw LibraryError.invalid("开篇取样暂时无法准备，可以继续阅读。") }
        return value
    }
}

public struct ReadingGuide: Codable, Equatable, Sendable, Identifiable {
    public struct SampleRange: Codable, Equatable, Sendable {
        public let passageId: String
        public let chapterId: String
        public let charOffset: Int
        public let charEnd: Int
    }
    public let kind: String
    public let schemaVersion: Int
    public let id: String
    public let bookId: String
    public let contentVersion: String
    public let sourceKind: String
    public let locale: String
    public let origin: String
    public let status: String
    public let scope: String
    public let opening: String
    public let method: String
    public let readingQuestion: String
    public let sampleRanges: [SampleRange]
    public let model: String
    public let createdAt: String
    public var bookID: String { bookId }
    public var text: String { opening + "\n\n" + method + "\n\n" + readingQuestion }
    public var followUps: [ChatFollowUp] { ChatFollowUps.make(parentID: id, answer: text, question: readingQuestion) }
    public var isValid: Bool {
        kind == "leafhour-reading-guide" && schemaVersion == 1 && !id.isEmpty && origin == "ai" && status == "draft" && scope == "opening-sample"
            && !bookId.isEmpty && !contentVersion.isEmpty && ["zh-Hans", "zh-Hant", "en", "ja"].contains(locale)
            && ["cloud", "local-device"].contains(sourceKind) && !opening.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !method.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !readingQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && opening.unicodeScalars.prefix(1201).count <= 1200 && method.unicodeScalars.prefix(1201).count <= 1200 && readingQuestion.unicodeScalars.prefix(301).count <= 300
            && !model.isEmpty && !createdAt.isEmpty && !sampleRanges.isEmpty && sampleRanges.count <= 6
            && sampleRanges.allSatisfy { !$0.passageId.isEmpty && !$0.chapterId.isEmpty && $0.charOffset == 0 && $0.charEnd > 0 && $0.charEnd <= 6000 }
            && sampleRanges.reduce(0, { $0 + $1.charEnd }) <= 6000 && Set(sampleRanges.map(\.passageId)).count == sampleRanges.count
    }
}

public struct ReadingGuideRecord: Codable, Sendable {
    public let ownerID: String
    public let contentVersion: String
    public let locale: String
    public var guide: ReadingGuide?
    public var dismissed: Bool
    public var attempted: Bool
    public init(ownerID: String, contentVersion: String, locale: String, guide: ReadingGuide? = nil, dismissed: Bool = false, attempted: Bool = false) {
        self.ownerID = ownerID; self.contentVersion = contentVersion; self.locale = locale; self.guide = guide; self.dismissed = dismissed; self.attempted = attempted
    }
}

extension OfflineLibrary {
    private func readingGuideFile(bookID: String, ownerID: String, locale: String) throws -> URL {
        guard let owner = UUID(uuidString: ownerID), root.lastPathComponent == LibraryScope.account(owner).folder,
              ["zh-Hans", "zh-Hant", "en", "ja"].contains(locale) else { throw LibraryError.invalid("阅读前导不属于当前书房。") }
        return try bookDirectory(bookID).appendingPathComponent("reading-guide-" + locale + ".json")
    }
    public func readingGuideRecord(bookID: String, ownerID: String, contentVersion: String, locale: String) throws -> ReadingGuideRecord? {
        let file = try readingGuideFile(bookID: bookID, ownerID: ownerID, locale: locale)
        guard Disk.fm.fileExists(atPath: file.path) else { return nil }
        let record = try Disk.read(ReadingGuideRecord.self, from: file)
        guard record.ownerID == ownerID, record.contentVersion == contentVersion, record.locale == locale,
              record.guide == nil || record.guide?.isValid == true && record.guide?.contentVersion == contentVersion else { return nil }
        return record
    }
    public func saveReadingGuideRecord(_ record: ReadingGuideRecord, bookID: String) throws {
        try Task.checkCancellation()
        guard record.guide == nil || record.guide?.isValid == true && record.guide?.contentVersion == record.contentVersion else { throw LibraryError.invalid("阅读前导的版本无法核对。") }
        try Disk.write(record, to: readingGuideFile(bookID: bookID, ownerID: record.ownerID, locale: record.locale))
    }
}
