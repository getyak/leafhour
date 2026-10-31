import XCTest
@testable import LeafhourCore

final class ReadingTimeTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_793_491_200)
    private let anchor = ReadingAnchor(chapterID: "chapter", passageID: "passage")
    private func start(_ clock: inout ReadingActivityClock, source: ReadingTimeSource = .estimate) throws {
        try clock.start(bookID: "book", contentVersion: "version", anchor: anchor, source: source, timeZone: "Asia/Singapore", at: base, id: "stable-session")
    }
    func testEstimateCountsOnlyObservedForegroundAndResumesAfterActualInteraction() throws {
        var clock = ReadingActivityClock()
        XCTAssertNil(clock.snapshot(at: base))
        try start(&clock)
        for second in 1...130 { clock.tick(at: base.addingTimeInterval(Double(second))) }
        XCTAssertEqual(clock.durationSeconds, 120)
        XCTAssertEqual(clock.phase, .paused)
        clock.interact(at: base.addingTimeInterval(140))
        clock.tick(at: base.addingTimeInterval(141))
        XCTAssertEqual(clock.durationSeconds, 121)
        clock.setVisible(false, at: base.addingTimeInterval(142))
        clock.tick(at: base.addingTimeInterval(200))
        XCTAssertEqual(clock.durationSeconds, 122)
        clock.setVisible(true, at: base.addingTimeInterval(201))
        clock.tick(at: base.addingTimeInterval(202))
        XCTAssertEqual(clock.durationSeconds, 123)
        clock.pause(at: base.addingTimeInterval(203))
        clock.interact(at: base.addingTimeInterval(204))
        XCTAssertEqual(clock.phase, .paused, "Interaction must not undo a manual pause")
    }
    func testSuspensionGapAndCheckpointRecoveryNeverInventElapsedTime() throws {
        var clock = ReadingActivityClock(); try start(&clock, source: .focus)
        clock.tick(at: base.addingTimeInterval(1))
        clock.tick(at: base.addingTimeInterval(30))
        clock.tick(at: base.addingTimeInterval(31))
        let row = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(31)))
        XCTAssertEqual(row.durationSeconds, 2)
        XCTAssertEqual(row.segments.count, 2)
        var ledger = ReadingTimeLedger(ownerID: "owner", bookID: "local", contentVersion: "version")
        try ledger.retain(row)
        ledger.recoverInterrupted()
        XCTAssertEqual(ledger.pending.first?.durationSeconds, 2)
        XCTAssertEqual(ledger.pending.first?.endedAt, row.endedAt)
        XCTAssertEqual(ledger.pending.first?.status, .finished)
        XCTAssertEqual(ledger.pending.first?.sequence, row.sequence + 1)
    }
    func testReceiptForEarlierSequenceCannotAcknowledgeNewerCheckpointOrAnotherOwner() throws {
        var clock = ReadingActivityClock(); try start(&clock)
        clock.tick(at: base.addingTimeInterval(1)); let first = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(1)))
        var ledger = ReadingTimeLedger(ownerID: "owner", bookID: "local", contentVersion: "version")
        try ledger.retain(first)
        clock.tick(at: base.addingTimeInterval(2)); let second = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(2)))
        try ledger.retain(second)
        XCTAssertThrowsError(try ledger.acknowledge(first, submitted: first, ownerID: "another"))
        try ledger.acknowledge(first, submitted: first, ownerID: "owner")
        XCTAssertEqual(ledger.pending, [second])
        var wrong = second; wrong.contentVersion = "other"
        XCTAssertThrowsError(try ledger.acknowledge(wrong, submitted: second, ownerID: "owner"))
        try ledger.acknowledge(second, submitted: second, ownerID: "owner")
        XCTAssertTrue(ledger.pending.isEmpty)
    }
    func testDeviceAndUnuploadedAccountHistoriesCanRetainMoreThanTwentySessions() throws {
        var clock = ReadingActivityClock(); try start(&clock)
        let row = try XCTUnwrap(clock.finish(at: base.addingTimeInterval(1)))
        for owner in [nil, "account-owner"] {
            var ledger = ReadingTimeLedger(ownerID: owner, bookID: "local", contentVersion: "version", cloudBound: false)
            for count in 0..<25 { var next = row; next.id = "local-\(count)"; try ledger.retain(next) }
            XCTAssertEqual(ledger.snapshots.count, 25)
        }
        var cloud = ReadingTimeLedger(ownerID: "account-owner", bookID: "local", contentVersion: "version", cloudBound: true)
        for count in 0..<20 { var next = row; next.id = "cloud-\(count)"; try cloud.retain(next) }
        var extra = row; extra.id = "cloud-21"
        XCTAssertThrowsError(try cloud.retain(extra))
        XCTAssertEqual(cloud.snapshots.count, 20)
    }
    func testIntegerMillisecondTotalsMatchServiceAtOneHundredTwentyIntervals() throws {
        var seed: UInt32 = 4, cursor = 0, totalMilliseconds = 0, intervals: [ReadingTimeSegment] = []
        func parsed(_ milliseconds: Int) -> Date { ReadingTimeDate.parse(ReadingTimeDate.string(base.addingTimeInterval(Double(milliseconds) / 1000)))! }
        for index in 0..<120 {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            var milliseconds = Int(seed % 1500) + 500
            if index == 119 { milliseconds += (1000 - (totalMilliseconds + milliseconds) % 1000) % 1000 + 1000 }
            intervals.append(ReadingTimeSegment(startedAt: parsed(cursor), endedAt: parsed(cursor + milliseconds)))
            totalMilliseconds += milliseconds; cursor += milliseconds + 97
        }
        let row = ReadingTimeSnapshot(id: "many-segments", bookId: "book", contentVersion: "version", source: .focus, sequence: 1, status: .finished, timeZone: "UTC", startedAt: intervals[0].startedAt, endedAt: intervals.last!.endedAt, start: anchor, end: anchor, segments: intervals)
        XCTAssertEqual(totalMilliseconds, 152000)
        XCTAssertEqual(row.durationSeconds, totalMilliseconds / 1000)
        var serviceReceipt = try CloudJSON.decode(row.wireData()).object
        serviceReceipt["durationSeconds"] = .number(Double(totalMilliseconds / 1000))
        XCTAssertNoThrow(try ReadingTimeSnapshot(wireData: CloudJSON.encode(serviceReceipt)))
        var clock = ReadingActivityClock()
        try clock.start(bookID: "book", contentVersion: "version", anchor: anchor, at: row.startedAt)
        for (index, interval) in intervals.enumerated() {
            if index > 0 { clock.resume(at: interval.startedAt) }
            clock.pause(at: interval.endedAt)
        }
        XCTAssertEqual(clock.durationSeconds, totalMilliseconds / 1000)
    }
    func testWireRoundTripUsesServiceFieldNamesAndPreservesSegments() throws {
        var clock = ReadingActivityClock(); try start(&clock)
        clock.tick(at: base.addingTimeInterval(2)); let row = try XCTUnwrap(clock.finish(at: base.addingTimeInterval(2)))
        let wire = try row.wireData()
        let json = try CloudJSON.decode(wire)
        XCTAssertEqual(json["source"].string, "reader_estimate")
        XCTAssertEqual(json["start"]["chapterId"].string, "chapter")
        XCTAssertEqual(json["durationSeconds"].number, 2)
        XCTAssertEqual(try ReadingTimeSnapshot(wireData: wire), row)
    }
    func testFractionalDeviceTimestampsRoundTripIntoExactServiceReceipts() throws {
        for fraction in [0.001234, 0.123456, 0.999999] {
            var clock = ReadingActivityClock(); let at = base.addingTimeInterval(fraction)
            try clock.start(bookID: "book", contentVersion: "version", anchor: anchor, at: at)
            clock.tick(at: at.addingTimeInterval(2))
            let row = try XCTUnwrap(clock.finish(at: at.addingTimeInterval(2)))
            XCTAssertEqual(try ReadingTimeSnapshot(wireData: row.wireData()), row)
        }
    }
    func testClockBoundsLongSessionsAndNeverErasesTimeAfterClockMovesBackward() throws {
        var clock = ReadingActivityClock(); try start(&clock, source: .focus)
        clock.tick(at: base.addingTimeInterval(3)); clock.tick(at: base.addingTimeInterval(1)); clock.tick(at: base.addingTimeInterval(4))
        XCTAssertEqual(clock.durationSeconds, 4)
        clock.pause(at: base.addingTimeInterval(4)); clock.resume(at: base.addingTimeInterval(25 * 3600))
        let row = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(25 * 3600)))
        XCTAssertEqual(row.status, .finished); XCTAssertEqual(row.durationSeconds, 4)
        XCTAssertEqual(row.endedAt.timeIntervalSince(row.startedAt), 86400)
        XCTAssertFalse(clock.wantsRunning)
    }
    func testIntervalLimitRetainsAllPriorIntervalsAndFinishesCleanly() throws {
        var clock = ReadingActivityClock(); try start(&clock, source: .focus)
        for count in 0..<120 {
            clock.pause(at: base.addingTimeInterval(Double(count * 2 + 1)))
            clock.resume(at: base.addingTimeInterval(Double(count * 2 + 2)))
        }
        let row = try XCTUnwrap(clock.snapshot(at: base.addingTimeInterval(240)))
        XCTAssertEqual(row.status, .finished); XCTAssertEqual(row.segments.count, 120); XCTAssertEqual(row.durationSeconds, 120)
    }
}
