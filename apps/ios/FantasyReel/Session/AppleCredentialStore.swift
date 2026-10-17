import Foundation
import Security

/// What the app keeps about a Sign in with Apple, in the Keychain (L-01):
///
/// - the Apple user ID of the signed-in account, so the app can notice when
///   the person stops using Apple with Fantasy Reel (Settings → Apple ID →
///   Sign in with Apple) and sign out;
/// - the name Apple shared on a first authorization, until a sign-in with it
///   succeeds. Apple sends the name only once, so a failed attempt (offline,
///   say) would otherwise lose it for good.
enum AppleCredentialStore {
    private static let service = "com.fantasyreel.apple-sign-in"
    private static let signedInAccount = "signed-in-user"

    static var signedInAppleUserID: String? {
        get { read(signedInAccount) }
        set { write(newValue, account: signedInAccount) }
    }

    static func pendingName(for appleUserID: String) -> String? {
        read(nameAccount(appleUserID))
    }

    static func setPendingName(_ name: String?, for appleUserID: String) {
        write(name, account: nameAccount(appleUserID))
    }

    private static func nameAccount(_ appleUserID: String) -> String { "name-\(appleUserID)" }

    private static func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read(_ account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func write(_ value: String?, account: String) {
        let query = baseQuery(account)
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
