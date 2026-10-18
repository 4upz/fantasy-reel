import FantasyReelCore
import Foundation
import Supabase

/// This phone's push registration and the account's push switches (O-01).
public protocol PushRepository: Sendable {
    /// Registers this phone's APNs token to the signed-in account, moving it
    /// from whoever had it before (`register_push_device`).
    func register(token: String, environment: PushEnvironment, bundleID: String) async throws(APIError)
    /// Removes this phone's token from the signed-in account. Call before signing out.
    func unregister(token: String) async throws(APIError)
    /// The account's switches. No row means every category is on.
    func preferences(for userID: UserID) async throws(APIError) -> PushPreferences
    func savePreferences(_ preferences: PushPreferences, for userID: UserID) async throws(APIError)
}

/// Which APNs gateway the token is for: Debug builds get sandbox tokens,
/// TestFlight and App Store builds production ones.
public enum PushEnvironment: String, Sendable, Hashable {
    case sandbox
    case production
}

public struct SupabasePushRepository: PushRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func register(token: String, environment: PushEnvironment, bundleID: String) async throws(APIError) {
        do {
            try await client
                .rpc("register_push_device", params: [
                    "p_token": token,
                    "p_environment": environment.rawValue,
                    "p_bundle_id": bundleID,
                ])
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func unregister(token: String) async throws(APIError) {
        do {
            try await client.rpc("unregister_push_device", params: ["p_token": token]).execute()
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func preferences(for userID: UserID) async throws(APIError) -> PushPreferences {
        do {
            let rows: [PushPreferences] = try await client
                .from("push_preferences")
                .select("draft, bids, trades, my_movies, league_activity, season")
                .eq("user_id", value: userID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first ?? .allOn
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func savePreferences(_ preferences: PushPreferences, for userID: UserID) async throws(APIError) {
        do {
            try await client
                .from("push_preferences")
                .upsert(PushPreferencesRow(userID: userID, preferences: preferences), onConflict: "user_id", returning: .minimal)
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }
}

private struct PushPreferencesRow: Encodable {
    let userID: UserID
    let preferences: PushPreferences

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
    }

    func encode(to encoder: any Encoder) throws {
        try preferences.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
    }
}

/// Previews, screenshots and tests: remembers what was registered and saved.
public actor InMemoryPushRepository: PushRepository {
    public private(set) var registeredTokens: [String] = []
    public var storedPreferences: PushPreferences

    public init(preferences: PushPreferences = .allOn) {
        self.storedPreferences = preferences
    }

    public func register(token: String, environment: PushEnvironment, bundleID: String) async throws(APIError) {
        if !registeredTokens.contains(token) { registeredTokens.append(token) }
    }

    public func unregister(token: String) async throws(APIError) {
        registeredTokens.removeAll { $0 == token }
    }

    public func preferences(for userID: UserID) async throws(APIError) -> PushPreferences {
        storedPreferences
    }

    public func savePreferences(_ preferences: PushPreferences, for userID: UserID) async throws(APIError) {
        storedPreferences = preferences
    }
}
