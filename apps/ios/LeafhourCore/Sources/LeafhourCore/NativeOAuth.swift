import Foundation
import CryptoKit
import Security

public enum NativeOAuthProvider: String, CaseIterable, Codable, Identifiable, Sendable {
    case google, apple
    public var id: String { rawValue }
    public var name: String { self == .apple ? "Apple" : "Google" }
}
public enum NativeOAuthMode: String, Sendable { case signIn = "sign-in", link }
public struct NativeOAuthProof: Equatable, Sendable {
    public let state: String
    public let codeVerifier: String
    public var codeChallenge: String { Self.challenge(for: codeVerifier) }
    public init(state: String, codeVerifier: String) throws {
        guard NativeOAuthPolicy.isOpaque(state), NativeOAuthPolicy.isOpaque(codeVerifier) else { throw NativeOAuthPolicy.invalid() }
        self.state = state; self.codeVerifier = codeVerifier
    }
    public static func generate() throws -> Self { try Self(state: random(), codeVerifier: random()) }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NativeOAuthPolicy.invalid() }
        return base64URL(Data(bytes))
    }
    public static func challenge(for verifier: String) -> String { base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    private static func base64URL(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
public struct NativeOAuthFlow: Sendable {
    public let id: UUID
    public let url: URL
    public let expiresAt: Date
    public let mode: NativeOAuthMode
    public let ownerID: String?
    let transactionID: String
    let proof: NativeOAuthProof
}
public enum NativeOAuthCallback: Equatable, Sendable { case code(String), failure(String) }
public enum NativeOAuthPolicy {
    public static let callbackScheme = "com.cubxxw.reader"
    public static let errors: Set<String> = ["cancelled", "expired", "unavailable", "conflict", "linking_disabled", "account_changed", "unverified_email", "failed"]
    public static func isOpaque(_ value: String) -> Bool {
        value.utf8.count == 43 && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
    }
    public static func launchURL(_ value: String, origin: URL) throws -> URL {
        guard let url = URL(string: value), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme == "https", origin.scheme == "https", url.host?.lowercased() == origin.host?.lowercased(), url.port == origin.port,
              url.user == nil, url.password == nil, url.fragment == nil,
              components.percentEncodedPath == "/api/auth/native/authorize", let query = components.queryItems,
              query.count == 1, query[0].name == "ticket", isOpaque(query[0].value ?? "") else { throw invalid() }
        return url
    }
    public static func callback(_ url: URL, expectedState: String) throws -> NativeOAuthCallback {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme?.lowercased() == callbackScheme, url.host?.lowercased() == "auth", components.percentEncodedPath == "/callback",
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil, let query = components.queryItems,
              query.count == 2, query.filter({ $0.name == "state" }).count == 1,
              query.first(where: { $0.name == "state" })?.value == expectedState, isOpaque(expectedState) else { throw invalid() }
        if let code = query.first(where: { $0.name == "code" })?.value, isOpaque(code), query.filter({ $0.name == "code" }).count == 1 { return .code(code) }
        if let error = query.first(where: { $0.name == "error" })?.value, errors.contains(error), query.filter({ $0.name == "error" }).count == 1 { return .failure(error) }
        throw invalid()
    }
    public static func errorMessage(_ code: String) -> String {
        switch code {
        case "cancelled": "已关闭登录窗口。"
        case "expired": "这次登录已过期，请重新开始。"
        case "conflict": "这个登录方式已属于另一个账号，现有书房没有合并。"
        case "linking_disabled": "此书房暂未开启账号关联，可以继续使用原来的登录方式。"
        case "account_changed": "账号已变化，请回到自己的书房后重试。"
        case "unverified_email": "请先在登录服务中验证邮箱，再继续登录。"
        default: "这个登录方式暂时无法完成，请稍后重试或使用邮箱登录。"
        }
    }
    static func invalid() -> CloudRequestError { CloudRequestError(status: 400, message: "登录回程无法安全核对，请重新开始。") }
}
public struct NativeAuthenticationStatus: Equatable, Sendable {
    public let available: Bool
    public let providers: Set<NativeOAuthProvider>
    init(_ json: CloudJSON) {
        available = json["nativeOAuth"]["version"].number == 1
        providers = Set(NativeOAuthProvider.allCases.filter { json["providers"][$0.rawValue] == .bool(true) })
    }
}
public struct CloudLinkedIdentity: Equatable, Identifiable, Sendable {
    public let provider: String
    public let email: String?
    public let emailVerified: Bool
    public var id: String { provider }
    init?(_ json: CloudJSON) {
        guard let provider = json["provider"].string, ["email", "google", "apple"].contains(provider) else { return nil }
        self.provider = provider; email = json["email"].string; emailVerified = json["emailVerified"] == .bool(true)
    }
}
