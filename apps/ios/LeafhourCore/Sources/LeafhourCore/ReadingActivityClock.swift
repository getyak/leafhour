import Foundation

public enum ReadingTimeSource: String, Codable, Sendable { case focus = "reader_focus", estimate = "reader_estimate" }
public enum ReadingTimePhase: String, Codable, Sendable { case idle, active, paused, finished }

enum ReadingTimeDate {
    static func stamp(_ date: Date) -> Date { Date(timeIntervalSince1970: floor(date.timeIntervalSince1970 * 1000) / 1000) }
    static func string(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value)
    }
    static func fail(_ message: String = "阅读时段尚未保存，原有记录已保留。") -> LibraryError { .invalid(message) }
}

public struct ReadingTimeSegment: Codable, Equatable, Sendable {
    public var startedAt: Date
    public var endedAt: Date
    public init(startedAt: Date, endedAt: Date) { self.startedAt = startedAt; self.endedAt = endedAt }
    static func union(_ rows: [Self]) -> [Self] {
        var result: [Self] = []
        for row in rows.filter({ $0.endedAt > $0.startedAt }).sorted(by: { $0.startedAt < $1.startedAt }) {
            if let last = result.last, row.startedAt <= last.endedAt { result[result.count - 1].endedAt = max(last.endedAt, row.endedAt) }
            else { result.append(row) }
        }
        return result
    }
    static func durationSeconds(_ rows: [Self]) -> Int {
        // The wire protocol has integer millisecond bounds (Date.parse in the
        // service). Round each Date interval to that precision before summing;
        // adding floating seconds can lose a whole second after many pauses.
        let milliseconds = union(rows).reduce(Int64(0)) { $0 + Int64(($1.endedAt.timeIntervalSince($1.startedAt) * 1000).rounded()) }
        return Int(milliseconds / 1000)
    }
}

