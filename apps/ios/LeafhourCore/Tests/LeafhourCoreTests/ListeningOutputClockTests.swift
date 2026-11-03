import XCTest
@testable import LeafhourCore

final class ListeningOutputClockTests: XCTestCase {
    func testOnlyActualOutputAccumulatesAndResumeKeepsAStableSystemTimerAnchor() {
        var clock = ListeningOutputClock()
        let base = Date(timeIntervalSince1970: 1_793_721_600)
        clock.setOutputPlaying(false, at: base, uptime: 10)
        XCTAssertNil(clock.timerStartDate); XCTAssertEqual(clock.elapsedSeconds, 0)
        clock.setOutputPlaying(true, at: base.addingTimeInterval(5), uptime: 15)
        let started = clock.timerStartDate
        clock.setOutputPlaying(true, at: base.addingTimeInterval(8), uptime: 18)
        XCTAssertEqual(clock.timerStartDate, started, "Identical playback snapshots must not restart the OS timer")
        clock.setOutputPlaying(false, at: base.addingTimeInterval(10), uptime: 20)
        XCTAssertEqual(clock.elapsedSeconds, 5); XCTAssertNil(clock.timerStartDate)
        clock.setOutputPlaying(false, at: base.addingTimeInterval(30), uptime: 40)
        XCTAssertEqual(clock.elapsedSeconds, 5, "Preparing or paused time is excluded")
        clock.setOutputPlaying(true, at: base.addingTimeInterval(30), uptime: 40)
        XCTAssertEqual(clock.timerStartDate, base.addingTimeInterval(25))
        clock.setOutputPlaying(false, at: base.addingTimeInterval(33), uptime: 43)
        XCTAssertEqual(clock.elapsedSeconds, 8)
    }

    func testWallClockChangesCannotInventAccumulatedListeningTime() {
        var clock = ListeningOutputClock()
        let base = Date(timeIntervalSince1970: 1_793_721_600)
        clock.setOutputPlaying(true, at: base, uptime: 100)
        clock.setOutputPlaying(false, at: base.addingTimeInterval(3600), uptime: 103)
        XCTAssertEqual(clock.elapsedSeconds, 3)
        clock = ListeningOutputClock()
        XCTAssertEqual(clock.elapsedSeconds, 0); XCTAssertNil(clock.timerStartDate)
    }

    func testContinuousOutputReprojectsItsSystemTimerAfterForwardAndBackwardClockChanges() {
        var clock = ListeningOutputClock()
        let base = Date(timeIntervalSince1970: 1_793_721_600)
        clock.setOutputPlaying(true, at: base, uptime: 100)
        clock.setOutputPlaying(true, at: base.addingTimeInterval(3603), uptime: 103)
        XCTAssertEqual(clock.timerStartDate, base.addingTimeInterval(3600), "Clock changes must not add an hour of output")
        clock.setOutputPlaying(true, at: base.addingTimeInterval(3), uptime: 106)
        XCTAssertEqual(clock.timerStartDate, base.addingTimeInterval(-3), "Backward changes must retain six seconds of real output")
        clock.setOutputPlaying(false, at: base.addingTimeInterval(4), uptime: 107)
        XCTAssertEqual(clock.elapsedSeconds, 7)
    }
}
