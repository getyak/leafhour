import Foundation

public enum AccountShelfAction: Codable, Equatable, Sendable {
    case pin(bookID: String, pinned: Bool)
    case archive(bookID: String)
    case restore(bookID: String)
    case mark(bookID: String, contentVersion: String, finished: Bool)
    public var bookID: String { switch self { case .pin(let id, _), .archive(let id), .restore(let id), .mark(let id, _, _): return id } }
    var intentKey: String { switch self { case .pin: return "pin:" + bookID; case .archive, .restore: return "archive:" + bookID; case .mark: return "mark:" + bookID } }
}
public struct PendingAccountShelfAction: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let ownerID: String
    public let action: AccountShelfAction
    public var baseRevision: Int
    public let createdAt: Date
    public var conflict: Bool
    public var error: String?
}
private struct AccountShelfActionFile: Codable { let ownerID: String; var actions: [PendingAccountShelfAction] }
public extension OfflineLibrary {
    private func accountActionFile(_ ownerID: String) throws -> URL {
        guard let uuid = UUID(uuidString: ownerID), root.lastPathComponent == "account-" + uuid.uuidString.lowercased() else { throw LibraryError.invalid("待同步书架不属于当前账号。") }
        return root.appendingPathComponent("account-shelf-actions.json")
    }
    func accountActions(ownerID: String) throws -> [PendingAccountShelfAction] {
        let file = try accountActionFile(ownerID)
        guard Disk.fm.fileExists(atPath: file.path) else { return [] }
        let value = try Disk.read(AccountShelfActionFile.self, from: file)
        guard value.ownerID == ownerID, value.actions.allSatisfy({ $0.ownerID == ownerID }), value.actions.count <= 2000 else { throw LibraryError.invalid("待同步书架归属无法核对，已保留原文件。") }
        return value.actions
    }
    @discardableResult func enqueueAccountAction(ownerID: String, action: AccountShelfAction, baseRevision: Int) throws -> PendingAccountShelfAction {
        guard baseRevision >= 0, action.bookID.count <= 128, !action.bookID.isEmpty else { throw LibraryError.invalid("请选择有效的书架调整。") }
        var actions = try accountActions(ownerID: ownerID)
        let pending = PendingAccountShelfAction(id: UUID(), ownerID: ownerID, action: action, baseRevision: baseRevision, createdAt: Date(), conflict: false)
        actions.removeAll { $0.action.intentKey == action.intentKey }
        guard actions.count < 2000 else { throw LibraryError.invalid("待同步调整较多，请先连接书房后重试。") }
        actions.append(pending)
        try Disk.write(AccountShelfActionFile(ownerID: ownerID, actions: actions), to: accountActionFile(ownerID))
        return pending
    }
    func acknowledgeAccountAction(_ pending: PendingAccountShelfAction, revision: Int?) throws {
        var actions = try accountActions(ownerID: pending.ownerID)
        actions.removeAll { $0.id == pending.id }
        // An ACK can arrive after another local intent replaced the request.
        // Only advance intents based on the same acknowledged shelf version.
        if let revision { for index in actions.indices where !actions[index].conflict && actions[index].baseRevision == pending.baseRevision { actions[index].baseRevision = revision } }
        try Disk.write(AccountShelfActionFile(ownerID: pending.ownerID, actions: actions), to: accountActionFile(pending.ownerID))
    }
    func failAccountAction(_ pending: PendingAccountShelfAction, conflict: Bool, message: String) throws {
        var actions = try accountActions(ownerID: pending.ownerID)
        guard let index = actions.firstIndex(where: { $0.id == pending.id }) else { return }
        actions[index].conflict = conflict; actions[index].error = message
        try Disk.write(AccountShelfActionFile(ownerID: pending.ownerID, actions: actions), to: accountActionFile(pending.ownerID))
    }
    func retryAccountAction(_ id: UUID, ownerID: String, baseRevision: Int) throws {
        var actions = try accountActions(ownerID: ownerID)
        guard let index = actions.firstIndex(where: { $0.id == id }), baseRevision >= 0 else { return }
        actions[index].baseRevision = baseRevision; actions[index].conflict = false; actions[index].error = nil
        try Disk.write(AccountShelfActionFile(ownerID: ownerID, actions: actions), to: accountActionFile(ownerID))
    }
    func discardAccountAction(_ id: UUID, ownerID: String) throws {
        let actions = try accountActions(ownerID: ownerID).filter { $0.id != id }
        try Disk.write(AccountShelfActionFile(ownerID: ownerID, actions: actions), to: accountActionFile(ownerID))
    }
}
