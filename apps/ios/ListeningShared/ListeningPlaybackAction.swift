import Foundation

enum ListeningPlaybackAction: String, Sendable { case togglePlayback, stop }

/// AudioPlaybackIntent executes in the application process. No account, text,
/// file location or persisted command mailbox crosses the extension boundary.
@MainActor final class ListeningPlaybackCommandCenter {
    static let shared = ListeningPlaybackCommandCenter()
    private var sessionID: String?
    private var handler: ((ListeningPlaybackAction) -> Bool)?
    private var completion: (() async -> Void)?

    func bind(sessionID: String, completion: @escaping () async -> Void = {}, handler: @escaping (ListeningPlaybackAction) -> Bool) {
        self.sessionID = sessionID; self.handler = handler; self.completion = completion
    }
    func perform(_ action: ListeningPlaybackAction, sessionID: String) -> Bool {
        guard self.sessionID == sessionID else { return false }
        return handler?(action) ?? false
    }
    func performAndWait(_ action: ListeningPlaybackAction, sessionID: String) async -> Bool {
        guard self.sessionID == sessionID, let handler else { return false }
        // Stop unbinds synchronously. Capture this owner's drain before that
        // happens, so the intent keeps execution alive through Activity.end.
        let complete = completion
        let accepted = handler(action)
        if accepted { await complete?() }
        return accepted
    }
    func unbind(sessionID: String) {
        guard self.sessionID == sessionID else { return }
        self.sessionID = nil; handler = nil; completion = nil
    }
}
