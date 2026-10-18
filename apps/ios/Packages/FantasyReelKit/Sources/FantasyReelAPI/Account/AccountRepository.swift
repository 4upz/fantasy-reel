import FantasyReelCore
import Foundation
import Supabase

/// What a delete-account request came back with (L-02).
public enum AccountDeletionOutcome: Sendable, Equatable {
    case deleted
    /// The last sign-in is older than 15 minutes; sign in again, then retry.
    case reauthRequired(message: String)
    /// A league the person is in is drafting; `leagues` names them.
    case liveDraft(leagues: [String], message: String)
}

/// The signed-in user's own account data (F-03, L-02): profile edits, the email
/// preference, and deleting the account.
public protocol AccountRepository: Sendable {
    func updateDisplayName(_ name: String, for userID: UserID) async throws(APIError)
    /// Nil removes the photo (the profile falls back to initials).
    func updateAvatarURL(_ url: String?, for userID: UserID) async throws(APIError)
    /// The Season recaps switch. A missing row means on.
    func seasonRecapEmails(for userID: UserID) async throws(APIError) -> Bool
    func setSeasonRecapEmails(_ enabled: Bool, for userID: UserID) async throws(APIError)
    /// Calls `delete-account`. Pass a fresh Sign in with Apple authorization
    /// code for an account that uses Apple, so the server can revoke it.
    func deleteAccount(appleAuthorizationCode: String?) async throws(APIError) -> AccountDeletionOutcome
}

public struct SupabaseAccountRepository: AccountRepository {
    private let client: SupabaseClient
    private let edgeFunctions: EdgeFunctionClient

    public init(provider: SupabaseProvider, edgeFunctions: EdgeFunctionClient) {
        self.client = provider.client
        self.edgeFunctions = edgeFunctions
    }

    public func updateDisplayName(_ name: String, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("profiles")
                .update(["display_name": name])
                .eq("user_id", value: userID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func updateAvatarURL(_ url: String?, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("profiles")
                .update(AvatarURLUpdate(avatarURL: url))
                .eq("user_id", value: userID.rawValue)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func seasonRecapEmails(for userID: UserID) async throws(APIError) -> Bool {
        do {
            let rows: [EmailPreferences] = try await client
                .from("email_preferences")
                .select("user_id, season_recap_emails")
                .eq("user_id", value: userID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first?.seasonRecapEmails ?? true
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func setSeasonRecapEmails(_ enabled: Bool, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("email_preferences")
                // Minimal: members can't read `unsubscribe_token`, so asking
                // for the row back (the default) is refused.
                .upsert(EmailPreferences(userID: userID, seasonRecapEmails: enabled), onConflict: "user_id", returning: .minimal)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func deleteAccount(appleAuthorizationCode: String?) async throws(APIError) -> AccountDeletionOutcome {
        do throws(APIError) {
            let _: DeleteAccountResponse = try await edgeFunctions.invoke(
                "delete-account",
                body: DeleteAccountRequest(confirmation: AccountDeletion.confirmationWord, appleAuthorizationCode: appleAuthorizationCode)
            )
            return .deleted
        } catch {
            if let outcome = AccountDeletion.outcome(for: error) { return outcome }
            throw error
        }
    }
}

/// The parts of account deletion that don't need a network, kept testable.
public enum AccountDeletion {
    /// What the person types, and what the function checks.
    public static let confirmationWord = "DELETE"

    /// Maps the function's refusals to outcomes; other errors stay errors.
    public static func outcome(for error: APIError) -> AccountDeletionOutcome? {
        guard case .server(let server) = error else { return nil }
        switch server.code {
        case "reauth_required":
            return .reauthRequired(message: server.message)
        case "live_draft":
            let leagues = server.body?["leagues"]?.arrayValue?.compactMap(\.stringValue) ?? []
            return .liveDraft(leagues: leagues, message: server.message)
        default:
            return nil
        }
    }
}

private struct DeleteAccountRequest: Encodable, Sendable {
    let confirmation: String
    let appleAuthorizationCode: String?

    enum CodingKeys: String, CodingKey {
        case confirmation
        case appleAuthorizationCode = "apple_authorization_code"
    }
}

private struct DeleteAccountResponse: Decodable, Sendable {
    let deleted: Bool
}

/// Encodes `avatar_url` even when nil, so removing a photo writes SQL NULL
/// (a synthesized encoder would leave the key out and change nothing).
private struct AvatarURLUpdate: Encodable, Sendable {
    let avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case avatarURL = "avatar_url"
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(avatarURL, forKey: .avatarURL)
    }
}

private struct EmailPreferences: Codable, Sendable {
    let userID: UserID
    let seasonRecapEmails: Bool

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case seasonRecapEmails = "season_recap_emails"
    }
}
