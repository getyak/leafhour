import Foundation

/// Read-only presentation of the existing records. No inferred dates or time.
public enum ReadingJournal {
    public struct Interval: Sendable {
        public let bookID: String
        public let start: Date
        public let end: Date
        public init(bookID: String, start: Date, end: Date) { self.bookID = bookID; self.start = start; self.end = end }
    }
    public struct Note: Identifiable, Sendable {
        public let id: String
        public let bookID: String
        public let title: String
        public let text: String
        public let quote: String
        public let attribution: String
        public let quoteAttribution: String
        public let date: Date?
        public let anchor: ReadingAnchor?
        public let passageID: String?
        public let contentVersion: String?
        public let kind: String
        public var isDraft: Bool { kind == "draft" }
        public func matches(_ query: String) -> Bool {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            return q.isEmpty || [title, text, quote].contains { $0.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        }
    }
    public static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    public static func monthKey(_ date: Date, calendar: Calendar = .current) -> String { String(dayKey(date, calendar: calendar).prefix(7)) }
    public static func lastSevenDays(ending date: Date, calendar: Calendar = .current) -> [Date] {
        let end = calendar.startOfDay(for: date)
        return (-6...0).compactMap { calendar.date(byAdding: .day, value: $0, to: end) }
    }
    public static func monthDays(_ date: Date, calendar: Calendar = .current) -> [Date] {
        guard let interval = calendar.dateInterval(of: .month, for: date), let range = calendar.range(of: .day, in: .month, for: date) else { return [] }
        return range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: interval.start) }
    }
    public static func seconds(_ intervals: [Interval], on date: Date, bookID: String? = nil, calendar: Calendar = .current) -> Int {
        guard let day = calendar.dateInterval(of: .day, for: date) else { return 0 }
        let rows = intervals.filter { bookID == nil || $0.bookID == bookID }.compactMap { row -> DateInterval? in
            let start = max(row.start, day.start), end = min(row.end, day.end)
            return end > start ? DateInterval(start: start, end: end) : nil
        }.sorted { $0.start < $1.start }
        var total: Int64 = 0, current: DateInterval?
        func milliseconds(_ row: DateInterval) -> Int64 { Int64((row.end.timeIntervalSince1970 * 1000).rounded()) - Int64((row.start.timeIntervalSince1970 * 1000).rounded()) }
        for row in rows {
            if let previous = current {
                if row.start <= previous.end { current = DateInterval(start: previous.start, end: max(previous.end, row.end)) }
                else { total += milliseconds(previous); current = row }
            } else { current = row }
        }
        if let current { total += milliseconds(current) }
        return Int(total / 1000)
    }
    public static func validateMonth(_ value: CloudJSON, month: String, calendar: Calendar = .current) throws {
        guard value["month"].string == month, value["timeZone"].string == calendar.timeZone.identifier,
              let first = value["days"].array.first?["date"].string, first == month + "-01" else { throw LibraryError.invalid("这份阅读日历尚未完整，请重新读取。") }
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = calendar.timeZone; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: first) else { throw LibraryError.invalid("阅读日期暂时无法核对。") }
        let expected = monthDays(start, calendar: calendar).map { dayKey($0, calendar: calendar) }
        let lengths = Dictionary(uniqueKeysWithValues: monthDays(start, calendar: calendar).map { (dayKey($0, calendar: calendar), calendar.dateInterval(of: .day, for: $0)?.duration ?? 86400) })
        guard value["days"].array.compactMap({ $0["date"].string }) == expected,
              value["days"].array.allSatisfy({ day in
                  guard let n = day["durationSeconds"].number else { return false }
                  guard let key = day["date"].string, let maximum = lengths[key], case .array = day["books"] else { return false }
                  return n.isFinite && n >= 0 && n <= maximum && day["books"].array.allSatisfy { book in
                      guard let seconds = book["durationSeconds"].number, book["bookId"].string != nil else { return false }
                      return seconds.isFinite && seconds >= 0 && seconds <= maximum
                  }
              }) else { throw LibraryError.invalid("阅读日历的时间记录尚未完整。") }
    }
    public static func cloudNotes(_ entries: [CloudJSON]) -> [Note] {
        var seen = Set<String>()
        return entries.flatMap { entry -> [Note] in
            guard let bookID = entry["book"]["bookId"].string else { return [] }
            return [("note", "comments"), ("question", "questions"), ("highlight", "highlights")].flatMap { kind, field -> [Note] in
                entry["records"][field].array.compactMap { row -> Note? in
                    guard row["deletedAt"] == .null, let rawID = row["id"].string else { return nil }
                    let text = row["text"].string ?? "", quote = row["quote"].string ?? row["parts"].array.compactMap { $0["text"].string }.joined(separator: "\n\n")
                    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !quote.isEmpty else { return nil }
                    let id = bookID + ":" + kind + ":" + rawID
                    guard seen.insert(id).inserted else { return nil }
                    let origin = row["origin"].string
                    let attribution = origin == "assistant" ? "AI 内容" : origin == "user" ? (kind == "question" ? "我的提问" : kind == "highlight" ? "我的摘录" : "我的笔记") : "来源未标注"
                    let q = row["quoteOrigin"].string
                    let anchor: ReadingAnchor? = row["chapterId"].string.flatMap { chapter in row["passageId"].string.map { ReadingAnchor(chapterID: chapter, passageID: $0) } }
                    return Note(id: id, bookID: bookID, title: CloudShelfBook.title(entry["book"]["title"]), text: text, quote: quote, attribution: attribution, quoteAttribution: q == "original" ? "作者原文" : q == "translation" ? "译文引用" : "引用 · 来源未标注", date: ReadingRecency.date(row["createdAt"].string), anchor: anchor, passageID: row["passageId"].string ?? row["parts"].array.first?["passageId"].string, contentVersion: row["contentVersion"].string ?? entry["records"]["contentVersion"].string ?? entry["book"]["contentVersion"].string, kind: kind)
                }
            }
        }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }
    public static func localNotes(book: LocalBook, state: ReaderState) -> [Note] {
        let notes = state.notes.map { note in
            Note(id: book.id + ":note:" + note.id.uuidString, bookID: book.id, title: book.title, text: note.body, quote: note.quote, attribution: "我的笔记", quoteAttribution: note.quoteOrigin == "translation" ? "译文引用" : note.quoteOrigin == "original" ? "作者原文" : "引用 · 来源未标注", date: note.modifiedAt, anchor: note.anchor, passageID: note.anchor.passageID, contentVersion: book.sourceVersion, kind: "note")
        }
        let drafts = state.drafts.values.filter { !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map { draft in
            Note(id: book.id + ":draft:" + draft.id, bookID: book.id, title: book.title, text: draft.body, quote: draft.quote, attribution: "未提交的草稿", quoteAttribution: draft.quoteOrigin == "translation" ? "译文引用" : draft.quoteOrigin == "original" ? "作者原文" : "引用 · 来源未标注", date: nil, anchor: draft.anchor, passageID: draft.anchor.passageID, contentVersion: book.sourceVersion, kind: "draft")
        }
        return drafts.sorted { $0.id < $1.id } + notes.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
    }
    public static func duration(_ seconds: Int) -> String {
        if seconds <= 0 { return "0 分钟" }
        if seconds < 60 { return "少于 1 分钟" }
        if seconds < 3600 { return "\(seconds / 60) 分钟" }
        return "\(seconds / 3600) 小时 \(seconds % 3600 / 60) 分"
    }
}
