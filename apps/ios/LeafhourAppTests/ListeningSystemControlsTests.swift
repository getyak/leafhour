import XCTest
import MediaPlayer
@testable import Leafhour

@MainActor final class ListeningSystemControlsTests: XCTestCase {
    func testIntentCommandsRejectForeignTokensAndLateUnbindCannotRemoveReplacement() {
        let router = ListeningPlaybackCommandCenter()
        var calls: [String] = []
        router.bind(sessionID: "first") { action in calls.append("first-\(action)"); return true }
        XCTAssertFalse(router.perform(.stop, sessionID: "foreign"))
        XCTAssertTrue(router.perform(.togglePlayback, sessionID: "first"))
        router.bind(sessionID: "second") { action in calls.append("second-\(action)"); return true }
        router.unbind(sessionID: "first")
        XCTAssertFalse(router.perform(.stop, sessionID: "first"))
        XCTAssertTrue(router.perform(.stop, sessionID: "second"))
        XCTAssertEqual(calls, ["first-togglePlayback", "second-stop"])
        router.unbind(sessionID: "second")
        XCTAssertFalse(router.perform(.togglePlayback, sessionID: "second"))
    }

    func testMediaTogglePausesPreparationAndOutputThenResumesAnExplicitPause() throws {
        let sink = SystemControlMetadataProbe(), commands = SystemControlCommandsProbe()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let identity = ReaderNowPlayingIdentity(accountID: nil, bookID: "synthetic", sourceVersion: "1")
        var calls: [String] = []
        let controller = ReaderNowPlayingController(identity: identity, center: center,
            play: { calls.append("play") }, pause: { calls.append("pause") },
            previousChapter: {}, nextChapter: {}, stop: { calls.append("stop") })
        var value = ReaderNowPlayingSnapshot(identity: identity, title: "Synthetic", author: nil,
            chapterTitle: nil, isPlaying: false, playbackRate: 1.5, artwork: nil,
            canPreviousChapter: false, canNextChapter: false)
        value.isPreparing = true
        XCTAssertTrue(controller.publish(value))
        let toggle = try XCTUnwrap(commands.handlers[.togglePlayback])
        XCTAssertEqual(toggle(), .success)
        value.isPreparing = false
        XCTAssertTrue(controller.update(value))
        XCTAssertEqual(toggle(), .success)
        XCTAssertEqual(calls, ["pause", "play"])
        let stop = try XCTUnwrap(commands.handlers[.stop])
        XCTAssertEqual(stop(), .success)
        XCTAssertEqual(calls, ["pause", "play", "stop"])
        XCTAssertNil(sink.nowPlayingInfo)
        XCTAssertEqual(stop(), .commandFailed)
        XCTAssertEqual(toggle(), .commandFailed)
    }

    func testLiveActivityActionsShareTheMediaOwnerAndEndBothPresentations() throws {
        let sink = SystemControlMetadataProbe(), commands = SystemControlCommandsProbe()
        let activities = SystemActivityProbe(), intents = ListeningPlaybackCommandCenter()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands, activities: activities, intentCommands: intents)
        let identity = ReaderNowPlayingIdentity(accountID: "private-account", bookID: "synthetic", sourceVersion: "1")
        var calls: [String] = []
        let controller = ReaderNowPlayingController(identity: identity, center: center,
            play: { calls.append("play") }, pause: { calls.append("pause") },
            previousChapter: {}, nextChapter: {}, stop: { calls.append("stop") })
        var value = ReaderNowPlayingSnapshot(identity: identity, title: "Synthetic", author: nil,
            chapterTitle: nil, isPlaying: false, playbackRate: 1, artwork: nil,
            canPreviousChapter: false, canNextChapter: false)
        value.isPreparing = true
        XCTAssertTrue(controller.publish(value))
        let token = try XCTUnwrap(activities.sessionID)
        XCTAssertNotNil(UUID(uuidString: token))
        XCTAssertFalse(token.contains("private-account"))
        XCTAssertEqual(activities.state?.phase, .preparing)
        XCTAssertTrue(intents.perform(.togglePlayback, sessionID: token))
        XCTAssertEqual(calls, ["pause"])
        XCTAssertTrue(intents.perform(.stop, sessionID: token))
        XCTAssertEqual(calls, ["pause", "stop"])
        XCTAssertNil(sink.nowPlayingInfo)
        XCTAssertNil(activities.sessionID)
        XCTAssertFalse(intents.perform(.togglePlayback, sessionID: token))
    }

    func testStopIntentKeepsItsExecutionAliveUntilTheActivityHasEnded() async throws {
        let activities = DelayedActivityEndProbe()
        let center = ReaderNowPlayingCenter(sink: SystemControlMetadataProbe(), commands: SystemControlCommandsProbe(),
            activities: activities, intentCommands: .shared)
        let identity = ReaderNowPlayingIdentity(accountID: nil, bookID: "synthetic", sourceVersion: "1")
        let controller = ReaderNowPlayingController(identity: identity, center: center, play: {}, pause: {}, previousChapter: {}, nextChapter: {})
        XCTAssertTrue(controller.publish(.init(identity: identity, title: "Synthetic", author: nil, chapterTitle: nil,
            isPlaying: true, playbackRate: 1, artwork: nil, canPreviousChapter: false, canNextChapter: false)))
        let token = try XCTUnwrap(activities.sessionID)
        let queued = expectation(description: "Stop enqueued the activity end")
        activities.queued = { queued.fulfill() }
        var returned = false
        let command = Task { @MainActor in
            _ = try await StopListeningPlaybackIntent(sessionID: token).perform()
            returned = true
        }
        await fulfillment(of: [queued], timeout: 2)
        XCTAssertFalse(returned, "Returning before the queued end finishes can release background execution too early")
        activities.complete()
        try await command.value
        XCTAssertTrue(returned)
        XCTAssertFalse(ListeningPlaybackCommandCenter.shared.perform(.togglePlayback, sessionID: token))
    }
}

@MainActor private final class DelayedActivityEndProbe: ReaderListeningActivityPublishing {
    var sessionID: String?
    var queued: (() -> Void)?
    var continuation: CheckedContinuation<Void, Never>?
    func publish(sessionID: String, state: ListeningActivityAttributes.ContentState) { self.sessionID = sessionID }
    func end(sessionID: String) { self.sessionID = nil; queued?() }
    func flush() async { await withCheckedContinuation { continuation = $0 } }
    func complete() { continuation?.resume(); continuation = nil }
}

@MainActor private final class SystemActivityProbe: ReaderListeningActivityPublishing {
    var sessionID: String?
    var state: ListeningActivityAttributes.ContentState?
    func publish(sessionID: String, state: ListeningActivityAttributes.ContentState) { self.sessionID = sessionID; self.state = state }
    func end(sessionID: String) { if self.sessionID == sessionID { self.sessionID = nil; state = nil } }
    func flush() async {}
}

@MainActor private final class SystemControlMetadataProbe: ReaderNowPlayingSink {
    var nowPlayingInfo: [String: Any]?
}
@MainActor private final class SystemControlCommandsProbe: ReaderRemoteCommandRegistering {
    var handlers: [ReaderRemoteCommand: @MainActor () -> MPRemoteCommandHandlerStatus] = [:]
    private var tokens: [UUID: ReaderRemoteCommand] = [:]
    func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID {
        let token = UUID(); tokens[token] = command; handlers[command] = handler; return token
    }
    func remove(_ token: UUID) { if let command = tokens.removeValue(forKey: token) { handlers[command] = nil } }
    func setEnabled(_ enabled: Bool, for command: ReaderRemoteCommand) {}
}
