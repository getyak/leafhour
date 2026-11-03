import Foundation
import MediaPlayer
import UIKit
import LeafhourCore

/// This identity stays local. Neither account identifiers nor source locations
/// are included in the system's Now Playing dictionary.
struct ReaderNowPlayingIdentity: Equatable {
    let accountID: String?
    let bookID: String
    let sourceVersion: String
}

/// Only real bibliographic identity and actual playback state may cross the
/// lock-screen boundary. There is intentionally no duration, progress or text.
struct ReaderNowPlayingSnapshot {
    let identity: ReaderNowPlayingIdentity
    let title: String
    let author: String?
    let chapterTitle: String?
    let isPlaying: Bool
    let playbackRate: Double
    let artwork: UIImage?
    let canPreviousChapter: Bool
    let canNextChapter: Bool
    var isPreparing = false
}

@MainActor protocol ReaderNowPlayingSink: AnyObject {
    var nowPlayingInfo: [String: Any]? { get set }
}

enum ReaderRemoteCommand: CaseIterable, Hashable {
    case play, pause, togglePlayback, stop, previousChapter, nextChapter
}

@MainActor protocol ReaderRemoteCommandRegistering: AnyObject {
    func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID
    func remove(_ token: UUID)
    func setEnabled(_ enabled: Bool, for command: ReaderRemoteCommand)
}

/// One owner arbitrates the app-wide system center. Tests supply an isolated
/// sink and registrar, so exercising ownership never mutates the live session.
@MainActor final class ReaderNowPlayingCenter {
    static let shared = ReaderNowPlayingCenter(sink: SystemReaderNowPlayingSink(), commands: SystemReaderRemoteCommands(),
        activities: ReaderListeningActivityPublisher(), intentCommands: .shared)

    private let sink: any ReaderNowPlayingSink
    private let commands: any ReaderRemoteCommandRegistering
    private let activities: (any ReaderListeningActivityPublishing)?
    private let intentCommands: ListeningPlaybackCommandCenter?
    private var owner: UUID?
    private var revokeOwner: (() -> Void)?

    init(sink: any ReaderNowPlayingSink, commands: any ReaderRemoteCommandRegistering,
         activities: (any ReaderListeningActivityPublishing)? = nil, intentCommands: ListeningPlaybackCommandCenter? = nil) {
        self.sink = sink; self.commands = commands
        self.activities = activities; self.intentCommands = intentCommands
    }

    fileprivate func isOwner(_ candidate: UUID) -> Bool { owner == candidate }

    fileprivate func claim(_ candidate: UUID, revoke: @escaping () -> Void) {
        guard owner != candidate else { return }
        let previous = revokeOwner
        if let owner {
            activities?.end(sessionID: owner.uuidString)
            intentCommands?.unbind(sessionID: owner.uuidString)
        }
        owner = candidate; revokeOwner = revoke
        previous?()
    }

    fileprivate func publish(_ snapshot: ReaderNowPlayingSnapshot, owner candidate: UUID) {
        guard isOwner(candidate) else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: snapshot.title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackRate: snapshot.isPlaying ? ReaderPreferences.normalizedSpeechSpeed(snapshot.playbackRate) : 0.0
        ]
        if let author = snapshot.author, !author.isEmpty { info[MPMediaItemPropertyArtist] = author }
        if let chapter = snapshot.chapterTitle, !chapter.isEmpty { info[MPMediaItemPropertyAlbumTitle] = chapter }
        if let image = snapshot.artwork {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { size in
                // MediaPlayer requests a smaller image. Keep this callback
                // independent of reader/account state and of asynchronous loads.
                guard size.width > 0, size.height > 0, size.width.isFinite, size.height.isFinite else { return image }
                if size == image.size { return image }
                let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.preferredRange = .standard
                let scale = min(size.width / image.size.width, size.height / image.size.height)
                let fitted = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                return UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    image.draw(in: CGRect(x: (size.width - fitted.width) / 2, y: (size.height - fitted.height) / 2,
                                          width: fitted.width, height: fitted.height))
                }
            }
        }
        // Replace rather than merge: artwork or identity from a previous book
        // must never survive an absent value in the current snapshot.
        sink.nowPlayingInfo = info
        commands.setEnabled(true, for: .play)
        commands.setEnabled(true, for: .pause)
        commands.setEnabled(true, for: .togglePlayback)
        commands.setEnabled(true, for: .stop)
        commands.setEnabled(snapshot.canPreviousChapter, for: .previousChapter)
        commands.setEnabled(snapshot.canNextChapter, for: .nextChapter)
        activities?.publish(sessionID: candidate.uuidString, state: .init(title: snapshot.title, chapter: snapshot.chapterTitle,
            phase: snapshot.isPlaying ? .playing : snapshot.isPreparing ? .preparing : .paused,
            speed: ReaderPreferences.normalizedSpeechSpeed(snapshot.playbackRate)))
    }

    fileprivate func bindIntents(owner: UUID, handler: @escaping (ListeningPlaybackAction) -> Bool) {
        guard isOwner(owner) else { return }
        intentCommands?.bind(sessionID: owner.uuidString, completion: { [weak self] in await self?.activities?.flush() }, handler: handler)
    }

    fileprivate func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID {
        commands.register(command, handler: handler)
    }
    fileprivate func remove(_ tokens: [UUID]) { tokens.forEach(commands.remove) }

    fileprivate func clear(owner candidate: UUID) {
        guard isOwner(candidate) else { return }
        owner = nil; revokeOwner = nil
        activities?.end(sessionID: candidate.uuidString)
        intentCommands?.unbind(sessionID: candidate.uuidString)
        sink.nowPlayingInfo = nil
        for command in ReaderRemoteCommand.allCases { commands.setEnabled(false, for: command) }
    }
}

