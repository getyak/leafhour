import Foundation
import Observation
import LeafhourCore

struct ReaderAutoPageConditions: Equatable {
    var isForeground = true
    var isPaged = true
    var hasSelection = false
    var isTouching = false
    var hasPanel = false
    var isListening = false
    var voiceOverEnabled = false
    var hasAlert = false

    var pauseReason: ReaderAutoPagePauseReason? {
        if !isForeground { return .inactive }
        if voiceOverEnabled { return .voiceOver }
        if isListening { return .listening }
        if hasSelection { return .selection }
        if isTouching { return .interaction }
        if hasPanel || hasAlert { return .panel }
        if !isPaged { return .navigation }
        return nil
    }
}

/// Owns one cancellable foreground timer, never a background job. Scene and
/// native interaction changes must be fed through update before another turn.
@MainActor @Observable
final class ReaderAutoPageController {
    private(set) var state = ReaderAutoPageState()
    private(set) var pageRequest: ReaderPageRequest?
    private(set) var conditions = ReaderAutoPageConditions(isForeground: false)
    @ObservationIgnored private var navigationID: UUID?
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private let now: () -> TimeInterval

    init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) { self.now = now }
    deinit { timer?.cancel() }

    var isActive: Bool {
        switch state.phase { case .running, .paused: true; case .stopped, .finished: false }
    }
    var showsStatus: Bool { state.phase != .stopped }

    func update(_ value: ReaderAutoPageConditions, navigationID updatedNavigation: UUID) {
        let previousNavigation = navigationID
        conditions = value; navigationID = updatedNavigation
        if let reason = value.pauseReason {
            pause(reason)
        } else if let previousNavigation, previousNavigation != updatedNavigation, state.pendingRequestID == nil {
            pause(.navigation)
        }
        // Removing an interruption deliberately leaves a paused state paused.
    }

    func start() {
        state.start(at: now(), blockedBy: conditions.pauseReason ?? (navigationID == nil ? .layout : nil))
        pageRequest = nil; schedule()
    }

    func pause(_ reason: ReaderAutoPagePauseReason = .user) {
        state.pause(reason)
        pageRequest = nil; schedule()
    }

    func stop() {
        state.stop(); pageRequest = nil; schedule()
    }

    func setInterval(_ interval: Double) {
        state.setInterval(interval, at: now()); schedule()
    }

    func receive(_ id: UUID, outcome: ReaderPageRequestOutcome) {
        guard pageRequest?.id == id, state.pendingRequestID == id else { return }
        if let reason = conditions.pauseReason { pause(reason); return }
        switch outcome {
        case .settled(let navigation):
            navigationID = navigation; state.pageDidSettle(id, at: now())
        case .end: state.reachedEnd(id)
        case .notReady: state.requestFailed(id, reason: .layout)
        case .blocked: state.requestFailed(id, reason: .interaction)
        }
        pageRequest = nil; schedule()
    }

    func advanceIfDue() {
        guard state.phase == .running else { return }
        if let reason = conditions.pauseReason { pause(reason); return }
        guard let navigationID else { pause(.layout); return }
        if let id = state.requestIfDue(at: now()) {
            pageRequest = ReaderPageRequest(id: id, expectedNavigationID: navigationID)
        }
        schedule()
    }

    private func schedule() {
        timer?.cancel(); timer = nil
        guard state.phase == .running else { return }
        let pending = state.pendingRequestID
        let delay: TimeInterval
        if pending != nil { delay = 5 }
        else if let deadline = state.deadline { delay = max(0, deadline - now()) }
        else { return }
        // Task.sleep throws on cancellation. Always check again on the main
        // actor: a touch, sheet, or scene change can win the deadline race.
        timer = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard !Task.isCancelled, let self else { return }
            if let pending, self.state.pendingRequestID == pending {
                self.receive(pending, outcome: .notReady)
            } else if pending == nil {
                self.advanceIfDue()
            }
        }
    }
}
