import XCTest
@testable import LeafhourCore

final class ReadingJournalTests: XCTestCase {
    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Shanghai")!; return c }
    private func date(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }

    func testSevenDaysCrossMonthAndKeepAnExplicitZeroDay() {
        let days = ReadingJournal.lastSevenDays(ending: date("2026-11-02T12:00:00Z"), calendar: calendar)
        XCTAssertEqual(days.map { ReadingJournal.dayKey($0, calendar: calendar) }, ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
    }

    func testLocalIntervalsUnionAcrossBooksAndSplitAtLocalMidnight() {
        let rows = [ReadingJournal.Interval(bookID: "a", start: date("2026-11-01T15:50:00Z"), end: date("2026-11-01T16:10:00Z")), ReadingJournal.Interval(bookID: "b", start: date("2026-11-01T16:00:00Z"), end: date("2026-11-01T16:20:00Z"))]
        XCTAssertEqual(ReadingJournal.seconds(rows, on: date("2026-11-01T12:00:00Z"), calendar: calendar), 600)
        XCTAssertEqual(ReadingJournal.seconds(rows, on: date("2026-11-02T12:00:00Z"), calendar: calendar), 1200)
        XCTAssertEqual(ReadingJournal.seconds(rows, on: date("2026-11-02T12:00:00Z"), bookID: "a", calendar: calendar), 600)
    }

    func testCloudNotesKeepBookIdentityAttributionAndUnknownDates() throws {
        let entries: [CloudJSON] = [.object(["book": .object(["bookId": .string("a"), "title": .string("A")]), "records": .object(["contentVersion": .string("v1"), "comments": .array([.object(["id": .string("same"), "origin": .string("assistant"), "text": .string("AI words"), "quote": .string("translated"), "quoteOrigin": .string("translation")])])])]), .object(["book": .object(["bookId": .string("b"), "title": .string("B")]), "records": .object(["comments": .array([.object(["id": .string("same"), "origin": .string("user"), "text": .string("My words")]), .object(["id": .string("gone"), "text": .string("Deleted"), "deletedAt": .string("2026-11-01")])])])])]
        let notes = ReadingJournal.cloudNotes(entries)
        XCTAssertEqual(notes.count, 2)
        XCTAssertEqual(Set(notes.map(\.id)).count, 2)
        XCTAssertNil(notes.first?.date)
        let ai = try XCTUnwrap(notes.first(where: { $0.bookID == "a" }))
        XCTAssertEqual(ai.attribution, "AI 内容")
        XCTAssertEqual(ai.quoteAttribution, "译文引用")
        XCTAssertEqual(ai.contentVersion, "v1")
    }

    func testMonthlyResponseRejectsMissingDaysAndNegativeTime() throws {
        XCTAssertThrowsError(try ReadingJournal.validateMonth(.object(["books": .array([])]), month: "2026-11", calendar: calendar))
        let invalid: CloudJSON = .object(["month": .string("2026-11"), "days": .array([.object(["date": .string("2026-11-01"), "durationSeconds": .number(-1)])])])
        XCTAssertThrowsError(try ReadingJournal.validateMonth(invalid, month: "2026-11", calendar: calendar))
    }
    func testDSTDayUsesActualCalendarBoundaries() {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "America/New_York")!
        let day = date("2026-11-01T12:00:00Z")
        let rows = [ReadingJournal.Interval(bookID: "a", start: date("2026-11-01T04:00:00Z"), end: date("2026-11-02T05:00:00Z"))]
        XCTAssertEqual(ReadingJournal.seconds(rows, on: day, calendar: c), 25 * 3600)
    }
    func testFractionalIntervalsUseTheSameMillisecondRoundingAsStoredRecords() {
        let base = date("2026-11-02T00:00:00Z")
        let rows = (0..<150).map { i in ReadingJournal.Interval(bookID: "a", start: base.addingTimeInterval(Double(i)), end: base.addingTimeInterval(Double(i) + 0.4)) }
        XCTAssertEqual(ReadingJournal.seconds(rows, on: base, calendar: calendar), 60)
    }
    func testCloudMonthAcceptsTheActualLengthOfAFallBackDay() throws {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "America/New_York")!
        let day = date("2026-11-01T12:00:00Z")
        let days = ReadingJournal.monthDays(day, calendar: c).map { value in CloudJSON.object(["date": .string(ReadingJournal.dayKey(value, calendar: c)), "durationSeconds": .number(c.isDate(value, inSameDayAs: day) ? 90000 : 0), "books": .array([])]) }
        XCTAssertNoThrow(try ReadingJournal.validateMonth(.object(["month": .string("2026-11"), "timeZone": .string(c.timeZone.identifier), "days": .array(days)]), month: "2026-11", calendar: c))
    }
    func testCloudNoteWithOnlyPassageIDKeepsItsVerifiedVersionForSourceResolution() {
        let row: CloudJSON = .object([
            "book": .object(["bookId": .string("b"), "title": .string("Book")]),
            "records": .object([
                "contentVersion": .string("v1"),
                "comments": .array([.object(["id": .string("n"), "origin": .string("user"), "text": .string("Thought"), "passageId": .string("p2")])])
            ])
        ])
        let note = ReadingJournal.cloudNotes([row]).first
        XCTAssertEqual(note?.passageID, "p2")
        XCTAssertNil(note?.anchor)
        XCTAssertEqual(note?.contentVersion, "v1")
    }
}