public struct ReadingTimeSnapshot: Codable, Equatable, Sendable {
    public var id: String
    public var bookId: String
    public var contentVersion: String
    public var source: ReadingTimeSource
    public var sequence: Int
    public var status: ReadingTimePhase
    public var timeZone: String
    public var startedAt: Date
    public var endedAt: Date
    public var start: ReadingAnchor
    public var end: ReadingAnchor
    public var segments: [ReadingTimeSegment]
    public var durationSeconds: Int { ReadingTimeSegment.durationSeconds(segments) }
    func sameIdentity(as row: Self) -> Bool {
        id == row.id && bookId == row.bookId && contentVersion == row.contentVersion && source == row.source && startedAt == row.startedAt && timeZone == row.timeZone && start == row.start
    }
    func matches(_ row: Self) -> Bool { self == row }
    public func wireData() throws -> Data {
        func anchor(_ value: ReadingAnchor) -> CloudJSON { .object(["chapterId": .string(value.chapterID), "passageId": .string(value.passageID)]) }
        return try CloudJSON.encode(["id": .string(id), "bookId": .string(bookId), "contentVersion": .string(contentVersion), "source": .string(source.rawValue), "sequence": .number(Double(sequence)), "status": .string(status.rawValue), "timeZone": .string(timeZone), "startedAt": .string(ReadingTimeDate.string(startedAt)), "endedAt": .string(ReadingTimeDate.string(endedAt)), "start": anchor(start), "end": anchor(end), "durationSeconds": .number(Double(durationSeconds)), "segments": .array(segments.map { .object(["startedAt": .string(ReadingTimeDate.string($0.startedAt)), "endedAt": .string(ReadingTimeDate.string($0.endedAt))]) })])
    }
    public init(wireData: Data) throws {
        let value = try CloudJSON.decode(wireData)
        func anchor(_ value: CloudJSON) throws -> ReadingAnchor {
            guard let chapter = value["chapterId"].string, let passage = value["passageId"].string else { throw ReadingTimeDate.fail() }
            return ReadingAnchor(chapterID: chapter, passageID: passage)
        }
        guard let id = value["id"].string, let book = value["bookId"].string, let version = value["contentVersion"].string,
              let source = value["source"].string.flatMap(ReadingTimeSource.init), let phase = value["status"].string.flatMap(ReadingTimePhase.init),
              let sequence = value["sequence"].number, sequence.rounded() == sequence, (1...10_000_000).contains(sequence),
              let zone = value["timeZone"].string, TimeZone(identifier: zone) != nil,
              let started = ReadingTimeDate.parse(value["startedAt"].string), let ended = ReadingTimeDate.parse(value["endedAt"].string),
              case .array(let segments) = value["segments"] else { throw ReadingTimeDate.fail("书房尚未确认这次阅读，记录仍留在本机。") }
        self.init(id: id, bookId: book, contentVersion: version, source: source, sequence: Int(sequence), status: phase, timeZone: zone, startedAt: started, endedAt: ended, start: try anchor(value["start"]), end: try anchor(value["end"]), segments: try segments.map {
            guard let a = ReadingTimeDate.parse($0["startedAt"].string), let b = ReadingTimeDate.parse($0["endedAt"].string) else { throw ReadingTimeDate.fail() }
            return ReadingTimeSegment(startedAt: a, endedAt: b)
        })
        try validate()
        guard value["durationSeconds"].number == Double(durationSeconds) else { throw ReadingTimeDate.fail() }
    }
    init(id: String, bookId: String, contentVersion: String, source: ReadingTimeSource, sequence: Int, status: ReadingTimePhase, timeZone: String, startedAt: Date, endedAt: Date, start: ReadingAnchor, end: ReadingAnchor, segments: [ReadingTimeSegment]) {
        self.id = id; self.bookId = bookId; self.contentVersion = contentVersion; self.source = source; self.sequence = sequence; self.status = status; self.timeZone = timeZone; self.startedAt = startedAt; self.endedAt = endedAt; self.start = start; self.end = end; self.segments = segments
    }
    func validate() throws {
        guard !id.isEmpty, id.count <= 128, id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }),
              !bookId.isEmpty, !contentVersion.isEmpty, (1...10_000_000).contains(sequence), status != .idle,
              TimeZone(identifier: timeZone) != nil, endedAt >= startedAt, endedAt.timeIntervalSince(startedAt) <= 86400,
              segments.count <= 120, segments.allSatisfy({ $0.startedAt >= startedAt && $0.endedAt <= endedAt && $0.endedAt > $0.startedAt }),
              startedAt.timeIntervalSince1970.isFinite, endedAt.timeIntervalSince1970.isFinite,
              start.characterOffset == 0, end.characterOffset == 0, start.pageY == nil, end.pageY == nil, start.resourceY == nil, end.resourceY == nil,
              !start.chapterID.isEmpty, !start.passageID.isEmpty, !end.chapterID.isEmpty, !end.passageID.isEmpty else { throw ReadingTimeDate.fail() }
    }
}

