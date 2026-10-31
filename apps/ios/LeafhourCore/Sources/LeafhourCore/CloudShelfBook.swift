import Foundation

public struct CloudShelfBook: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var author: String
    public var contentVersion: String
    public var coverPath: String? = nil
    public var addedAt: Date? = nil
    public var resume: CloudShelfResume? = nil
    public var journey: CloudShelfJourney? = nil
    public var lastReadAt: Date? = nil
    public var shelfPosition: Int? = nil
    public var pinned: Bool? = nil
    public var readingStateReady: Bool? = nil
    public init(id: String, title: String, author: String, contentVersion: String, coverPath: String? = nil, addedAt: Date? = nil) {
        self.id = id; self.title = title; self.author = author; self.contentVersion = contentVersion
        self.coverPath = coverPath.flatMap { CloudCoverPath.isAllowed($0) ? $0 : nil }
        self.addedAt = addedAt
    }
    public init?(json: CloudJSON) {
        guard let id = json["bookId"].string, let version = json["contentVersion"].string else { return nil }
        let legacyCover = json["visibility"].string == "private" && ["epub", "pdf"].contains(json["source"]["format"].string ?? "")
            ? "/api/library/books/" + CloudJSON.component(id) + "/cover?v=" + CloudJSON.component(json["source"]["sha256"].string ?? version) : nil
        let addedAt = Self.date(json["addedAt"].string) ?? (json["visibility"].string == "private" ? Self.date(json["createdAt"].string) : nil)
        self.init(id: id, title: Self.title(json["title"]), author: json["author"].string ?? "", contentVersion: version, coverPath: json["coverImage"].string ?? legacyCover, addedAt: addedAt)
        resume = CloudShelfResume(json["resume"])
        journey = CloudShelfJourney(json["journey"])
        lastReadAt = Self.date(json["lastReadAt"].string)
        shelfPosition = json["shelfPosition"].number.flatMap { $0 >= 0 && $0.rounded() == $0 && $0 < 1000 ? Int($0) : nil }
        pinned = json["pinned"].boolean
        readingStateReady = json["readingStateReady"].boolean
    }
    public var activityAt: Date? { ReadingRecency.maximum([lastReadAt, resume?.activityAt, journey?.lastReadAt]) }
    public var readingStatus: CloudBookReadingStatus {
        guard readingStateReady == true else { return .pending }
        if journey?.status == "finished" { return .finished }
        return resume != nil || activityAt != nil || (journey?.completedChapters ?? 0) > 0 ? .reading : .unread
    }
    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    public static func title(_ json: CloudJSON) -> String { json.string ?? json["zh"].string ?? json["en"].string ?? json.object.values.compactMap(\.string).first ?? "未命名书籍" }
}
