import XCTest
@testable import LeafhourCore

final class ReaderAutoPageStateTests: XCTestCase {
    func testStartWaitsForAFullIntervalAndLateWakeRequestsOnlyOnePage() throws {
        var state = ReaderAutoPageState(interval: 30)
        XCTAssertNil(state.requestIfDue(at: 100))
        state.start(at: 100)
        XCTAssertNil(state.requestIfDue(at: 129.9))
        let request = try XCTUnwrap(state.requestIfDue(at: 250))
        XCTAssertNil(state.requestIfDue(at: 251), "A late wake must not catch up with a burst of page turns")
        state.pageDidSettle(request, at: 260)
        XCTAssertNil(state.requestIfDue(at: 289.9))
        XCTAssertNotNil(state.requestIfDue(at: 290))
    }

    func testEveryInterruptionCancelsPendingWorkAndRequiresAnExplicitStart() throws {
        for reason in ReaderAutoPagePauseReason.allCases {
            var state = ReaderAutoPageState(interval: 5)
            state.start(at: 0)
            let request = try XCTUnwrap(state.requestIfDue(at: 5))
            state.pause(reason)
            state.pageDidSettle(request, at: 6)
            XCTAssertEqual(state.phase, .paused(reason))
            XCTAssertNil(state.requestIfDue(at: 1000))
            XCTAssertNil(state.pendingRequestID)
            state.start(at: 1000)
            XCTAssertNil(state.requestIfDue(at: 1004))
            XCTAssertNotNil(state.requestIfDue(at: 1005))
        }
    }

    func testEndAndStopRejectLateAcknowledgmentsAndNeverRestartThemselves() throws {
        var state = ReaderAutoPageState(interval: 5)
        state.start(at: 0)
        let last = try XCTUnwrap(state.requestIfDue(at: 5))
        state.reachedEnd(last)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertNil(state.requestIfDue(at: 100))
        state.pageDidSettle(last, at: 100)
        XCTAssertEqual(state.phase, .finished)
        state.start(at: 100)
        let pending = try XCTUnwrap(state.requestIfDue(at: 105))
        state.stop()
        state.pageDidSettle(pending, at: 106)
        XCTAssertEqual(state.phase, .stopped)
        XCTAssertNil(state.requestIfDue(at: 1000))
        XCTAssertEqual(ReaderAutoPageState(interval: 5).phase, .stopped, "A newly opened reader never restores a running state")
    }

    func testStaleResultCannotAcknowledgeANewerPageRequest() throws {
        var state = ReaderAutoPageState(interval: 5)
        state.start(at: 0)
        let old = try XCTUnwrap(state.requestIfDue(at: 5))
        state.pause(.interaction)
        state.start(at: 10)
        let current = try XCTUnwrap(state.requestIfDue(at: 15))
        state.pageDidSettle(old, at: 20)
        state.reachedEnd(old)
        state.requestFailed(old, reason: .layout)
        XCTAssertEqual(state.pendingRequestID, current)
        XCTAssertEqual(state.phase, .running)
        state.requestFailed(current, reason: .layout)
        XCTAssertEqual(state.phase, .paused(.layout))
    }

    func testChangingIntervalRestartsTheCountdownAndUsesTheNewIntervalAfterSettle() throws {
        var state = ReaderAutoPageState(interval: 30)
        state.start(at: 0)
        state.setInterval(10, at: 29)
        XCTAssertNil(state.requestIfDue(at: 38))
        let request = try XCTUnwrap(state.requestIfDue(at: 39))
        state.setInterval(60, at: 40)
        XCTAssertEqual(state.pendingRequestID, request)
        state.pageDidSettle(request, at: 45)
        XCTAssertNil(state.requestIfDue(at: 104))
        XCTAssertNotNil(state.requestIfDue(at: 105))
    }

    func testInvalidIntervalsCannotCreateImmediateOrUnboundedTimers() {
        let cases: [(Double, Double)] = [(.nan, 30), (.infinity, 30), (-20, 5), (0, 5), (7, 5), (8, 10), (122, 120)]
        for (input, expected) in cases {
            var state = ReaderAutoPageState(interval: input)
            state.start(at: 100)
            XCTAssertNil(state.requestIfDue(at: 100 + expected - 0.1))
            XCTAssertNotNil(state.requestIfDue(at: 100 + expected))
        }
    }
}