/// Pure foreground sampling. The caller supplies time and trusted interactions;
/// constructing a clock or restoring a bookmark does not start a reading session.
public struct ReadingActivityClock: Sendable {
    private var row: ReadingTimeSnapshot?
    private var intervals: [ReadingTimeSegment] = []
    private var open: Date?
    private var lastObserved = Date.distantPast
    private var lastActivity = Date.distantPast
    private var lastTime = Date.distantPast
    private var visible = true
    private var wanted = false
    public init() {}
    public var phase: ReadingTimePhase { row == nil ? .idle : row!.status == .finished ? .finished : open == nil ? .paused : .active }
    public var source: ReadingTimeSource { row?.source ?? .focus }
    public var wantsRunning: Bool { wanted }
    public var durationSeconds: Int { ReadingTimeSegment.durationSeconds(currentIntervals(at: lastObserved)) }
    private mutating func time(_ date: Date) -> Date { let safe = date.timeIntervalSince1970.isFinite ? ReadingTimeDate.stamp(date) : lastTime; lastTime = max(lastTime, safe); return lastTime }
    private func idle(_ date: Date) -> Bool { source == .estimate && date.timeIntervalSince(lastActivity) >= 120 }
    private mutating func close(_ date: Date) {
        if let open, date > open { intervals = ReadingTimeSegment.union(intervals + [ReadingTimeSegment(startedAt: open, endedAt: date)]) }
        open = nil
    }
    private func currentIntervals(at date: Date) -> [ReadingTimeSegment] { ReadingTimeSegment.union(intervals + (open.map { [ReadingTimeSegment(startedAt: $0, endedAt: date)] } ?? [])) }
    public mutating func start(bookID: String, contentVersion: String, anchor: ReadingAnchor, source: ReadingTimeSource = .focus, timeZone: String = TimeZone.current.identifier, at date: Date, id: String = UUID().uuidString.lowercased()) throws {
        guard row == nil || phase == .finished, date.timeIntervalSince1970.isFinite, !bookID.isEmpty, !contentVersion.isEmpty, TimeZone(identifier: timeZone) != nil else { throw ReadingTimeDate.fail("请先结束这次阅读，再开始新的时段。") }
        let date = time(date), anchor = ReadingAnchor(chapterID: anchor.chapterID, passageID: anchor.passageID)
        row = ReadingTimeSnapshot(id: id, bookId: bookID, contentVersion: contentVersion, source: source, sequence: 0, status: .active, timeZone: timeZone, startedAt: date, endedAt: date, start: anchor, end: anchor, segments: [])
        intervals = []; open = visible ? date : nil; lastObserved = date; lastActivity = date; wanted = true
    }
    public mutating func tick(at date: Date) {
        let date = time(date); guard let row, row.status != .finished else { return }
        let bounded = min(date, row.startedAt.addingTimeInterval(86400))
        if open != nil, date.timeIntervalSince(lastObserved) > 5 { close(min(lastObserved, source == .estimate ? lastActivity.addingTimeInterval(120) : bounded)) }
        if open != nil, idle(bounded) { close(lastActivity.addingTimeInterval(120)) }
        lastObserved = bounded
        if date >= row.startedAt.addingTimeInterval(86400) { close(bounded); self.row?.endedAt = bounded; self.row?.status = .finished; wanted = false; return }
        if wanted && visible && !idle(date) && open == nil {
            if intervals.count >= 120 { self.row?.status = .finished; self.row?.endedAt = bounded; wanted = false }
            else { open = date }
        }
    }
    public mutating func setContext(_ anchor: ReadingAnchor) { if phase != .finished { row?.end = ReadingAnchor(chapterID: anchor.chapterID, passageID: anchor.passageID) } }
    public mutating func pause(at date: Date) { tick(at: date); wanted = false; close(lastObserved) }
    public mutating func resume(at date: Date) { guard row != nil, phase != .finished else { return }; tick(at: date); guard phase != .finished else { return }; wanted = true; lastActivity = lastObserved; tick(at: date) }
    public mutating func setVisible(_ value: Bool, at date: Date) { tick(at: date); visible = value; if !value { close(lastObserved) } else { tick(at: date) } }
    public mutating func interact(at date: Date) { guard visible, phase != .finished else { return }; tick(at: date); lastActivity = lastTime; tick(at: date) }
    public mutating func finish(at date: Date) -> ReadingTimeSnapshot? { tick(at: date); if row != nil && phase != .finished { close(lastObserved); row?.status = .finished; row?.endedAt = lastObserved; wanted = false }; return snapshot(at: date) }
    public mutating func snapshot(at date: Date) -> ReadingTimeSnapshot? {
        tick(at: date); guard var row else { return nil }
        row.sequence += 1; row.status = phase; if phase != .finished { row.endedAt = lastObserved }; row.segments = currentIntervals(at: row.endedAt); self.row = row; return row
    }
}
