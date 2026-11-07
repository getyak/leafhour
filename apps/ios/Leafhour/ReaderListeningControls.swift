import Foundation

enum ReaderSurfaceMode: Equatable { case reading, listening }

/// Navigation may sleep automatically. Playback only folds by explicit choice.
struct ReaderListeningControls: Equatable {
    private(set) var navigationVisible = true
    private(set) var transportExpanded = true
    mutating func sleepNavigation() { navigationVisible = false }
    mutating func wakeNavigation() { navigationVisible = true }
    mutating func collapseTransport() { transportExpanded = false }
    mutating func expandTransport() { transportExpanded = true }
}
