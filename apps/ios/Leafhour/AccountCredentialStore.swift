import Foundation
import Security
import LeafhourCore

/// Only the opaque session is retained. Passwords remain in the login form's memory.
enum AccountCredentialStore {
    private static let service = "org.leafhour.native-session"
    static func read() -> CloudCredential? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "leafhour.com", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(CloudCredential.self, from: data)
    }
    static func write(_ credential: CloudCredential?) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "leafhour.com"]
        guard let credential else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw LibraryError.invalid("无法清除本机登录凭据，请重试退出。") }
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(credential), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) == errSecSuccess else { throw LibraryError.invalid("无法保存登录状态，请稍后重试。") }
        } else if status != errSecSuccess { throw LibraryError.invalid("无法保存登录状态，请稍后重试。") }
    }
}
