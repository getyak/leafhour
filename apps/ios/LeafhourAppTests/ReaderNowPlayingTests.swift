import XCTest
import MediaPlayer
import UIKit
@testable import Leafhour

@MainActor final class ReaderNowPlayingTests: XCTestCase {
    func testMetadataPublishesOnlyActualBookChapterAndPlaybackWithoutInventedTiming() throws {
        let sink = IsolatedNowPlayingSink(), commands = IsolatedRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let identity = ReaderNowPlayingIdentity(accountID: "synthetic-account", bookID: "synthetic-book", sourceVersion: "source-v1")
        let controller = controller(identity, center: center)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        XCTAssertTrue(controller.publish(snapshot(identity, playing: true, artwork: image)))
        let metadata = try XCTUnwrap(sink.nowPlayingInfo)
        XCTAssertEqual(metadata[MPMediaItemPropertyTitle] as? String, "真实书名")
        XCTAssertEqual(metadata[MPMediaItemPropertyArtist] as? String, "真实作者")
        XCTAssertEqual(metadata[MPMediaItemPropertyAlbumTitle] as? String, "第二章")
        XCTAssertEqual(metadata[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.75)
        XCTAssertEqual(metadata[MPNowPlayingInfoPropertyMediaType] as? UInt, MPNowPlayingInfoMediaType.audio.rawValue)
        let artwork = try XCTUnwrap(metadata[MPMediaItemPropertyArtwork] as? MPMediaItemArtwork)
        XCTAssertEqual(artwork.bounds.size, image.size)
        XCTAssertEqual(artwork.image(at: CGSize(width: 4, height: 4))?.size, CGSize(width: 4, height: 4))
        XCTAssertEqual(Set(metadata.keys), Set([
            MPMediaItemPropertyTitle, MPMediaItemPropertyArtist, MPMediaItemPropertyAlbumTitle,
            MPMediaItemPropertyArtwork, MPNowPlayingInfoPropertyPlaybackRate,
            MPNowPlayingInfoPropertyMediaType
        ]), "The system receives no guessed duration, elapsed time, whole-book progress, selection, private notes or source URLs")
        XCTAssertTrue(controller.update(snapshot(identity, playing: false)))
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        XCTAssertNil(sink.nowPlayingInfo?[MPMediaItemPropertyArtwork], "A later snapshot must replace the dictionary rather than retaining another cover")
        controller.clear()
        XCTAssertNil(sink.nowPlayingInfo)
    }

    func testOldControllerCannotClearOrUpdateANewerOwnersBook() throws {
        let sink = IsolatedNowPlayingSink(), commands = IsolatedRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let first = ReaderNowPlayingIdentity(accountID: "account-a", bookID: "book", sourceVersion: "v1")
        let second = ReaderNowPlayingIdentity(accountID: "account-b", bookID: "book", sourceVersion: "v2")
        let old = controller(first, center: center), current = controller(second, center: center)
        XCTAssertTrue(old.publish(snapshot(first, playing: true)))
        XCTAssertTrue(current.publish(snapshot(second, playing: false, title: "New account and source")))
        XCTAssertFalse(old.update(snapshot(first, playing: true, title: "Late old cover")))
        XCTAssertFalse(old.publish(snapshot(first, playing: true)), "A superseded controller cannot reclaim the global session")
        old.clear()
        XCTAssertEqual(sink.nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "New account and source")
        XCTAssertEqual(sink.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        XCTAssertFalse(current.update(snapshot(first, playing: true)), "A foreign account/source snapshot cannot enter the current session")
        XCTAssertEqual(sink.nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "New account and source")
        current.clear()
        XCTAssertNil(sink.nowPlayingInfo)
    }

    func testRemoteCommandsRejectLateHandlersAndRespectCurrentChapterAvailability() throws {
        let sink = IsolatedNowPlayingSink(), commands = IsolatedRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let identity = ReaderNowPlayingIdentity(accountID: nil, bookID: "device-book", sourceVersion: "v1")
        var calls: [String] = []
        let controller = ReaderNowPlayingController(identity: identity, center: center,
            play: { calls.append("play") }, pause: { calls.append("pause") },
            previousChapter: { calls.append("previous") }, nextChapter: { calls.append("next") })
        XCTAssertTrue(controller.publish(snapshot(identity, playing: true)))
        XCTAssertEqual(commands.enabled[.previousChapter], false)
        XCTAssertEqual(commands.enabled[.nextChapter], true)
        let oldPlay = try XCTUnwrap(commands.latestHandler(for: .play))
        let oldNext = try XCTUnwrap(commands.latestHandler(for: .nextChapter))
        XCTAssertEqual(oldPlay(), .success)
        XCTAssertEqual(try XCTUnwrap(commands.latestHandler(for: .pause))(), .success)
        XCTAssertEqual(try XCTUnwrap(commands.latestHandler(for: .previousChapter))(), .noSuchContent)
        XCTAssertEqual(oldNext(), .success)
        XCTAssertEqual(calls, ["play", "pause", "next"])
        XCTAssertTrue(controller.update(snapshot(identity, playing: false, previous: true, next: false)))
        XCTAssertEqual(commands.enabled[.previousChapter], true)
        XCTAssertEqual(commands.enabled[.nextChapter], false)
        XCTAssertEqual(oldNext(), .noSuchContent, "A registered callback reads the latest chapter boundary")
        XCTAssertEqual(try XCTUnwrap(commands.latestHandler(for: .previousChapter))(), .success)
        let foreignToken = commands.register(.play) { .success }
        controller.clear()
        XCTAssertEqual(oldPlay(), .commandFailed)
        XCTAssertEqual(oldNext(), .commandFailed)
        XCTAssertEqual(calls, ["play", "pause", "next", "previous"])
        XCTAssertTrue(commands.registrations.contains { $0.token == foreignToken }, "Cleanup removes only this controller's registrations")
        XCTAssertFalse(controller.update(snapshot(identity, playing: true)), "Late artwork/state updates after teardown cannot claim a session")
        XCTAssertFalse(controller.publish(snapshot(identity, playing: true)), "Explicitly cleared controller cannot republish after teardown")
        XCTAssertNil(sink.nowPlayingInfo)
    }

    func testSupersededRemoteCallbackCannotControlNewBookEvenWithIdenticalMetadata() throws {
        let sink = IsolatedNowPlayingSink(), commands = IsolatedRemoteCommands()
        let center = ReaderNowPlayingCenter(sink: sink, commands: commands)
        let first = ReaderNowPlayingIdentity(accountID: "a", bookID: "book", sourceVersion: "v1")
        let second = ReaderNowPlayingIdentity(accountID: "a", bookID: "book", sourceVersion: "v2")
        var oldCalls = 0, currentCalls = 0
        let old = ReaderNowPlayingController(identity: first, center: center, play: { oldCalls += 1 }, pause: {}, previousChapter: {}, nextChapter: {})
        XCTAssertTrue(old.publish(snapshot(first, playing: true)))
        let stale = try XCTUnwrap(commands.latestHandler(for: .play))
        let current = ReaderNowPlayingController(identity: second, center: center, play: { currentCalls += 1 }, pause: {}, previousChapter: {}, nextChapter: {})
        XCTAssertTrue(current.publish(snapshot(second, playing: true)))
        XCTAssertEqual(stale(), .commandFailed)
        XCTAssertEqual(try XCTUnwrap(commands.latestHandler(for: .play))(), .success)
        XCTAssertEqual(oldCalls, 0)
        XCTAssertEqual(currentCalls, 1)
        current.clear(); old.clear()
    }

    private func controller(_ identity: ReaderNowPlayingIdentity, center: ReaderNowPlayingCenter) -> ReaderNowPlayingController {
        ReaderNowPlayingController(identity: identity, center: center, play: {}, pause: {}, previousChapter: {}, nextChapter: {})
    }
    private func snapshot(_ identity: ReaderNowPlayingIdentity, playing: Bool, title: String = "真实书名", artwork: UIImage? = nil, previous: Bool = false, next: Bool = true) -> ReaderNowPlayingSnapshot {
        ReaderNowPlayingSnapshot(identity: identity, title: title, author: "真实作者", chapterTitle: "第二章", isPlaying: playing,
                                 playbackRate: 1.75, artwork: artwork, canPreviousChapter: previous, canNextChapter: next)
    }
}

@MainActor private final class IsolatedNowPlayingSink: ReaderNowPlayingSink {
    var nowPlayingInfo: [String: Any]?
}

@MainActor private final class IsolatedRemoteCommands: ReaderRemoteCommandRegistering {
    struct Registration {
        let token: UUID
        let command: ReaderRemoteCommand
        let handler: @MainActor () -> MPRemoteCommandHandlerStatus
    }
    var registrations: [Registration] = []
    var enabled: [ReaderRemoteCommand: Bool] = [:]
    func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID {
        let token = UUID()
        registrations.append(Registration(token: token, command: command, handler: handler))
        return token
    }
    func remove(_ token: UUID) { registrations.removeAll { $0.token == token } }
    func setEnabled(_ enabled: Bool, for command: ReaderRemoteCommand) { self.enabled[command] = enabled }
    func latestHandler(for command: ReaderRemoteCommand) -> (@MainActor () -> MPRemoteCommandHandlerStatus)? {
        registrations.last { $0.command == command }?.handler
    }
}
