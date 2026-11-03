import Foundation

/// Presentation-only listening time. This never writes the reading ledger.
/// The stable date lets the system tick without per-second app execution;
/// monotonic uptime owns accumulated output time across pauses/clock changes.
public struct ListeningOutputClock: Sendable {
    /// Completed intervals; the current interval is represented by timerStartDate.
    public private(set) var elapsedSeconds: TimeInterval = 0
    public private(set) var timerStartDate: Date?
    private var startedUptime: TimeInterval?
    public init() {}

    public mutating func setOutputPlaying(_ playing: Bool, at date: Date, uptime: TimeInterval) {
        guard date.timeIntervalSince1970.isFinite, uptime.isFinite else { return }
        if playing {
            if let start = startedUptime, let anchor = timerStartDate {
                let actualSeconds = elapsedSeconds + max(0, uptime - start)
                if abs(date.timeIntervalSince(anchor) - actualSeconds) >= 1 {
                    timerStartDate = date.addingTimeInterval(-actualSeconds)
                }
                return
            }
            startedUptime = uptime
            timerStartDate = date.addingTimeInterval(-elapsedSeconds)
        } else if let start = startedUptime {
            elapsedSeconds += max(0, uptime - start)
            startedUptime = nil; timerStartDate = nil
        }
    }
}
