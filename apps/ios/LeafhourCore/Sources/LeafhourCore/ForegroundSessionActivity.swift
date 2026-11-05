import Foundation

/// Accepts only app-opening and interaction events supplied by the foreground UI.
@MainActor
public final class ForegroundSessionActivity {
    private let client: CloudLibraryClient
    public private(set) var isForeground = false

    public init(client: CloudLibraryClient) { self.client = client }
    public func setForeground(_ active: Bool) { isForeground = active }

    @discardableResult
    public func record(ownerID: String?, now: Date = Date()) async throws -> Bool {
        guard isForeground, let ownerID else { return false }
        return try await client.recordSessionActivity(ownerID: ownerID, now: now)
    }
}
