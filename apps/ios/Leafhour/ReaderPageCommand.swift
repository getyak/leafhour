import Foundation

enum ReaderPageTurnOrigin: Equatable { case user, automatic }

/// Native readers consume an ID once and reject a stale navigation generation.
/// Automatic turns must not be recorded as a real touch or reading interaction.
struct ReaderPageRequest: Equatable {
    let id: UUID
    let expectedNavigationID: UUID
    let direction: ReaderPageDirection
    let origin: ReaderPageTurnOrigin

    init(id: UUID = UUID(), expectedNavigationID: UUID, direction: ReaderPageDirection = .next, origin: ReaderPageTurnOrigin = .automatic) {
        self.id = id; self.expectedNavigationID = expectedNavigationID
        self.direction = direction; self.origin = origin
    }
}

enum ReaderPageRequestOutcome: Equatable {
    /// Only after the visible source and any chapter restoration have settled.
    case settled(navigationID: UUID)
    /// No following page remains, including a turn that just reached the end.
    case end
    case notReady
    case blocked
}
