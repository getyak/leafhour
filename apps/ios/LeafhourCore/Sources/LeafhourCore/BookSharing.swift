import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Content links are intents, never instructions to fetch a supplied URL with an account cookie.
public enum NativeBookLink: Equatable, Sendable, Identifiable {
    case gift(String)
    case read(bookID: String, passageID: String?)
    public var id: String {
        switch self { case .gift(let token): return "gift:" + token; case .read(let id, let passage): return "read:" + id + ":" + (passage ?? "") }
    }
    public init(_ url: URL, origin: URL = URL(string: "https://leafhour.com")!) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), url.user == nil, url.password == nil,
              parts.fragment == nil, url.absoluteString.utf8.count <= 2048 else { throw Self.invalid() }
        let isCustom = parts.scheme?.lowercased() == "leafhour"
        if isCustom {
            guard parts.port == nil else { throw Self.invalid() }
        } else {
            guard parts.scheme == "https", parts.host?.lowercased() == origin.host?.lowercased(),
                  parts.port == origin.port, origin.scheme == "https" else { throw Self.invalid() }
        }
        let path = isCustom ? "/" + (parts.host ?? "") + parts.percentEncodedPath : parts.percentEncodedPath
        let query = parts.queryItems ?? []
        guard Set(query.map(\.name)).count == query.count,
              query.allSatisfy({ ["ui", "book", "passage"].contains($0.name) }),
              query.first(where: { $0.name == "ui" }).map({ ["en", "zh-Hans", "zh-Hant", "ja"].contains($0.value ?? "") }) ?? true else { throw Self.invalid() }
        if path.hasPrefix("/gift/") {
            let token = String(path.dropFirst(6))
            guard Self.isGiftToken(token), query.allSatisfy({ $0.name == "ui" }) else { throw Self.invalid() }
            self = .gift(token)
        } else if path == "/read" {
            guard let book = query.first(where: { $0.name == "book" })?.value, Self.isContentID(book) else { throw Self.invalid() }
            let passage = query.first(where: { $0.name == "passage" })?.value
            guard query.first(where: { $0.name == "passage" }) == nil || passage.map(Self.isContentID) == true else { throw Self.invalid() }
            self = .read(bookID: book, passageID: passage)
        } else { throw Self.invalid() }
    }
    public static func isGiftToken(_ value: String) -> Bool { value.utf8.count == 43 && value.utf8.allSatisfy(isIDByte) }
    public static func isContentID(_ value: String) -> Bool { !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy(isIDByte) }
    private static func isIDByte(_ byte: UInt8) -> Bool { (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) || byte == 45 || byte == 95 }
    private static func invalid() -> LibraryError { .invalid("此链接无法在书房中导入。请使用 Leafhour 赠书链接或支持的书籍文件。") }
}

public extension CloudShelfBook {
    func publicReadingURL(origin: URL = URL(string: "https://leafhour.com")!, passageID: String? = nil) -> URL? {
        guard visibility == "public", NativeBookLink.isContentID(id), origin.scheme == "https", origin.user == nil, origin.password == nil,
              passageID == nil || NativeBookLink.isContentID(passageID!) else { return nil }
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        parts?.path = "/read"; parts?.fragment = nil
        parts?.queryItems = [URLQueryItem(name: "book", value: id)] + (passageID.map { [URLQueryItem(name: "passage", value: $0)] } ?? [])
        return parts?.url
    }
}

/// A bounded projection of the existing Web gift. It cannot contain notes or a book manifest.
public struct BookGift: Identifiable, Sendable {
    public let token: String
    public let bookID: String
    public let title: String
    public let author: String
    public let sender: String
    public let message: String
    public let includeTranslations: Bool
    public var id: String { token }
    public init(json: CloudJSON) throws {
        guard let token = json["token"].string, NativeBookLink.isGiftToken(token),
              let book = json["bookId"].string, NativeBookLink.isContentID(book),
              json["shareUrl"].string == nil || json["shareUrl"].string == "/gift/" + token,
              case .bool(let includes) = json["includeTranslations"] else { throw LibraryError.invalid("赠书回执无法核对，请重新打开链接。") }
        let title = CloudShelfBook.title(json["title"])
        guard title.utf8.count <= 4096 else { throw LibraryError.invalid("赠书书名较长，暂时无法显示。") }
        self.token = token; bookID = book; self.title = title; includeTranslations = includes
        author = String((json["author"].string ?? "").prefix(500))
        sender = String((json["sender"].string ?? "一位读者").prefix(200))
        message = String((json["message"].string ?? "").prefix(500))
    }
    public func url(origin: URL = URL(string: "https://leafhour.com")!) -> URL {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = "/gift/" + token; parts.query = nil; parts.fragment = nil
        return parts.url!
    }
}

