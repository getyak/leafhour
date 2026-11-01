import Foundation

public enum ReaderAutoPagePauseReason: String, CaseIterable, Equatable, Sendable {
    case user, inactive, interaction, selection, panel, listening, voiceOver, navigation, layout
}

public enum ReaderAutoPagePhase: Equatable, Sendable {
    case stopped, running, paused(ReaderAutoPagePauseReason), finished
}

/// A foreground-only schedule. The caller supplies monotonic time; no elapsed
/// background time or page count is recovered, and this state is never encoded.
public struct ReaderAutoPageState: Equatable, Sendable {
    public private(set) var phase: ReaderAutoPagePhase = .stopped
    public private(set) var interval: Double
    public private(set) var deadline: TimeInterval?
    public private(set) var pendingRequestID: UUID?

    public init(interval: Double = 30) { self.interval = Self.normalizedInterval(interval) }

    public static func normalizedInterval(_ value: Double) -> Double {
        guard value.isFinite else { return 30 }
        return (min(120, max(5, value)) / 5).rounded() * 5
    }

    public mutating func start(at now: TimeInterval, blockedBy reason: ReaderAutoPagePauseReason? = nil) {
        pendingRequestID = nil
        if let reason {
            phase = .paused(reason); deadline = nil
        } else {
            phase = .running; deadline = now + interval
        }
    }

    public mutating func pause(_ reason: ReaderAutoPagePauseReason) {
        guard phase == .running else { return }
        phase = .paused(reason); deadline = nil; pendingRequestID = nil
    }

    public mutating func stop() {
        phase = .stopped; deadline = nil; pendingRequestID = nil
    }

    public mutating func setInterval(_ value: Double, at now: TimeInterval) {
        let updated = Self.normalizedInterval(value)
        guard interval != updated else { return }
        interval = updated
        if phase == .running, pendingRequestID == nil { deadline = now + interval }
    }

    /// One request waits for one native layout receipt. A delayed wake never
    /// manufactures several turns to make up for missed deadlines.
    public mutating func requestIfDue(at now: TimeInterval) -> UUID? {
        guard phase == .running, pendingRequestID == nil, let deadline, now >= deadline else { return nil }
        let request = UUID()
        pendingRequestID = request; self.deadline = nil
        return request
    }

    public mutating func pageDidSettle(_ request: UUID, at now: TimeInterval) {
        guard phase == .running, pendingRequestID == request else { return }
        pendingRequestID = nil; deadline = now + interval
    }

    public mutating func reachedEnd(_ request: UUID) {
        guard phase == .running, pendingRequestID == request else { return }
        phase = .finished; pendingRequestID = nil; deadline = nil
    }

    public mutating func requestFailed(_ request: UUID, reason: ReaderAutoPagePauseReason) {
        guard pendingRequestID == request else { return }
        pause(reason)
    }
}
