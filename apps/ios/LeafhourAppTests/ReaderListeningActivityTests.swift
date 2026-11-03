import XCTest
@testable import Leafhour

@MainActor final class ReaderListeningActivityTests: XCTestCase {
    func testOnlyChangedPresentationUpdatesAndDismissedSessionDoesNotRestart() async {
        let backend = ActivityBackendProbe(), publisher = ReaderListeningActivityPublisher(backend: backend)
        let state = ListeningActivityAttributes.ContentState(title: "Synthetic", chapter: "One", phase: .playing, speed: 1)
        publisher.publish(sessionID: "first", state: state)
        await publisher.flush()
        XCTAssertEqual(backend.starts, ["first"])
        publisher.publish(sessionID: "first", state: state)
        await publisher.flush()
        XCTAssertTrue(backend.updates.isEmpty)
        backend.active.remove("first") // The person dismissed the card.
        var paused = state; paused.phase = .paused
        publisher.publish(sessionID: "first", state: paused)
        await publisher.flush()
        XCTAssertEqual(backend.starts, ["first"])
        XCTAssertTrue(backend.updates.isEmpty)
    }

    func testStopDuringSuspendedCreationEndsLateCardInsteadOfResurrectingIt() async {
        let backend = ActivityBackendProbe(), publisher = ReaderListeningActivityPublisher(backend: backend)
        backend.suspendCreation = true
        let started = expectation(description: "Activity creation suspended")
        backend.creationStarted = { started.fulfill() }
        publisher.publish(sessionID: "old", state: .init(title: "Old", chapter: nil, phase: .preparing, speed: 1))
        await fulfillment(of: [started], timeout: 2)
        publisher.end(sessionID: "old")
        backend.completeCreation()
        await publisher.flush()
        XCTAssertTrue(backend.active.isEmpty)
        XCTAssertTrue(backend.ends.contains("old"))
    }

    func testReplacementSurvivesDelayedOldCleanupAndOldOrphansAreEnded() async {
        let backend = ActivityBackendProbe(), publisher = ReaderListeningActivityPublisher(backend: backend)
        backend.active.insert("previous-process")
        publisher.publish(sessionID: "first", state: .init(title: "First", chapter: nil, phase: .playing, speed: 1))
        await publisher.flush()
        publisher.publish(sessionID: "second", state: .init(title: "Second", chapter: nil, phase: .paused, speed: 2))
        publisher.end(sessionID: "first")
        await publisher.flush()
        XCTAssertEqual(backend.active, ["second"])
        XCTAssertTrue(backend.ends.contains("previous-process"))
        XCTAssertEqual(backend.states["second"]?.title, "Second")
    }

    func testDisabledOrFailedActivityDoesNotRetryEachAudioUpdate() async {
        let backend = ActivityBackendProbe(), publisher = ReaderListeningActivityPublisher(backend: backend)
        backend.areActivitiesEnabled = false
        publisher.publish(sessionID: "disabled", state: .init(title: "Book", chapter: nil, phase: .preparing, speed: 1))
        await publisher.flush()
        publisher.publish(sessionID: "disabled", state: .init(title: "Book", chapter: nil, phase: .playing, speed: 1))
        await publisher.flush()
        XCTAssertTrue(backend.starts.isEmpty)
        backend.areActivitiesEnabled = true; backend.failCreation = true
        publisher.publish(sessionID: "failed", state: .init(title: "Book", chapter: nil, phase: .preparing, speed: 1))
        await publisher.flush()
        publisher.publish(sessionID: "failed", state: .init(title: "Book", chapter: nil, phase: .playing, speed: 1))
        await publisher.flush()
        XCTAssertEqual(backend.starts, ["failed"])
    }
}

@MainActor private final class ActivityBackendProbe: ReaderListeningActivityBackend {
    var areActivitiesEnabled = true
    var active: Set<String> = []
    var starts: [String] = [], updates: [String] = [], ends: [String] = []
    var states: [String: ListeningActivityAttributes.ContentState] = [:]
    var suspendCreation = false, failCreation = false
    var creationStarted: (() -> Void)?
    private var continuation: CheckedContinuation<Void, Never>?
    func existingSessionIDs() -> [String] { Array(active) }
    func isActive(sessionID: String) -> Bool { active.contains(sessionID) }
    func start(sessionID: String, state: ListeningActivityAttributes.ContentState) async throws {
        starts.append(sessionID)
        if failCreation { throw NSError(domain: "Synthetic activity error", code: 1) }
        if suspendCreation { await withCheckedContinuation { continuation = $0; creationStarted?() } }
        active.insert(sessionID); states[sessionID] = state
    }
    func update(sessionID: String, state: ListeningActivityAttributes.ContentState) async {
        updates.append(sessionID); states[sessionID] = state
    }
    func end(sessionID: String) async { ends.append(sessionID); active.remove(sessionID); states[sessionID] = nil }
    func completeCreation() { continuation?.resume(); continuation = nil; suspendCreation = false }
}
