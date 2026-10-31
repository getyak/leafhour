import Foundation

public struct CloudShelfSnapshot: Codable, Equatable, Sendable {
    public let ownerID: String
    public var revision: Int
    public var books: [CloudShelfBook]
    public var archivedBooks: [CloudShelfBook]
    public var order: [String]
    public var archivedBookIDs: Set<String>
    public var pinnedBookIDs: Set<String>
    public var pinsInitialized: Bool
    public let isAuthoritative: Bool
    private struct Cache: Codable { var kind = "leafhour-native-account-shelf-cache-v1"; var snapshot: CloudShelfSnapshot }
    public init(json: CloudJSON, ownerID: String, allowLegacyOwnerless: Bool = false) throws {
        let actual = json["user"]["id"].string
        guard actual == ownerID || (allowLegacyOwnerless && actual == nil && json["kind"].string == nil) else { throw CloudRequestError(status: 409, message: "账号已切换，未载入其他书房。") }
        guard case .array = json["books"] else { throw LibraryError.invalid("书架回执不完整，已保留此前记录。") }
        self.ownerID = ownerID
        let complete = json["kind"].string == "leafhour-account-shelf-v1"
        if complete {
            guard case .array = json["archivedBooks"], case .array = json["shelf"]["order"], case .object = json["shelf"]["archived"], case .array = json["shelf"]["pinned"], json["shelf"]["pinsInitialized"].boolean != nil,
                  let number = json["shelf"]["revision"].number, number >= 0, number.rounded() == number, number < 9_007_199_254_740_991 else { throw LibraryError.invalid("书架状态尚未完整，已保留此前记录。") }
        }
        let number = json["shelf"]["revision"].number ?? json["shelfRevision"].number ?? 0
        guard number.isFinite, number >= 0, number.rounded() == number, number < 9_007_199_254_740_991 else { throw LibraryError.invalid("书架版本无效。") }
        isAuthoritative = complete
        revision = Int(number)
        books = json["books"].array.compactMap(CloudShelfBook.init(json:))
        archivedBooks = complete ? json["archivedBooks"].array.compactMap(CloudShelfBook.init(json:)) : []
        order = complete ? json["shelf"]["order"].array.compactMap(\.string) : []
        guard order.count <= 1000, Set(order).count == order.count, books.count <= 1000, archivedBooks.count <= 1000 else { throw LibraryError.invalid("书架信息较多或重复，已保留此前记录。") }
        archivedBookIDs = complete ? Set(json["shelf"]["archived"].object.keys) : []
        pinnedBookIDs = complete ? Set(json["shelf"]["pinned"].array.compactMap(\.string)) : []
        pinsInitialized = complete && json["shelf"]["pinsInitialized"].boolean == true
    }
    public func cacheData() throws -> Data { try JSONEncoder().encode(Cache(snapshot: self)) }
    public init(cacheData: Data, ownerID: String) throws {
        if let cache = try? JSONDecoder().decode(Cache.self, from: cacheData), cache.kind == "leafhour-native-account-shelf-cache-v1" {
            guard cache.snapshot.ownerID == ownerID else { throw LibraryError.invalid("书架缓存不属于当前账号。") }
            self = cache.snapshot
        } else { try self.init(json: CloudJSON.decode(cacheData), ownerID: ownerID, allowLegacyOwnerless: true) }
    }
}
extension CloudJSON {
    var boolean: Bool? { if case .bool(let value) = self { return value }; return nil }
}
public extension CloudLibraryClient {
    func accountShelf(ownerID: String) async throws -> CloudShelfSnapshot {
        try CloudShelfSnapshot(json: CloudJSON.decode(await data(path: "/api/library?view=account", ownerID: ownerID)), ownerID: ownerID)
    }
    func performAccountAction(_ pending: PendingAccountShelfAction) async throws -> Int? {
        let path: String, body: [String: CloudJSON]
        switch pending.action {
        case .pin(let id, let pinned):
            path = "/api/library/pins"; body = ["bookIds": .array([.string(id)]), "pinned": .bool(pinned), "baseRevision": .number(Double(pending.baseRevision))]
        case .archive(let id), .restore(let id):
            let operation: String; if case .archive = pending.action { operation = "archive" } else { operation = "restore" }
            path = "/api/library/books/" + CloudJSON.component(id) + "/" + operation
            body = ["baseRevision": .number(Double(pending.baseRevision))]
        case .mark(let id, let version, let finished):
            path = "/api/library/books/" + CloudJSON.component(id) + "/reading-milestones"
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            body = ["id": .string(pending.id.uuidString.lowercased()), "bookId": .string(id), "contentVersion": .string(version), "type": .string(finished ? "book_finished" : "book_reopened"), "origin": .string("user"), "createdAt": .string(formatter.string(from: pending.createdAt))]
        }
        let response = try CloudJSON.decode(await data(path: path, method: "POST", body: CloudJSON.encode(body), ownerID: pending.ownerID))
        switch pending.action {
        case .mark(let id, let version, let finished):
            let record = response["record"] == .null ? response : response["record"]
            guard record["id"].string == pending.id.uuidString.lowercased(), record["bookId"].string == id, record["contentVersion"].string == version, record["type"].string == (finished ? "book_finished" : "book_reopened"), record["origin"].string == "user", ReadingRecency.date(record["createdAt"].string) == ReadingRecency.date(body["createdAt"]?.string) else { throw LibraryError.invalid("阅读标记回执无法核对，待同步记录仍保留。") }
            return nil
        default:
            guard let number = response["revision"].number, number >= 0, number.rounded() == number, number < 9_007_199_254_740_991 else { throw LibraryError.invalid("书架调整回执无法核对，待同步记录仍保留。") }
            switch pending.action {
            case .pin(let id, let pinned):
                guard case .array = response["pinned"], response["pinned"].array.compactMap(\.string).contains(id) == pinned else { throw LibraryError.invalid("置顶回执无法核对，待同步调整仍保留。") }
            case .archive(let id):
                guard response["archived"][id].string != nil else { throw LibraryError.invalid("移除回执无法核对，待同步调整仍保留。") }
            case .restore(let id):
                guard case .object = response["archived"], response["archived"][id] == .null else { throw LibraryError.invalid("恢复回执无法核对，待同步调整仍保留。") }
            case .mark: break
            }
            return Int(number)
        }
    }
}
