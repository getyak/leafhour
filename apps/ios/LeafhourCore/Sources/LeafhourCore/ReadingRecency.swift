import Foundation

public enum ReadingRecency {
    public struct Candidate: Equatable, Sendable {
        public let id: String
        public let activityAt: Date?
        public init(id: String, activityAt: Date?) { self.id = id; self.activityAt = activityAt }
    }
    public static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = formatter.date(from: value) ?? { formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value) }()
        return parsed.flatMap { $0.timeIntervalSince1970.isFinite ? $0 : nil }
    }
    public static func maximum(_ values: [Date?]) -> Date? { values.compactMap { $0 }.filter { $0.timeIntervalSince1970.isFinite }.max() }
    public static func latest(_ candidates: [Candidate]) -> Candidate? {
        candidates.filter { $0.activityAt?.timeIntervalSince1970.isFinite == true }.sorted {
            $0.activityAt == $1.activityAt ? $0.id < $1.id : $0.activityAt! > $1.activityAt!
        }.first
    }
}

public enum CloudBookReadingStatus: String, Codable, Sendable { case unread, reading, finished, pending }
public struct CloudShelfResume: Codable, Equatable, Sendable {
    public var chapterID: String
    public var passageID: String
    public var revision: Int?
    public var label: String?
    public var updatedAt: Date?
    public var observedAt: Date?
    public var activityAt: Date? { observedAt ?? updatedAt }
    public var anchor: ReadingAnchor { ReadingAnchor(chapterID: chapterID, passageID: passageID) }
    init?(_ json: CloudJSON) {
        guard let chapter = json["chapterId"].string, let passage = json["passageId"].string else { return nil }
        chapterID = chapter; passageID = passage
        revision = json["revision"].number.flatMap { $0 >= 0 && $0 < Double(Int.max) ? Int($0) : nil }
        label = json["label"].string ?? json["chapterTitle"].string.flatMap { $0 } ?? json["chapterTitle"]["zh"].string ?? json["chapterTitle"]["en"].string
        updatedAt = ReadingRecency.date(json["updatedAt"].string); observedAt = ReadingRecency.date(json["observedAt"].string)
    }
}
public struct CloudShelfJourney: Codable, Equatable, Sendable {
    public var status: String
    public var finishedAt: Date?
    public var lastReadAt: Date?
    public var completedChapters: Int?
    init?(_ json: CloudJSON) {
        guard let value = json["status"].string else { return nil }
        status = value; finishedAt = ReadingRecency.date(json["finishedAt"].string); lastReadAt = ReadingRecency.date(json["lastReadAt"].string)
        completedChapters = json["completedChapters"].number.flatMap { $0 >= 0 && $0 < 100_000 ? Int($0) : nil }
    }
}
