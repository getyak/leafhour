import ActivityKit
import Foundation
import UIKit

@MainActor protocol ReaderListeningActivityPublishing: AnyObject {
    func publish(sessionID: String, state: ListeningActivityAttributes.ContentState)
    func end(sessionID: String)
    func flush() async
}

@MainActor protocol ReaderListeningActivityBackend: AnyObject {
    var areActivitiesEnabled: Bool { get }
    func existingSessionIDs() -> [String]
    func isActive(sessionID: String) -> Bool
    func start(sessionID: String, state: ListeningActivityAttributes.ContentState) async throws
    func update(sessionID: String, state: ListeningActivityAttributes.ContentState) async
    func end(sessionID: String) async
}

/// Serialize framework calls, but check the latest desired owner across awaits.
/// A dismissed or failed session is attempted once, never recreated per passage.
@MainActor final class ReaderListeningActivityPublisher: ReaderListeningActivityPublishing {
    private struct Presentation: Equatable {
        let sessionID: String
        let state: ListeningActivityAttributes.ContentState
    }
    private let backend: any ReaderListeningActivityBackend
    private var desired: Presentation?
    private var attemptedSessionID: String?
    private var sent: Presentation?
    private var pending: Task<Void, Never>?

    init(backend: (any ReaderListeningActivityBackend)? = nil) { self.backend = backend ?? SystemListeningActivityBackend() }

    func publish(sessionID: String, state: ListeningActivityAttributes.ContentState) {
        let next = Presentation(sessionID: sessionID, state: state)
        guard desired != next else { return }
        desired = next
        let previous = pending
        pending = Task { [self] in await previous?.value; await synchronize() }
    }
    func end(sessionID: String) {
        if desired?.sessionID == sessionID { desired = nil }
        let previous = pending
        pending = Task { [self] in
            await previous?.value
            await backend.end(sessionID: sessionID)
            if sent?.sessionID == sessionID { sent = nil }
        }
    }
    func flush() async { await pending?.value }

    private func synchronize() async {
        guard let target = desired else { return }
        for id in backend.existingSessionIDs() where id != target.sessionID { await backend.end(sessionID: id) }
        guard desired?.sessionID == target.sessionID else { return }
        if backend.isActive(sessionID: target.sessionID) {
            guard sent != target else { return }
            await backend.update(sessionID: target.sessionID, state: target.state)
            sent = target
            return
        }
        guard attemptedSessionID != target.sessionID else { return }
        attemptedSessionID = target.sessionID
        guard backend.areActivitiesEnabled else { return }
        do { try await backend.start(sessionID: target.sessionID, state: target.state) }
        catch { return } // System media playback remains available independently.
        guard desired?.sessionID == target.sessionID else {
            await backend.end(sessionID: target.sessionID); return
        }
        sent = target
        if let current = desired, current != target {
            await backend.update(sessionID: current.sessionID, state: current.state)
            sent = current
        }
    }
}

@MainActor private final class SystemListeningActivityBackend: ReaderListeningActivityBackend {
    var areActivitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    private var activities: [Activity<ListeningActivityAttributes>] { Activity<ListeningActivityAttributes>.activities }
    func existingSessionIDs() -> [String] { activities.map { $0.attributes.sessionID } }
    func isActive(sessionID: String) -> Bool {
        activities.contains { $0.attributes.sessionID == sessionID && ($0.activityState == .active || $0.activityState == .stale) }
    }
    func start(sessionID: String, state: ListeningActivityAttributes.ContentState) async throws {
        // Resuming from a background command may update an existing card, but
        // must not work around a person's dismissal by creating another one.
        guard UIApplication.shared.applicationState == .active else { return }
        _ = try Activity.request(attributes: ListeningActivityAttributes(sessionID: sessionID),
            content: ActivityContent(state: state, staleDate: nil), pushType: nil)
    }
    func update(sessionID: String, state: ListeningActivityAttributes.ContentState) async {
        for activity in activities where activity.attributes.sessionID == sessionID {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }
    func end(sessionID: String) async {
        for activity in activities where activity.attributes.sessionID == sessionID {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
