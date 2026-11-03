import ActivityKit
import AppIntents

struct ToggleListeningPlaybackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "暂停或继续听书"
    static var isDiscoverable: Bool = false
    @Parameter(title: "播放会话") var sessionID: String
    init() {}
    init(sessionID: String) { self.sessionID = sessionID }
    @MainActor func perform() async throws -> some IntentResult {
        await performListeningAction(.togglePlayback, sessionID: sessionID)
        return .result()
    }
}

struct StopListeningPlaybackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "结束听书"
    static var isDiscoverable: Bool = false
    @Parameter(title: "播放会话") var sessionID: String
    init() {}
    init(sessionID: String) { self.sessionID = sessionID }
    @MainActor func perform() async throws -> some IntentResult {
        await performListeningAction(.stop, sessionID: sessionID)
        return .result()
    }
}

@MainActor private func performListeningAction(_ action: ListeningPlaybackAction, sessionID: String) async {
    guard !(await ListeningPlaybackCommandCenter.shared.performAndWait(action, sessionID: sessionID)) else { return }
    // After process termination an old card has no live player to control.
    // Clean only that token; never infer a book or start playback from disk.
    for activity in Activity<ListeningActivityAttributes>.activities where activity.attributes.sessionID == sessionID {
        await activity.end(nil, dismissalPolicy: .immediate)
    }
}