public struct AcceptedBookGift: Sendable {
    public let bookID: String
    public let alreadyOwned: Bool
}

public extension CloudLibraryClient {
    /// Archiving affects shelf presentation; the content service remains the access authority.
    func readableBook(bookID: String, ownerID: String) async throws -> CloudShelfBook {
        guard NativeBookLink.isContentID(bookID) else { throw LibraryError.invalid("书籍链接无效。") }
        let value = try CloudJSON.decode(await data(path: "/api/library/books/" + CloudJSON.component(bookID) + "/reading-manifest", ownerID: ownerID))
        guard let book = CloudShelfBook(json: value), book.id == bookID else { throw LibraryError.invalid("书籍来源无法核对，请重新打开分享链接。") }
        return book
    }
    func createBookGift(bookID: String, ownerID: String, includeTranslations: Bool, message: String = "") async throws -> BookGift {
        guard NativeBookLink.isContentID(bookID), message.count <= 500 else { throw LibraryError.invalid("书籍或赠书留言无效。") }
        let value = try CloudJSON.decode(await data(path: "/api/library/books/" + CloudJSON.component(bookID) + "/gifts", method: "POST",
            body: CloudJSON.encode(["includeTranslations": .bool(includeTranslations), "message": .string(message), "recipient": .string("")]), ownerID: ownerID))
        let gift = try BookGift(json: value)
        guard gift.bookID == bookID, gift.includeTranslations == includeTranslations, value["shareUrl"].string == "/gift/" + gift.token else { throw LibraryError.invalid("分享回执与预览范围不一致，请到网页核对已发布的赠书信。") }
        return gift
    }
    func bookGift(token: String) async throws -> BookGift {
        guard NativeBookLink.isGiftToken(token), baseURL.scheme == "https" || ["localhost", "127.0.0.1"].contains(baseURL.host ?? "") else { throw LibraryError.invalid("赠书链接无效。") }
        // Public previews deliberately use an isolated, cookie-free session.
        let configuration = publicPreviewConfiguration.copy() as! URLSessionConfiguration
        let transport = URLSession(configuration: configuration, delegate: BookGiftRedirectPolicy(), delegateQueue: nil)
        defer { transport.invalidateAndCancel() }
        var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        parts.path = "/api/book-gifts/" + token; parts.query = nil; parts.fragment = nil
        var request = URLRequest(url: parts.url!); request.timeoutInterval = 30; request.cachePolicy = .reloadIgnoringLocalCacheData
        let (bytes, response) = try await transport.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw CloudRequestError(status: (response as? HTTPURLResponse)?.statusCode ?? 502, message: "赠书信已收回，或暂时无法打开。可稍后重试。") }
        guard bytes.count <= 64 * 1024 else { throw LibraryError.invalid("赠书预览较大，请在网页中查看。") }
        let gift = try BookGift(json: CloudJSON.decode(bytes))
        guard gift.token == token else { throw LibraryError.invalid("赠书链接与预览无法对应。") }
        return gift
    }
    func acceptBookGift(token: String, ownerID: String) async throws -> AcceptedBookGift {
        guard NativeBookLink.isGiftToken(token) else { throw LibraryError.invalid("赠书链接无效。") }
        let value = try CloudJSON.decode(await data(path: "/api/book-gifts/" + token + "/accept", method: "POST", body: CloudJSON.encode([:]), ownerID: ownerID))
        guard let book = value["bookId"].string, NativeBookLink.isContentID(book),
              value["readUrl"].string == "/read?book=" + CloudJSON.component(book), case .bool(let owned) = value["alreadyOwned"] else { throw LibraryError.invalid("收书结果尚未确认，请刷新书房核对；已有书籍与记录仍保留。") }
        return AcceptedBookGift(bookID: book, alreadyOwned: owned)
    }
    func revokeBookGift(token: String, ownerID: String) async throws {
        guard NativeBookLink.isGiftToken(token) else { throw LibraryError.invalid("赠书链接无效。") }
        let value = try CloudJSON.decode(await data(path: "/api/book-gifts/" + token + "/revoke", method: "POST", body: CloudJSON.encode([:]), ownerID: ownerID))
        guard value["revoked"] == .bool(true) else { throw LibraryError.invalid("赠书链接尚未确认收回，请在网页中核对。") }
    }
}

private final class BookGiftRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
