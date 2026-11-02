import Foundation
import CryptoKit

extension OfflineLibrary {
    private func conversationFile(bookID: String, ownerID: String) throws -> URL {
        guard let owner = UUID(uuidString: ownerID), root.lastPathComponent == LibraryScope.account(owner).folder,
              !bookID.isEmpty, bookID.utf8.count <= 512 else { throw LibraryError.invalid("对话草稿不属于这间书房。") }
        let key = SHA256.hash(data: Data(bookID.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent("chat-" + key + ".json")
    }
    public func conversationDraft(bookID: String, ownerID: String) throws -> Data? {
        let file = try conversationFile(bookID: bookID, ownerID: ownerID)
        return FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
    }
    public func saveConversationDraft(_ data: Data, bookID: String, ownerID: String) throws {
        try data.write(to: conversationFile(bookID: bookID, ownerID: ownerID), options: .atomic)
    }
}
