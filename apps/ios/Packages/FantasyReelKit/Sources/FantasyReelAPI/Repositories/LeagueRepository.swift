import FantasyReelCore
import Foundation
import Supabase

/// League and season reads the shell needs. Feature threads add their own
/// repositories beside this one rather than growing it.
public struct LeagueRepository: Sendable {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    /// Every season the signed-in user can see, newest first.
    ///
    /// RLS decides visibility, exactly like the web dashboard's
    /// `leagues.select('*')`; group the result with `LeagueDirectory`.
    public func fetchVisibleSeasons() async throws(APIError) -> [League] {
        do {
            return try await client
                .from("leagues")
                .select()
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// One season, re-read after a phase change. Nil when the user can no
    /// longer see it (left, removed, or deleted).
    public func fetchSeason(_ id: LeagueID) async throws(APIError) -> League? {
        do {
            let rows: [League] = try await client
                .from("leagues")
                .select()
                .eq("id", value: id.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }
}

/// The signed-in user's own profile row.
public struct ProfileRepository: Sendable {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchProfile(for userID: UserID) async throws(APIError) -> Profile? {
        do {
            let rows: [Profile] = try await client
                .from("profiles")
                .select()
                .eq("user_id", value: userID.rawValue)
                .limit(1)
                .execute()
                .value
            return rows.first
        } catch {
            throw APIError.wrap(error)
        }
    }
}

/// The notification inbox reads (F-17). The web loads the latest 50 and counts
/// unread among those; this matches it rather than promising an exact total.
public struct NotificationRepository: Sendable {
    public static let pageSize = 50
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchLatest(for userID: UserID) async throws(APIError) -> [AppNotification] {
        do {
            return try await client
                .from("notifications")
                .select()
                .eq("user_id", value: userID.rawValue)
                .order("created_at", ascending: false)
                .limit(Self.pageSize)
                .execute()
                .value
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// Marks notifications read. RLS lets a user update only `read_at` on their own rows.
    public func markRead(_ ids: [NotificationID], at date: Date = Date()) async throws(APIError) {
        guard !ids.isEmpty else { return }
        do {
            try await client
                .from("notifications")
                .update(["read_at": date])
                .in("id", values: ids.map(\.rawValue))
                .execute()
        } catch {
            throw APIError.wrap(error)
        }
    }
}