/// Create a new controller for each book/source/account session. A cleared or
/// superseded instance stays revoked, including callbacks already in flight.
@MainActor final class ReaderNowPlayingController {
    let identity: ReaderNowPlayingIdentity
    var isCurrentOwner: Bool { !revoked && center.isOwner(owner) }
    private let center: ReaderNowPlayingCenter
    private let owner = UUID()
    private let play: () -> Void
    private let pause: () -> Void
    private let previousChapter: () -> Void
    private let nextChapter: () -> Void
    private let stop: () -> Void
    private var snapshot: ReaderNowPlayingSnapshot?
    private var registrations: [UUID] = []
    private var revoked = false

    init(identity: ReaderNowPlayingIdentity, center: ReaderNowPlayingCenter? = nil,
         play: @escaping () -> Void, pause: @escaping () -> Void,
         previousChapter: @escaping () -> Void, nextChapter: @escaping () -> Void, stop: @escaping () -> Void = {}) {
        self.identity = identity; self.center = center ?? .shared
        self.play = play; self.pause = pause; self.previousChapter = previousChapter; self.nextChapter = nextChapter
        self.stop = stop
    }

    @discardableResult func publish(_ value: ReaderNowPlayingSnapshot) -> Bool {
        guard !revoked, value.identity == identity else { return false }
        center.claim(owner) { [weak self] in self?.revoke() }
        snapshot = value
        if registrations.isEmpty {
            center.bindIntents(owner: owner) { [weak self] action in
                self?.handle(action == .stop ? .stop : .togglePlayback) == .success
            }
            registrations = ReaderRemoteCommand.allCases.map { command in
                center.register(command) { [weak self] in self?.handle(command) ?? .commandFailed }
            }
        }
        center.publish(value, owner: owner)
        return true
    }

    @discardableResult func update(_ value: ReaderNowPlayingSnapshot) -> Bool {
        guard !revoked, value.identity == identity, center.isOwner(owner), snapshot != nil else { return false }
        snapshot = value
        center.publish(value, owner: owner)
        return true
    }

    func clear() {
        center.clear(owner: owner)
        revoke()
    }

    private func revoke() {
        revoked = true; snapshot = nil
        center.remove(registrations); registrations.removeAll()
    }

    private func handle(_ command: ReaderRemoteCommand) -> MPRemoteCommandHandlerStatus {
        guard !revoked, center.isOwner(owner), let snapshot else { return .commandFailed }
        switch command {
        case .play: play()
        case .pause: pause()
        case .togglePlayback:
            if snapshot.isPlaying || snapshot.isPreparing { pause() } else { play() }
        case .stop:
            stop()
            clear()
        case .previousChapter:
            guard snapshot.canPreviousChapter else { return .noSuchContent }
            previousChapter()
        case .nextChapter:
            guard snapshot.canNextChapter else { return .noSuchContent }
            nextChapter()
        }
        return .success
    }

    deinit {
        // Explicit stop normally clears synchronously. This also releases owned
        // registrations if the reader is discarded; the owner guard protects a
        // replacement that publishes before this main-actor cleanup runs.
        let center = center, owner = owner, registrations = registrations
        Task { @MainActor in
            center.remove(registrations)
            center.clear(owner: owner)
        }
    }
}

@MainActor private final class SystemReaderNowPlayingSink: ReaderNowPlayingSink {
    var nowPlayingInfo: [String: Any]? {
        get { MPNowPlayingInfoCenter.default().nowPlayingInfo }
        set { MPNowPlayingInfoCenter.default().nowPlayingInfo = newValue }
    }
}

@MainActor private final class SystemReaderRemoteCommands: ReaderRemoteCommandRegistering {
    private var registrations: [UUID: (command: MPRemoteCommand, target: Any)] = [:]
    private let center = MPRemoteCommandCenter.shared()

    func register(_ command: ReaderRemoteCommand, handler: @escaping @MainActor () -> MPRemoteCommandHandlerStatus) -> UUID {
        let remote = systemCommand(command)
        let target = remote.addTarget { _ in
            if Thread.isMainThread { return MainActor.assumeIsolated { handler() } }
            // MediaPlayer does not promise a callback queue. Never wait on main
            // while it may be removing this target. Ownership is checked again
            // by the controller when this queued action actually runs.
            Task { @MainActor in _ = handler() }
            return .success
        }
        let token = UUID(); registrations[token] = (remote, target)
        return token
    }

    func remove(_ token: UUID) {
        guard let registration = registrations.removeValue(forKey: token) else { return }
        // Passing nil removes every app registration. Remove only ours.
        registration.command.removeTarget(registration.target)
    }

    func setEnabled(_ enabled: Bool, for command: ReaderRemoteCommand) { systemCommand(command).isEnabled = enabled }

    private func systemCommand(_ command: ReaderRemoteCommand) -> MPRemoteCommand {
        switch command {
        case .play: center.playCommand
        case .pause: center.pauseCommand
        case .togglePlayback: center.togglePlayPauseCommand
        case .stop: center.stopCommand
        case .previousChapter: center.previousTrackCommand
        case .nextChapter: center.nextTrackCommand
        }
    }
}
