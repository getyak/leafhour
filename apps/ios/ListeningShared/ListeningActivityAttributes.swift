import ActivityKit
import Foundation

struct ListeningActivityAttributes: ActivityAttributes {
    /// Random per-playback token; never an account or source identifier.
    var sessionID: String

    struct ContentState: Codable, Hashable, Sendable {
        var title: String
        var chapter: String?
        var phase: Phase
        var speed: Double
        var elapsedOutputSeconds: TimeInterval = 0
        var outputTimerStartDate: Date?
    }
    enum Phase: String, Codable, Hashable, Sendable {
        case preparing, playing, paused
        var label: String {
            switch self { case .preparing: "准备声音"; case .playing: "听书中"; case .paused: "已暂停" }
        }
        var symbol: String {
            switch self { case .preparing: "speaker"; case .playing: "waveform"; case .paused: "pause.fill" }
        }
    }
}
