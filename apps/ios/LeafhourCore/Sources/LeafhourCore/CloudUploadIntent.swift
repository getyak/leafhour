import Foundation

/// Frozen before sending original bytes. A saved receipt resumes download/migration;
/// a missing receipt resends the exact same policy and operation, never a fresh choice.
public struct CloudUploadIntent: Codable, Equatable, Sendable {
    public var operationID: UUID
    public var ownerID: String
    public var sourceVersion: String
    public var policy: DuplicateImportPolicy
    public var bookID: String?
    public var contentVersion: String?
}

public extension OfflineLibrary {
    func pendingUpload(_ bookID: String, ownerID: String, sourceVersion: String) throws -> CloudUploadIntent? {
        let file = try uploadIntentURL(bookID)
        guard Disk.fm.fileExists(atPath: file.path) else { return nil }
        let intent = try Disk.read(CloudUploadIntent.self, from: file)
        guard intent.ownerID == ownerID, intent.sourceVersion == sourceVersion else { throw LibraryError.invalid("上传恢复记录与当前账号或原件不一致，已保留记录。") }
        return intent
    }
    func beginUpload(_ bookID: String, ownerID: String, sourceVersion: String, policy: DuplicateImportPolicy) throws -> CloudUploadIntent {
        if let pending = try pendingUpload(bookID, ownerID: ownerID, sourceVersion: sourceVersion) { return pending }
        let intent = CloudUploadIntent(operationID: UUID(), ownerID: ownerID, sourceVersion: sourceVersion, policy: policy)
        try Disk.write(intent, to: uploadIntentURL(bookID))
        return intent
    }
    func retainUploadReceipt(_ intent: CloudUploadIntent, localBookID: String, bookID: String, contentVersion: String) throws -> CloudUploadIntent {
        guard var current = try pendingUpload(localBookID, ownerID: intent.ownerID, sourceVersion: intent.sourceVersion), current.operationID == intent.operationID,
              NativeBookLink.isContentID(bookID), !contentVersion.isEmpty,
              current.bookID == nil || current.bookID == bookID,
              current.contentVersion == nil || current.contentVersion == contentVersion else { throw LibraryError.invalid("上传回执与恢复记录不一致。") }
        current.bookID = bookID; current.contentVersion = contentVersion
        try Disk.write(current, to: uploadIntentURL(localBookID))
        return current
    }
    func finishUpload(_ intent: CloudUploadIntent, localBookID: String) throws {
        guard let current = try pendingUpload(localBookID, ownerID: intent.ownerID, sourceVersion: intent.sourceVersion), current.operationID == intent.operationID,
              current.bookID != nil, current.contentVersion != nil else { throw LibraryError.invalid("上传尚无完整回执，恢复记录仍保留。") }
        try Disk.fm.removeItem(at: uploadIntentURL(localBookID))
    }
    private func uploadIntentURL(_ bookID: String) throws -> URL {
        let directory = try bookDirectory(bookID)
        guard Disk.fm.fileExists(atPath: directory.appendingPathComponent("manifest.json").path) else { throw LibraryError.invalid("此书不属于当前书房。") }
        return root.appendingPathComponent("states/" + bookID + "-upload.json")
    }
}
