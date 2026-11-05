import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum CloudUploadPhase: Sendable { case preparing, sending, processing }

public enum CloudOriginalUploadPolicy {
    public static func maximumBytes(filename: String) -> Int64 {
        let mebibytes: Int64
        switch URL(fileURLWithPath: filename).pathExtension.lowercased() {
        case "txt", "md", "markdown": mebibytes = 64
        case "pdf": mebibytes = 256
        default: mebibytes = 20
        }
        return mebibytes * 1024 * 1024
    }
}

public struct CloudAccount: Codable, Equatable, Sendable {
    public var id: String
    public var email: String?
    public init(id: String, email: String?) { self.id = id; self.email = email }
}

public struct CloudBookIdentity: Codable, Equatable, Sendable {
    public var ownerID: String
    public var bookID: String
    public var contentVersion: String
    public var sourceFormat: String
    public init(ownerID: String, bookID: String, contentVersion: String, sourceFormat: String) {
        self.ownerID = ownerID; self.bookID = bookID; self.contentVersion = contentVersion; self.sourceFormat = sourceFormat
    }
}

public struct CloudCredential: Codable, Sendable {
    public var account: CloudAccount
    public var token: String
    public init(account: CloudAccount, token: String) { self.account = account; self.token = token }
}

public struct CloudRequestError: Error, LocalizedError, Sendable {
    public var status: Int
    public var message: String
    public var billingOperationStatus: String?
    public var errorDescription: String? { message }
    public init(status: Int, message: String, billingOperationStatus: String? = nil) { self.status = status; self.message = message; self.billingOperationStatus = billingOperationStatus }
}

