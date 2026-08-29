import Foundation
import Security

/// Keychain-backed storage for the session token and the device identity.
/// Both survive app deletion, so a reinstall lands back on the same account.
enum KeychainService {
    private static let service = "com.theowu.audioqueue"
    private static let tokenAccount = "jwt"
    private static let deviceAccount = "deviceId"

    // MARK: - Session token

    static func saveToken(_ token: String) { save(token, account: tokenAccount) }
    static func loadToken() -> String? { load(account: tokenAccount) }
    static func deleteToken() { delete(account: tokenAccount) }

    // MARK: - Device identity

    /// Stable id for this install, created the first time it's needed.
    static func deviceId() -> String {
        if let existing = load(account: deviceAccount) { return existing }
        let generated = UUID().uuidString
        save(generated, account: deviceAccount)
        return generated
    }

    // MARK: - Storage

    private static func query(_ account: String) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
    }

    private static func save(_ value: String, account: String) {
        guard let data = value.data(using: .utf8) else { return }
        SecItemDelete(query(account) as CFDictionary)
        let attributes = query(account).merging([kSecValueData: data]) { $1 }
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private static func load(account: String) -> String? {
        let lookup = query(account).merging([
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]) { $1 }
        var result: AnyObject?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
