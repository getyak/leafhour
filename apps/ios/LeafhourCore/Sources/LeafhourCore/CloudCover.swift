import Foundation
import CryptoKit

public enum CloudCoverPath {
    public static func isAllowed(_ path: String) -> Bool {
        let pattern = #"^(/book-covers/[a-z0-9-]+-(320|640)\.webp|/api/library/books/[A-Za-z0-9_-]{1,128}/cover)(\?v=[A-Za-z0-9_-]{1,128})?$"#
        return path.range(of: pattern, options: .regularExpression) != nil
    }
}

/// Each origin, owner and version gets a separate entry; no shared HTTP cache.
public actor CloudCoverCache {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    public func data(path: String, ownerID: String, client: CloudLibraryClient) async throws -> Data {
        guard CloudCoverPath.isAllowed(path), await client.activeAccount()?.id == ownerID else { throw CancellationError() }
        let origin = await client.baseURL.absoluteString
        let key = SHA256.hash(data: Data((origin + "\n" + ownerID + "\n" + path).utf8)).map { String(format: "%02x", $0) }.joined()
        let file = directory.appendingPathComponent(key + ".image")
        if let cached = try? Data(contentsOf: file), !cached.isEmpty, cached.count <= 4 * 1024 * 1024 {
            guard await client.activeAccount()?.id == ownerID, !Task.isCancelled else { throw CancellationError() }
            return cached
        }
        let bytes = try await client.coverData(path: path, ownerID: ownerID)
        try Task.checkCancellation()
        guard await client.activeAccount()?.id == ownerID else { throw CancellationError() }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try bytes.write(to: file, options: .atomic)
        return bytes
    }
}