/// Cookies are private to this client and never enter the shared browser cookie store.
/// Every request captures its owner and generation before suspension.
public actor CloudLibraryClient {
    public nonisolated let baseURL: URL
    /// Separate public transport retains custom URL loading protocols but never ambient account secrets.
    let publicPreviewConfiguration: URLSessionConfiguration
    private let session: URLSession
    private var credential: CloudCredential?
    private var generation = UUID()
    private struct SessionActivityAttempt {
        let id: UUID
        let generation: UUID
        let ownerID: String
        let token: String
        let date: Date
        var inFlight: Bool
    }
    private var sessionActivityAttempt: SessionActivityAttempt?
    private struct NativePending {
        let flow: NativeOAuthFlow
        let generation: UUID
        let parentToken: String?
        var exchanging = false
    }
    private var nativeStartingID: UUID?
    private var nativePending: NativePending?
    public init(baseURL: URL = URL(string: "https://leafhour.com")!, credential: CloudCredential? = nil, configuration: URLSessionConfiguration = .ephemeral) {
        self.baseURL = baseURL; self.credential = credential
        let preview = configuration.copy() as! URLSessionConfiguration
        preview.httpShouldSetCookies = false; preview.httpCookieStorage = nil; preview.urlCredentialStorage = nil
        preview.httpAdditionalHeaders = nil; preview.urlCache = nil
        publicPreviewConfiguration = preview
        configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 45
        self.session = URLSession(configuration: configuration, delegate: NoCloudRedirect(), delegateQueue: nil)
    }
    public func savedCredential() -> CloudCredential? { credential }
    public func activeAccount() -> CloudAccount? { credential?.account }
    /// Only explicit foreground activity extends a session. Failed attempts also
    /// observe the cooldown so an expired session cannot retry on every gesture.
    @discardableResult
    public func recordSessionActivity(ownerID: String, now: Date = Date()) async throws -> Bool {
        try Task.checkCancellation()
        guard let credential, credential.account.id == ownerID else { throw Self.changed() }
        let marker = generation
        if let previous = sessionActivityAttempt,
           previous.generation == marker, previous.ownerID == ownerID, previous.token == credential.token,
           previous.inFlight || now.timeIntervalSince(previous.date) < 300 { return false }
        let attempt = UUID()
        sessionActivityAttempt = SessionActivityAttempt(id: attempt, generation: marker, ownerID: ownerID, token: credential.token, date: now, inFlight: true)
        defer { if sessionActivityAttempt?.id == attempt { sessionActivityAttempt?.inFlight = false } }
        let bytes = try await data(path: "/api/auth/session/activity", method: "POST", body: CloudJSON.encode(["client": .string("ios")]), ownerID: ownerID)
        try Task.checkCancellation()
        guard marker == generation, self.credential?.account.id == ownerID, self.credential?.token == credential.token else { throw Self.changed() }
        let receipt = try CloudJSON.decode(bytes)
        guard Self.account(receipt["user"])?.id == ownerID,
              let expiresAt = receipt["expiresAt"].number, expiresAt.isFinite,
              expiresAt > now.timeIntervalSince1970 * 1000,
              receipt["maxAge"].number == 7_776_000 else {
            throw CloudRequestError(status: 502, message: "登录活动尚未确认，已保留本机书籍与记录。")
        }
        return true
    }
    public func restore() async throws -> CloudAccount? {
        let expected = credential?.account.id
        let value = try CloudJSON.decode(await data(path: "/api/auth/session"))
        guard let account = Self.account(value["user"]), expected == nil || expected == account.id else {
            credential = nil; generation = UUID(); return nil
        }
        guard UUID(uuidString: account.id) != nil else { throw CloudRequestError(status: 409, message: "这个账号暂不支持原生同步，请使用邮箱账号进入自己的书房。") }
        if let token = credential?.token { credential = CloudCredential(account: account, token: token) }
        return account
    }
    public func signIn(email: String, password: String) async throws -> CloudAccount {
        nativeStartingID = nil; nativePending = nil
        credential = nil; generation = UUID()
        let marker = generation
        let (bytes, response) = try await perform(path: "/api/auth/password", method: "POST", body: CloudJSON.encode(["email": .string(email), "password": .string(password), "client": .string("ios")]), ownerID: nil)
        guard marker == generation else { throw Self.changed() }
        let value = try CloudJSON.decode(bytes)
        guard let account = Self.account(value["user"]), UUID(uuidString: account.id) != nil,
              let header = response.value(forHTTPHeaderField: "Set-Cookie"),
              let token = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: baseURL).first(where: { $0.name == "marginalia_session" })?.value,
              !token.isEmpty else { throw CloudRequestError(status: 502, message: "登录回执不完整，请稍后重试。") }
        credential = CloudCredential(account: account, token: token)
        return account
    }
    public func requestCode(email: String, purpose: String = "login") async throws {
        _ = try await data(path: "/api/auth/code", method: "POST", body: CloudJSON.encode(["email": .string(email), "purpose": .string(purpose)]))
    }
    public func verifyCode(email: String, code: String) async throws -> CloudAccount {
        nativeStartingID = nil; nativePending = nil
        credential = nil; generation = UUID()
        let marker = generation
        let (bytes, response) = try await perform(path: "/api/auth/verify", method: "POST", body: CloudJSON.encode(["email": .string(email), "code": .string(code), "purpose": .string("login"), "client": .string("ios")]), ownerID: nil)
        guard marker == generation else { throw Self.changed() }
        let value = try CloudJSON.decode(bytes)
        guard let account = Self.account(value["user"]), UUID(uuidString: account.id) != nil,
              let header = response.value(forHTTPHeaderField: "Set-Cookie"),
              let token = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: baseURL).first(where: { $0.name == "marginalia_session" })?.value else { throw CloudRequestError(status: 502, message: "登录回执不完整。") }
        credential = CloudCredential(account: account, token: token); return account
    }
    public func signOut() async {
        await cancelNativeOAuth()
        let old = credential
        credential = nil; generation = UUID()
        guard let old else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/logout"))
        request.httpMethod = "POST"; request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue("marginalia_session=" + old.token, forHTTPHeaderField: "Cookie")
        request.setValue(old.account.id, forHTTPHeaderField: "X-Reader-Owner")
        _ = try? await session.data(for: request)
    }
    public func data(path: String, method: String = "GET", body: Data? = nil, ownerID: String? = nil, timeout: TimeInterval = 45) async throws -> Data {
        try await perform(path: path, method: method, body: body, ownerID: ownerID, timeout: timeout).0
    }
    // A whole download spans many requests and progress callbacks. A new request's
    // own fence cannot detect a sign-out/sign-in of the same owner between parts.
    func readingDownloadGeneration(ownerID: String) throws -> UUID {
        try Task.checkCancellation()
        guard credential?.account.id == ownerID else { throw Self.changed() }
        return generation
    }
    func validateReadingDownload(ownerID: String, generation marker: UUID) throws {
        try Task.checkCancellation()
        guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
    }
    func readingCopyData(path: String, ownerID: String, preparing: Bool = false) async throws -> Data {
        try await perform(path: path, method: "GET", body: nil, ownerID: ownerID, timeout: preparing ? 180 : 45).0
    }
    public func coverData(path: String, ownerID: String) async throws -> Data {
        guard CloudCoverPath.isAllowed(path), credential?.account.id == ownerID else { throw Self.changed() }
        let marker = generation
        let bytes: Data
        let response: HTTPURLResponse
        if path.hasPrefix("/api/") {
            (bytes, response) = try await privateCoverResponse(path: path, ownerID: ownerID)
        } else {
            // Public artwork never receives account credentials or shared cookies.
            guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL, url.host == baseURL.host,
                  url.scheme == baseURL.scheme else { throw Self.changed() }
            var request = URLRequest(url: url)
            request.setValue("image/webp,image/*", forHTTPHeaderField: "Accept")
            let (data, reply) = try await session.data(for: request)
            guard let http = reply as? HTTPURLResponse, http.statusCode == 200 else { throw CloudRequestError(status: 404, message: "封面暂不可用。") }
            bytes = data; response = http
        }
        guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
        guard bytes.count <= 4 * 1024 * 1024, !bytes.isEmpty, response.mimeType?.hasPrefix("image/") == true else {
            throw CloudRequestError(status: 413, message: "封面暂不可用。")
        }
        return bytes
    }
    private func privateCoverResponse(path: String, ownerID: String) async throws -> (Data, HTTPURLResponse) {
        for delay in [0, 2, 8, 25, 60] {
            if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
            do { return try await perform(path: path, method: "GET", body: nil, ownerID: ownerID, timeout: 120) }
            catch let error as CloudRequestError where error.status == 503 && delay < 60 { continue }
        }
        throw CloudRequestError(status: 503, message: "封面暂不可用。")
    }
    public func nativeAuthenticationStatus() async throws -> NativeAuthenticationStatus {
        let owner = credential?.account.id
        let value = try CloudJSON.decode(await data(path: "/api/auth/session", ownerID: owner))
        if let owner, value["user"]["id"].string != owner { throw Self.changed() }
        return NativeAuthenticationStatus(value)
    }
    public func linkedIdentities(ownerID: String) async throws -> [CloudLinkedIdentity] {
        let value = try CloudJSON.decode(await data(path: "/api/auth/identities", ownerID: ownerID))
        guard value["user"]["id"].string == ownerID else { throw Self.changed() }
        var seen = Set<String>()
        return value["identities"].array.compactMap(CloudLinkedIdentity.init).filter { seen.insert($0.provider).inserted }
    }
    public func beginNativeOAuth(provider: NativeOAuthProvider, mode: NativeOAuthMode, proof: NativeOAuthProof? = nil) async throws -> NativeOAuthFlow {
        guard nativeStartingID == nil, nativePending == nil else { throw CloudRequestError(status: 409, message: "请先完成或关闭当前登录窗口。") }
        guard mode == .link ? credential != nil : credential == nil else { throw Self.changed() }
        let proof = try proof ?? NativeOAuthProof.generate(), id = UUID(), marker = generation
        let owner = credential?.account.id, parentToken = credential?.token, startedAt = Date()
        nativeStartingID = id
        defer { if nativeStartingID == id { nativeStartingID = nil } }
        let body: [String: CloudJSON] = ["provider": .string(provider.rawValue), "mode": .string(mode.rawValue), "state": .string(proof.state), "codeChallenge": .string(proof.codeChallenge)]
        let value = try CloudJSON.decode(await data(path: "/api/auth/native/start", method: "POST", body: CloudJSON.encode(body), ownerID: owner))
        guard let transaction = value["transactionId"].string, NativeOAuthPolicy.isOpaque(transaction), value["expiresIn"].number == 600,
              let address = value["url"].string else { throw NativeOAuthPolicy.invalid() }
        let url = try NativeOAuthPolicy.launchURL(address, origin: baseURL)
        guard marker == generation, nativeStartingID == id, credential?.account.id == owner, credential?.token == parentToken else {
            _ = try? await data(path: "/api/auth/native/cancel", method: "POST", body: CloudJSON.encode(["transactionId": .string(transaction)]))
            throw Self.changed()
        }
        let flow = NativeOAuthFlow(id: id, url: url, expiresAt: startedAt.addingTimeInterval(600), mode: mode, ownerID: owner, transactionID: transaction, proof: proof)
        nativePending = NativePending(flow: flow, generation: marker, parentToken: parentToken)
        return flow
    }
    public func cancelNativeOAuth(flowID: UUID? = nil) async {
        if let flowID, nativePending?.flow.id != flowID, nativeStartingID != flowID { return }
        let transaction = nativePending?.flow.transactionID
        nativeStartingID = nil; nativePending = nil
        if let transaction { _ = try? await data(path: "/api/auth/native/cancel", method: "POST", body: CloudJSON.encode(["transactionId": .string(transaction)])) }
    }
    public func completeNativeOAuth(flowID: UUID, callbackURL: URL, persist: (@Sendable (CloudCredential) throws -> Void)? = nil) async throws -> CloudAccount {
        guard let pending = nativePending, pending.flow.id == flowID, !pending.exchanging,
              pending.generation == generation, pending.flow.ownerID == credential?.account.id, pending.parentToken == credential?.token,
              pending.flow.expiresAt > Date() else { throw Self.changed() }
        let callback: NativeOAuthCallback
        do { callback = try NativeOAuthPolicy.callback(callbackURL, expectedState: pending.flow.proof.state) }
        catch { await cancelNativeOAuth(flowID: flowID); throw error }
        guard case .code(let code) = callback else {
            await cancelNativeOAuth(flowID: flowID)
            if case .failure(let category) = callback { throw CloudRequestError(status: 400, message: NativeOAuthPolicy.errorMessage(category)) }
            throw NativeOAuthPolicy.invalid()
        }
        nativePending?.exchanging = true
        defer { if nativePending?.flow.id == flowID { nativePending = nil } }
        let (bytes, response) = try await perform(path: "/api/auth/native/exchange", method: "POST",
            body: CloudJSON.encode(["code": .string(code), "state": .string(pending.flow.proof.state), "codeVerifier": .string(pending.flow.proof.codeVerifier)]), ownerID: pending.flow.ownerID)
        guard nativePending?.flow.id == flowID, pending.generation == generation,
              credential?.account.id == pending.flow.ownerID, credential?.token == pending.parentToken else { throw Self.changed() }
        let value = try CloudJSON.decode(bytes)
        guard let account = Self.account(value["user"]), UUID(uuidString: account.id) != nil,
              let header = response.value(forHTTPHeaderField: "Set-Cookie"),
              let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: baseURL).first(where: { $0.name == "marginalia_session" }),
              cookie.isSecure, cookie.isHTTPOnly, NativeOAuthPolicy.isOpaque(cookie.value) else { throw NativeOAuthPolicy.invalid() }
        if pending.flow.mode == .link { guard account.id == pending.flow.ownerID, cookie.value == pending.parentToken else { throw Self.changed() } }
        let next = CloudCredential(account: account, token: cookie.value)
        try persist?(next)
        credential = next
        if pending.flow.mode == .signIn { generation = UUID() }
        return account
    }
    public func duplicateOriginal(_ bytes: Data, ownerID: String) async throws -> CloudJSON? {
        let result = try CloudJSON.decode(await data(path: "/api/library/upload/duplicate", method: "POST", body: CloudJSON.encode(["sha256": .string(Disk.hash(bytes))]), ownerID: ownerID))
        return result["duplicate"].object.isEmpty ? nil : result["duplicate"]
    }
    public func uploadOriginal(_ bytes: Data, filename: String, ownerID: String, duplicatePolicy: DuplicateImportPolicy = .keep, operationID: UUID = UUID(), progress: @Sendable (CloudUploadPhase) async -> Void = { _ in }) async throws -> CloudJSON {
        let limit = CloudOriginalUploadPolicy.maximumBytes(filename: filename)
        guard !bytes.isEmpty, Int64(bytes.count) <= limit else { throw CloudRequestError(status: 413, message: "文件为空或超过此格式的云端上传上限（\(limit / 1024 / 1024) MB），本机原件仍保留。") }
        await progress(.preparing)
        let target: CloudJSON
        do {
            target = try CloudJSON.decode(await data(path: "/api/library/upload/start", method: "POST", body: CloudJSON.encode(["filename": .string(filename), "bytes": .number(Double(bytes.count))]), ownerID: ownerID))
        } catch let error as CloudRequestError where error.status == 404 {
            await progress(.sending)
            return try CloudJSON.decode(await data(path: "/api/library/upload", method: "POST", body: CloudJSON.encode(["filename": .string(filename), "base64": .string(bytes.base64EncodedString()), "duplicatePolicy": .string(duplicatePolicy.rawValue), "operationId": .string(operationID.uuidString.lowercased()), "receiptOnly": .bool(true)]), ownerID: ownerID))
        }
        guard let id = target["id"].string, let address = target["url"].string, let url = URL(string: address),
              url.scheme == "https", url.user == nil, url.password == nil,
              url.path.hasPrefix("/storage/v1/object/upload/sign/"), credential?.account.id == ownerID else {
            throw CloudRequestError(status: 502, message: "上传地址无法核对，本机原件仍保留。")
        }
        let marker = generation
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"; request.httpBody = bytes
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        // Signed storage requests never carry the Leafhour session or owner header.
        await progress(.sending)
        let (_, response) = try await session.data(for: request)
        guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw CloudRequestError(status: 502, message: "文件尚未完整上传，请重试；原件仍保留在此设备。") }
        await progress(.processing)
        return try CloudJSON.decode(await data(path: "/api/library/upload/complete", method: "POST", body: CloudJSON.encode(["id": .string(id), "duplicatePolicy": .string(duplicatePolicy.rawValue), "operationId": .string(operationID.uuidString.lowercased()), "receiptOnly": .bool(true)]), ownerID: ownerID))
    }
    /// Streams only public answer text and typed tool requests; account fencing is checked at every suspension.
    public func streamChat(path: String, body: Data, ownerID: String,
                           onEvent: @escaping @Sendable (CloudJSON) async throws -> Void) async throws -> CloudJSON {
        guard path.hasPrefix("/api/library/"), !path.hasPrefix("//"),
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.host == baseURL.host, url.scheme == baseURL.scheme,
              url.scheme == "https" || ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""),
              credential?.account.id == ownerID else { throw Self.changed() }
        let marker = generation
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 300
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue(ownerID, forHTTPHeaderField: "X-Reader-Owner")
        request.setValue("marginalia_session=" + (credential?.token ?? ""), forHTTPHeaderField: "Cookie")
        let (bytes, response) = try await session.bytes(for: request)
        guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
        guard let response = response as? HTTPURLResponse else { throw CloudRequestError(status: 502, message: "陪读暂时没有回应。") }
        let streaming = response.value(forHTTPHeaderField: "Content-Type")?.contains("application/x-ndjson") == true
        if !(200..<300).contains(response.statusCode) || !streaming {
            var data = Data()
            for try await byte in bytes {
                guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
                guard data.count < 16 * 1024 * 1024 else { throw LibraryError.invalid("回答数据过大，请重试查看结果。") }
                data.append(byte)
            }
            let value = try CloudJSON.decode(data)
            guard (200..<300).contains(response.statusCode) else {
                throw CloudRequestError(status: response.statusCode, message: value["error"].string ?? "暂时无法完成回答。", billingOperationStatus: value["billingOperation"]["status"].string)
            }
            return value
        }
        var decoder = ChatStreamDecoder(), line = Data(), result: CloudJSON?
        func consume(_ event: CloudJSON) async throws {
            guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
            if event["type"].string == "error" {
                throw CloudRequestError(status: Int(event["status"].number ?? 500), message: event["error"].string ?? "回答中断，可重试查看结果。", billingOperationStatus: event["billingOperation"]["status"].string)
            }
            if event["type"].string == "result" { result = event["turn"] }
            try await onEvent(event)
            guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
        }
        for try await byte in bytes {
            try Task.checkCancellation()
            guard marker == generation, credential?.account.id == ownerID else { throw Self.changed() }
            line.append(byte)
            guard line.count <= 16 * 1024 * 1024 else { throw LibraryError.invalid("回答片段过大，请重试查看结果。") }
            if byte == 10 {
                for event in try decoder.append(line) { try await consume(event) }
                line.removeAll(keepingCapacity: true)
            }
        }
        for event in try decoder.append(line) + decoder.finish() { try await consume(event) }
        guard let result else { throw CloudRequestError(status: 502, message: "连接已中断，消息已保留，可重试查看结果。") }
        return result
    }

    private func perform(path: String, method: String, body: Data?, ownerID: String?, timeout: TimeInterval = 45) async throws -> (Data, HTTPURLResponse) {
        guard path.hasPrefix("/api/"), !path.hasPrefix("//"), let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.host == baseURL.host, url.scheme == baseURL.scheme,
              url.scheme == "https" || ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "") else {
            throw CloudRequestError(status: 400, message: "书房地址不安全或无效。")
        }
        let requiresAccount = !path.hasPrefix("/api/auth/")
        let owner = ownerID ?? (requiresAccount ? credential?.account.id : nil)
        if requiresAccount && owner == nil { throw CloudRequestError(status: 401, message: "请先登录自己的书房。") }
        if let owner, owner != credential?.account.id { throw Self.changed() }
        let marker = generation
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        if let credential { request.setValue("marginalia_session=" + credential.token, forHTTPHeaderField: "Cookie") }
        if let owner { request.setValue(owner, forHTTPHeaderField: "X-Reader-Owner") }
        let (bytes, response) = try await session.data(for: request)
        guard marker == generation else { throw Self.changed() }
        guard let response = response as? HTTPURLResponse else { throw CloudRequestError(status: 502, message: "书房暂时没有回应。") }
        guard (200..<300).contains(response.statusCode) else {
            let error = try? CloudJSON.decode(bytes)
            throw CloudRequestError(status: response.statusCode, message: error?["error"].string ?? "暂时无法连接书房，请稍后重试。", billingOperationStatus: error?["billingOperation"]["status"].string)
        }
        return (bytes, response)
    }
    private static func account(_ value: CloudJSON) -> CloudAccount? {
        guard let id = value["id"].string else { return nil }
        return CloudAccount(id: id, email: value["email"].string)
    }
    private static func changed() -> CloudRequestError { CloudRequestError(status: 409, message: "账号已切换，请重新打开自己的书房。") }
}

