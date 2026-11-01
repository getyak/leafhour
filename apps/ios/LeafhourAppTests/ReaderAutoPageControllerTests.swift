import XCTest
import LeafhourCore
@testable import Leafhour

@MainActor
final class ReaderAutoPageControllerTests: XCTestCase {
    func testDefaultMonotonicTimerPublishesARealRequestAfterFiveSeconds() async throws {
        let controller = ReaderAutoPageController()
        defer { controller.stop() }
        let navigation = UUID()
        controller.update(.init(), navigationID: navigation)
        controller.setInterval(5)
        let started = ProcessInfo.processInfo.systemUptime
        controller.start()
        XCTAssertNil(controller.pageRequest, "Starting must wait for the full configured interval")
        while controller.pageRequest == nil, ProcessInfo.processInfo.systemUptime - started < 8 {
            try await Task.sleep(for: .milliseconds(25))
        }
        let request = try XCTUnwrap(controller.pageRequest, "The default monotonic timer must publish without manual advanceIfDue or an injected clock")
        XCTAssertGreaterThanOrEqual(ProcessInfo.processInfo.systemUptime - started, 5)
        XCTAssertEqual(request.expectedNavigationID, navigation)
        XCTAssertEqual(request.direction, .next)
        XCTAssertEqual(request.origin, .automatic)
        XCTAssertEqual(controller.state.phase, .running)
    }

    func testCommandsAreAutomaticAndUseTheSettledNavigationGeneration() throws {
        var now: TimeInterval = 0
        let controller = ReaderAutoPageController(now: { now })
        let firstNavigation = UUID(), nextNavigation = UUID()
        controller.update(.init(), navigationID: firstNavigation)
        controller.setInterval(5)
        controller.start()
        now = 5; controller.advanceIfDue()
        let first = try XCTUnwrap(controller.pageRequest)
        XCTAssertEqual(first.expectedNavigationID, firstNavigation)
        XCTAssertEqual(first.origin, .automatic)
        XCTAssertEqual(first.direction, .next)
        controller.update(.init(), navigationID: nextNavigation)
        controller.receive(first.id, outcome: .settled(navigationID: nextNavigation))
        now = 9; controller.advanceIfDue()
        XCTAssertNil(controller.pageRequest)
        now = 10; controller.advanceIfDue()
        XCTAssertEqual(controller.pageRequest?.expectedNavigationID, nextNavigation)
        controller.stop()
    }

    func testAllBlockingConditionsPauseAndClearingThemNeverResumes() {
        let cases: [(ReaderAutoPageConditions, ReaderAutoPagePauseReason)] = [
            (.init(isForeground: false), .inactive),
            (.init(isPaged: false), .navigation),
            (.init(hasSelection: true), .selection),
            (.init(isTouching: true), .interaction),
            (.init(hasPanel: true), .panel),
            (.init(isListening: true), .listening),
            (.init(voiceOverEnabled: true), .voiceOver),
            (.init(hasAlert: true), .panel)
        ]
        for (conditions, reason) in cases {
            var now: TimeInterval = 0
            let controller = ReaderAutoPageController(now: { now })
            let navigation = UUID()
            controller.update(.init(), navigationID: navigation)
            controller.start()
            controller.update(conditions, navigationID: navigation)
            XCTAssertEqual(controller.state.phase, .paused(reason))
            controller.update(.init(), navigationID: navigation)
            now = 120; controller.advanceIfDue()
            XCTAssertNil(controller.pageRequest)
            XCTAssertEqual(controller.state.phase, .paused(reason))
            controller.stop()
        }
    }

    func testManualNavigationAndUnavailablePagesCannotSilentlyKeepRunning() throws {
        var now: TimeInterval = 0
        let controller = ReaderAutoPageController(now: { now })
        controller.update(.init(), navigationID: UUID())
        controller.setInterval(5); controller.start()
        controller.update(.init(), navigationID: UUID())
        XCTAssertEqual(controller.state.phase, .paused(.navigation))
        controller.start()
        now = 5; controller.advanceIfDue()
        let request = try XCTUnwrap(controller.pageRequest)
        controller.receive(request.id, outcome: .notReady)
        XCTAssertEqual(controller.state.phase, .paused(.layout))
        now = 100; controller.advanceIfDue()
        XCTAssertNil(controller.pageRequest)
        controller.stop()
    }

    func testPausedSelectionRejectsAnAlreadyDispatchedPageResult() throws {
        var now: TimeInterval = 0
        let controller = ReaderAutoPageController(now: { now })
        let navigation = UUID()
        controller.update(.init(), navigationID: navigation)
        controller.setInterval(5); controller.start()
        now = 5; controller.advanceIfDue()
        let request = try XCTUnwrap(controller.pageRequest)
        controller.update(.init(hasSelection: true), navigationID: navigation)
        controller.receive(request.id, outcome: .settled(navigationID: navigation))
        XCTAssertEqual(controller.state.phase, .paused(.selection))
        XCTAssertNil(controller.pageRequest)
        controller.stop()
    }

    func testLastPageStopsAndARecreatedControllerIsStopped() throws {
        var now: TimeInterval = 0
        let controller = ReaderAutoPageController(now: { now })
        controller.update(.init(), navigationID: UUID())
        controller.setInterval(5); controller.start()
        now = 5; controller.advanceIfDue()
        let request = try XCTUnwrap(controller.pageRequest)
        controller.receive(request.id, outcome: .end)
        XCTAssertEqual(controller.state.phase, .finished)
        now = 500; controller.advanceIfDue()
        XCTAssertNil(controller.pageRequest)
        XCTAssertEqual(ReaderAutoPageController().state.phase, .stopped)
        controller.stop()
    }
}