private final class NoCloudRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// A small typed JSON boundary keeps optional web fields forward compatible.
public enum CloudJSON: Codable, Equatable, Sendable {
    case object([String: CloudJSON]), array([CloudJSON]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let data = try? value.decode([String: CloudJSON].self) { self = .object(data) }
        else if let data = try? value.decode([CloudJSON].self) { self = .array(data) }
        else if let data = try? value.decode(String.self) { self = .string(data) }
        else if let data = try? value.decode(Bool.self) { self = .bool(data) }
        else { self = .number(try value.decode(Double.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self { case .object(let x): try value.encode(x); case .array(let x): try value.encode(x); case .string(let x): try value.encode(x); case .number(let x): try value.encode(x); case .bool(let x): try value.encode(x); case .null: try value.encodeNil() }
    }
    public subscript(_ key: String) -> CloudJSON { if case .object(let value) = self { return value[key] ?? .null }; return .null }
    public var string: String? { if case .string(let value) = self { return value }; return nil }
    public var number: Double? { if case .number(let value) = self { return value }; return nil }
    public var array: [CloudJSON] { if case .array(let value) = self { return value }; return [] }
    public var object: [String: CloudJSON] { if case .object(let value) = self { return value }; return [:] }
    public static func decode(_ data: Data) throws -> CloudJSON { try JSONDecoder().decode(Self.self, from: data) }
    public static func encode(_ object: [String: CloudJSON]) throws -> Data { try JSONEncoder().encode(Self.object(object)) }
    public static func component(_ string: String) -> String { string.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? "" }
}
